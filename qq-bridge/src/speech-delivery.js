import {createHash,randomUUID} from 'node:crypto';import fs from 'node:fs';
export const voiceFailureStatus=cause=>/highway upload transport failed[\s\S]*cmdId=1008/i.test(String(cause?.message||cause))?'upload-failed':'uncertain';
export class SpeechDelivery {
 constructor(store,{now=Date.now}={}){
  this.store=store;this.now=now;
  store.db.exec('CREATE TABLE IF NOT EXISTS speech_deliveries(id TEXT PRIMARY KEY,key TEXT,voiceId TEXT,textHash TEXT,status TEXT,time INTEGER,updatedAt INTEGER,messageId TEXT)');
  const cols=store.db.prepare('PRAGMA table_info(speech_deliveries)').all().map(x=>x.name);for(const [name,type]of [['audioFile','TEXT'],['audioHash','TEXT'],['attempts','INTEGER NOT NULL DEFAULT 0']])if(!cols.includes(name))store.db.exec(`ALTER TABLE speech_deliveries ADD COLUMN ${name} ${type}`);
 }
 latest(key){const row=this.store.db.prepare('SELECT id,voiceId,status,time,updatedAt,messageId,attempts FROM speech_deliveries WHERE key=? ORDER BY rowid DESC LIMIT 1').get(key);return row?{...row,note:row.status==='upload-failed'?'QQ上传失败，未取得消息ID；可在用户明确要求后重发已生成音频，无需再次合成':row.status==='uncertain'?'发送结果不明，必须核对QQ实际记录；本地文字发送列表没有记录不能证明未送达':'sent表示QQ返回消息ID，不表示对方已读'}:null;}
 async run(key,voiceId,text,{generate,send}){
  const hash=createHash('sha256').update(text).digest('hex'),now=this.now();
  const prior=this.store.db.prepare("SELECT id FROM speech_deliveries WHERE key=? AND voiceId=? AND textHash=? AND status IN ('generating','sending','uncertain','upload-failed') AND updatedAt>? ORDER BY rowid DESC LIMIT 1").get(key,voiceId,hash,now-300000);
  if(prior)throw Error('相同语音仍在处理、上次上传失败或送达未确认；请查询语音状态并核对QQ记录，5分钟内不会自动重复合成。');
  const id=randomUUID();this.store.db.prepare('INSERT INTO speech_deliveries(id,key,voiceId,textHash,status,time,updatedAt,messageId) VALUES(?,?,?,?,?,?,?,NULL)').run(id,key,voiceId,hash,'generating',now,now);
  let phase='generation';
  try{
   const file=await generate();phase='send';
   if(typeof file==='string'&&fs.existsSync(file))this.store.db.prepare('UPDATE speech_deliveries SET audioFile=?,audioHash=? WHERE id=?').run(file,createHash('sha256').update(fs.readFileSync(file)).digest('hex'),id);
   this.store.db.prepare("UPDATE speech_deliveries SET status='sending',updatedAt=? WHERE id=?").run(this.now(),id);
   const result=await send(file);
   if(result?.message_id==null)throw Error('QQ没有返回消息ID，无法确认语音送达');
   this.store.db.prepare("UPDATE speech_deliveries SET status='sent',updatedAt=?,messageId=? WHERE id=?").run(this.now(),String(result.message_id),id);
   return result;
  }catch(cause){
   const status=phase==='send'?voiceFailureStatus(cause):'generation-failed';
   this.store.db.prepare('UPDATE speech_deliveries SET status=?,updatedAt=? WHERE id=?').run(status,this.now(),id);
   const error=new Error(phase==='send'?'语音已合成，但QQ发送失败或送达未确认；不是音色复刻权限错误。请先核对群聊/私聊记录，不自动重复发送。':'语音合成失败，尚未提交给QQ。');
   error.phase=phase;error.cause=cause;error.deliveryId=id;error.deliveryStatus=status;throw error;
  }
 }
 async retry(key,id,{send}){
  const r=this.store.db.prepare('SELECT * FROM speech_deliveries WHERE key=? AND id=?').get(key,String(id));
  if(!r||r.status!=='upload-failed')throw Error('只重发已明确上传失败的本会话语音；结果不明、已提交或不存在均不重发');
  if(r.attempts>=2||this.now()-r.time>86400000)throw Error('补发次数已达上限或音频超过一天');
  if(!r.audioFile||!fs.existsSync(r.audioFile)||createHash('sha256').update(fs.readFileSync(r.audioFile)).digest('hex')!==r.audioHash)throw Error('保留音频不存在或已变化，不重新合成');
  this.store.db.prepare("UPDATE speech_deliveries SET status='sending',attempts=attempts+1,updatedAt=? WHERE id=?").run(this.now(),id);
  try{const result=await send(r.audioFile);if(result?.message_id==null)throw Error('QQ未返回消息ID');this.store.db.prepare("UPDATE speech_deliveries SET status='sent',messageId=?,updatedAt=? WHERE id=?").run(String(result.message_id),this.now(),id);return {id,status:'sent',messageId:String(result.message_id),reusedAudio:true};}
  catch(cause){this.store.db.prepare('UPDATE speech_deliveries SET status=?,updatedAt=? WHERE id=?').run(voiceFailureStatus(cause),this.now(),id);throw Error('保留音频补发失败；请查询真实发送状态，不重复合成或盲目重试');}
 }
}
