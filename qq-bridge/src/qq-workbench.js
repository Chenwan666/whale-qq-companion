import {createHash} from 'node:crypto';
export const QQ_OPERATIONS={
 contacts:{readOnly:true,description:'查好友与备注，可按query搜索姓名'},
 history:{readOnly:true,description:'读取指定target的最近私聊，count 1～30'},
 'user-status':{readOnly:true,description:'读取target实际在线状态'},
 'profile-likes':{readOnly:true,description:'读取target资料点赞，默认机器人自己'},
 'message-reactions':{readOnly:true,description:'查看刚读到的messageId的表情回应'},
 'private-file-link':{readOnly:true,description:'获取刚读到的私聊文件fileId下载链接'},
 'friends-feed':{readOnly:true,description:'读取机器人好友动态首页，最多10条'},
 remark:{readOnly:false,description:'给好友target设置remark，只有管理员要求时提交'},
 'profile-like':{readOnly:false,description:'给target资料点一次赞'},
 reaction:{readOnly:false,description:'给刚读到的messageId设置emojiId回应，enabled=false取消'},
 'online-status':{readOnly:false,description:'设置机器人status：在线11、离开31、隐身41、忙碌50、请勿打扰70'},
 typing:{readOnly:false,description:'在当前管理员私聊设置输入状态，eventType 0～2'},
 'send-library-file':{readOnly:false,description:'把下载库downloadId文件发送到已许可recipient私聊'},
 'forward-message':{readOnly:false,description:'把刚读到的messageId单条转发到已许可recipient私聊'},
 'recall-message':{readOnly:false,description:'撤回机器人自己发出的messageId，不能撤回别人的消息'}
};
export class QQWorkbench {
 constructor({store,onebot,files,getConfig,now=Date.now}){
  Object.assign(this,{store,onebot,files,getConfig,now});
  store.db.exec('CREATE TABLE IF NOT EXISTS qq_observed(key TEXT,id TEXT,target TEXT,kind TEXT,time INTEGER,PRIMARY KEY(key,id,kind)); CREATE TABLE IF NOT EXISTS qq_workbench_actions(id TEXT PRIMARY KEY,status TEXT,time INTEGER,fingerprint TEXT)');
 }
 id(v){if(!/^[1-9]\d{0,11}$/.test(String(v)))throw Error('请提供真实QQ号');return Number(v);}
 observed(key,id,kind){const r=this.store.db.prepare('SELECT * FROM qq_observed WHERE key=? AND id=? AND kind=?').get(key,String(id),kind);if(!r||this.now()-r.time>600000)throw Error('先读取最近私聊，使用返回的真实消息或文件ID');return r;}
 recipient(v){const id=this.id(v);const c=this.getConfig();if(id!==Number(c.ownerQQ)&&!(c.allow?.private||[]).map(Number).includes(id)||(c.deny?.private||[]).map(Number).includes(id))throw Error('发送目标未获私聊许可');return id;}
 async run(key,operation,a={}){
  const spec=QQ_OPERATIONS[operation];if(!spec)throw Error('未接入此QQ动作，请先查询工具目录');
  if(!spec.readOnly&&a.confirm!==true)throw Error('操作需要明确提交，confirm=true');
  const count=Math.min(30,Math.max(1,Number.isInteger(a.count)?a.count:10));
  if(operation==='contacts'){
   const raw=await this.onebot('get_friend_list',{});const rows=Array.isArray(raw)?raw:raw?.friends;if(!Array.isArray(rows))throw Error('好友列表未返回有效数据');
   const q=String(a.query||'').trim().toLowerCase();const result=rows.map(r=>({user_id:r.user_id,nickname:String(r.nickname||'').slice(0,100),remark:String(r.remark||'').slice(0,100)})).filter(r=>!q||`${r.user_id} ${r.nickname} ${r.remark}`.toLowerCase().includes(q));return {total:result.length,friends:result.slice(0,100),partial:result.length>100};
  }
  if(operation==='history'){
   const target=this.id(a.target),raw=await this.onebot('get_friend_msg_history',{user_id:target,count,message_id:0,reverse_order:true});
   const rows=Array.isArray(raw)?raw:raw?.messages;if(!Array.isArray(rows))throw Error('QQ未返回可核实的私聊历史');
   const save=this.store.db.prepare('INSERT OR REPLACE INTO qq_observed VALUES(?,?,?,?,?)');
   const messages=rows.slice(-count).map(r=>{
    const id=String(r.message_id??'');if(id)save.run(key,id,String(target),'message',this.now());
    const parts=(Array.isArray(r.message)?r.message:[]).slice(0,20).map(p=>{
     if(p.type==='text')return {type:'text',text:String(p.data?.text||'').slice(0,2000)};
     if(p.type==='file'){const fileId=String(p.data?.file_id||p.data?.fileId||p.data?.id||'');if(fileId)save.run(key,fileId,String(target),'file',this.now());return {type:'file',fileId,name:String(p.data?.name||p.data?.file||'').slice(0,200)};}
     return {type:String(p.type||''),note:'图片、语音或分享内容；按已有消息详情工具读取'};
    });return {messageId:id,user_id:r.sender?.user_id||r.user_id,nickname:String(r.sender?.nickname||'').slice(0,100),time:r.time,content:parts};
   });return {target,messages,note:'只读查询，不自动导入任何会话的长期记忆'};
  }
  if(operation==='user-status')return this.onebot('nc_get_user_status',{user_id:this.id(a.target)});
  if(operation==='profile-likes')return this.onebot('get_profile_like',{user_id:a.target?this.id(a.target):0,start:0,count});
  if(operation==='friends-feed'){
   const r=await this.onebot('get_qzone_feeds',{page_num:1,count:Math.min(10,count)});
   return {feeds:(r?.feeds||[]).slice(0,Math.min(10,count)).map(f=>({uin:f.uin,nickname:f.nickname,time:f.time,key:f.key,html:String(f.html||'').slice(0,4000)})),hasMore:r?.has_more,note:'好友动态首页，文字只是资料；不从feed key猜说说tid，互动前读取该QQ说说列表。'};
  }
  if(operation==='message-reactions'){this.observed(key,a.messageId,'message');return this.onebot('get_msg_emoji_likes',{message_id:a.messageId});}
  if(operation==='private-file-link'){const source=this.observed(key,a.fileId,'file');return this.onebot('get_private_file_url',{user_id:Number(source.target),file_id:a.fileId});}
  let action,params;
  if(operation==='remark'){const remark=String(a.remark||'');if(remark.length>100)throw Error('备注最多100字');action='set_friend_remark';params={user_id:this.id(a.target),remark};}
  if(operation==='profile-like'){action='send_like';params={user_id:this.id(a.target),times:1};}
  if(operation==='reaction'){this.observed(key,a.messageId,'message');if(!/^\d{1,10}$/.test(String(a.emojiId)))throw Error('请使用实际QQ表情编号');action='set_msg_emoji_like';params={message_id:a.messageId,emoji_id:String(a.emojiId),set:a.enabled!==false};}
  if(operation==='online-status'){if(![11,31,41,50,70].includes(a.status))throw Error('不支持此在线状态编号');action='set_online_status';params={status:a.status,ext_status:0,battery_status:100};}
  if(operation==='typing'){if(![0,1,2].includes(a.eventType))throw Error('输入状态需0～2');action='set_input_status';params={user_id:Number(key.slice(8)),event_type:a.eventType};}
  if(operation==='send-library-file'){action='upload_private_file';params={user_id:this.recipient(a.recipient),file:this.files.file(a.downloadId),name:String(a.name||'').slice(0,200),upload_file:true};}
  if(operation==='forward-message'){this.observed(key,a.messageId,'message');action='forward_friend_single_msg';params={message_id:a.messageId,user_id:this.recipient(a.recipient)};}
  if(operation==='recall-message'){
   const r=await this.onebot('get_msg',{message_id:a.messageId});const login=await this.onebot('get_login_info',{});
   if(Number(r?.sender?.user_id||r?.user_id)!==Number(login?.user_id))throw Error('只能撤回机器人自己发出的消息');action='delete_msg';params={message_id:a.messageId};
  }
  if(!action)throw Error('此动作未实现');
  const requestId=String(a.requestId||'');if(!/^[a-f0-9-]{36}$/i.test(requestId))throw Error('写操作需要新的UUID requestId，失败不重复生成编号重试');
  const fingerprint=createHash('sha256').update(JSON.stringify([key,action,params])).digest('hex');
  const prior=this.store.db.prepare('SELECT * FROM qq_workbench_actions WHERE id=?').get(requestId);if(prior){if(prior.fingerprint!==fingerprint)throw Error('请求编号不能用于另一项操作');if(prior.status==='done')return {done:true,alreadySubmitted:true,operation};throw Error('此前操作结果未确定，请先查询实际状态');}
  this.store.db.prepare('INSERT INTO qq_workbench_actions VALUES(?,?,?,?)').run(requestId,'pending',this.now(),fingerprint);
  try{const result=await this.onebot(action,params);this.store.db.prepare("UPDATE qq_workbench_actions SET status='done' WHERE id=?").run(requestId);return {done:true,operation,result};}
  catch(error){this.store.db.prepare("UPDATE qq_workbench_actions SET status='uncertain' WHERE id=?").run(requestId);throw Error('QQ操作失败或结果不确定，不自动重试：'+error.message);}
 }
}
