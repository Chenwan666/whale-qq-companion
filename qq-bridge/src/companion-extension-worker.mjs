import {pathToFileURL} from 'node:url';
const pending=new Map();let seq=0,started=false;
process.on('message',async message=>{
  if(message?.type==='service-result'){
    const p=pending.get(message.id);if(!p)return;pending.delete(message.id);message.error?p.reject(Error(message.error)):p.resolve(message.value);return;
  }
  if(started)return;started=true;
  try{
    const invoke=name=>(...args)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});process.send({type:'service',id,name,args});});
    const services=Object.fromEntries(['recall','readLink','download','task'].map(name=>[name,invoke(name)]));
    const mod=await import(pathToFileURL(message.file).href);if(typeof mod.run!=='function')throw Error('缺少run入口');
    const value=await mod.run({args:message.args,services});process.send({type:'result',value});
  }catch{process.send({type:'error'});}
});
