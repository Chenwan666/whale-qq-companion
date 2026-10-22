import {createHash} from 'node:crypto';
import path from 'node:path';

export class ConversationFiles {
  constructor({store,files,onebot,getConfig,root}){
    Object.assign(this,{store,files,onebot,getConfig,root});
    store.db.exec('CREATE TABLE IF NOT EXISTS received_files(key TEXT,messageId TEXT,fileId TEXT,name TEXT,userId TEXT,busid INTEGER,time INTEGER,PRIMARY KEY(key,messageId,fileId)); CREATE TABLE IF NOT EXISTS file_transfers(id TEXT PRIMARY KEY,fingerprint TEXT,status TEXT,time INTEGER)');
  }
  isOwner(key){return key===`private:${this.getConfig().ownerQQ}`;}
  observe(key,event){
    const segments=Array.isArray(event.message)?event.message:[];
    for(const s of segments){
      if(s.type!=='file')continue;const d=s.data||{},messageId=String(event.message_id??event.msg_id??''),fileId=String(d.file_id||d.fileId||d.id||'');
      if(!messageId||!fileId)continue;
      this.store.db.prepare('INSERT OR IGNORE INTO received_files VALUES(?,?,?,?,?,?,?)').run(key,messageId,fileId,String(d.name||d.file||'download.bin').slice(0,200),String(event.user_id||event.sender?.user_id||''),Number(d.busid||d.bus_id)||0,Date.now());
    }
  }
  list(key){return {files:this.files.scoped(key,this.isOwner(key)),received:this.store.db.prepare('SELECT messageId,fileId,name,userId,time FROM received_files WHERE key=? ORDER BY time DESC LIMIT 50').all(key),limits:{fileMB:20,textPage:12000,archiveMemberMB:8}};}
  observeUpload(key,event){
    const file=event.file||{};if(!key.startsWith('group:')||!file.id)return null;
    const messageId='upload:'+createHash('sha256').update(`${key}:${file.id}`).digest('hex');
    this.observe(key,{user_id:event.user_id,message_id:messageId,message:[{type:'file',data:{file_id:file.id,name:file.name,busid:file.busid}}]});return messageId;
  }
  async receive(key,{messageId,fileId}){
    let message;
    if(/^upload:[a-f0-9]{64}$/.test(String(messageId))){
      const observed=this.store.db.prepare('SELECT * FROM received_files WHERE key=? AND messageId=?').get(key,messageId);
      if(!observed||!key.startsWith('group:'))throw Error('没有本群的实际文件上传记录');
      message={message_type:'group',group_id:key.slice(6),user_id:observed.userId,message:[{type:'file',data:{file_id:observed.fileId,name:observed.name,busid:observed.busid}}]};
    }else{
      if(!/^-?\d+$/.test(String(messageId)))throw Error('请提供真实QQ消息ID');
      message=await this.onebot('get_msg',{message_id:String(messageId)});
    }
    const match=key.startsWith('group:')?message.message_type==='group'&&String(message.group_id)===key.slice(6):message.message_type==='private'&&String(message.sender?.user_id||message.user_id)===key.slice(8);
    if(!match)throw Error('不能读取其他会话的文件消息');
    this.observe(key,{...message,message_id:messageId});
    const segments=(Array.isArray(message.message)?message.message:[]).filter(s=>s.type==='file');
    const segment=fileId?segments.find(s=>String(s.data?.file_id||s.data?.fileId||s.data?.id)===String(fileId)):segments.length===1?segments[0]:null;
    if(!segment)throw Error('没有找到文件，多个文件时请指定真实fileId');
    const d=segment.data||{},id=String(d.file_id||d.fileId||d.id||'');if(!id)throw Error('QQ未返回可下载文件ID');
    const params=key.startsWith('group:')?{group_id:Number(key.slice(6)),file_id:id,busid:Number(d.busid||d.bus_id)||0}:{user_id:Number(key.slice(8)),file_id:id,file_hash:String(d.file_hash||'')};
    const link=await this.onebot(key.startsWith('group:')?'get_group_file_url':'get_private_file_url',params);
    const url=typeof link==='string'?link:link?.url;
    if(!/^https?:\/\//i.test(url||''))throw Error('QQ未返回可下载文件链接');
    return this.files.receive(url,d.name||d.file||'download.bin',key,`qq:${messageId}:${id}`);
  }
  read(key,body){return this.files.inspect(body.id,key,{owner:this.isOwner(key),member:body.member,offset:body.offset,limit:body.limit,readerScript:path.join(this.root,'scripts','read-companion-file.py')});}
  async send(key,body){
    const owner=this.isOwner(key),row=this.files.scopedRow(body.id,key,owner),target=String(body.target||key);
    if(!/^(private|group):[1-9]\d*$/.test(target))throw Error('目标会话格式无效');
    if(!owner&&target!==key)throw Error('普通会话只能向当前会话发送文件');
    const cfg=this.getConfig(),[kind,id]=target.split(':');
    const allowed=kind==='private'?(String(cfg.ownerQQ)===id||(cfg.allow?.private||[]).map(String).includes(id)):(cfg.allow?.groups||[]).map(String).includes(id);
    if(!allowed||(cfg.deny?.[kind==='private'?'private':'groups']||[]).map(String).includes(id))throw Error('目标会话尚未获许可');
    if(body.confirm!==true||! /^[a-f0-9-]{36}$/i.test(String(body.requestId||'')))throw Error('发送需confirm=true和新的UUID requestId');
    const file=this.files.file(row.id),name=row.name,fingerprint=createHash('sha256').update(JSON.stringify([key,target,row.id,name])).digest('hex');
    const old=this.store.db.prepare('SELECT * FROM file_transfers WHERE id=?').get(body.requestId);
    if(old){if(old.fingerprint!==fingerprint)throw Error('请求ID不能复用到其他文件');if(old.status==='done')return {sent:true,alreadySubmitted:true,target,name};throw Error('上次发送结果不确定，请核查QQ，不自动重复发送');}
    this.store.db.prepare('INSERT INTO file_transfers VALUES(?,?,?,?)').run(body.requestId,fingerprint,'pending',Date.now());
    try{
      const result=await this.onebot(kind==='group'?'upload_group_file':'upload_private_file',{[kind==='group'?'group_id':'user_id']:Number(id),file,name,...(kind==='private'?{upload_file:true}:{})});
      if(!result?.file_id)throw Error('QQ没有返回真实文件ID，无法确认上传');
      this.store.db.prepare("UPDATE file_transfers SET status='done' WHERE id=?").run(body.requestId);
      return {sent:true,target,name,result};
    }catch(e){this.store.db.prepare("UPDATE file_transfers SET status='uncertain' WHERE id=?").run(body.requestId);throw Error('文件发送失败或结果不确定，不自动重试：'+e.message);}
  }
}
