import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile,fork} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const uuid=/^[a-f0-9-]{36}$/;
export class CompanionUpgrades {
  constructor(root,{workspace,node=process.execPath,runTimeoutMs=170000}={}){
    this.root=root;this.workspace=workspace||path.join(root,'upgrade-workspace');this.node=node;
    this.file=path.join(root,'self-upgrades.json');this.dir=path.join(root,'extensions');
    this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{versions:[],active:{}};
    if(!Array.isArray(this.data.versions)||!this.data.active)throw Error('扩展索引损坏');
    this.busy=false;
    this.runTimeoutMs=runTimeoutMs;
    // A crash during a new extension restores its previous active revision on startup.
    if(this.data.inFlight){this.rollback(this.data.inFlight.name);delete this.data.inFlight;this.save();}
  }
  save(){fs.mkdirSync(this.root,{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(temp,this.file);}
  version(id){const v=this.data.versions.find(v=>v.id===id);if(!v||!uuid.test(v.id))throw Error('升级ID不存在');return v;}
  staged(v,name){const base=path.resolve(this.workspace,v.id),file=path.join(base,name),real=fs.realpathSync(file);if(!real.startsWith(base+path.sep))throw Error('升级文件不能跳出专用目录');return real;}
  bytes(v,name){const b=fs.readFileSync(this.staged(v,name));if(b.length>65536)throw Error('单个扩展源文件最多64KB');return b;}
  prepare(name,goal){
    if(!/^[a-z][a-z0-9_-]{2,39}$/.test(name))throw Error('扩展名需要3～40位英文小写字母、数字、下划线或短横线');
    if(!goal||goal.length>2000)throw Error('请写明升级目的，最多2000字');
    if(this.data.versions.length>=100)throw Error('升级档案已满，请由管理员整理');
    const v={id:randomUUID(),name,goal,status:'draft',createdAt:Date.now()};const dir=path.join(this.workspace,v.id);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'extension.mjs'),"export async function run({args,services}) { throw new Error('NOT_IMPLEMENTED'); }\n",{mode:0o600});
    fs.writeFileSync(path.join(dir,'extension.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {run} from './extension.mjs';\ntest('实现后补充实际功能验证',()=>assert.fail('请先实现并补充实际功能测试'));\n",{mode:0o600});
    this.data.versions.push(v);this.save();return {...v,workspace:dir,instruction:'只在这个目录编辑extension.mjs和extension.test.mjs，不修改桥接核心、角色卡、权限或凭据。入口export async function run({args,services})，返回JSON兼容的结果。services提供recall(query)、readLink(url)、download(url,name)、task(text)。测试必须使用node:test的test()及node:assert/strict，至少一个真实功能断言；不要使用process.exit或仅打印PASS。可通过qq_agent_task完成代码和真实测试。必须先qq_upgrade_verify通过，再qq_upgrade_apply启用；未验证的草稿不能执行。验证工具返回失败详情，应根据详情修复。'};
  }
  async verify(id){
    if(this.busy)throw Error('正在验证另一项升级');const v=this.version(id);this.busy=true;
    try{
      const code=this.bytes(v,'extension.mjs'),tests=this.bytes(v,'extension.test.mjs');
      await promisify(execFile)(this.node,['--check',this.staged(v,'extension.mjs')],{windowsHide:true,timeout:10000,maxBuffer:4096});
      const stage=path.resolve(this.workspace,v.id);
      const {stdout}=await promisify(execFile)(this.node,['--permission',`--allow-fs-read=${stage}`,`--allow-fs-write=${stage}`,'--test-isolation=none','--test','extension.test.mjs'],{cwd:stage,windowsHide:true,timeout:30000,maxBuffer:8192,env:{SystemRoot:process.env.SystemRoot||'C:\\Windows',TEMP:stage,TMP:stage}});
      if(!/(?:tests\s+[1-9]\d*|✔)/u.test(stdout))throw Error('没有执行到测试');
      v.verified={codeHash:hash(code),testHash:hash(tests),time:Date.now()};v.status='verified';this.save();
      return {id,verified:true,instruction:'语法及本扩展功能测试已通过；还未启用，不代表已验证所有外部服务。'};
    }catch(error){delete v.verified;v.status='failed';this.save();const detail=String(error.stdout||error.stderr||error.message||'验证失败').replace(/\x1b\[[0-9;]*m/g,'').slice(-3500);throw Error('扩展语法或功能测试未通过／超时，未启用；请修复后再验证。测试须使用node:test且至少一个test()，不能仅打印PASS或process.exit。详情：'+detail);}finally{this.busy=false;}
  }
  apply(id){
    const v=this.version(id);if(v.status!=='verified'||!v.verified)throw Error('必须先通过升级验证');
    const code=this.bytes(v,'extension.mjs'),tests=this.bytes(v,'extension.test.mjs');
    if(hash(code)!==v.verified.codeHash||hash(tests)!==v.verified.testHash)throw Error('验证后代码发生变化，请重新验证');
    if(Date.now()-v.verified.time>86400000)throw Error('验证结果已过期，请重新验证');
    const file=path.join(this.dir,v.id+'.mjs');fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(file,code,{mode:0o600,flag:'wx'});
    v.previous=this.data.active[v.name]||null;v.status='active';this.data.active[v.name]=v.id;this.save();return {id,name:v.name,enabled:true,previous:v.previous,instruction:'独立私聊扩展已启用，可用qq_extension_run调用；核心程序和角色权限未改动。'};
  }
  rollback(name){const id=this.data.active[name];if(!id)throw Error('该扩展尚未启用');const v=this.version(id);if(v.previous)this.data.active[name]=v.previous;else delete this.data.active[name];v.status='rolled-back';this.save();return {name,active:this.data.active[name]||null,rolledBack:true};}
  list(){return this.data.versions.map(({id,name,goal,status,createdAt})=>({id,name,goal,status,createdAt,active:this.data.active[name]===id}));}
  async run(name,args,services){
    if(this.data.inFlight)throw Error('正在执行另一项扩展');const v=this.version(this.data.active[name]);const file=path.join(this.dir,v.id+'.mjs');
    if(hash(fs.readFileSync(file))!==v.verified?.codeHash)throw Error('已安装扩展发生变化，拒绝执行，请重新验证');
    this.data.inFlight={name,id:v.id};this.save();
    try{return await this.execute(file,args,services,path.join(this.workspace,v.id));}
    catch{this.rollback(name);throw Error('扩展执行失败，已回退到上一版本或停用；核心聊天仍可用');}
    finally{delete this.data.inFlight;this.save();}
  }
  execute(file,args,services,stage){
    const runner=new URL('./companion-extension-worker.mjs',import.meta.url);
    return new Promise((resolve,reject)=>{
      const child=fork(runner,[],{execPath:this.node,execArgv:['--max-old-space-size=128','--permission',`--allow-fs-read=${file}`,`--allow-fs-read=${fileURLToPath(runner)}`,`--allow-fs-read=${stage}`,`--allow-fs-write=${stage}`],cwd:stage,windowsHide:true,silent:true,serialization:'advanced',env:{SystemRoot:process.env.SystemRoot||'C:\\Windows',TEMP:stage,TMP:stage}});
      let settled=false,requests=0;
      // Reap the worker before returning: on Windows the live process can keep
      // staging files open, racing rollback/cleanup immediately after a result.
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);const deliver=()=>error?reject(error):resolve(value);child.once('close',deliver);child.kill();};
      const timer=setTimeout(()=>finish(Error('扩展执行超时')),this.runTimeoutMs);
      child.on('error',error=>finish(error));child.on('exit',()=>finish(Error('扩展进程提前退出')));
      child.stdout?.resume();child.stderr?.resume();
      child.on('message',async message=>{
        if(settled)return;
        if(message?.type==='result')return finish(null,message.value);
        if(message?.type==='error')return finish(Error('扩展执行失败'));
        if(message?.type==='service'){
          try{
            if(++requests>12||!Object.hasOwn(services,message.name)||typeof services[message.name]!=='function'||!Array.isArray(message.args)||JSON.stringify(message.args).length>10000)throw Error('服务请求无效');
            const value=await services[message.name](...message.args);
            if(!settled&&child.connected)child.send({type:'service-result',id:message.id,value});
          }catch{if(!settled&&child.connected)child.send({type:'service-result',id:message.id,error:'服务调用失败，请核对功能、权限和参数'});}
        }
      });
      child.send({file,args});
    });
  }
}
