import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {safeFetchResource} from './safe-fetch.js';
import {runSingingProcess} from './singing.js';

const normalize=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
export function chooseSong(rows,title,artist=''){
 const exact=rows.filter(r=>(normalize(r.title)===normalize(title)||normalize(r.artist+' '+r.title)===normalize(title)||normalize(r.title+' '+r.artist)===normalize(title))&&(!artist||normalize(r.artist)===normalize(artist)));
 return exact.length===1?exact[0]:null;
}
export function isAudioResource(buffer,type=''){
 if(/text\/|html|json|javascript/i.test(type))return false;
 return buffer?.length>1000&&(buffer.subarray(0,3).toString()==='ID3'||buffer[0]===0xff&&(buffer[1]&0xe0)===0xe0||['RIFF','OggS','fLaC'].includes(buffer.subarray(0,4).toString())||buffer.subarray(4,8).toString()==='ftyp');
}
const publicCandidate=c=>({id:c.id,title:c.title,artist:c.artist,album:c.album||'',providers:[...new Set(c.origins.map(o=>o.provider))]});
export function platformExcerptHint(data){
 const d=data?.data||data;if(!d||typeof d!=='object')return null;const duration=Number(d.timelength)/1000||Number(d.duration)||0;
 const seconds=v=>{if(typeof v==='string'&&/^\d{1,2}:\d{2}$/.test(v)){const [m,s]=v.split(':').map(Number);return m*60+s;}const n=Number(v);return duration&&n>duration+2&&n/1000<=duration+2?n/1000:n;};
 const range=(row,kind)=>{if(!row||typeof row!=='object')return null;const rawStart=row.start_time??row.start,rawEnd=row.end_time??row.end;if(rawStart==null||rawEnd==null)return null;const start=seconds(rawStart),end=seconds(rawEnd);return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end-start>=5&&end<=(duration||600)+1?{start,end,kind}:null;};
 const chorus=Array.isArray(d.choric_audios)?d.choric_audios:[d.choric_audios];for(const row of chorus){const r=range(row,'chorus');if(r)return r;}
 return range({start:d.free_part_start,end:d.free_part_end},'preview');
}

export function sourceError(code,message,platformCode){const error=Error(message);error.code=code;if(Number.isFinite(platformCode))error.platformCode=platformCode;return error;}
export function kugouPlaybackInfo(json){
 const d=json?.data||{},platformCode=Number(json?.err_code??json?.error_code);
 if(json?.status===0&&platformCode===30020)throw sourceError('SOURCE_VERIFICATION_REQUIRED','酷狗网页要求完成安全验证（30020），请在固定酷狗窗口按网页提示验证后重试；不代表会员或登录已失效',platformCode);
 if(json?.status===0)throw sourceError('SOURCE_PLAYBACK_DENIED','酷狗网页拒绝提供此曲音源（返回'+(Number.isFinite(platformCode)?platformCode:'未知')+'）；不能据此断定登录失效',platformCode);
 return {backupUrls:[...new Set((Array.isArray(d.play_backup_url)?d.play_backup_url:typeof d.play_backup_url==='string'?[d.play_backup_url]:[]).filter(u=>typeof u==='string'&&/^https?:\/\//.test(u)))].slice(0,3),url:typeof d.play_url==='string'&&/^https?:\/\//.test(d.play_url)?d.play_url:null,duration:Number(d.timelength)/1000||0,isPreview:Number(d.is_free_part)>0,fullVerified:d.is_free_part!==undefined&&Number(d.is_free_part)===0&&Number(d.timelength)>0,hint:platformExcerptHint(json)};
}
// Listen before clicking: a popup can finish songinfo before waitForEvent resolves.
// Buffer only the normal playback responses and bind them to the selected page.
export function watchKugouPlayback(context){
 let page=null,closed=false,sequence=0,latest=0,value={media:null,error:null},resolveReady;
 const buffered=[],ready=new Promise(resolve=>resolveReady=resolve);
 const accept=row=>{if(closed||row.page!==page||row.sequence<latest)return;latest=row.sequence;try{value={media:kugouPlaybackInfo(row.json),error:null};}catch(error){value={media:null,error};}if(value.error||value.media?.url)resolveReady(value);};
 const listener=async response=>{try{
  if(new URL(response.url()).pathname!=='/play/songinfo')return;
  const row={page:response.frame().page(),sequence:++sequence,json:await response.json()};if(closed)return;
  if(page)accept(row);else{buffered.push(row);if(buffered.length>20)buffered.shift();}
 }catch{}};
 context.on('response',listener);
 return {ready,bind(selected){page=selected;for(const row of buffered)accept(row);buffered.length=0;},get value(){return value;},close(){closed=true;context.off('response',listener);buffered.length=0;}};
}
export async function getPlaybackWithRetry(provider,origin,signal){
 try{return await provider.audio(origin,signal);}catch(error){
  if(signal?.aborted||error.code!=='SOURCE_PLAYER_TIMEOUT')throw error;
  // Exactly one fresh player attempt, before rendering or sending anything.
  return provider.audio(origin,signal);
 }
}
export const audioFailureKey=origin=>JSON.stringify([origin.provider,normalize(origin.title),normalize(origin.artist)]);
const safeFailure=error=>({code:/^SOURCE_[A-Z_]+$/.test(error?.code||'')?error.code:'SOURCE_PLAYER_ERROR',platformCode:Number.isFinite(error?.platformCode)?error.platformCode:undefined,message:/^SOURCE_[A-Z_]+$/.test(error?.code||'')?error.message.slice(0,240):'播放器处理或连接失败；不能据此推断账号失效'});
export function completeAudioResponse(resource){
 if(resource.truncated||!isAudioResource(resource.buffer,resource.contentType))return false;
 if(resource.statusCode===200)return true;
 const range=String(resource.contentRange||'').match(/^bytes 0-(\d+)\/(\d+)$/i);
 return resource.statusCode===206&&!!range&&Number(range[1])+1===Number(range[2])&&resource.buffer.length===Number(range[2]);
}
export async function fetchSongAudio(media,fetchResource,signal){
 const urls=[...new Set([media.url,...(media.backupUrls||[])])].filter(Boolean).slice(0,3);let lastError;
 for(let attempt=0;attempt<urls.length;attempt++){
  if(signal?.aborted)throw Error('任务已取消');
  try{const resource=await fetchResource(urls[attempt],12*1024*1024);if(!completeAudioResponse(resource))throw sourceError('SOURCE_INVALID_AUDIO','播放器音频响应不完整或格式不可用');return resource;}
  catch(error){if(/内网|私有|禁止|loopback|private|public address/i.test(error.message))throw error;lastError=error;if(urls.length===1&&attempt===0&&/超时|timeout|ECONNRESET|ETIMEDOUT/i.test(error.message))urls.push(urls[0]);}
 }
 throw sourceError('SOURCE_DOWNLOAD_FAILED',/超时|timeout|ECONNRESET|ETIMEDOUT/i.test(lastError?.message||'')?'音频主地址和可用备用地址下载超时或连接中断，未开始转换':'音频主地址和可用备用地址未返回完整音频，未开始转换');
}
export class SongChoice extends Error{constructor(choices){super('找到多个版本，请选择歌手和版本');this.code='SONG_CHOICE';this.choices=choices;}}

export class MusicMaterials{
 constructor({stateRoot,singingRoot,kugou,phoneHint,knownSource,policy=()=>({}),fetchResource=safeFetchResource,providers,now=Date.now}){
  Object.assign(this,{stateRoot,singingRoot,kugou,phoneHint,knownSource,policy,fetchResource,now});this.file=path.join(stateRoot,'music-materials.json');this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{candidates:[],health:{}};this.data.hints??=[];this.data.audioFailures??={};
  this.providers=providers||{kugou:{search:(q,s)=>this.kugouSearch(q,s),audio:(o,s)=>this.kugouAudio(o,s)},uzz:{search:(q,s)=>this.uzzSearch(q,s),audio:(o,s)=>this.uzzAudio(o,s)}};this.uzzContext=null;this.uzzChain=Promise.resolve();this.searching=new Map();this.idle=null;
 }
 save(){fs.mkdirSync(this.stateRoot,{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(tmp,this.file);}
 status(){return {songLimitations:Object.values(this.data.audioFailures).filter(f=>f.retryAt>this.now()).map(({title,artist,provider,code,message,platformCode,retryAt})=>({title,artist,provider,code,message,platformCode,retryAt})),providers:['kugou','uzz'].map(id=>({id,name:id==='uzz'?'优折美在线播放器':'酷狗正常网页',...(this.data.health[id]||{state:'unknown'}),coolingDown:(this.data.health[id]?.retryAt||0)>this.now()})),note:'只读正常搜索及播放器实际提供的音频地址；不导出账号Cookie、不破解加密音频、不自动付费。'};}
 recent(key){const rows=this.data.candidates.filter(c=>c.key===key&&this.now()-c.time<900000),latest=rows.at(-1);return rows.filter(c=>c.cacheKey===latest?.cacheKey).slice(-10).map(publicCandidate);}
 get(key,id){const c=this.data.candidates.find(c=>c.key===key&&c.id===id&&this.now()-c.time<900000);if(!c){const error=Error('候选已过期或不属于本会话，请重新 /搜歌；不能据此判断登录失效');error.code='SONG_CANDIDATE_EXPIRED';throw error;}return c;}
 recordPhoneHint(title,artist,hint){if(!hint?.verified||hint.source!=='kugou-android-marker'||!Number.isFinite(hint.startSeconds)||!Number.isFinite(hint.durationSeconds)||hint.startSeconds<0||hint.startSeconds+5>hint.durationSeconds||!/^[a-f0-9]{64}$/i.test(hint.imageHash||''))throw Error('没有经过实际手机界面核验的高潮位置');const row={title,artist,start:hint.startSeconds,end:Math.min(hint.startSeconds+30,hint.durationSeconds),duration:hint.durationSeconds,kind:'chorus',provenance:hint.source,time:this.now()};this.data.hints=this.data.hints.filter(h=>!(normalize(h.title)===normalize(title)&&normalize(h.artist)===normalize(artist))).slice(-99);this.data.hints.push(row);this.save();return row;}
 async search(key,{title,artist='',source='auto'},signal){
  title=String(title||'').trim();artist=String(artist||'').trim();if(!title||title.length>100||artist.length>80||/https?:|[\x00-\x1f]/.test(title+artist))throw Error('请填写歌名和歌手，链接请先通过网页或文件工具处理');
  if(!['auto','uzz','kugou'].includes(source))throw Error('未知素材来源');
  const selected=source==='auto'?(this.policy().preferredSource||'auto'):source,cacheKey=JSON.stringify([key,title,artist,selected]);
  const cached=this.data.candidates.filter(c=>c.cacheKey===cacheKey&&this.now()-c.time<600000);if(cached.length)return {candidates:cached.map(publicCandidate),cached:true,health:this.status()};
  if(this.searching.has(key))throw Error('本会话正在搜索歌曲，请等待结果，不重复提交');
  const job=(async()=>{
   const names=selected==='auto'?['kugou','uzz']:[selected],query=title+(artist?' '+artist:'');
   const results=await Promise.allSettled(names.map(async provider=>{if((this.data.health[provider]?.retryAt||0)>this.now())throw Error('来源退避中');if(signal?.aborted)throw Error('任务已取消');try{const rows=await this.providers[provider].search(query,signal);this.data.health[provider]={...this.data.health[provider],state:'ready',retryAt:0,time:this.now(),note:'最近搜索成功，不等于所有歌曲都能取得音频'};return rows.map(r=>({...r,provider}));}catch(e){if(signal?.aborted)throw e;this.data.health[provider]={state:'limited',time:this.now(),retryAt:this.now()+300000,note:'来源要求登录、验证或当前不可用，五分钟内不反复请求'};throw e;}}));
   if(signal?.aborted)throw Error('任务已取消');const merged=[];
   for(const result of results)if(result.status==='fulfilled')for(const r of result.value.slice(0,10)){if(!r.title||!r.artist)continue;let row=merged.find(c=>normalize(c.title)===normalize(r.title)&&normalize(c.artist)===normalize(r.artist));if(!row){row={id:'online:'+randomUUID(),key,title:String(r.title).slice(0,100),artist:String(r.artist).slice(0,100),album:String(r.album||'').slice(0,100),query,cacheKey,time:this.now(),origins:[]};merged.push(row);}row.origins.push(r);}
   this.data.candidates=this.data.candidates.filter(c=>this.now()-c.time<900000).slice(-190);this.data.candidates.push(...merged.slice(0,10));this.save();
   if(!merged.length)throw Error('当前来源没有可用搜索结果；可稍后重新搜索、换版本或提供音频，不能据此判断登录失效');return {candidates:merged.slice(0,10).map(publicCandidate),health:this.status()};
  })();this.searching.set(key,job);try{return await job;}finally{this.searching.delete(key);}
 }
 async resolveCandidate(job,signal){
  let title=job.sourceQuery,artist=job.artist||'';
  if(title.startsWith('online:')){
   try{return this.get(job.key,title);}catch(error){
    if(error.code!=='SONG_CANDIDATE_EXPIRED')throw error;
    const known=this.data.candidates.find(c=>c.id===title&&c.key===job.key)||this.knownSource?.(job.key,title);
    if(!known?.title||!known?.artist)throw error;
    title=known.title;artist=known.artist;
   }
  }
  const result=await this.search(job.key,{title,artist},signal),match=chooseSong(result.candidates,title,artist);
  if(!match)throw new SongChoice(result.candidates);
  return this.get(job.key,match.id);
 }
 async materialize(job,signal){
  const candidate=await this.resolveCandidate(job,signal);
  job.title=candidate.title;job.artist=candidate.artist;
  if(signal?.aborted)throw Error('任务已取消');let media,provider;
  let lastError;
  for(const origin of candidate.origins){
   const failureKey=audioFailureKey(origin),old=this.data.audioFailures[failureKey];
   if(old?.retryAt>this.now()){lastError=sourceError(old.code,old.message+'；此歌曲暂时退避，请勿反复提交',old.platformCode);continue;}
   try{
    media=await getPlaybackWithRetry(this.providers[origin.provider],origin,signal);
    if(!media?.url)throw sourceError('SOURCE_NO_AUDIO','播放器未提供此曲可处理音频，尚未开始转换');
    provider=origin.provider;delete this.data.audioFailures[failureKey];this.data.health[provider]={...this.data.health[provider],audioState:'ready',audioRetryAt:0,audioCode:null,audioNote:'最近一首获取成功'};this.save();break;
   }catch(error){
    if(signal?.aborted)throw Error('任务已取消');lastError=error;const failure=safeFailure(error);
    this.data.audioFailures=Object.fromEntries(Object.entries(this.data.audioFailures).filter(([,f])=>f.retryAt>this.now()).slice(-199));
    this.data.audioFailures[failureKey]={...failure,title:candidate.title,artist:candidate.artist,provider:origin.provider,retryAt:this.now()+300000};
    this.data.health[origin.provider]={...this.data.health[origin.provider],audioState:'limited',audioRetryAt:0,audioCode:failure.code,audioNote:failure.message+'；仅此曲退避，其他歌曲不受影响'};this.save();
   }
  }
  if(!media?.url){const reason=safeFailure(lastError);throw sourceError(reason.code,reason.message,reason.platformCode);}
  if(job.clipMode!=='manual'&&job.clipMode!=='full'&&job.clipStart===undefined&&!media.hint){let hint=this.data.hints.find(h=>normalize(h.title)===normalize(candidate.title)&&normalize(h.artist)===normalize(candidate.artist)&&this.now()-h.time<30*86400000&&(!media.duration||Math.abs(media.duration-h.duration)<3));if(!hint&&this.phoneHint)try{const result=await this.phoneHint(job.key,candidate.title,candidate.artist,signal);if(result?.verified)hint=this.recordPhoneHint(candidate.title,candidate.artist,result);}catch{}if(hint)media.hint=hint;}
  if(job.full&&(media.isPreview||!media.fullVerified))throw Error('AVAILABLE_LENGTH: 酷狗仅提供试听片段，无法生成整首');
  const resource=await fetchSongAudio(media,this.fetchResource,signal);if(signal?.aborted)throw Error('任务已取消');
  if(!completeAudioResponse(resource))throw Error('来源返回的不是完整可处理音频，未开始唱歌');
  const id=randomUUID(),dir=path.join(this.singingRoot,'cache','materials'),file=path.join(dir,id+'.audio'),destination=path.join(this.singingRoot,'inputs',id+'.wav');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,resource.buffer,{flag:'wx'});
  const seconds=job.clipSeconds||12,temp=path.join(this.singingRoot,'cache','temp');fs.mkdirSync(temp,{recursive:true});const args=[path.join(this.singingRoot,'prepare-clip.py'),'--input',file,'--output',destination,'--seconds',String(seconds),'--mode',job.clipMode||'auto'];
  if(job.clipStart!==undefined)args.push('--start',String(job.clipStart));else if(job.clipMode==='manual')args.push('--start','0');
  if(job.full&&media.duration)args.push('--expected-seconds',String(media.duration));
  if(media.hint&&job.clipMode!=='full'&&job.clipStart===undefined)args.push('--hint-start',String(media.hint.start),'--hint-end',String(media.hint.end),'--hint-kind',media.hint.kind);
  try{await runSingingProcess(path.join(this.singingRoot,'env','Scripts','python.exe'),args,{cwd:this.singingRoot,signal,timeout:90000,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',TEMP:temp,TMP:temp,NUMBA_CACHE_DIR:path.join(this.singingRoot,'cache','numba')}});}finally{try{fs.unlinkSync(file);}catch{}}
  const selection=JSON.parse(fs.readFileSync(destination.replace(/\.wav$/,'.selection.json'),'utf8'));
  if(media.hint)selection.hintSource=media.hint.provenance||'platform-metadata';
  return {id,key:job.key,title:candidate.title,artist:candidate.artist,seconds:Number(((fs.statSync(destination).size-44)/176400).toFixed(2)),file:destination,source:provider,sourceCandidate:candidate.id,sourceAliases:[...new Set([...(job.sourceAliases||[]),...(this.knownSource?.(job.key,job.sourceQuery)?.sourceAliases||[]),...(job.sourceQuery.startsWith('online:')?[job.sourceQuery]:[])])].slice(-20),selection};
 }
 async withKugou(callback,signal){const task=this.kugou.chain.then(async()=>{const context=await this.kugou.ensure();const page=await context.newPage();page.setDefaultTimeout(12000);const cancel=()=>void page.close().catch(()=>{}),timer=setTimeout(cancel,45000);signal?.addEventListener('abort',cancel,{once:true});try{if(signal?.aborted)throw Error('任务已取消');return await callback(page,context);}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);await page.close().catch(()=>{});}});this.kugou.chain=task.catch(()=>{});return task;}
 async openKugouSearch(page,query){await page.goto('https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord='+encodeURIComponent(query),{waitUntil:'domcontentloaded',timeout:25000});await page.locator('#search_song .song_name').first().waitFor({timeout:15000});}
 async kugouSearch(query,signal){return this.withKugou(async page=>{await this.openKugouSearch(page,query);return page.locator('#search_song .list_content > li').evaluateAll((nodes,query)=>nodes.slice(0,10).map(n=>{const text=n.querySelector('.song_name')?.getAttribute('title')||'',i=text.indexOf(' - ');return {title:i>=0?text.slice(i+3):text,artist:i>=0?text.slice(0,i):'',album:n.querySelector('.album_name')?.getAttribute('title')||'',query,label:text};}),query);},signal);}
 async checkVerification(key,{title,artist=''}){
  const result=await this.search(key,{title,artist,source:'kugou'}),match=chooseSong(result.candidates,title,artist);
  if(!match)throw new SongChoice(result.candidates);
  const candidate=this.get(key,match.id),origin=candidate.origins.find(o=>o.provider==='kugou');
  const media=await this.kugouAudio(origin,new AbortController().signal),resource=await this.fetchResource(media.url,12*1024*1024);
  if(![200,206].includes(resource.statusCode)||!isAudioResource(resource.buffer,resource.contentType))throw sourceError('SOURCE_INVALID_AUDIO','播放器有地址，但实际音频响应仍不可用；未演唱或发送');
  delete this.data.audioFailures[audioFailureKey(origin)];this.data.health.kugou={...this.data.health.kugou,audioState:'ready',audioRetryAt:0,audioCode:null,audioVerifiedAt:this.now(),audioNote:'安全验证后已检查正常音频响应；没有创建演唱任务或发送'};this.save();
  return {verified:true,title:candidate.title,artist:candidate.artist,duration:media.duration,fullVerified:!!media.fullVerified,audioHeaderVerified:true,resourceStatus:resource.statusCode,audioBytes:resource.buffer.length,contentRange:resource.contentRange,queued:false,sent:false};
 }
 async openVerification({title,artist=''}){
  title=String(title||'').trim();artist=String(artist||'').trim();if(!title||title.length>100||artist.length>100||/https?:|[\x00-\x1f]/.test(title+artist))throw Error('请填写正常歌名和歌手');
  const context=await this.kugou.ensure(true),page=await context.newPage();await this.openKugouSearch(page,title+' '+artist);
  const links=page.locator('#search_song .song_name'),titles=await links.evaluateAll(ns=>ns.map(n=>n.getAttribute('title')||'')),index=artist?titles.findIndex(label=>normalize(label)===normalize(artist+' - '+title)):-1;
  if(index<0){await page.bringToFront();return {opened:true,title,artist,note:'请在正常酷狗窗口选择对应原唱，点击播放，按网页提示完成验证。未确认音源已恢复。'};}
  const pending=context.waitForEvent('page',{timeout:12000});await links.nth(index).click();const popup=await pending;await popup.waitForLoadState('domcontentloaded');await popup.bringToFront();await page.close();
  return {opened:true,title,artist,note:'已打开正常酷狗播放器，请点击播放并按网页提示完成安全验证。未确认音源已恢复，不会自动唱歌或发送QQ。'};
 }
 async kugouAudio(origin,signal){return this.withKugou(async(page,context)=>{
  await this.openKugouSearch(page,origin.query);
  const link=page.locator('#search_song .song_name').filter({hasText:origin.title}),titles=await link.evaluateAll(ns=>ns.map(n=>n.getAttribute('title'))),index=titles.findIndex(t=>normalize(t)===normalize(origin.label));
  if(index<0)throw sourceError('SOURCE_VERSION_CHANGED','搜索结果已变化，请重新核对版本');
  const playback=watchKugouPlayback(context);let popup;
  const cancel=()=>void popup?.close().catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});
  try{
   const popupPromise=context.waitForEvent('page',{timeout:12000});popupPromise.catch(()=>{});
   await link.nth(index).click();popup=await popupPromise;playback.bind(popup);
   await popup.waitForLoadState('domcontentloaded');
   if(playback.value.error)throw playback.value.error;if(playback.value.media?.url)return playback.value.media;
   await Promise.race([popup.locator('audio').first().waitFor({state:'attached',timeout:12000}),playback.ready.then(({error})=>{if(error)throw error;})]);
   if(playback.value.error)throw playback.value.error;if(playback.value.media?.url)return playback.value.media;
   if(await popup.locator('#KgPopupLoginBoxBg').isVisible())throw sourceError('SOURCE_LOGIN_REQUIRED','播放器明确显示登录窗口，需要恢复酷狗网页登录');
   await popup.locator('audio').evaluateAll(ns=>ns.forEach(a=>a.muted=true));
   const hasSource=await popup.locator('audio').first().evaluate(a=>!!a.currentSrc&&a.currentSrc!==location.href&&!a.currentSrc.includes('/mixsong/'));
   if(!hasSource)await popup.locator('#toggle').click({timeout:8000});
   const result=await Promise.race([
    popup.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>a.currentSrc&&a.currentSrc!==location.href&&!a.currentSrc.includes('/mixsong/')),{},{timeout:15000}).then(()=>null),
    playback.ready.then(({media,error})=>{if(error)throw error;return media;})
   ]);
   if(result?.url)return result;
   if(!playback.value.media&&!playback.value.error)await Promise.race([playback.ready,new Promise(resolve=>setTimeout(resolve,1200))]);
   const audio=await popup.locator('audio').first().evaluate(a=>({url:a.currentSrc,duration:Number.isFinite(a.duration)?a.duration:0}));
   const {media,error}=playback.value;if(error)throw error;return {...audio,...(media||{}),url:media?.url||audio.url,duration:media?.duration||audio.duration};
  }catch(error){
   if(signal?.aborted)throw Error('任务已取消');if(error.code)throw error;
   if(popup&&await popup.locator('#KgPopupLoginBoxBg').isVisible().catch(()=>false))throw sourceError('SOURCE_LOGIN_REQUIRED','播放器明确显示登录窗口，需要恢复酷狗网页登录');
   if(playback.value.error)throw playback.value.error;
   throw sourceError(/Timeout|timeout/i.test(error.message)?'SOURCE_PLAYER_TIMEOUT':'SOURCE_PLAYER_ERROR',/Timeout|timeout/i.test(error.message)?'播放器等待超时，未取得可用音源；尚未开始转换':'播放器页面或连接失败，未取得可用音源');
  }finally{playback.close();signal?.removeEventListener('abort',cancel);if(popup)await popup.close().catch(()=>{});}
 },signal);}
 async withUzz(callback,signal){const task=this.uzzChain.then(async()=>{clearTimeout(this.idle);if(!this.uzzContext){const exe='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';this.uzzContext=await chromium.launchPersistentContext(path.join(this.stateRoot,'music-browser'),{executablePath:exe,headless:true,acceptDownloads:false,serviceWorkers:'block'});await this.uzzContext.route('**/*',route=>{try{const u=new URL(route.request().url());if(!['http:','https:'].includes(u.protocol)||u.hostname!=='m.uzz.me'||route.request().method()!=='GET')return route.abort();return route.continue();}catch{return route.abort();}});this.uzzContext.on('close',()=>{this.uzzContext=null;});}const page=await this.uzzContext.newPage();page.setDefaultTimeout(12000);const cancel=()=>void page.close().catch(()=>{}),timer=setTimeout(cancel,45000);signal?.addEventListener('abort',cancel,{once:true});try{if(signal?.aborted)throw Error('任务已取消');return await callback(page);}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);await page.close().catch(()=>{});this.idle=setTimeout(()=>{const c=this.uzzContext;this.uzzContext=null;void c?.close().catch(()=>{});},120000);this.idle.unref?.();}});this.uzzChain=task.catch(()=>{});return task;}
 async openUzzSearch(page,query){const response=await page.goto('https://m.uzz.me/',{waitUntil:'domcontentloaded',timeout:25000});if(response.status()===403||response.status()===429)throw Error('播放器拒绝请求');await page.waitForFunction(()=>typeof rem!=='undefined'&&rem.audio?.length&&rem.mainList?.length,{},{timeout:25000});await page.locator('.btn[data-action="search"]').click();await page.locator('#search-wd').fill(query);await page.locator('.search-submit').click();await page.waitForFunction(()=>typeof musicList!=='undefined'&&musicList[0]?.item?.length>0,{},{timeout:15000});}
 async uzzSearch(query,signal){return this.withUzz(async page=>{await this.openUzzSearch(page,query);return page.evaluate(query=>musicList[0].item.slice(0,10).map(s=>({title:String(s.name),artist:String(s.artist),album:String(s.album||''),query,sourceId:String(s.id),source:String(s.source)})),query);},signal);}
 async uzzAudio(origin,signal){return this.withUzz(async page=>{const cancel=()=>void page.close().catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});try{await this.openUzzSearch(page,origin.query);const index=await page.evaluate(o=>musicList[0].item.findIndex(s=>String(s.id)===o.sourceId&&s.source===o.source),origin);if(index<0)throw Error('原候选已变化');const row=page.locator('.music-list .list-item[data-no="'+index+'"]').first();await row.hover();await row.locator('.icon-share').click();await page.locator('.share-url').waitFor({timeout:15000});return {url:await page.locator('.share-url').inputValue(),duration:0};}finally{signal?.removeEventListener('abort',cancel);}});}
}
