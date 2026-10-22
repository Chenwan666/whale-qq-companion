import {createHash} from 'node:crypto';

export class AdminOutreach {
  constructor({store,getConfig,sendTarget,sanitize=String,now=Date.now}){
    Object.assign(this,{store,getConfig,sendTarget,sanitize,now});
    store.db.exec('CREATE TABLE IF NOT EXISTS admin_outreach(id TEXT PRIMARY KEY,source TEXT,target TEXT,fingerprint TEXT,status TEXT,messageId TEXT,time INTEGER)');
  }
  async send(key,body){
    const cfg=this.getConfig();
    if(key!==`private:${cfg.ownerQQ}`)throw Error('跨会话发送仅管理员私聊可用');
    const target=String(body.target||''),message=String(body.message||'').trim(),requestId=String(body.requestId||'');
    if(!/^(private|group):[1-9]\d{0,11}$/.test(target))throw Error('请从真实聊天目录选择目标会话');
    const [kind,id]=target.split(':'),bucket=kind==='group'?'groups':'private';
    if((cfg.deny?.[bucket]||[]).map(String).includes(id)||!(kind==='private'&&id===String(cfg.ownerQQ))&&!(cfg.allow?.[bucket]||[]).map(String).includes(id))throw Error('目标会话未获发送许可');
    if(!message||message.length>500||message!==this.sanitize(message))throw Error('单次发送1～500字，不能包含令牌或敏感配置');
    if(body.confirm!==true||! /^[a-f0-9-]{36}$/i.test(requestId))throw Error('需要confirm=true和新的UUID requestId');
    const atUserId=body.atUserId==null?undefined:String(body.atUserId);
    if(atUserId&&(kind!=='group'||! /^[1-9]\d{0,11}$/.test(atUserId)))throw Error('@成员只支持群聊真实QQ号，不能@全体');
    const fingerprint=createHash('sha256').update(JSON.stringify([key,target,message,atUserId||null])).digest('hex');
    const previous=this.store.db.prepare('SELECT * FROM admin_outreach WHERE id=?').get(requestId);
    if(previous){if(previous.fingerprint!==fingerprint)throw Error('请求ID不能用于另一个发送内容');if(previous.status==='sent')return {sent:true,alreadySubmitted:true,target,messageId:previous.messageId};throw Error('上次发送结果不确定，请先查看目标聊天，不自动重发');}
    const count=this.store.db.prepare('SELECT count(*) n FROM admin_outreach WHERE source=? AND time>?').get(key,this.now()-60000).n;
    if(count>=6)throw Error('跨会话发送频率较高，请稍后再发');
    if(typeof this.sendTarget!=='function')throw Error('跨会话发送服务未连接');
    this.store.db.prepare('INSERT INTO admin_outreach VALUES(?,?,?,?,?,NULL,?)').run(requestId,key,target,fingerprint,'sending',this.now());
    try{
      const result=await this.sendTarget(target,message,atUserId);
      if(result?.message_id==null)throw Error('QQ没有返回实际消息ID');
      const messageId=String(result.message_id);
      this.store.db.prepare("UPDATE admin_outreach SET status='sent',messageId=? WHERE id=?").run(messageId,requestId);
      return {sent:true,target,messageId,instruction:'已通过管理员当前会话权限发送到目标会话；未借用目标令牌，不自动把私聊记忆合并到目标。发送成功只汇报一次，不重复提交。'};
    }catch(e){this.store.db.prepare("UPDATE admin_outreach SET status='uncertain' WHERE id=?").run(requestId);throw Error('跨会话发送失败或结果不确定，不自动重试：'+e.message);}
  }
}
