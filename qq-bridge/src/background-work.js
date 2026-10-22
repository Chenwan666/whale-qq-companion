import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const chinaDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(at);
// Stores fingerprints only. Reservations count before dispatch and survive a
// restart, so crashes/timeouts cannot turn into a free retry loop.
export class BackgroundWorkGate{
 constructor(file,{now=Date.now,policy=()=>({})}={}){Object.assign(this,{file,now,policy});try{this.data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{this.data={jobs:{},days:{}};}this.data.jobs??={};this.data.days??={};}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 status(){const p={enabled:true,maxDailyJobs:8,cooldownMs:15*60000,retryMs:30*60000,...this.policy()};return {policy:p,day:chinaDay(this.now()),used:this.data.days[chinaDay(this.now())]||0,scope:'仅自动黑话提取与研究的任务启动次数；不含聊天和明确要求记住的事实'};}
 reserve(kind,scope,input,{manual=false}={}){const s=this.status(),at=this.now(),key=kind+'|'+scope,hash=createHash('sha256').update(JSON.stringify(input)).digest('hex'),old=this.data.jobs[key];
  if(old?.hash===hash&&old.status==='ok')return {allowed:false,reason:'unchanged'};
  if(!manual&&(!s.policy.enabled||s.used>=s.policy.maxDailyJobs))return {allowed:false,reason:!s.policy.enabled?'disabled':'daily-limit'};
  if(!manual&&old?.nextAt>at)return {allowed:false,reason:'cooldown'};
  const lease={id:randomUUID(),key,hash,at,manual};this.data.jobs[key]={...lease,status:'running',nextAt:at+s.policy.retryMs};if(!manual)this.data.days[s.day]=s.used+1;
  this.data.days=Object.fromEntries(Object.entries(this.data.days).sort().slice(-14));this.save();return {allowed:true,lease};
 }
 finish(lease,ok){if(this.data.jobs[lease.key]?.id!==lease.id)return;const s=this.status();this.data.jobs[lease.key]={...lease,status:ok?'ok':'failed',nextAt:this.now()+(ok?s.policy.cooldownMs:s.policy.retryMs)};this.save();}
}
