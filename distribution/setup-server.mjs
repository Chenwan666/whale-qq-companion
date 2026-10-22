import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {randomBytes,timingSafeEqual} from 'node:crypto';import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const validQQ=value=>/^[1-9]\d{4,11}$/.test(String(value||''));
export function prepareConfig(base,input,edition){
 if(!validQQ(input.ownerQQ))throw Error('请输入你自己的管理员QQ号');
 const localUrl=(raw,protocols)=>{const u=new URL(raw);if(!protocols.includes(u.protocol)||u.hostname!=='127.0.0.1'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('接入地址只接受 127.0.0.1 的本机服务地址');return u.origin;};
 const config=structuredClone(base);config.ownerQQ=Number(input.ownerQQ);config.allow.private=base.ownerQQ===config.ownerQQ?[...new Set([config.ownerQQ,...(base.allow.private||[])])]:[config.ownerQQ];config.consoleToken=base.consoleToken||randomBytes(32).toString('hex');
 config.snowluma.httpUrl=localUrl(input.httpUrl||base.snowluma.httpUrl,['http:']);config.snowluma.wsUrl=localUrl(input.wsUrl||base.snowluma.wsUrl,['ws:']);
 config.snowluma.accessToken=String(input.gatewayToken||base.snowluma.accessToken||'');config.companion.tts=edition==='ultimate';config.socialV2.tools.sendVoice=edition==='ultimate';return config;
}
export function saveSetup(baseRoot,input){
 const bridge=path.join(baseRoot,'qq-bridge'),edition=JSON.parse(fs.readFileSync(path.join(bridge,'release.json'),'utf8')).edition;
 const configFile=path.join(bridge,'config.json');const baseFile=fs.existsSync(configFile)?configFile:path.join(baseRoot,'distribution','config-template.json');const cfg=prepareConfig(JSON.parse(fs.readFileSync(baseFile,'utf8')),input,edition);
 const state=path.join(bridge,'state');fs.mkdirSync(state,{recursive:true});
 const secretFile=path.join(state,'provider-secret.json');let previous={};try{previous=JSON.parse(fs.readFileSync(secretFile,'utf8'));}catch{}
 const apiKey=String(input.apiKey||previous.apiKey||'').trim();if(apiKey&&(/\s/.test(apiKey)||apiKey.length<10))throw Error('API Key 格式不正确，请直接粘贴服务商提供的值');
 let voice=null;if(edition==='ultimate'){
  const engine=String(input.voiceEngine||cfg.companion.voiceEngine||'local');if(!['local','doubao','edge'].includes(engine))throw Error('语音服务类型不支持');cfg.companion.voiceEngine=engine;cfg.companion.localVoiceName=cfg.companion.localVoiceName||'auto';
  let old={};try{old=JSON.parse(fs.readFileSync(path.join(state,'companion','voice-doubao.json'),'utf8'));}catch{}
  if(engine==='doubao'){const speaker=String(input.speaker||old.speaker||''),key=String(input.voiceApiKey||old.apiKey||'');if(!/^[-_a-zA-Z0-9]{3,128}$/.test(speaker)||key.length<10||/\s/.test(key))throw Error('豆包语音需要你自己的语音API Key与有效音色ID，不能用模型Key代替');voice={apiKey:key,speaker,resourceId:speaker.startsWith('S_')?'seed-icl-2.0':'seed-tts-2.0'};}
 }
 const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};write(configFile,cfg);write(secretFile,{apiKey});if(voice)write(path.join(state,'companion','voice-doubao.json'),voice);
 for(const [name,value]of [['current-role.json',{role:'通用鲸鱼',mode:'active'}],['mode.json',{mode:'reserved2'}]])if(!fs.existsSync(path.join(state,name)))write(path.join(state,name),value);
 return {ok:true,configuredModel:Boolean(apiKey),edition};
}
export async function serveSetup(baseRoot=root,{openBrowser=true}={}){
 const nonce=randomBytes(24).toString('hex');const server=http.createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${server.address().port}`;res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method==='GET'&&req.url==='/'){
   const edition=JSON.parse(fs.readFileSync(path.join(baseRoot,'qq-bridge','release.json'),'utf8')).edition;let existing={};try{existing=JSON.parse(fs.readFileSync(path.join(baseRoot,'qq-bridge','config.json'),'utf8'));}catch{}
   const escape=s=>String(s||'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
   let voice=edition==='ultimate'?'<details><summary>终极版语音设置（可先用本地声音）</summary><label>语音服务<select name="voiceEngine"><option value="local">本地中文声音 · 无语音API费用</option><option value="doubao">豆包语音 · 需自己的服务权限</option><option value="edge">Edge 在线合成 · 可用性受网络影响</option></select></label><label>语音服务 API Key<input name="voiceApiKey" type="password" autocomplete="new-password"></label><label>已授权音色 ID<input name="speaker" autocomplete="off" placeholder="不用填原作者的音色，使用自己的"></label><p>本地语音需要 Windows 已安装中文声音；云端语音请先在启动菜单5安装可选依赖。已保存的Key不回显，留空保留。</p></details>':'';
   const engine=existing.companion?.voiceEngine;if(engine)voice=voice.replace(`value="${engine}"`,`value="${engine}" selected`);
   let html=fs.readFileSync(path.join(baseRoot,'distribution','setup.html'),'utf8').replaceAll('__CSRF__',nonce).replace('__VOICE_FORM__',voice);
   if(validQQ(existing.ownerQQ))html=html.replace('name="ownerQQ"','name="ownerQQ" value="'+escape(existing.ownerQQ)+'"');for(const [field,url]of [['httpUrl',existing.snowluma?.httpUrl],['wsUrl',existing.snowluma?.wsUrl]])if(url)html=html.replace(new RegExp(`name="${field}" value="[^"]*"`),`name="${field}" value="${escape(url)}"`);
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;
  }
  if(req.method!=='POST'||req.url!=='/save'){res.writeHead(404);res.end();return;}
  if(req.headers.origin!==origin||!/^application\/json/.test(req.headers['content-type']||'')){res.writeHead(403);res.end('Local setup only');return;}
  const supplied=String(req.headers['x-setup-token']||''),a=Buffer.from(supplied),b=Buffer.from(nonce);if(a.length!==b.length||!timingSafeEqual(a,b)){res.writeHead(403);res.end('Invalid setup session');return;}
  let text='';try{for await(const chunk of req){text+=chunk;if(text.length>16000)throw Error('填写内容过长');}const result=saveSetup(baseRoot,JSON.parse(text));res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));setTimeout(()=>server.close(),1500).unref();}catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:e.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/`;console.log('WHALE_SETUP_URL='+url);
 if(openBrowser){const {spawn}=await import('node:child_process');spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref();}
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await serveSetup();
