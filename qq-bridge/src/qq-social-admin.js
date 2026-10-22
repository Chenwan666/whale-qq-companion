import {createHash} from 'node:crypto';
export class QQSocialAdmin {
 constructor({store,onebot,authorizeGroup,getConfig,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){Object.assign(this,{store,onebot,authorizeGroup,getConfig,sleep});store.db.exec('CREATE TABLE IF NOT EXISTS qq_requests(id TEXT PRIMARY KEY,kind TEXT,flag TEXT,userId INTEGER,groupId INTEGER,subType TEXT,comment TEXT,status TEXT,time INTEGER)');store.db.exec('CREATE TABLE IF NOT EXISTS qq_owned_groups(groupId INTEGER PRIMARY KEY,name TEXT,verifiedAt INTEGER); CREATE TABLE IF NOT EXISTS qq_group_actions(id TEXT PRIMARY KEY,status TEXT,time INTEGER,fingerprint TEXT)');}
 record(event){
  if(event?.post_type!=='request'||!['friend','group'].includes(event.request_type)||typeof event.flag!=='string'||!event.flag||event.flag.length>2000)return false;
  const id=createHash('sha256').update(event.request_type+':'+event.flag).digest('hex').slice(0,32);
  this.store.db.prepare('INSERT OR IGNORE INTO qq_requests VALUES(?,?,?,?,?,?,?,?,?)').run(id,event.request_type,event.flag,Number(event.user_id)||0,Number(event.group_id)||0,String(event.sub_type||'add'),String(event.comment||'').slice(0,1000),'pending',Date.now());return true;
 }
 list(){return this.store.db.prepare('SELECT id,kind,userId,groupId,subType,comment,status,time FROM qq_requests ORDER BY time DESC LIMIT 50').all();}
 async handle(body){
  const r=this.store.db.prepare('SELECT * FROM qq_requests WHERE id=?').get(String(body.id||''));if(!r)throw Error('申请ID必须来自真实申请收件箱');
  if(typeof body.approve!=='boolean')throw Error('请明确是否通过申请');if(r.status==='done')return {handled:true,alreadySubmitted:true,id:r.id};if(r.status!=='pending')throw Error('申请结果未确定，请核对实际好友或群成员，不重复提交');
  if(r.kind==='group'&&!this.store.db.prepare('SELECT 1 FROM qq_owned_groups WHERE groupId=?').get(r.groupId))throw Error('仅管理已验证属于机器人自己的群申请');
  if(r.kind==='group')await this.verifyOwner(r.groupId);
  this.store.db.prepare("UPDATE qq_requests SET status='submitting' WHERE id=?").run(r.id);
  try{await this.onebot(r.kind==='friend'?'set_friend_add_request':'set_group_add_request',{flag:r.flag,approve:body.approve,...(r.kind==='group'?{sub_type:r.subType,reason:String(body.reason||'').slice(0,200)}:{})});this.store.db.prepare("UPDATE qq_requests SET status='done' WHERE id=?").run(r.id);return {handled:true,approved:body.approve,id:r.id,userId:r.userId,groupId:r.groupId};}
  catch{this.store.db.prepare("UPDATE qq_requests SET status='uncertain' WHERE id=?").run(r.id);throw Error('申请处理失败或结果不确定，请核对真实状态，不自动重复提交');}
 }
 async registerOwned(groupId){
  const id=Number(groupId);if(!Number.isSafeInteger(id)||id<=0)throw Error('请提供真实群号');
  const login=await this.onebot('get_login_info',{});const member=await this.onebot('get_group_member_info',{group_id:id,user_id:login.user_id,no_cache:true});
  if(member?.role!=='owner')throw Error('未验证机器人为群主，不自动授予群对话许可');
  const info=await this.onebot('get_group_info',{group_id:id,no_cache:true});
  this.store.db.prepare('INSERT OR REPLACE INTO qq_owned_groups VALUES(?,?,?)').run(id,String(info.group_name||'').slice(0,200),Date.now());
  if(!this.authorizeGroup)throw Error('群许可回写尚未接入');await this.authorizeGroup(id);
  return {groupId:id,name:info.group_name,botIsOwner:true,chatAllowed:true};
 }
 owned(){return this.store.db.prepare('SELECT * FROM qq_owned_groups ORDER BY verifiedAt DESC').all();}
 isOwned(groupId){return !!this.store.db.prepare('SELECT 1 FROM qq_owned_groups WHERE groupId=?').get(Number(groupId));}
 async verifyOwner(groupId){
  if(!this.isOwned(groupId))throw Error('这个群还未登记为机器人自己的群');
  const login=await this.onebot('get_login_info',{});const self=await this.onebot('get_group_member_info',{group_id:Number(groupId),user_id:login.user_id,no_cache:true});if(self?.role!=='owner')throw Error('机器人已不再是这个群的群主');return login;
 }
 async verifyTitle(groupId,userId,expected){
  let actual=null;
  for(const delay of [0,250,750]){
   if(delay)await this.sleep(delay);
   try{const member=await this.onebot('get_group_member_info',{group_id:groupId,user_id:userId,no_cache:true});actual=typeof member?.title==='string'?member.title:typeof member?.special_title==='string'?member.special_title:null;if(actual===expected)return {verified:true,actualTitle:actual};}catch{}
  }
  return {verified:false,actualTitle:actual};
 }
 async manage(key,body){
  const id=Number(body.groupId),cfg=this.getConfig();if(!Number.isSafeInteger(id)||id<=0)throw Error('无效群号');
  const admin=key===`private:${cfg.ownerQQ}`;
  if(!admin&&key!==`group:${id}`)throw Error('群工具只能管理当前群');
  const login=await this.verifyOwner(id),base={group_id:id},op=body.operation;
  if(op==='info'){const info=await this.onebot('get_group_info',{...base,no_cache:true});if(typeof info?.group_name==='string')this.store.db.prepare('UPDATE qq_owned_groups SET name=?,verifiedAt=? WHERE groupId=?').run(info.group_name.slice(0,200),Date.now(),id);return info;}
  if(op==='members'){const r=await this.onebot('get_group_member_list',{...base,no_cache:true});return (Array.isArray(r)?r:[]).slice(0,100).map(m=>({user_id:m.user_id,nickname:m.nickname,card:m.card,role:m.role,title:m.title??m.special_title??null,title_expire_time:m.title_expire_time??null}));}
  if(op==='notices')return this.onebot('_get_group_notice',base);
  if(op==='requests')return this.list().filter(r=>r.kind==='group'&&r.groupId===id);
  if(body.confirm!==true)throw Error('请明确提交群管理操作');
  if(op==='request-handle'){
   const request=this.store.db.prepare('SELECT kind,groupId FROM qq_requests WHERE id=?').get(String(body.id||''));
   if(!request||request.kind!=='group'||request.groupId!==id)throw Error('只能处理本群真实入群申请');
   return this.handle(body);
  }
  const uid=Number(body.userId);let action,params;
  if(['title','card','admin','ban','kick'].includes(op)){
   if(!Number.isSafeInteger(uid)||uid<=0)throw Error('请提供真实成员QQ号');
   await this.onebot('get_group_member_info',{...base,user_id:uid,no_cache:true});
  }
  if(['ban','kick'].includes(op)&&[Number(cfg.ownerQQ),Number(login.user_id)].includes(uid))throw Error('不能对管理员或机器人自己执行禁言或踢人');
  const text=String(body.text||'');
  if(op==='title'){if(Buffer.byteLength(text,'utf8')>18)throw Error('头衔最多18字节，通常6个汉字');action='set_group_special_title';params={...base,user_id:uid,special_title:text};}
  if(op==='card'){if(text.length>60)throw Error('群名片最多60字');action='set_group_card';params={...base,user_id:uid,card:text};}
  if(op==='name'){if(!text||text.length>60)throw Error('群名需要1～60字');action='set_group_name';params={...base,group_name:text};}
  if(op==='notice'){if(!text||text.length>2000)throw Error('公告需要1～2000字');action='_send_group_notice';params={...base,content:text,pinned:body.pinned?1:0,confirm_required:0};}
  if(op==='admin'){action='set_group_admin';params={...base,user_id:uid,enable:body.enabled!==false};}
  if(op==='ban'){const duration=Number(body.duration??60);if(!Number.isInteger(duration)||duration<0||duration>2592000)throw Error('禁言时长需0～30天，0表示解除');action='set_group_ban';params={...base,user_id:uid,duration};}
  if(op==='kick'){action='set_group_kick';params={...base,user_id:uid,reject_add_request:false};}
  if(op==='whole-ban'){action='set_group_whole_ban';params={...base,enable:body.enabled!==false};}
  if(!action)throw Error('未接入此群管理动作');
  const req=String(body.requestId||'');if(!/^[a-f0-9-]{36}$/i.test(req))throw Error('群管理写操作需要UUID requestId');
  const fingerprint=createHash('sha256').update(JSON.stringify([key,action,params])).digest('hex'),old=this.store.db.prepare('SELECT * FROM qq_group_actions WHERE id=?').get(req);
  if(old){if(old.fingerprint!==fingerprint)throw Error('不能复用其他操作的编号');if(op==='title'){const verification=await this.verifyTitle(id,uid,text);this.store.db.prepare('UPDATE qq_group_actions SET status=? WHERE id=?').run(verification.verified?'done':'unverified',req);return {done:verification.verified,submitted:true,alreadySubmitted:true,operation:op,requestedTitle:text,...verification,note:verification.verified?'已从QQ成员资料读回相同头衔':'未读回期望头衔，不能声称设置成功；没有重复写入'};}if(old.status==='done')return {done:true,alreadySubmitted:true};throw Error('此前群操作结果不确定，先核对，不重复提交');}
  this.store.db.prepare('INSERT INTO qq_group_actions VALUES(?,?,?,?)').run(req,'pending',Date.now(),fingerprint);
  try{const result=await this.onebot(action,params);if(op==='title'){const verification=await this.verifyTitle(id,uid,text);this.store.db.prepare('UPDATE qq_group_actions SET status=? WHERE id=?').run(verification.verified?'done':'unverified',req);return {done:verification.verified,submitted:true,operation:op,requestedTitle:text,...verification,note:verification.verified?'已从QQ成员资料读回相同头衔':'QQ接口已接受，但尚未读回期望头衔；不能声称设置成功，不自动重发'};}this.store.db.prepare("UPDATE qq_group_actions SET status='done' WHERE id=?").run(req);if(op==='name')this.store.db.prepare('UPDATE qq_owned_groups SET name=?,verifiedAt=? WHERE groupId=?').run(text,Date.now(),id);return {done:true,operation:op,result};}catch{this.store.db.prepare("UPDATE qq_group_actions SET status='uncertain' WHERE id=?").run(req);throw Error('群管理失败或结果不确定，请核对真实状态');}
 }
}
