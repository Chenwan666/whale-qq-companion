import fs from 'node:fs';
import path from 'node:path';

// Small durable scheduler: successful work is throttled across restarts;
// failures back off, and a running tick cannot overlap the next one.
export class MaintenanceJobs {
  constructor(file,{now=Date.now}={}) {
    this.file=file;this.now=now;this.running=new Set();
    try{this.rows=JSON.parse(fs.readFileSync(file,'utf8'));}catch{this.rows={};}
    if(!this.rows||typeof this.rows!=='object'||Array.isArray(this.rows))this.rows={};
  }
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.rows,null,2),{mode:0o600});fs.renameSync(tmp,this.file);}
  async run(key,intervalMs,work,{retryMs=15*60000}={}) {
    const at=this.now(),prior=this.rows[key];
    if(this.running.has(key)||(prior?.nextAt>at&&prior.nextAt-at<=Math.max(intervalMs,retryMs)))return false;
    this.running.add(key);
    // An interrupted process waits one retry interval, rather than immediately
    // starting the same paid operation again after a restart.
    try{this.rows[key]={lastStartedAt:at,nextAt:at+retryMs,status:'running'};this.save();await work();this.rows[key]={lastStartedAt:at,lastSuccessAt:this.now(),nextAt:this.now()+intervalMs,status:'ok'};this.save();return true;}
    catch(error){this.rows[key]={lastStartedAt:at,nextAt:this.now()+retryMs,status:'failed'};this.save();throw error;}
    finally{this.running.delete(key);}
  }
}
