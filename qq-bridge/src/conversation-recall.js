import {createHash} from 'node:crypto';

export class ConversationRecall {
  constructor({store,onebot,getConfig}){
    Object.assign(this,{store,onebot,getConfig});
    store.db.exec('CREATE TABLE IF NOT EXISTS message_recalls(id TEXT PRIMARY KEY,fingerprint TEXT,status TEXT,time INTEGER)');
    store.db.exec('CREATE TABLE IF NOT EXISTS message_recall_notices(target TEXT,messageId TEXT,time INTEGER,PRIMARY KEY(target,messageId))');
  }
  observe(event){
    if(event?.post_type!=='notice'||!['friend_recall','group_recall'].includes(event.notice_type)||!event.self_id||String(event.user_id)!==String(event.self_id)||! /^-?\d+$/.test(String(event.message_id)))return;
    const target=event.notice_type==='group_recall'?`group:${event.group_id}`:`private:${event.target_id||event.user_id}`;
    if(!/^(private|group):[1-9]\d*$/.test(target))return;
    this.store.db.prepare('INSERT OR REPLACE INTO message_recall_notices VALUES(?,?,?)').run(target,String(event.message_id),Date.now());
  }
  verified(target,id){return !!this.store.db.prepare('SELECT 1 FROM message_recall_notices WHERE target=? AND messageId=?').get(target,String(id));}
  async recall(key,{messageId,target=key,confirm,requestId}){
    const cfg=this.getConfig(),owner=key===`private:${cfg.ownerQQ}`;
    if(!/^(private|group):[1-9]\d*$/.test(target)||(!owner&&target!==key))throw Error('只能撤回当前会话，管理员可指定已许可会话');
    const [kind,id]=target.split(':'),bucket=kind==='group'?'groups':'private';
    if(!(kind==='private'&&String(cfg.ownerQQ)===id)&&!(cfg.allow?.[bucket]||[]).map(String).includes(id)|| (cfg.deny?.[bucket]||[]).map(String).includes(id))throw Error('目标会话未获许可');
    if(!/^-?\d+$/.test(String(messageId))||confirm!==true||! /^[a-f0-9-]{36}$/i.test(String(requestId||'')))throw Error('需要真实消息ID、confirm=true和新的UUID requestId');
    const fingerprint=createHash('sha256').update(JSON.stringify([key,target,String(messageId)])).digest('hex');
    const old=this.store.db.prepare('SELECT * FROM message_recalls WHERE id=?').get(requestId);
    if(old){if(old.fingerprint!==fingerprint)throw Error('请求ID不能用于另一项撤回');if(old.status==='submitted')return {submitted:true,verified:this.verified(target,messageId),alreadySubmitted:true,target,messageId};throw Error('上次撤回结果不确定，不自动重复提交');}
    const message=await this.onebot('get_msg',{message_id:String(messageId)}),login=await this.onebot('get_login_info',{});
    if(!login?.user_id||String(message?.sender?.user_id||message?.user_id)!==String(login.user_id))throw Error('只能撤回小鲸鱼自己发出的消息');
    if(kind==='group'){
      if(message.message_type!=='group'||String(message.group_id)!==id)throw Error('消息不属于目标群聊');
    }else{
      if(message.message_type!=='private')throw Error('消息不属于目标私聊');
      // SnowLuma returns target_id for outgoing private messages. History cursors
      // are exclusive and therefore cannot prove ownership of the anchor itself.
      if(message.target_id!==undefined&&message.target_id!==null){
        if(String(message.target_id)!==id)throw Error('消息不属于目标私聊');
      }else{
        const history=await this.onebot('get_friend_msg_history',{user_id:Number(id),message_id:0,count:100,reverse_order:true});
        const rows=Array.isArray(history)?history:history?.messages;
        if(!Array.isArray(rows)||!rows.some(m=>String(m.message_id)===String(messageId)&&String(m.sender?.user_id||m.user_id)===String(login.user_id)))throw Error('无法在目标私聊核实这条消息，未撤回');
      }
    }
    this.store.db.prepare('INSERT INTO message_recalls VALUES(?,?,?,?)').run(requestId,fingerprint,'pending',Date.now());
    try{
      await this.onebot('delete_msg',{message_id:String(messageId)});
      this.store.db.prepare("UPDATE message_recalls SET status='submitted' WHERE id=?").run(requestId);
      for(let i=0;i<4&&!this.verified(target,messageId);i++)await new Promise(r=>setTimeout(r,250));
      const verified=this.verified(target,messageId);
      return {submitted:true,verified,target,messageId,note:verified?'已收到QQ实际撤回通知。':'QQ接口已接受撤回；尚未收到本会话撤回通知，接收端显示未独立核验。不自动重试。'};
    }catch(e){this.store.db.prepare("UPDATE message_recalls SET status='uncertain' WHERE id=?").run(requestId);throw Error('撤回失败或结果不确定，不自动重试：'+e.message);}
  }
}
