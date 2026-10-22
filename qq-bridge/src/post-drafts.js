import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {REPLY_VARIETY_POLICY} from './comment-reply-style.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const normalized=s=>String(s).normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g,'');
const pii=/(?:\b1[3-9]\d{9}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[A-Z]:[\\/]|身份证|家庭住址|银行卡号)/i;
const bounds=n=>(String(n.bounds||'').match(/\d+/g)||[]).map(Number);
const intersects=(a,b)=>a.length===4&&a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
export function postConfirmation(text){
 const value=String(text||'').trim();
 const explicit=value.match(/^(?:(?:请)?(?:你|帮我)?(?:敲|输入|执行|发送)\s*)?\/发帖确认\s+([a-f0-9]{8})[。！!\s]*$/i);
 if(explicit)return {id:explicit[1].toLowerCase()};
 return /^(?:不用确认[，,\s]*)?(?:直接发送|直接发布|发吧|可以发布了)[。！!]*$/.test(value)?{latest:true}:null;
}
export class PostDrafts {
 constructor(root,{audit=String,getConfig,now=Date.now,python,script,runner=promisify(execFile)}={}){
  Object.assign(this,{audit,getConfig,now,python,script,runner});this.dir=path.join(root,'post-drafts');fs.mkdirSync(this.dir,{recursive:true});this.file=path.join(this.dir,'index.json');
  this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{images:[],drafts:[]};
  this.previewing=new Set();
  for(const row of this.data.drafts)if(row.status==='approved'&&row.dispatch?.status==='queued'){row.dispatch.status='interrupted';row.lastFailure='服务重启中断了准备任务；先核对真实编辑器，再继续本篇，不重复发布';this.persist();}
  for(const [key,manual] of Object.entries(this.data.manual||{}))if(manual.mode==='ready'&&!manual.verifiedAt){this.data.manual[key]={mode:'prepare',at:this.now()};const row=this.data.drafts.filter(d=>d.key===key&&d.status==='approved').at(-1);if(row)row.lastFailure='旧交接没有编辑器核验记录，尚不能认定标题、正文和配图已填好';this.persist();}
 }
 persist(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(tmp,this.file);}
 hydrateOwnerHistory(key,rows){
  this.owner(key);if(this.data.ownerHistoryHydrated)return;
  // Migration only: current draft state and deliberately cleared locks take precedence.
  if(!this.data.manual?.[key]&&!this.data.drafts.some(d=>d.key===key))for(const row of rows)this.ownerMessage(key,row.content);
  this.data.ownerHistoryHydrated=true;this.persist();
 }
 owner(key){if(key!==`private:${this.getConfig().ownerQQ}`)throw Error('发帖草稿和确认仅限管理员私聊');}
 clean(text){const value=this.audit(String(text||'').trim()),cfg=this.getConfig();const ids=[cfg.ownerQQ,...(cfg.allow?.private||[])].map(String).filter(x=>x.length>=5);if(pii.test(value)||ids.some(id=>value.includes(id)))throw Error('草稿疑含个人信息，请移除账号、联系方式或本机资料');return value;}
 async capture(key,state,screenshot,box,reason,{source='public-post',chatEvidence=[],maskBoxes=[],trustedImport=false}={}){
  this.owner(key);
  if(!trustedImport){
   if(source==='owner-chat'){
    const visible=normalized(state.nodes.map(n=>n.text||'').join('\n'));
    const matches=[...new Set(chatEvidence.filter(t=>t.length>=8&&visible.includes(normalized(t))))];
    if(state.package!=='com.tencent.mobileqq'||matches.length<2)throw Error('未核实这是与管理员本人的聊天；可请管理员把她允许使用的聊天截图发来，再裁剪并检查敏感资料');
   }else if(state.package!=='com.max.xiaoheihe'||state.nodes.some(n=>/^(私信|聊天|账户安全|账号设置|实名认证|支付)$/.test(n.text||'')))throw Error('公开取图仅限小黑盒阅读页面；管理员的聊天截图须选owner-chat并核实来源');
  }
  for(const k of ['x','y','width','height'])if(!Number.isSafeInteger(box?.[k]))throw Error('先看截图，再提供主体区域的整数裁剪坐标');
  if(box.width<32||box.height<32||box.x<0||box.y<0||box.x+box.width>state.width||box.y+box.height>state.height)throw Error('裁剪区域超出实际截图');
  if(this.data.images.length>=200)throw Error('发帖配图库已满，请先整理');
  const clip=[box.x,box.y,box.x+box.width,box.y+box.height],redactions=[];
  const privateIds=[this.getConfig().ownerQQ,...(this.getConfig().allow?.private||[])].map(String).filter(x=>x.length>=5);
  for(const n of state.nodes){const b=bounds(n),text=(n.text||'')+' '+(n.description||'');if(intersects(b,clip)&&(pii.test(text)||privateIds.some(id=>text.includes(id))||/(?:phone_number|mobile_number|qq_number|id_card|home_address|precise_location|password|api_key|access_token)/i.test(n.resourceId||'')))redactions.push(b);}
  if(maskBoxes.length>20)throw Error('最多20个额外遮盖区域');
  for(const b of maskBoxes){if(['x','y','width','height'].some(k=>!Number.isSafeInteger(b[k]))||Math.min(b.x,b.y)<0||Math.min(b.width,b.height)<1||b.x+b.width>state.width||b.y+b.height>state.height)throw Error('遮盖区域超出实际图片');redactions.push([b.x,b.y,b.x+b.width,b.y+b.height]);}
  // Status/nav bars are never part of a public screenshot, even if the model
  // selected the entire screen. Unknown raster-only PII still needs review.
  if(source!=='approved-meme')redactions.push([0,0,state.width,Math.ceil(state.height*.025)],[0,Math.floor(state.height*.985),state.width,state.height]);
  const id=randomUUID(),raw=path.join(this.dir,id+'.raw.png'),file=path.join(this.dir,id+'.png');
  fs.writeFileSync(raw,Buffer.from(screenshot.image.data,'base64'),{mode:0o600});
  try{const out=await this.runner(this.python,[this.script,'--input',raw,'--output',file,'--spec',JSON.stringify({...box,redactions})],{windowsHide:true,timeout:20000,maxBuffer:2048});const info=JSON.parse(out.stdout);const bytes=fs.readFileSync(file);const row={id,key,sha256:hash(bytes),bytes:bytes.length,createdAt:this.now(),box,redactions:info.redactions,description:this.clean(reason)};this.data.images.push(row);this.persist();return {id,...info,image:{mimeType:'image/png',data:bytes.toString('base64')},description:`发帖候选图ID：${id}。${row.description}。已裁剪并遮盖可识别的敏感资料，头像和名字可保留，仍须实际看图与管理员预览；未发布。`};}
  finally{fs.rmSync(raw,{force:true});}
 }
 async importImage(key,image,box,reason,options={}){
  this.owner(key);const tmp=path.join(this.dir,randomUUID()+'.import');fs.writeFileSync(tmp,Buffer.from(image.data,'base64'),{mode:0o600});
  try{const out=await this.runner(this.python,[this.script,'--input',tmp,'--info'],{windowsHide:true,timeout:10000,maxBuffer:1024}),size=JSON.parse(out.stdout);return await this.capture(key,{...size,package:'owner-imported',nodes:[]},{image},box,reason,{...options,trustedImport:true});}finally{fs.rmSync(tmp,{force:true});}
 }
 image(id,key){const row=this.data.images.find(r=>r.id===id&&r.key===key);if(!row)throw Error('配图不存在或不属于本会话');const data=fs.readFileSync(path.join(this.dir,id+'.png'));if(hash(data)!==row.sha256)throw Error('配图已变化，需重新预览确认');return {row,data};}
 draft(key,body){this.owner(key);const title=this.clean(body.title),content=this.clean(body.content);if(!title||title.length>80||!content||content.length>1800)throw Error('标题1～80字，正文1～1800字');if(/\[cube_[^\]]+\]/i.test(title+content))throw Error('平台表情代码不会自动渲染；请用真实图片配图或实际点击平台表情，不能直接写cube代码');if(!(title+content).includes('智能大肥鱼'))throw Error('原创帖子须自然表明自己是“智能大肥鱼”');const images=[...new Set(body.imageIds||[])];if(images.length>3)throw Error('每篇最多3张精选配图');for(const id of images)this.image(id,key);const row={id:randomUUID().slice(0,8),key,title,content,imageIds:images,status:'draft',createdAt:this.now()};if(this.data.ownerPublishes){this.data.manual??={};this.data.manual[key]={mode:'prepare',at:this.now()};}for(const old of this.data.drafts)if(old.key===key&&['draft','previewed','approved'].includes(old.status)){old.status='superseded';old.replacedBy=row.id;}this.data.drafts.push(row);this.persist();return {...row,instruction:'尚未发布。此前未提交草稿的确认已失效。调用qq_post_preview向管理员展示全文和实际配图，等待本篇确认。'};}
 get(key,id){this.owner(key);const row=this.data.drafts.find(r=>r.id===id&&r.key===key);if(!row)throw Error('没有这份草稿');return row;}
 async preview(key,id,deliver){
  const row=this.get(key,id);if(this.previewing.has(id))return {id,status:row.status,previewInProgress:true,note:'这份预览正在发送，不重复投递'};
  if(row.status==='approved'&&this.now()-row.approvedAt>2*3600000){row.status='needs-review';delete row.approvedAt;delete row.previewDelivery;this.persist();}
  if(!['draft','previewed','needs-review'].includes(row.status))throw Error('此草稿已确认或提交，不能替换内容');
  const imgs=row.imageIds.map(i=>this.image(i,key));if(row.status==='previewed')return {id,status:row.status,alreadyPreviewed:true,awaitingOwnerConfirmation:true};
  const progress=row.previewDelivery??={textSent:false,imagesSent:0};
  const checkpoint=patch=>{Object.assign(progress,patch,{at:this.now()});this.persist();};
  this.previewing.add(id);
  try{await deliver(`智能大肥鱼发帖草稿 ${row.id}\n\n标题：${row.title}\n\n${row.content}\n\n配图 ${imgs.length} 张，以下均为裁剪后的实际图片。\n同意后发 /发帖确认 ${row.id}；不满意可让我改，取消用 /发帖取消 ${row.id}。`,imgs.map(i=>i.data),{progress,checkpoint});
   checkpoint({textSent:true,imagesSent:imgs.length});row.status='previewed';row.previewedAt=this.now();delete row.lastFailure;this.persist();return {id,status:row.status,awaitingOwnerConfirmation:true};
  }catch(error){row.lastFailure=`预览未完整送达：正文${progress.textSent?'已送达':'未确认'}，配图${progress.imagesSent}/${imgs.length}已送达；再次预览只续传未完成部分`;this.persist();throw Error(row.lastFailure+'。'+error.message);}
  finally{this.previewing.delete(id);}
 }
 approve(key,id){id=String(id).trim().replace(/[。.!！]+$/,'');const row=this.get(key,id);if(row.status!=='previewed')throw Error('先完整预览草稿和配图，再确认');for(const i of row.imageIds)this.image(i,key);if(this.data.ownerPublishes){this.data.manual??={};this.data.manual[key]={mode:'prepare',at:this.now()};}else if(this.data.manual)delete this.data.manual[key];row.status='approved';row.approvedAt=this.now();this.persist();return {id,status:row.status};}
 cancel(key,id){const row=this.get(key,id);if(row.status==='submission-unverified')throw Error('已尝试提交，先查实际帖子；取消草稿不能撤回已发布内容');row.status='cancelled';this.persist();return {id,status:row.status};}
 guard({scope,operation,args,observation}){
  if(observation?.package!=='com.max.xiaoheihe')return;
  // A reply composer belongs to a published post, not to the original-post editor.
  // Require native comment controls; a label containing “回复” alone is insufficient.
  const ns=observation.nodes||[],editor=ns.find(n=>/:id\/et_editor$/.test(n.resourceId||''));
  const commentPanel=(editor||ns.some(n=>n.focused&&n.text))&&ns.some(n=>n.text==='发送'||n.description==='发送')&&!ns.some(n=>/标题|发布帖子|发表帖子/.test(n.text||''));
  const clicked=n=>{const b=bounds(n);return operation==='tap'&&b.length===4&&args.x>=b[0]&&args.x<b[2]&&args.y>=b[1]&&args.y<b[3];};
  if(this.data.commentReplies?.[scope]?.enabled&&scope===`private:${this.getConfig().ownerQQ}`&&commentPanel&&(
   operation==='type'&&(editor?.focused||ns.some(n=>n.focused))||operation==='tap'&&ns.some(n=>(/:id\/(?:et_editor|tv_send)$/.test(n.resourceId||'')||n.text==='发送'||n.description==='发送')&&clicked(n))||operation==='key'&&args.key==='enter'
  ))return;
  const visibleText=normalized(ns.map(n=>n.text||'').join('\n'));
  const titleField=ns.some(n=>/:id\/(?:et_title|et_post_title|post_title)$/.test(n.resourceId||''))||!!editor&&ns.some(n=>/^(?:标题|添加标题|请输入标题)(?:[（(：:]|$)/.test(n.text||''));
  const originalEditor=titleField||ns.some(n=>/^(发布|发布帖子|发表帖子|发布动态)$/.test((n.text||n.description||'').trim()))&&(ns.some(n=>/标题|正文|说点什么|分享.{0,6}想法/.test(n.text||'')||/:id\/et_(?:title|content|editor)/.test(n.resourceId||''))||this.data.drafts.some(d=>d.key===scope&&d.status==='approved'&&visibleText.includes(normalized(d.title))&&visibleText.includes(normalized(d.content))));
  const manual=this.data.manual?.[scope];if(manual?.mode==='ready'&&originalEditor&&(operation==='type'||operation==='key'&&args.key==='enter'||operation==='tap'))throw Error('编辑器已交给管理员手动发布，禁止旧任务继续操作；需管理员新的明确编辑要求');
  if(manual?.mode==='verify'&&(operation==='type'&&(originalEditor||commentPanel)||(observation.nodes||[]).some(n=>/^(编辑|修改|发布|删除)$/.test(n.text||'')&&operation==='tap'&&(()=>{const b=bounds(n);return b.length===4&&args.x>=b[0]&&args.x<b[2]&&args.y>=b[1]&&args.y<b[3];})())))throw Error('当前只核对管理员已发布的帖子，不能擅自编辑或再次发布');
  const nodes=observation.nodes||[],publish=nodes.filter(n=>/^(发布|发布帖子|发表帖子|发布动态)$/.test((n.text||n.description||'').trim()));
  const hit=operation==='tap'&&publish.some(n=>{const b=bounds(n);return b.length===4&&args.x>=b[0]&&args.x<b[2]&&args.y>=b[1]&&args.y<b[3];})||operation==='key'&&args.key==='enter'&&publish.length>0;
  if(!hit)return;
  this.owner(scope);if(manual)throw Error('本次由管理员手动发布，小鲸鱼不能点击最终发布');if(!args.postDraftId)throw Error('原创帖发布前必须qq_post_draft、qq_post_preview并由管理员 /发帖确认；确认后携带postDraftId');
  const row=this.get(scope,args.postDraftId);if(row.status!=='approved'||this.now()-row.approvedAt>2*3600000)throw Error('本篇没有有效的一次性确认，或已提交/取消/超过2小时');
  const visible=nodes.map(n=>n.text||'').join('\n');if(!normalized(visible).includes(normalized(row.title))||!normalized(visible).includes(normalized(row.content)))throw Error('当前编辑器正文与确认草稿不一致或未完整显示，不能发布');
  for(const id of row.imageIds)this.image(id,scope);
  row.status='submission-unverified';row.submissionAt=this.now();this.persist();return {publishCheck:{title:row.title,content:row.content},onFailure:error=>{if(error.notSubmitted===true){row.preflightFailures=(row.preflightFailures||0)+1;row.status=row.preflightFailures>=2?'needs-review':'approved';row.lastFailure='动作前核对未通过，未点击发布';delete row.submissionAt;this.persist();}}};
 }
 ownerMessage(key,text){this.owner(key);this.data.manual??={};
  if(/以后[\s\S]*我(?:自己)?(?:来|手动|点|点击)?发布/.test(text)){this.data.ownerPublishes=true;this.data.manual[key]={mode:'prepare',at:this.now()};this.persist();}
  if(/^(?:请)?(?:继续|接着)(?:帮我)?发布(?:刚才的|这份|这个|那份)?(?:帖子|草稿)?[。！!]*$/.test(text.trim())){
   const draft=this.data.drafts.filter(d=>d.key===key&&d.status==='approved'&&this.now()-d.approvedAt<=2*3600000).at(-1);
   if(draft){delete this.data.manual[key];this.persist();return;}
  }
  if(/^(?:请)?(?:关闭|停止|取消)自主回复评论[。！!]*$/.test(text))this.setCommentReplies(key,false);
  if(/^(?:请)?(?:开启|开放)自主回复评论[。！!]*$/.test(text))this.setCommentReplies(key,true);
  if(/(?:去|继续|可以|允许|帮我).*(?:回复|回一下).*(?:评论|帖子|贴子)|(?:帖子|贴子).*(?:回复|一一回复)/.test(text)&&!/(?:不要|别|停止|取消|不许)/.test(text)&&this.data.manual[key]?.mode==='ready'){this.data.manual[key]={mode:'verify',at:this.now()};this.persist();}
  if(/(?:最后.{0,4}由我发布|我来发布|我自己发布|由我手动发布|我点发布|我点击发布)/.test(text)){this.data.manual[key]={mode:'prepare',at:this.now()};this.persist();}
  else if(/^(?:我)?(?:已经发布(?:完了|了)?|发布完了|已发完)[。！!]*$/.test(text.trim())){this.data.manual[key]={mode:'verify',at:this.now()};this.persist();}
  else if(/(?:再改|修改|更改|重新编辑|重新发帖|准备(?:发送|发布)|发(?:个|一篇)帖子|去.*刷帖)/.test(text)){delete this.data.manual[key];this.persist();}
 }
 setCommentReplies(key,enabled){this.owner(key);if(typeof enabled!=='boolean')throw Error('评论开关须为布尔值');this.data.commentReplies??={};this.data.commentReplies[key]={enabled,at:this.now()};this.persist();}
 commentReplyPrompt(key){return this.data.commentReplies?.[key]?.enabled?REPLY_VARIETY_POLICY+'【自主回复评论已开放】在管理员发起的查看自己帖子评论、回复通知或本次评论任务中，按实际评论列表顺序逐条回复并组织文字，普通短留言也回应，不只挑选少量评论，无需逐条请求确认。必须遵守当前任务模式：按消息回复从消息列表逐条核对、可跨不同老帖，不改成最新帖子补漏；按帖子回复只处理指定链接，不用消息列表代替整帖扫描；每批少量回复，5条只是分批节奏，不是整个任务上限；有自主回复批次时按runId和batchId继续并调用qq_comment_reply_finish登记，后台会续接，无需管理员逐批说继续。跳过已回复、广告及争吵，不重复发送。先核对帖子和评论作者，发送后回读核实，记录真实目标与文本。此许可只用于评论，不允许修改或重发原帖，不绕过刷帖取消、时限和只读限制；只在管理员本次授权的数量和时限内续接，不启动额外后台巡查或自行续期。可用“关闭自主回复评论”关闭。':'';}
 handoff(key,state){
  this.owner(key);const row=this.data.drafts.filter(d=>d.key===key&&d.status==='approved'&&this.now()-d.approvedAt<=2*3600000).at(-1),nodes=state?.nodes||[];
  const visible=normalized(nodes.map(n=>n.text||'').join('\n'));
  if(!row||state?.package!=='com.max.xiaoheihe'||!nodes.some(n=>/^(发布|发布帖子|发表帖子|发布动态)$/.test((n.text||n.description||'').trim()))||!visible.includes(normalized(row.title))||!visible.includes(normalized(row.content)))throw Error('尚未核实已填好的真实编辑器：请先实际准备并回读本篇标题、完整正文和配图，不能空口交接');
  const attached=nodes.filter(n=>/(?:delete|remove).*(?:image|photo)|(?:image|photo).*(?:delete|remove)/i.test(n.resourceId||'')||/^(?:删除|移除)(?:图片|照片)(?:\s*\d+)?$/.test(n.description||n.text||'')).length;
  const counts=nodes.filter(n=>/(?:image|photo|pic).*(?:count|num)|(?:count|num).*(?:image|photo|pic)/i.test(n.resourceId||'')).map(n=>String(n.text||n.description||'').match(/^(\d+)(?:\s*\/\s*\d+|\s*张)?$/)?.[1]).filter(v=>v!==undefined).map(Number);
  if(row.imageIds.length&&attached!==row.imageIds.length&&!counts.includes(row.imageIds.length))throw Error('正文已核对，但配图数量尚未从编辑器核实；不能宣称配图已填好或交接完成');
  this.data.manual??={};this.data.manual[key]={mode:'ready',at:this.now(),verifiedAt:this.now(),draftId:row.id};delete row.lastFailure;this.persist();return {handedOff:true,id:row.id,verifiedImageCount:row.imageIds.length,note:'已实际核对编辑器标题、完整正文及配图数量，交给管理员；不再输入或点击最终发布。'};
 }
 async fromMeme(key,image,reason){this.owner(key);const tmp=path.join(this.dir,randomUUID()+'.import');fs.writeFileSync(tmp,Buffer.from(image.data,'base64'),{mode:0o600});
  try{const out=await this.runner(this.python,[this.script,'--input',tmp,'--info'],{windowsHide:true,timeout:10000,maxBuffer:1024}),size=JSON.parse(out.stdout);return await this.capture(key,{...size,package:'approved-meme',nodes:[]},{image},{x:0,y:0,width:size.width,height:size.height},reason,{source:'approved-meme',trustedImport:true});}finally{fs.rmSync(tmp,{force:true});}
 }
 prompt(key,id){const r=this.get(key,id),manual=this.data.manual?.[key];if(manual&&manual.mode!=='prepare')return this.statePrompt(key);if(r.status!=='approved')return '这份草稿没有有效确认，不发布。';return `【管理员已确认本篇原创帖】草稿ID=${r.id}，标题=${r.title}，正文=${r.content}，配图ID=${JSON.stringify(r.imageIds)}。仅本篇一次许可，不能改文换图。按真实小黑盒界面准备，配图未能正确添加则停止，不偷换成别的相册图。${manual?.mode==='prepare'?'本次只实际填好编辑器，通过qq_post_handoff核验后交给管理员点最终发布，禁止自行点击最终发布。':'发布前读回完整编辑器，与确认内容核对；qq_android_action.args.postDraftId='+r.id+'。真实提交后去主页回读核实，未确认只说已提交，失败不重复点击。'}`;}
 statePrompt(key){
  if(key!==`private:${this.getConfig().ownerQQ}`)return '';
  const manual=this.data.manual?.[key];
  if(manual?.mode==='ready')return '\n【发帖实时状态】编辑器已经实际核验并交给管理员亲自发布。停止修改本篇编辑器或自动发布；旧的approved与排队唤醒不能覆盖这次交接。其他已授权的浏览与评论任务可按各自权限执行。\n';
  if(manual?.mode==='prepare')return '\n【发帖实时状态】本次由管理员点最终发布；小鲸鱼须实际操作并准备标题、正文、配图，准备后qq_post_handoff会读取真实编辑器核验再交接。这里只表示准备阶段，不能据此声称已经填好；不能只调用交接而省略实际操作。\n';
  if(manual?.mode==='verify')return '\n【发帖实时状态】本次只核对管理员已发布的帖子，不允许修改或重新发布。\n';
  const r=this.data.drafts.filter(d=>d.key===key&&!['superseded','cancelled'].includes(d.status)).at(-1);if(!r)return '';
  if(r.status==='approved'&&this.now()-r.approvedAt<=2*3600000)return `\n【发帖实时状态，以后台为准】草稿${r.id}已经收到管理员确认（approved），不得再要求输入确认口令。用qq_post_status读取确认正文和配图；按这份内容继续，发布动作携带postDraftId=${r.id}。正在处理时不另开重复任务，提交后回读，未核实不能说成功。\n`;
  if(r.status==='approved')return `\n【发帖实时状态】草稿${r.id}的确认已超过2小时，需要重新完整预览并确认；不要宣称仍有有效许可。\n`;
  if(r.status==='submission-unverified')return `\n【发帖实时状态】草稿${r.id}已尝试提交，结果尚未核实；只能回读实际帖子，不能再次发布，也不要重新索要确认来绕过核实。\n`;
  return `\n【发帖实时状态】草稿${r.id}状态=${r.status}。仅previewed表示等待本篇明确确认；“已预览”不是发布许可。已经明确确认的用户不需要再照抄固定口令。\n`;
 }
 canWake(key,id){const r=this.data.drafts.find(d=>d.key===key&&d.id===id),manual=this.data.manual?.[key];return key===`private:${this.getConfig().ownerQQ}`&&(!manual||manual.mode==='prepare')&&r?.status==='approved'&&this.now()-r.approvedAt<=2*3600000;}
}
