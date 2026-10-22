import {ONLINE_IMAGE_COLLECTION_POLICY} from './online-image-collection.js';
import {randomUUID,createHash} from 'node:crypto';
import {REPLY_VARIETY_POLICY} from './comment-reply-style.js';
import {PostCommentQueue,replyPostId,replyPostUrl} from './post-comment-queue.js';

export function parseReplyRequest(text){
 const value=String(text||'').trim().replace(/^(?:[@＠]\s*)?[！？!?]*(?:小鲸鱼小鲸鱼|小鲸鱼|小鲸鱼|大肥鱼)[！？!?，,、：:\s]*/,'');
 if(/^(?:停止|停|停下|别回了|先别回了|停止回复|取消回复)[。！!]*$/.test(value))return {action:'stop'};
 if(/^(?:停止|取消|暂停)(?:自主)?(?:回复评论|评论回复|回复任务)[。！!]*$/.test(value))return {action:'stop'};
 if(/^(?:(?:评论回复状态|回复进度)|(?:现在|刚才|这次|本轮)?(?:的)?(?:评论)?(?:回复|回)(?:完了|好了|完|好)(?:了吗|了没|没|吗)|(?:怎么|为什么)(?:还|又)?(?:没|没有)(?:有)?回复(?:评论)?|(?:新帖|新帖子)(?:根本|还|怎么)?(?:没|没有)回复)[？?。！!]*$/.test(value))return {action:'status'};
 if(/^(?:消息(?:列表)?回复|按消息回复)(?:进度|状态)[？?。！!]*$/.test(value))return {action:'status',mode:'inbox'};
 if(/^(?:帖子回复|单帖回复|按帖子回复)(?:进度|状态)[？?。！!]*$/.test(value))return {action:'status',mode:'post'};
 const links=value.match(/https?:\/\/[^\s<>"，。！）)]+/g)||[],withoutLinks=links.reduce((s,url)=>s.replace(url,''),value);
 if(/[？?]|不要|别再|不许|什么意思/.test(withoutLinks))return null;
 const inbox=/^(?:\/回复消息(?:\s|$)|(?:(?:请|帮我|开始|继续)\s*)*(?:(?:按|从)(?:小黑盒)?消息(?:列表)?|回复(?:小黑盒)?消息列表))/.test(withoutLinks)&&/(?:回复|\/回复消息)/.test(withoutLinks)&&!/(?:区别|怎么|如何|是什么|是不是|能不能|不要)/.test(withoutLinks);
 if(inbox){if(links.length||/(?:按帖子|这篇帖|这个帖)/.test(withoutLinks))return {action:'invalid',message:'消息列表回复与指定帖子回复不能混用；按消息回复不需要帖子链接，指定单帖请用“回复这篇帖子 + 链接”'};const count=withoutLinks.match(/(\d+)\s*条/),minutes=withoutLinks.match(/(\d+)\s*分钟/);return {action:'start',mode:'inbox',limit:count?Number(count[1]):30,minutes:minutes?Number(minutes[1]):20};}
 const single=/^(?:\/回复帖子(?:\s|$)|按帖(?:子)?回复|回复帖子)/.test(value)||/(?:回复|补漏)/.test(withoutLinks)&&(/(?:这个|这篇|这条|指定|单独|单个|这一篇).{0,4}帖/.test(withoutLinks)||links.length&&/帖|补漏|回复/.test(withoutLinks));
 if(single){if(links.length>1)return {action:'invalid',message:'单帖补漏一次只接收一个帖子链接，请分篇处理'};const count=withoutLinks.match(/(\d+)\s*条/),minutes=withoutLinks.match(/(\d+)\s*分钟/);return {action:links.length?'start':'select-post',targetUrl:links[0],limit:count?Number(count[1]):100,minutes:minutes?Number(minutes[1]):60};}
 if(!/^(?:回复|统一回复|全部回复|批量回复|开始回复|继续回复|(?:开启|开始|继续)(?:评论回复|回复评论|回复)任务)[。！!]*$/.test(value)&&!/^(?:(?:可以|请|帮我|你|去|继续|开始|自主|慢慢|逐条|一条条)\s*)*(?:搞回复|回复(?:一下)?(?:\d+条)?评论|回复(?:一下)?最近.{0,12}帖|把.{0,20}评论.{0,6}回复)/.test(value)&&!/^继续回复[，,].*(?:还没有回复|都回复)/.test(value))return null;
 const count=value.match(/(?:回复\s*)?(\d+)\s*条/),minutes=value.match(/(\d+)\s*分钟/);
 return {action:'start',limit:count?Number(count[1]):30,minutes:minutes?Number(minutes[1]):20};
}
export const replyMode=r=>r?.targetPostId||r?.targetUrl?'post':'inbox';
export function replyDispatchError(error){return String(error?.message||'未知派发错误').replace(/https?:\/\/\S+/g,'[服务地址]').replace(/(?:token|secret|api[_ -]?key|authorization|bearer)[\s:=]+\S+/gi,'[凭据已隐藏]').replace(/[a-zA-Z0-9_-]{32,}/g,'[标识已隐藏]').slice(0,300);}
export function replyStatusText(r){
 if(!r?.id)return '还没有评论回复任务，未发送评论。';
 const reasons={'dispatch-failed':'任务派发失败','batch-timeout':'批次超时','no-new-comments':'本轮检查结束','no-progress':'本批没有进展',blocked:'实际操作受阻',restart:'服务重启后暂停',expired:'原定时限已到',budget:'费用保护已停止',cancelled:'已取消',limit:'达到本轮条数上限','delivery-unverified':'发送结果待核实',permission:'功能权限未开放','mode-switch':'已切换另一回复模式',replaced:'已更换目标帖子'};
 const waits={'conversation-busy':'上一会话收尾','model-backoff':'模型冷却','device-busy':'手机设备空闲','device-paused':'手机设备恢复','service-not-ready':'服务就绪'};
 return `本轮${replyMode(r)==='post'?'按帖子回复':'按消息回复'}${r.enabled?'进行中':'已停止'}（${new Date(r.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}开始），已核实发送${r.count||0}/${r.limit||0}条。`+(r.targetUrl?'目标：'+r.targetUrl+'。':'入口：小黑盒消息列表，按列表顺序逐条处理本轮待回复通知；通知可能来自不同老帖，不等于整篇帖子补漏。')+(r.enabled?(r.batch?'当前批次已派发，尚未核实的发送不计入条数。':'等待'+(waits[r.lastDispatchReason]||'派发')+'。'):'原因：'+(reasons[r.stopReason]||r.stopReason||'未启动')+'。')+(r.lastDispatchError?'派发错误：'+r.lastDispatchError+'。':'')+'仅统计本轮，不包含以前任务的回复；本轮停止不代表评论已经全部回复。';
}
export async function dispatchCommentReplyWake({enabled,busy,modelRetryAt=0,deliver,now=Date.now()}){
 if(!enabled)return {accepted:false,reason:'service-not-ready'};
 if(modelRetryAt>now)return {accepted:false,reason:'model-backoff'};
 if(busy)return {accepted:false,reason:'conversation-busy'};
 // Unread messages are included by deliverPrompt in the same task snapshot.
 // They must never block the task that was created to handle those messages.
 const result=await deliver();return {accepted:result?.ok===true&&!result.skipped,reason:result?.ok&&!result.skipped?'accepted':'not-accepted'};
}
export function onlyReplyControlMessages(messages){const incoming=(messages||[]).filter(m=>!m.isSelf);return incoming.length>0&&incoming.every(m=>!!parseReplyRequest(m.text||m.content||''));}

export class CommentReplies{
 constructor(store,{now=Date.now}={}){
  this.db=store.db;this.now=now;this.ticking=false;
  this.postQueue=new PostCommentQueue(store);
  this.db.exec('CREATE TABLE IF NOT EXISTS comment_reply_pending(key TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS comment_reply_mode_runs(key TEXT NOT NULL,mode TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(key,mode));');
  this.db.exec('CREATE TABLE IF NOT EXISTS comment_reply_runs(key TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS comment_reply_seen(key TEXT NOT NULL,target TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(key,target));');
  for(const row of this.db.prepare('SELECT data FROM comment_reply_runs').all()){const r=JSON.parse(row.data);if(r.enabled)this.stop(r.key,'restart');else if(r.id)this.save(r);}
 }
 save(r){if(r.id)r={...r,mode:replyMode(r)};this.db.prepare('INSERT INTO comment_reply_runs VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(r.key,JSON.stringify(r));if(r.id)this.db.prepare('INSERT INTO comment_reply_mode_runs VALUES(?,?,?) ON CONFLICT(key,mode) DO UPDATE SET data=excluded.data').run(r.key,r.mode,JSON.stringify(r));return r;}
 modeStatus(key,mode){if(!['inbox','post'].includes(mode))throw Error('回复模式必须是inbox或post');const current=this.status(key);if(current.id&&replyMode(current)===mode)return current;const row=this.db.prepare('SELECT data FROM comment_reply_mode_runs WHERE key=? AND mode=?').get(key,mode);return row?{...JSON.parse(row.data),enabled:false}:{key,mode,enabled:false};}
 status(key){const row=this.db.prepare('SELECT data FROM comment_reply_runs WHERE key=?').get(key);const r=row?JSON.parse(row.data):{key,enabled:false};if(r.enabled&&this.now()>=r.expiresAt)return this.stop(key,'expired');return r.id?{...r,mode:replyMode(r)}:r;}
 awaitPost(key,request){this.db.prepare('INSERT INTO comment_reply_pending VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key,JSON.stringify({...request,expiresAt:this.now()+5*60000}));}
 pendingPost(key){const row=this.db.prepare('SELECT data FROM comment_reply_pending WHERE key=?').get(key);if(!row)return null;const p=JSON.parse(row.data);if(p.expiresAt<=this.now()){this.clearPending(key);return null;}return p;}
 clearPending(key){this.db.prepare('DELETE FROM comment_reply_pending WHERE key=?').run(key);}
 start(key,{limit=30,minutes=20,authorizationId,targetUrl,mode=targetUrl?'post':'inbox'}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(minutes)||minutes<1||minutes>60)throw Error('本次回复数量1～100条，时长1～60分钟');
  if(!['inbox','post'].includes(mode)||mode==='inbox'&&targetUrl||mode==='post'&&!targetUrl)throw Error('回复模式和入口不一致：消息列表无需链接，指定帖子必须提供真实链接');
  const scoped=targetUrl?{targetUrl:replyPostUrl(targetUrl),targetPostId:replyPostId(targetUrl)}:{};
  const old=this.status(key);if(old.enabled){if(replyMode(old)!==mode||mode==='post'&&old.targetPostId!==scoped.targetPostId)throw Error('已有另一回复模式或不同帖子的任务，须先停止旧轮再明确切换；不能借用旧进度');return {...old,alreadyRunning:true};}if(authorizationId&&old.authorizationId===authorizationId)return {...old,alreadyUsed:true};
  const r=this.save({key,id:randomUUID(),authorizationId,mode,...scoped,enabled:true,limit,count:0,batches:0,startedAt:this.now(),expiresAt:this.now()+minutes*60000,nextAt:this.now(),batch:null});if(r.targetPostId)this.postQueue.begin(key,r);this.clearPending(key);return r;
 }
 stop(key,reason='cancelled'){const row=this.db.prepare('SELECT data FROM comment_reply_runs WHERE key=?').get(key);return this.save({...row?JSON.parse(row.data):{key},enabled:false,batch:null,stopReason:reason,stoppedAt:this.now()});}
 reconcileReadback(key,id){const r=this.status(key),row=this.db.prepare('SELECT data FROM comment_reply_seen WHERE key=? AND target=?').get(key,id),d=row&&JSON.parse(row.data);if(!d||d.runId!==r.id||!['submitted','submission-unverified','observed'].includes(d.status))throw Error('不是本轮待核实的已提交记录');if(d.status==='observed')return r;this.db.prepare('UPDATE comment_reply_seen SET data=? WHERE key=? AND target=?').run(JSON.stringify({...d,status:'observed',readbackAt:this.now()}),key,id);this.postQueue.mark(key,r,id,'observed');r.count++;return this.save(r);}
 resumeVerifiedDelivery(key,id){const r=this.status(key);if(r.id!==id||r.enabled||!['delivery-unverified','blocked','restart'].includes(r.stopReason)||this.now()>=r.expiresAt||this.postQueue.state(key,r).rows.some(x=>['submitted','submission-unverified','reserved'].includes(x.status)))throw Error('仅可恢复已用真实界面核实的投递误判，不续开取消、到限或仍不明的任务');return this.save({...r,enabled:true,batch:null,nextAt:this.now(),stopReason:undefined,stoppedAt:undefined});}
 resumeAfterRepair(key,id){const r=this.status(key);if(r.id!==id||r.enabled||r.stopReason!=='restart'||this.now()>=r.expiresAt)throw Error('旧任务不满足修复恢复条件，不重开已取消、已完成或到期任务');return this.save({...r,enabled:true,batch:null,nextAt:Math.max(this.now(),r.nextAt||0),stopReason:undefined,stoppedAt:undefined});}
 postId(body){const u=new URL(body.url);const post=u.searchParams.get('link_id')||u.pathname.match(/\/link\/([a-f0-9]{12,32})\/?$/i)?.[1];if(u.protocol!=='https:'||!['www.xiaoheihe.cn','api.xiaoheihe.cn','xiaoheihe.cn'].includes(u.hostname)||u.username||u.password||!/^[a-f0-9]{12,32}$/i.test(post||''))throw Error('需实际小黑盒帖子链接');return post;}
 target(body){const post=this.postId(body),target=body.commentId?post+'|'+body.commentId:body.author&&body.comment?post+'|'+body.author+'|'+body.comment:null;if(!target)throw Error('需真实commentId，或author和comment原文');return createHash('sha256').update(target).digest('hex');}
 findTarget(key,body){
  const id=this.target(body),exact=this.db.prepare('SELECT target,data FROM comment_reply_seen WHERE key=? AND target=?').get(key,id);if(exact)return exact;
  // Notification and original-post views may omit the same App emoji token.
  // Resolve only a unique existing target on the same post by the same author;
  // never collapse emoji-only comments, different text, or conflicting comment IDs.
  const text=value=>String(value||'').replace(/\[cube_[^\]\r\n]+\]/g,'').replace(/\s+/g,' ').trim();
  const comment=text(body.comment),author=String(body.author||'').trim();if(!comment||!author)return null;
  const post=this.postId(body),matches=this.db.prepare('SELECT target,data FROM comment_reply_seen WHERE key=?').all(key).filter(row=>{
   const old=JSON.parse(row.data);if(body.commentId&&old.commentId&&String(body.commentId)!==String(old.commentId))return false;
   try{return this.postId(old)===post&&String(old.author||'').trim()===author&&text(old.comment)===comment;}catch{return false;}
  });
  if(matches.length>1)throw Error('评论目标存在歧义，请核对真实commentId和claim原文后登记；只回读，不重复发送');
  return matches[0]||null;
 }
 claim(key,body){
  const r=this.status(key);if(!r.enabled||!r.batch||r.id!==body.runId||r.batch.id!==body.batchId)throw Error('没有有效回复批次');
  if(replyMode(r)==='inbox'&&body.queueItemId)throw Error('当前是按消息回复，不使用单帖扫描清单；请核对这条通知实际指向的评论');
  const queued=r.targetPostId?this.postQueue.requireNext(key,r,body):null,id=queued?.id||this.target(body);let old=this.db.prepare('SELECT target,data FROM comment_reply_seen WHERE key=? AND target=?').get(key,id)||(queued?.parent?null:this.findTarget(key,body));
  if(queued&&old&&JSON.parse(old.data).status==='skipped')old=null;
  if(old){const status=JSON.parse(old.data).status;if(queued)this.postQueue.mark(key,r,id,status==='observed'?'already-replied':'submission-unverified');return {claimed:false,skip:true,status,note:'此评论已处理或结果待核实，不重复发送'};}
  if((r.batch.attempts||0)>=5)throw Error('本批已达5个目标，请先登记批次完成');
  this.db.prepare('INSERT INTO comment_reply_seen VALUES(?,?,?) ON CONFLICT(key,target) DO UPDATE SET data=excluded.data').run(key,id,JSON.stringify({...body,mode:replyMode(r),status:'reserved'}));if(queued)this.postQueue.mark(key,r,id,'reserved');r.batch.attempts=(r.batch.attempts||0)+1;this.save(r);return {claimed:true,replyTargetId:id};
 }
 guardWrite({scope,args={},operation,observation}){
  const r=this.status(scope),nodes=observation?.nodes||[];
  const sendNodes=nodes.filter(n=>n.text==='发送'||n.description==='发送');
  const panel=observation?.package==='com.max.xiaoheihe'&&sendNodes.length>0&&nodes.some(n=>/:id\/et_editor$/.test(n.resourceId||'')||n.focused&&!!n.text);
  const send=operation==='key'&&args.key==='enter'||operation==='tap'&&sendNodes.some(n=>{const b=(n.bounds?.match(/\d+/g)||[]).map(Number);return b.length===4&&args.x>=b[0]&&args.x<b[2]&&args.y>=b[1]&&args.y<b[3];});
  if(r.id&&panel&&(!r.enabled||!r.batch)&&(operation==='type'||send))throw Error('本轮评论回复尚未派发、未开启或已停止；'+replyStatusText(r)+(r.enabled||r.stopReason==='dispatch-failed'?'已有本轮授权，不能要求管理员重复口令；核对真实派发状态，不手动绕过批次。':'等待管理员发出新的回复任务，不手动绕过批次。'));
  if(r.enabled&&r.batch&&panel&&['type','tap','key'].includes(operation)&&(!args.replyRunId||!args.replyBatchId||!args.replyTargetId))throw Error('本次评论任务先qq_comment_reply_claim登记真实目标，输入或发送时携带replyRunId、replyBatchId和replyTargetId');
  if(!args.replyRunId)return;
  if(!r.enabled||r.id!==args.replyRunId||!r.batch||r.batch.id!==args.replyBatchId)throw Error('评论回复任务已停止或批次过期，不继续操作');
  if(args.replyTargetId){const row=this.db.prepare('SELECT data FROM comment_reply_seen WHERE key=? AND target=?').get(scope,args.replyTargetId);const target=row&&JSON.parse(row.data);if(!target||target.runId!==r.id||target.batchId!==r.batch.id||target.status!=='reserved')throw Error('回复目标未登记、已提交或属于旧批次，不重复发送');}
  const hit=panel&&send;
  if(hit&&args.replyTargetId){const row=this.db.prepare('SELECT data FROM comment_reply_seen WHERE key=? AND target=?').get(scope,args.replyTargetId);const target=JSON.parse(row.data);target.status='submission-unverified';this.db.prepare('UPDATE comment_reply_seen SET data=? WHERE key=? AND target=?').run(JSON.stringify(target),scope,args.replyTargetId);if(r.targetPostId)this.postQueue.mark(scope,r,args.replyTargetId,'submission-unverified');
   return {onFailure:error=>{if(error.notSubmitted===true){target.status='reserved';this.db.prepare('UPDATE comment_reply_seen SET data=? WHERE key=? AND target=?').run(JSON.stringify(target),scope,args.replyTargetId);if(r.targetPostId)this.postQueue.mark(scope,r,args.replyTargetId,'reserved');}}};
  }
 }
 record(key,body){
  const r=this.status(key);if(!r.enabled||!r.batch)return null;
  let id;try{id=this.target(body);}catch(error){if(body.status==='skipped')return {count:r.count,ignoredNonComment:true};throw Error(error.message+'；登记尚未完成，请补真实评论目标后再登记，不重新发送，不因此终止其余逐条回复');}
  if(r.targetPostId&&replyPostId(body.url)!==r.targetPostId)throw Error('当前单帖任务不能把其他老帖或新帖的回复记入本篇');
  if(r.targetPostId){this.postQueue.recordTarget(key,r,body);if(body.status==='skipped'&&!String(body.reason||'').trim())throw Error('单帖跳过必须登记具体原因，不能用已读代替回复');}
  const old=r.targetPostId?(body.replyTargetId?this.db.prepare('SELECT target,data FROM comment_reply_seen WHERE key=? AND target=?').get(key,body.replyTargetId):null):this.findTarget(key,body);if(old)id=old.target;
  if(old&&['observed','submitted','skipped'].includes(JSON.parse(old.data).status))return {alreadyRecorded:true,count:r.count};
  if(!old||JSON.parse(old.data).runId!==r.id||JSON.parse(old.data).batchId!==r.batch.id){this.stop(key,'missing-claim');throw Error('需发送前先qq_comment_reply_claim登记目标；任务已暂停以免重复');}
  const claimed=JSON.parse(old.data),row={...claimed,url:body.url,commentId:body.commentId||claimed.commentId,author:body.author||claimed.author,comment:body.comment||claimed.comment,reply:body.reply,status:body.status,replyKind:body.replyKind||'text',imageId:body.imageId,appEmoji:body.appEmoji};
  this.db.prepare('UPDATE comment_reply_seen SET data=? WHERE key=? AND target=?').run(JSON.stringify(row),key,id);
  if(r.targetPostId)this.postQueue.mark(key,r,id,body.status==='submitted'?'submission-unverified':body.status,{reason:body.reason});
  r.cursor={url:row.url,commentId:row.commentId,author:row.author,comment:row.comment?.slice(0,120)};
  if(body.status==='skipped'){r.batch.skipped=(r.batch.skipped||0)+1;return this.save(r);}
  if(body.status!=='observed')return this.stop(key,'delivery-unverified');
  r.count++;r.batch.count++;if(r.count>=r.limit)return this.save({...r,enabled:false,batch:null,stopReason:'limit'});
  return this.save(r);
 }
 finish(key,{runId,batchId,exhausted=false,blocked=false}){
  const r=this.status(key);if(!r.enabled)return r;
  if(r.id!==runId||r.batch?.id!==batchId)throw Error('回复批次已过期，不派发后续任务');
  const pending=this.db.prepare('SELECT data FROM comment_reply_seen WHERE key=?').all(key).map(row=>JSON.parse(row.data)).filter(row=>row.runId===r.id&&row.batchId===r.batch.id&&['reserved','submission-unverified'].includes(row.status));
  if(!blocked&&pending.length)throw Error(`本批还有${pending.length}条目标未登记结果，尚未收尾，不能按没有进展停止或宣称全部完成。已提交的只回读核实并登记，不重新发送；未发送的继续处理或用skipped登记真实原因。缺帖子链接先进入对应原帖复制真实链接，不借用别的帖子地址；确实无法核实才blocked=true暂停。`);
  if(r.targetPostId&&exhausted&&!blocked&&!this.postQueue.summary(key,r).complete)throw Error('本帖仍有未处理评论、未展开楼中楼、平台不可见计数缺口或未证明扫描到末尾，不能宣称整帖已回复完；按清单继续，确实受阻则blocked=true并保留缺口');
  if(exhausted||blocked||!r.batch.count&&!r.batch.skipped)return this.stop(key,blocked?'blocked':exhausted?'no-new-comments':'no-progress');
  r.batch=null;r.nextAt=this.now();return this.save(r);
 }
 async tick(wake,allowed,onFailure=()=>{}){
  if(this.ticking)return;this.ticking=true;
  try{for(const row of this.db.prepare('SELECT data FROM comment_reply_runs').all()){
   const r=this.status(JSON.parse(row.data).key);if(!r.enabled)continue;
   if(!allowed(r.key)){this.stop(r.key,'permission');continue;}
   if(r.batch){if(this.now()-r.batch.at>5*60000)this.stop(r.key,'batch-timeout');continue;}
   if(r.nextAt>this.now())continue;
   r.batch={id:randomUUID(),count:0,at:this.now()};r.batches++;this.save(r);
   try{const result=await wake(r.key),accepted=typeof result==='object'?result?.accepted===true:result===true;
    const live=this.status(r.key);if(live.enabled&&live.id===r.id&&live.batch?.id===r.batch.id){live.lastDispatchAt=this.now();live.lastDispatchReason=typeof result==='object'?result.reason:accepted?'accepted':'waiting';if(!accepted){live.batch=null;live.batches--;live.nextAt=this.now()+(['conversation-busy','device-busy'].includes(result?.reason)?5000:60000);}this.save(live);}
   }catch(error){const live=this.status(r.key);if(live.enabled&&live.id===r.id&&live.batch?.id===r.batch.id){
      // Persist a bounded, redacted diagnostic; never store session tokens or raw tool arguments.
      const message=replyDispatchError(error);
      const failed=this.save({...this.stop(r.key,'dispatch-failed'),lastDispatchReason:'dispatch-failed',lastDispatchAt:this.now(),lastDispatchError:message});await onFailure(failed);
     }}
   break;
  }}finally{this.ticking=false;}
 }
 prompt(key){
  const r=this.status(key);if(!r.enabled||!r.batch)return '【评论回复任务】本次任务已停止，不继续回复，也不自行重开。';
  if(r.targetPostId)return this.singlePostPrompt(key,r);
  const seen=this.db.prepare('SELECT data FROM comment_reply_seen WHERE key=? ORDER BY rowid DESC LIMIT 12').all(key).map(r=>{const d=JSON.parse(r.data);return {url:d.url,commentId:d.commentId,author:d.author,comment:d.comment?.slice(0,100),status:d.status,reply:d.reply?.slice(0,80),replyKind:d.replyKind||'text',imageId:d.imageId,appEmoji:d.appEmoji};});
  return ONLINE_IMAGE_COLLECTION_POLICY+REPLY_VARIETY_POLICY+`【按消息列表逐条回复，mode=inbox】runId=${r.id} batchId=${r.batch.id}。唯一入口是小黑盒“消息”中的评论/回复通知列表。不要切成按帖子补漏，不去主页寻找最新帖子，不因为停留在某篇评论区就以那篇为本轮范围，也不向管理员索要指定帖子的链接。先回到真实消息列表，按实际列表从上到下逐条核对本轮未回复通知。每条消息可能属于不同帖子，新消息也可能回复老帖子：必须由该条通知实际打开或引用的原帖核对归属，不按通知时间猜新帖、不借用上一条消息的原帖链接。这是按需任务：最多${r.limit}条，已核实${r.count}条，截止${new Date(r.expiresAt).toISOString()}，仅处理本轮已有通知，后来新来的不继续并入，不持续巡查。首批qq_xiaoheihe_history仅用于去重，历史回复数不算本轮进度。不是只处理自己最新帖子，也不要求扫完任一帖子全部评论；普通短留言也回应，已回复、重复、广告或明显辱骂可跳过并记录原因。同一评论只回一次，不无限追聊。接续位置：${JSON.stringify(r.cursor||null)}；下一批回到消息列表从上条通知之后继续，翻页核对未处理消息；进入评论详情只是为回复该通知，核实后返回消息列表，不遍历该帖其他评论。不能把当前消息屏看完当作本轮全部处理完。本批最多${Math.min(5,r.limit-r.count)}条，5条只是分批节奏，不是整个任务上限。先取得当前目标所属原帖的真实链接，再claim；通知中的他人帖子回复不能借用自己帖子链接。原帖链接由你从该条通知进入实际原帖自行copy-link核实；草稿号不能当帖子ID。不得因按消息模式没有预设链接而要求管理员补链接。实际App确实取不到时，说明该通知的具体障碍，finish(blocked=true)暂停；不能空等到批次超时，不自行改成单帖任务。不先发送后补链接。实际读原评论、核对作者与回复目标，按界面进入指定回复；发送前读输入框，发送后回读实际文本。每条发送前先qq_comment_reply_claim(runId,batchId,url,commentId或author和comment原文)登记，claimed=false必须跳过；然后该条qq_android_action的args携带replyRunId、replyBatchId、replyTargetId。完成后调用qq_xiaoheihe_record，附同一commentId或author和comment原文；仅observed计入完成，submitted须暂停核实，不重复发送。已处理目标：${JSON.stringify(seen)}。表情回复：按语境搭配文字、App内置表情或一张本地表情，不每条硬塞图片。App表情须实际打开面板点选并核对预览，禁止手打[cube_...]冒充图片；本地表情先qq_meme_list、qq_meme_preview实际看图，再qq_comment_reply_meme_stage(runId,batchId,replyTargetId,imageId)放入受限相册，按返回真实文件名选图，确认仍是同一条评论及正确配图再发。无配图入口就用App内置表情或文字，不另发顶层评论，不转成原创发帖。qq_meme_send只发QQ，不能用它代替App评论。回读核对文字及表情/图片，qq_xiaoheihe_record附replyKind=text/app-emoji/image/mixed以及实际imageId或appEmoji描述；仅填相册不算发出。收图统一按网上图片自动收集规则执行：表情包和普通内容图均进入电脑待审核库；不因收图改变消息列表入口。完成本批调用qq_comment_reply_finish(runId,batchId,exhausted,blocked)，后台会间隔续接，无需管理员说继续。本轮消息列表已核对到底且没有待处理通知才exhausted=true；看完某篇帖子不代表消息列表处理完成；平台限制、看不全或同一障碍两次则blocked=true并说明；不能空口说下一批会继续却不登记。期间收到管理员新消息先处理；取消任务立即停止。汇报数量只采用comment-reply-status里的count，不混入旧轮次回复，不把点击、评论成功提示或未登记回复计为已核实。仅首批和最终结果简短汇报，不每批刷屏。`;
 }
 singlePostPrompt(key,r){const q=this.postQueue.summary(key,r);return ONLINE_IMAGE_COLLECTION_POLICY+REPLY_VARIETY_POLICY+`【按帖子回复，mode=post；指定单帖补漏】runId=${r.id} batchId=${r.batch.id}。唯一目标帖子=${r.targetUrl}，帖子ID=${r.targetPostId}。新回复也可能属于老帖；不得按最新帖子猜归属，不去消息列表捡着回、不切换其他帖子。当前账号昵称=${this.postQueue.identity()||'尚未核实：先去自己的主页，qq_android_state实际读取昵称；不把原帖作者当自己'}。先qq_comment_reply_scan(mode=advance)，它会本地直接定位指定帖子、复制实际链接核验、切正序评论，无须自己导航；仅needsIdentity时去自己的主页核实昵称。advance：本地自动翻页、展开和过滤已回复，避免模型反复导航。得到清单后按顺序拟1～3条回复，一次qq_comment_reply_deliver(runId,batchId,replies:[{queueItemId,reply}])；工具自动核对引用作者原文、claim、发送一次、回读登记，不要重复claim/record。只在批量工具明确受阻时再人工核实。两次同一障碍就blocked=true暂停，禁止继续空转。旧方式兜底：用qq_comment_reply_scan(mode=top)由工具实际回到顶部并建清单，热门/最新保持同一种排序，不中途切换。有最新或时间排序可先切换再top。每屏按工具清单顺序处理，普通短留言也要回；只跳过有自己实际回复的评论、自己的留言或有明确理由的广告/辱骂，不能用已读、太短、没意思跳过。清单状态=${JSON.stringify(q)}。coverageGaps表示App实际展开到收起后仍存在的计数差异，只保留缺口，不把不可见内容算作已回复；继续按next处理其余实际可见评论，最终报告缺口、不宣称整帖完整。下一目标为清单next[0]；kind=expand时先展开其对应楼中楼，扫描时带parentTargetId，再从该楼顶部开始直到工具确认末尾。kind=comment时用qq_comment_reply_claim，携带runId、batchId、url=${r.targetUrl}、queueItemId=清单id、author和comment原文；claimed=false不得发送。该条安卓输入与发送args须带replyRunId、replyBatchId、replyTargetId；发送前核对目标作者及原文，发送后回读实际回复，再qq_xiaoheihe_record携带replyTargetId及同一author/comment原文。不能先挑后面的有趣评论，后台会拒绝越序。每条登记后再处理下一条，本批最多5个目标；批次不是总量上限。清空当前屏后qq_comment_reply_scan(mode=next)自动半屏向下扫，保留重叠锚点；无重叠说明可能漏页，先回滚衔接。所有工具返回的state优先复用，不反复截图、重新读相同屏。已发结果不明只核实，不重发。费用保护、最多${r.limit}条和${new Date(r.expiresAt).toISOString()}截止时间照常生效；到限保留清单和未处理位置，不自行重开。完成本批qq_comment_reply_finish，未扫到底/楼中楼未展开/有待处理项不能exhausted=true；确实看不全则blocked=true并列出缺口。报告只采用后台count和清单统计，区分已回复、原来已回复、待核实、被预算暂停，不能把本屏结束说成整帖完成。期间管理员说停止立即停。`;}
}
