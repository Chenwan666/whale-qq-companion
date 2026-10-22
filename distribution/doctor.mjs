import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),bridge=path.join(root,'qq-bridge');
const result={node:process.versions.node,edition:JSON.parse(fs.readFileSync(path.join(bridge,'release.json'),'utf8')).edition,checks:[],paidRequests:0};
const check=(name,ok,note)=>result.checks.push({name,ok,note});
check('Node runtime',Number(process.versions.node.split('.')[0])>=22,'需要 Node.js 22.13 或更高');
for(const file of ['node_modules/zod/package.json','roles/通用鲸鱼.md','release.json'])check(file,fs.existsSync(path.join(bridge,file)),'缺失时重新解压，首次运行安装依赖');
const configFile=path.join(bridge,'config.json');check('本地配置',fs.existsSync(configFile),'菜单 3 打开本地配置');
if(fs.existsSync(configFile)){
 const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));check('管理员',/^[1-9]\d{4,11}$/.test(String(cfg.ownerQQ)),'只检查格式，不显示账号');
 const secretFile=path.join(bridge,'state','provider-secret.json');let key=false;try{key=Boolean(JSON.parse(fs.readFileSync(secretFile,'utf8')).apiKey);}catch{}check('本地模型凭据',key?true:null,'只检查向导是否填写，不回显、不发送；若改在DSH设置配置，则本诊断不检查其凭据');
 for(const [name,url]of [['AI后台',cfg.dsh.baseUrl],['QQ HTTP接入',cfg.snowluma.httpUrl],['QQ WebSocket接入',cfg.snowluma.wsUrl]]){const u=new URL(url);const ok=await new Promise(resolve=>{const c=net.connect({host:u.hostname,port:Number(u.port)});c.setTimeout(1500);const done=v=>{c.destroy();resolve(v);};c.once('connect',()=>done(true));c.once('error',()=>done(false));c.once('timeout',()=>done(false));});check(name,ok,'只探测本机端口，不发消息，不测试模型');}
}
console.log(JSON.stringify(result,null,2));process.exitCode=result.checks.some(c=>c.ok===false)?1:0;
