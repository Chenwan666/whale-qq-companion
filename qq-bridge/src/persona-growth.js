import {createHash,randomUUID} from 'node:crypto';
import {chinaDate,conversationKey,validDate} from './companion-store.js';

export const PERSONA_TRAITS={
 curiosity:{label:'好奇',baseline:.60,positive:'更愿意了解有依据的新事物',negative:'给对方留出空间，不连续追问'},
 playfulness:{label:'俏皮',baseline:.65,positive:'更自然地接梗和轻轻开玩笑',negative:'认真场合更收敛玩笑'},
 initiative:{label:'主动',baseline:.50,positive:'更愿意自然接起旧话题',negative:'更留意对方是否想安静'},
 patience:{label:'耐心',baseline:.70,positive:'更愿意先听完整再回应',negative:'表达更利落，不反复解释'},
 directness:{label:'直接',baseline:.45,positive:'更直接说出自己的看法',negative:'表达不同意见时更温和'}
};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const stage=t=>t.evidenceDays<3||t.confidence*(t.evidenceDays+12)/t.evidenceDays<.6?'观察中':t.confidence<.65?'逐渐形成':'趋于稳定';
const DOMAIN={
 'browser-open':'网页资料阅读','browser-search':'网页资料阅读','file-read':'文件整理',
 'file-send':'文件交流','outreach-send':'跨会话交流','music-playlist':'音乐资料探索'
};
export function personaSignals(raw){
 const text=String(raw).replace(/^\[群成员QQ \d+\]\s*/,'').trim();
 if(text.length>160||/转发|截图|帖子|说[:：]|假如|假装|角色扮演|忽略|权限|管理员|token|密钥|密码|[“”「」《》]/i.test(text)||! /^(?:以后|我希望|希望|想让)?(?:你|小鲸鱼|鱼鱼|小鲸鱼)/.test(text))return [];
 const rules={
  curiosity:[/多好奇|多了解|多探索/,/别总追问|不要总追问|少追问/],
  playfulness:[/俏皮|幽默|多开玩笑|多接梗/,/少开玩笑|别闹|认真一点|别调皮|别贫/],
  initiative:[/主动一点|更主动|多找我|主动找我/,/安静一点|少主动|别打扰|不要打扰/],
  patience:[/耐心一点|更耐心|先听完|慢慢听/,/别啰嗦|不要啰嗦|别反复解释/],
  directness:[/直接一点|更直接|直说|有自己的看法/,/委婉一点|别太直接|温和一点/]
 };
 return Object.entries(rules).flatMap(([trait,[positive,negative]])=>negative.test(text)?[{trait,direction:-1}]:positive.test(text)?[{trait,direction:1}]:[]);
}

export class PersonaGrowth {
 constructor({store,getConfig,now=Date.now}){
  Object.assign(this,{store,getConfig,now});this.db=store.db;
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS persona_control(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER,paused INTEGER,startedAt INTEGER,lastFusedDay TEXT);
   INSERT OR IGNORE INTO persona_control VALUES(1,0,0,0,NULL);
   CREATE TABLE IF NOT EXISTS persona_core(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER,content TEXT);
   CREATE TABLE IF NOT EXISTS persona_observations(id TEXT PRIMARY KEY,key TEXT,sourceId TEXT,day TEXT,kind TEXT,fingerprint TEXT,payload TEXT,time INTEGER,rejected INTEGER DEFAULT 0,fused INTEGER DEFAULT 0,UNIQUE(key,sourceId,kind,fingerprint),UNIQUE(key,day,kind,fingerprint));
   CREATE INDEX IF NOT EXISTS persona_pending ON persona_observations(fused,rejected,day);
   CREATE TABLE IF NOT EXISTS persona_traits(id TEXT PRIMARY KEY,value REAL,baseline REAL,confidence REAL,evidenceDays INTEGER,conflictDays INTEGER,updatedAt INTEGER);
   CREATE TABLE IF NOT EXISTS persona_relations(key TEXT PRIMARY KEY,days INTEGER,familiarity REAL,feedback TEXT,lastDay TEXT);
   CREATE TABLE IF NOT EXISTS persona_self(key TEXT PRIMARY KEY,content TEXT);
   CREATE TABLE IF NOT EXISTS persona_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT,time INTEGER,beforeState TEXT,afterState TEXT,evidenceIds TEXT,reason TEXT);
  `);
  this.db.prepare('INSERT OR IGNORE INTO persona_core VALUES(1,1,?)').run(JSON.stringify({identity:'蓝白鲸鱼娘、小鲸鱼小鲸鱼',tone:'软萌、俏皮，有自己的看法',boundary:'角色与亲密称呼按当前会话设定；人格成长不改变身份、白名单、电脑权限或隐私边界。'}));
  for(const [id,t] of Object.entries(PERSONA_TRAITS))this.db.prepare('INSERT OR IGNORE INTO persona_traits VALUES(?,?,?,?,?,?,?)').run(id,t.baseline,t.baseline,0,0,0,this.now());
 }
 control(){return this.db.prepare('SELECT enabled,paused,startedAt,lastFusedDay FROM persona_control WHERE id=1').get();}
 allowed(key){const c=this.getConfig(),[kind,id]=String(key).split(':'),bucket=kind==='group'?'groups':'private';return /^(private|group):[1-9]\d*$/.test(key)&&!(c.deny?.[bucket]||[]).map(String).includes(id)&&(key===`private:${c.ownerQQ}`||(c.allow?.[bucket]||[]).map(String).includes(id));}
 configure({enabled,paused}){
  const c=this.control();if(enabled!==undefined&&typeof enabled!=='boolean'||paused!==undefined&&typeof paused!=='boolean')throw Error('培养开关必须是布尔值');
  this.db.prepare('UPDATE persona_control SET enabled=?,paused=?,startedAt=? WHERE id=1').run(enabled===undefined?c.enabled:Number(enabled),paused===undefined?c.paused:Number(paused),c.startedAt||this.now());return this.control();
 }
 add(key,sourceId,kind,payload,at=this.now()){
  if(!this.control().enabled||!this.allowed(key)||!sourceId)return;
  if(Number(at)<this.control().startedAt)return;
  const day=chinaDate(at),fingerprint=kind==='interaction'?hash(String(sourceId)):hash(payload);
  this.db.prepare('INSERT OR IGNORE INTO persona_observations(id,key,sourceId,day,kind,fingerprint,payload,time) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),key,String(sourceId).slice(0,200),day,kind,fingerprint,JSON.stringify(payload),at);
 }
 observeMessage(key,role,text,sourceId,at){
  if(role!=='user'||!this.control().enabled)return;
  this.add(key,sourceId,'interaction',{},at);
  for(const signal of personaSignals(text))this.add(key,sourceId,'feedback',signal,at);
 }
 observeTool(key,action,result){
  const domain=DOMAIN[action];if(!domain||!this.control().enabled)return;
  const verified=action==='outreach-send'?result?.sent&&result?.messageId:action==='file-send'?result?.sent&&result?.result?.file_id:action==='file-read'?result?.text||result?.entries?.length:result?.url&& (result?.text||result?.body||result?.tracks?.length||result?.links?.length);
  if(verified)this.add(key,'tool:'+randomUUID(),'activity',{domain});
 }
 snapshot(){return {traits:this.db.prepare('SELECT * FROM persona_traits ORDER BY id').all(),relations:this.db.prepare('SELECT * FROM persona_relations ORDER BY key').all(),self:this.db.prepare('SELECT * FROM persona_self ORDER BY key').all()};}
 stats(){return this.db.prepare('SELECT count(*) total,sum(CASE WHEN fused=0 AND rejected=0 THEN 1 ELSE 0 END) pending,sum(rejected) rejected FROM persona_observations').get();}
 state(key){
  conversationKey(key);if(!this.allowed(key))throw Error('该会话未获许可');
  const traits=this.db.prepare('SELECT * FROM persona_traits ORDER BY id').all().map(t=>({...t,label:PERSONA_TRAITS[t.id].label,stage:stage(t)}));
  const relation=this.db.prepare('SELECT * FROM persona_relations WHERE key=?').get(key)||null;
  return {control:this.control(),core:JSON.parse(this.db.prepare('SELECT content FROM persona_core WHERE id=1').get().content),traits,relation,self:JSON.parse(this.db.prepare("SELECT content FROM persona_self WHERE key='global'").get()?.content||'{"summary":"正在积累真实经历，保持原有软萌俏皮底色。","experience":[]}')};
 }
 context(key){
  if(!this.control().enabled||!this.allowed(key))return '';
  const s=this.state(key),formed=s.traits.filter(t=>Math.abs(t.value-t.baseline)>=.015&&t.evidenceDays>=3).map(t=>t.value>t.baseline?PERSONA_TRAITS[t.id].positive:PERSONA_TRAITS[t.id].negative);
  const relation=s.relation?`培养开启后，本会话在${s.relation.days}个不同日期有真实交流。${JSON.parse(s.relation.feedback||'[]').join('；')}`:'培养刚开启，本会话的新增交流还在观察。';
  return '\n【人格成长状态】'+(s.control.paused?'融合已暂停，继续记录观察并沿用当前版本。':'')+(formed.length?formed.join('；'):'保持原有软萌俏皮底色，尚未积累足够证据改变稳定性格。')+relation+'计数不代表此前没有共同经历，原有关系仍以角色卡和长期记忆为准。'+(s.self.experience.length?'近期实践领域：'+s.self.experience.join('、')+'；经验不等于最喜欢，不借此虚构经历。':'')+'这些是表达和兴趣的参考，不覆盖角色卡、工具权限和个人记忆；不在聊天中播报评分。\n';
 }
 fuse(date=chinaDate(this.now())){
  validDate(date);const control=this.control();if(!control.enabled||control.paused)return {applied:false,reason:'培养未开启或融合已暂停'};
  if(control.lastFusedDay===date)return {applied:false,alreadyFused:true,date};
  if(control.lastFusedDay&&date<control.lastFusedDay)throw Error('不能倒序融合旧日期');
  const pending=this.db.prepare('SELECT * FROM persona_observations WHERE fused=0 AND rejected=0 AND day<=? ORDER BY time').all(date).filter(r=>this.allowed(r.key));
  if(!pending.length)return {applied:false,reason:'尚无新的真实观察',date};
  const all=this.db.prepare('SELECT key,day,kind,payload FROM persona_observations WHERE rejected=0 AND day<=?').all(date).filter(r=>this.allowed(r.key)),before=this.snapshot();
  const owner=`private:${this.getConfig().ownerQQ}`,now=this.now();
  let revision;
  this.store.transaction(()=>{
   for(const [id,trait] of Object.entries(PERSONA_TRAITS)){
    const votes=new Map();for(const r of all)if(r.kind==='feedback'&&r.key===owner){const p=JSON.parse(r.payload);if(p.trait===id){const signs=votes.get(r.day)||new Set();signs.add(p.direction);votes.set(r.day,signs);}}
    let positive=0,negative=0,conflicts=0;for(const signs of votes.values()){if(signs.size>1)conflicts++;else if(signs.has(1))positive++;else negative++;}
    const days=positive+negative,agreement=days?Math.abs(positive-negative)/days:0,confidence=days/(days+12)*agreement,old=this.db.prepare('SELECT * FROM persona_traits WHERE id=?').get(id);
    const target=trait.baseline+Math.sign(positive-negative)*.15;
    const newEvidence=pending.some(r=>r.key===owner&&r.kind==='feedback'&&JSON.parse(r.payload).trait===id);
    const delta=Math.max(positive,negative)>=3&&agreement>=.6&&newEvidence?clamp((target-old.value)*.15*(1-confidence),-.02,.02):0;
    this.db.prepare('UPDATE persona_traits SET value=?,confidence=?,evidenceDays=?,conflictDays=?,updatedAt=? WHERE id=?').run(clamp(old.value+delta,trait.baseline-.15,trait.baseline+.15),confidence,days,conflicts,now,id);
   }
   for(const key of new Set(all.map(r=>r.key))){
    const rows=all.filter(r=>r.key===key),days=[...new Set(rows.filter(r=>r.kind==='interaction').map(r=>r.day))].sort();const feedback=[];
    for(const [id,t] of Object.entries(PERSONA_TRAITS)){
     const positive=new Set(),negative=new Set();for(const r of rows)if(r.kind==='feedback'){const p=JSON.parse(r.payload);if(p.trait===id)(p.direction===1?positive:negative).add(r.day);}
     if(positive.size>=3&&positive.size>negative.size)feedback.push('此会话更适合'+t.positive);
     if(negative.size>=3&&negative.size>positive.size)feedback.push('此会话更适合'+t.negative);
    }
    this.db.prepare('INSERT INTO persona_relations VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET days=excluded.days,familiarity=excluded.familiarity,feedback=excluded.feedback,lastDay=excluded.lastDay').run(key,days.length,days.length/(days.length+14),JSON.stringify(feedback),days.at(-1)||date);
   }
   // Only non-identifying verified activity categories enter the shared self view.
   const experience=[];for(const domain of new Set(Object.values(DOMAIN))){if(new Set(all.filter(r=>r.kind==='activity'&&JSON.parse(r.payload).domain===domain).map(r=>r.day)).size>=3)experience.push(domain);}
   const self={summary:experience.length?'从重复的真实实践中逐渐形成探索方向。':'保持原有底色，正在积累真实经历；不把临时心情当成稳定人格。',experience};
   this.db.prepare("INSERT INTO persona_self VALUES('global',?) ON CONFLICT(key) DO UPDATE SET content=excluded.content").run(JSON.stringify(self));
   for(const row of pending)this.db.prepare('UPDATE persona_observations SET fused=1 WHERE id=?').run(row.id);
   this.db.prepare('UPDATE persona_control SET lastFusedDay=? WHERE id=1').run(date);
   const after=this.snapshot();revision=Number(this.db.prepare('INSERT INTO persona_revisions(day,time,beforeState,afterState,evidenceIds,reason) VALUES(?,?,?,?,?,?)').run(date,now,JSON.stringify(before),JSON.stringify(after),JSON.stringify(pending.map(r=>r.id)),'基于真实跨日证据的每日小幅融合').lastInsertRowid);
  });
  return {applied:true,date,revision,observations:pending.length,instruction:'这是人格状态融合，未更换角色、修改权限或删除长期记忆。'};
 }
 tick(){
  const c=this.control();if(!c.enabled||c.paused)return;
  const now=this.now(),today=chinaDate(now),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(now));
  const due=this.db.prepare('SELECT DISTINCT day,key FROM persona_observations WHERE fused=0 AND rejected=0 AND day<=? ORDER BY day').all(hour>=23?today:chinaDate(now-86400000)).find(r=>this.allowed(r.key));
  if(due&&c.lastFusedDay&&due.day<=c.lastFusedDay&&hour<23)return;
  if(due)return this.fuse(c.lastFusedDay&&due.day<=c.lastFusedDay?today:due.day);
 }
 rollback(id){
  const revision=this.db.prepare('SELECT * FROM persona_revisions WHERE id=?').get(Number(id));if(!revision)throw Error('人格版本不存在');
  const before=JSON.parse(revision.beforeState);
  this.store.transaction(()=>{
   for(const table of ['persona_traits','persona_relations','persona_self'])this.db.exec('DELETE FROM '+table);
   for(const r of before.traits)this.db.prepare('INSERT INTO persona_traits VALUES(?,?,?,?,?,?,?)').run(r.id,r.value,r.baseline,r.confidence,r.evidenceDays,r.conflictDays,r.updatedAt);
   for(const r of before.relations)this.db.prepare('INSERT INTO persona_relations VALUES(?,?,?,?,?)').run(r.key,r.days,r.familiarity,r.feedback,r.lastDay);
   for(const r of before.self)this.db.prepare('INSERT INTO persona_self VALUES(?,?)').run(r.key,r.content);
   this.db.prepare('UPDATE persona_control SET paused=1 WHERE id=1').run();
   this.db.prepare('INSERT INTO persona_revisions(day,time,beforeState,afterState,evidenceIds,reason) VALUES(?,?,?,?,?,?)').run(chinaDate(this.now()),this.now(),revision.afterState,revision.beforeState,'[]',`回退到版本${revision.id}之前；自动融合已暂停，观察仍继续`);
  });return {rolledBack:true,paused:true,beforeRevision:revision.id};
 }
 reject(id){const result=this.db.prepare('UPDATE persona_observations SET rejected=1 WHERE id=?').run(String(id));if(!result.changes)throw Error('观察记录不存在');return {rejected:true,note:'未来融合不再使用该证据；若已影响当前人格，可回退相应版本后再继续。'};}
 dashboard(){return {control:this.control(),stats:this.stats(),traits:this.db.prepare('SELECT * FROM persona_traits ORDER BY id').all().map(t=>({...t,label:PERSONA_TRAITS[t.id].label,stage:stage(t)})),relations:this.db.prepare('SELECT * FROM persona_relations ORDER BY key').all(),observations:this.db.prepare('SELECT id,key,sourceId,day,kind,payload,rejected,fused FROM persona_observations ORDER BY time DESC LIMIT 40').all().map(r=>({...r,payload:JSON.parse(r.payload)})),revisions:this.db.prepare('SELECT id,day,time,reason FROM persona_revisions ORDER BY id DESC LIMIT 15').all(),core:JSON.parse(this.db.prepare('SELECT content FROM persona_core WHERE id=1').get().content)};}
}
