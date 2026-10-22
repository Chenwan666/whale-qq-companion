import {randomUUID} from 'node:crypto';
import {priceUsage} from './model-prices.js';

export const MOBILE_BUDGET_DEFAULTS=Object.freeze({maxCost:1,maxRequests:60,dailyCost:5,warnRatio:.8,durationMinutes:120});
const dayOf=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});

// A budget belongs to an actual user request, rather than an Android tool call.
// Replayed usage updates the original receipt; it never creates another charge.
export class MobileTaskBudget{
 constructor(store,{now=Date.now,limits=MOBILE_BUDGET_DEFAULTS}={}){
  this.db=store.db;this.now=now;this.limits={...MOBILE_BUDGET_DEFAULTS,...limits};
  this.turns=new Map();this.pending=new Set();this.bindingNeeded=new Set();this.recent=[];
  this.db.exec('CREATE TABLE IF NOT EXISTS mobile_budget_runs(key TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS mobile_budget_receipts(id TEXT PRIMARY KEY,budgetId TEXT NOT NULL,day TEXT NOT NULL,cost REAL NOT NULL);CREATE INDEX IF NOT EXISTS mobile_budget_receipts_budget ON mobile_budget_receipts(budgetId);CREATE TABLE IF NOT EXISTS mobile_budget_users(key TEXT PRIMARY KEY,authorization TEXT NOT NULL);CREATE TABLE IF NOT EXISTS mobile_budget_turns(id TEXT PRIMARY KEY,budgetId TEXT NOT NULL,key TEXT NOT NULL);CREATE TABLE IF NOT EXISTS mobile_budget_policy(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL);INSERT OR IGNORE INTO mobile_budget_policy VALUES(1,1);');
 }
 get enabled(){return this.db.prepare('SELECT enabled FROM mobile_budget_policy WHERE id=1').get().enabled===1;}
 configure(enabled){if(typeof enabled!=='boolean')throw Error('费用保护开关必须是布尔值');this.db.prepare('UPDATE mobile_budget_policy SET enabled=? WHERE id=1').run(enabled?1:0);return this.db.prepare('SELECT key FROM mobile_budget_runs').all().map(({key})=>{const active=this.current(key)?.status==='active',d=this.decision(key);return {...d,stopped:active&&!d.allowed};});}
 noteUser(key,id){if(id)this.db.prepare('INSERT INTO mobile_budget_users VALUES(?,?) ON CONFLICT(key) DO UPDATE SET authorization=excluded.authorization').run(key,String(id));}
 authorization(key){return this.db.prepare('SELECT authorization FROM mobile_budget_users WHERE key=?').get(key)?.authorization;}
 current(key){const row=this.db.prepare('SELECT data FROM mobile_budget_runs WHERE key=?').get(key);return row?JSON.parse(row.data):null;}
 save(row){this.db.prepare('INSERT INTO mobile_budget_runs VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(row.key,JSON.stringify(row));return row;}
 markTurn(key){this.assert(key);this.pending.add(key);}
 clearPending(key){this.pending.delete(key);}
 noteTurn(key,sid,turn){if(!Number.isInteger(turn))return;this.turns.set(key,{sid,turn});if(this.pending.delete(key))return this.bindCurrent(key);}
 endTurn(key,sid,turn){const current=this.turns.get(key);if(current?.sid===sid&&current.turn===turn)this.turns.delete(key);}
 bindCurrent(key){const row=this.current(key),turn=this.turns.get(key);if(!row||row.status!=='active')return;if(!turn){this.bindingNeeded.add(key);return;}this.bindingNeeded.delete(key);
  this.db.prepare('INSERT INTO mobile_budget_turns VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(turn.sid+'|'+turn.turn,row.id,key);
  let decision;for(const receipt of [...this.recent])if(receipt.sid===turn.sid&&receipt.turn===turn.turn){const result=this.ingest(receipt);if(result)decision={...result,warn:result.warn||decision?.warn,stopped:result.stopped||decision?.stopped};}return decision;
 }
 totals(id){return this.db.prepare('SELECT COUNT(*) AS requests,COALESCE(SUM(cost),0) AS cost FROM mobile_budget_receipts WHERE budgetId=?').get(id);}
 daily(){const day=dayOf(this.now());return {day,cost:this.db.prepare('SELECT COALESCE(SUM(cost),0) AS cost FROM mobile_budget_receipts WHERE day=?').get(day).cost};}
 status(key){const row=this.current(key);return {enabled:this.enabled,limits:this.limits,daily:this.daily(),run:row?{...row,...this.totals(row.id)}:null,note:'仅统计启用后手机任务执行回合的模型用量估算；其他聊天、语音、翻唱和其他程序不在此预算内。关闭保护仍记录用量，重新开启不清零；不会重开已停止任务。已在途请求可能略超上限。'};}
 start(key,{taskId,kind='手机操作',authorizationId,force=false}={}){
  const old=this.current(key),auth=authorizationId||this.authorization(key);
  if(!auth)throw Error('手机任务缺少真实用户授权，不能由后台自行启动付费任务');
  if(old?.status==='active'&&old.taskId===taskId&&!force){this.assert(key);return old;}
  if(old?.status==='active'&&old.authorizationId===auth){this.assert(key);return old;}
  if(old&&old.status!=='active'&&(old.blockedAuthorizationId||old.authorizationId)===auth)throw Error('这轮手机任务已停止，不自动续开或重置预算；请发出新的任务要求');
  if(this.enabled&&this.daily().cost>=this.limits.dailyCost){this.save({key,id:randomUUID(),taskId,kind,authorizationId:auth,blockedAuthorizationId:auth,status:'stopped',stopReason:'daily-cost',startedAt:this.now(),stoppedAt:this.now()});throw Error('今天手机任务的估算预算已用尽，不能通过新任务或重启绕过；普通聊天仍可使用');}
  const row={key,id:randomUUID(),taskId:taskId||'direct:'+auth,kind,authorizationId:auth,status:'active',startedAt:this.now(),expiresAt:this.now()+this.limits.durationMinutes*60000,warned:false};this.save(row);return row;
 }
 resumeVerifiedRepair(key,taskId){const row=this.current(key);if(!row||row.taskId!==taskId||row.authorizationId!==this.authorization(key)||row.status!=='stopped'||row.stopReason!=='completed'||this.now()>=row.expiresAt)throw Error('修复不能重开已取消、到限、过期或其他授权的预算');const before=this.totals(row.id),day=this.daily();if(this.enabled&&(before.cost>=this.limits.maxCost||before.requests>=this.limits.maxRequests||day.cost>=this.limits.dailyCost))throw Error('原任务预算已达保护线，修复不能清零续费');const {stopReason,stoppedAt,blockedAuthorizationId,...kept}=row;return this.save({...kept,status:'active'});}
 ensure(key,options={}){const old=this.current(key);if(old?.status==='active'){this.assert(key);return old;}return this.start(key,{...options,taskId:options.taskId||'direct:'+this.authorization(key)});}
 stop(key,reason='cancelled'){this.pending.delete(key);this.bindingNeeded.delete(key);const row=this.current(key);if(!row||row.status!=='active')return row;return this.save({...row,status:'stopped',stopReason:reason,blockedAuthorizationId:this.authorization(key)||row.authorizationId,stoppedAt:this.now()});}
 decision(key){
  const row=this.current(key);if(!row)return {allowed:false,reason:'not-started'};
  const usage=this.totals(row.id),daily=this.daily();let reason=row.stopReason;
  if(row.status==='active')reason=this.now()>=row.expiresAt?'expired':!this.enabled?null:daily.cost>=this.limits.dailyCost?'daily-cost':usage.cost>=this.limits.maxCost?'task-cost':usage.requests>=this.limits.maxRequests?'task-requests':null;
  if(reason&&row.status==='active')this.stop(key,reason);
  const ratio=Math.max(usage.cost/this.limits.maxCost,usage.requests/this.limits.maxRequests,daily.cost/this.limits.dailyCost);
  return {allowed:!reason&&row.status==='active',reason,run:{...this.current(key),...usage},daily,nearLimit:this.enabled&&ratio>=this.limits.warnRatio};
 }
 assert(key){const d=this.decision(key);if(!d.allowed)throw Error('手机任务已停止：'+(d.reason||'未启动')+'；不会自动重开，已提交的操作只核实、不重发');return d;}
 ingest(record){
  if(!/^(?:private|group):\d+$/.test(record?.key||'')||typeof record.sid!=='string'||!Number.isInteger(record.turn)||!Number.isInteger(record.step)||!Number.isInteger(record.retry))return null;
  if(!Number.isFinite(record.t)||record.t>this.now()+60000)return null;
  if(this.bindingNeeded.has(record.key)){const active=this.current(record.key);if(active?.status==='active'&&record.t>=active.startedAt){this.turns.set(record.key,{sid:record.sid,turn:record.turn});this.bindCurrent(record.key);}}
  const id=[record.sid,record.turn,record.step,record.retry].join('|'),existing=this.db.prepare('SELECT budgetId,day FROM mobile_budget_receipts WHERE id=?').get(id),binding=this.db.prepare('SELECT budgetId,key FROM mobile_budget_turns WHERE id=?').get(record.sid+'|'+record.turn),row=this.current(record.key);
  if(!existing&&!binding){this.recent=this.recent.filter(r=>[r.sid,r.turn,r.step,r.retry].join('|')!==id).concat(record).slice(-30);return null;}
  const cost=priceUsage(record.b,{model:record.model,at:record.t}).cost.total;
  this.db.prepare('INSERT INTO mobile_budget_receipts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET cost=excluded.cost').run(id,existing?.budgetId||binding.budgetId,existing?.day||dayOf(record.t),cost);
  if(!row||row.status!=='active')return null;
  const wasActive=row.status==='active',d=this.decision(record.key);let warn=false;
  if(d.allowed&&d.nearLimit&&!row.warned){row.warned=true;this.save(row);warn=true;}
  return {...d,warn,stopped:wasActive&&!d.allowed};
 }
}
