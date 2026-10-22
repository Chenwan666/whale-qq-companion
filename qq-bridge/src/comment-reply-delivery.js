import {randomUUID} from 'node:crypto';
import {nativeCommentPage,queueCarry} from './post-comment-queue.js';
const clean=s=>String(s||'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\[cube_[^\]]+\]/g,'').replace(/\s+/g,' ').trim();
export function center(node){const b=(node?.bounds?.match(/\d+/g)||[]).map(Number);if(b.length!==4||b[2]<=b[0]||b[3]<=b[1])throw Error('目标未完整显示，先滚动核实，不猜坐标');return {x:Math.floor((b[0]+b[2])/2),y:Math.floor((b[1]+b[3])/2)};}
export function verifyComposer(page,item){
 const quote=page.nodes?.find(n=>/:id\/tv_editor_comment_reply_msg$/.test(n.resourceId||'')),editor=page.nodes?.find(n=>/:id\/et_editor$/.test(n.resourceId||'')&&n.focused);
 if(!quote||clean(quote.text)!==clean(item.comment)||!editor||clean(editor.text)!=='回复 '+clean(item.author))throw Error('实际回复框的作者或引用原文不符，未输入、未发送');return editor;
}
export function verifyReply(page,item,reply,self,postId,carry){
 const p=nativeCommentPage(page,self,postId,carry),parent=item.parent||item.id;
 return p.evidenceRows.some(e=>e.author===self&&clean(e.comment)===clean(reply)&&e.parent===parent&&(!e.replyTo||e.replyTo===item.author));
}
// The language model supplies text only. Navigation, claim, composer checks,
// one send and readback run locally under the existing Android write guards.
export async function deliverQueuedReplies({key,body,android,replies,guard=()=>{},audit=String}){
 if(!Array.isArray(body.replies)||body.replies.length<1||body.replies.length>3)throw Error('一次提交1～3条按清单顺序的回复');
 const drafts=body.replies.map(d=>{const text=audit(d.reply);if(typeof text!=='string'||!text.trim()||text.length>500||/\[cube_[^\]]+\]/.test(text))throw Error('回复须为1～500字实际文字，不手打App表情代码');return {...d,reply:text};});
 const done=[];
 for(const draft of drafts){
  guard();const run=replies.status(key);if(!run.enabled||run.id!==body.runId||run.batch?.id!==body.batchId)throw Error('回复批次已停止或过期');
  if((run.batch.attempts||0)>=5)return {done,count:run.count,needsBatchFinish:true,queue:replies.postQueue.summary(key,run)};
  const item=replies.postQueue.next(key,run);if(!item||item.kind!=='comment'||item.id!==draft.queueItemId||item.status!=='pending')throw Error('只能提交清单next[0]的未回复项，不能越序或重发结果不明项');
  let state=await android.run('state',{},key);const carry=queueCarry(replies.postQueue.state(key,run));let actual;
  for(let attempt=0;attempt<5;attempt++){
   const view=await scanQueuedState({state,key,run,android,replies,guard});state=view.state;actual=view.parsed.rows.find(r=>r.id===item.id);
   if(actual&&fullyVisible(actual))break;
   state=await scrollCommentPage({state,key,android,guard});
  }
  if(!actual?.bounds||!fullyVisible(actual))return {done,count:replies.status(key).count,blocked:true,note:'目标尚未完整显示，保留进度，未发送；不要换坐标盲点。',queue:replies.postQueue.summary(key,run)};
  if(actual.status==='already-replied'){replies.postQueue.mark(key,run,item.id,'already-replied');done.push({id:item.id,status:'already-replied'});continue;}
  const claim=replies.claim(key,{runId:run.id,batchId:run.batch.id,url:run.targetUrl,queueItemId:item.id,author:item.author,comment:item.comment});
  if(!claim.claimed){done.push({id:item.id,status:claim.status});break;}
  const ids={replyRunId:run.id,replyBatchId:run.batch.id,replyTargetId:claim.replyTargetId};
  const act=async(operation,args)=>{guard();const live=replies.status(key);if(!live.enabled||live.id!==run.id||live.batch?.id!==run.batch.id)throw Error('任务已停止，不继续发送');const result=await android.run(operation,{confirm:true,requestId:randomUUID(),observationId:state.observationId,args:{...args,...ids}},key);if(!result.state)throw Error('动作回读缺失，停止并保留目标，不重发');state=result.state;if(result.submitted!==true)throw Error('执行前界面变化，本次未提交；暂停核实');return result;};
  try{
   await act('tap',center(actual));verifyComposer(state,item);
   await act('type',{text:draft.reply,clear:true});const editor=state.nodes.find(n=>/:id\/et_editor$/.test(n.resourceId||'')&&n.focused),quote=state.nodes.find(n=>/:id\/tv_editor_comment_reply_msg$/.test(n.resourceId||''));
   if(editor?.text!==draft.reply||clean(quote?.text)!==clean(item.comment))throw Error('输入框与引用原文复核不符，未发送');
   const send=state.nodes.filter(n=>n.text==='发送'&&/:id\/tv_send$/.test(n.resourceId||''));if(send.length!==1)throw Error('未找到唯一实际发送按钮');
   await act('tap',center(send[0]));
   const readback=await readQueuedReply({state,item,reply:draft.reply,self:replies.postQueue.identity(),postId:run.targetPostId,carry,android,key,guard});state=readback.state;const observed=readback.observed;
   replies.record(key,{url:run.targetUrl,replyTargetId:item.id,author:item.author,comment:item.comment,reply:draft.reply,status:observed?'observed':'submitted',replyKind:'text'});
   done.push({id:item.id,status:observed?'observed':'submission-unverified'});if(!observed)break;
  }catch(error){return {done,blocked:true,error:error.message,queue:replies.postQueue.summary(key,run),note:'未自动重试。保留已发送/待核实状态；不要改ID重复发送。'};}
 }
 const run=replies.status(key);return {done,count:run.count,needsBatchFinish:(run.batch?.attempts||0)>=5,enabled:run.enabled,stopReason:run.stopReason,note:!run.enabled?'本轮已停止；不要再调用发送、claim、scan或finish，不重发；等待修复核实。':undefined,queue:replies.postQueue.summary(key,run)};
}


export async function prepareReplyPost({key,run,android,guard=()=>{},onLink}){
 let state=await android.run('state',{},key);
 const act=async(op,args)=>{guard();const result=await android.run(op,{confirm:true,requestId:randomUUID(),observationId:state.observationId,args},key);if(!result.state||result.submitted!==true)throw Error('定位原帖界面变化，未发表评论，请核实后再试');state=result.state;return result;};
 await act('open-post',{postId:run.targetPostId});
 for(let i=0;i<2&&!state.nodes.some(n=>/:id\/iv_appbar_action_button$/.test(n.resourceId||''));i++)state=await android.run('state',{},key);
 const comments=state.nodes.find(n=>n.text==='评论'&&/:id\/tv_tab_title$/.test(n.resourceId||''));if(!comments)throw Error('没有实际评论标签，不猜目标');await act('tap',center(comments));
 const sort=state.nodes.find(n=>/:id\/vg_sort_container$/.test(n.resourceId||''));
 if(sort&&state.nodes.some(n=>n.text==='热门')){await act('tap',center(sort));const chronological=state.nodes.find(n=>n.text==='正序');if(!chronological)throw Error('未找到实际正序选项');await act('tap',center(chronological));}
 // Verify the URL after entering the final comment view. Never press Back
 // after copy: the share sheet may already have closed during readback.
 const share=state.nodes.find(n=>/:id\/iv_appbar_action_button$/.test(n.resourceId||''));if(!share)throw Error('未打开可核实的原帖，停止定位');
 await act('tap',center(share));const copy=state.nodes.find(n=>n.text==='复制链接');if(!copy)throw Error('当前分享菜单没有实际复制链接');const receipt=await act('copy-link',center(copy));
 state=await android.run('state',{},key);
 const sheet=state.nodes.find(n=>/:id\/tv_share_desc$/.test(n.resourceId||''));
 if(sheet){const b=(sheet.bounds?.match(/\d+/g)||[]).map(Number);if(b.length!==4||b[1]<100)throw Error('无法核实分享面板边界，不返回上一个帖子');await act('tap',{x:Math.floor(state.width/2),y:Math.floor(b[1]/2)});}
 if(!state.nodes.some(n=>/:id\/tv_all_comment$/.test(n.resourceId||'')))throw Error('复制后未回到实际评论区，不沿用其他页面的来源');onLink(receipt.urls);
 return state;
}

export async function readQueuedReply({state,item,reply,self,postId,carry,android,key,guard=()=>{},maxSteps=5}){
 for(let step=0;step<maxSteps;step++){
  const parsed=nativeCommentPage(state,self,postId,carry);if(verifyReply(state,item,reply,self,postId,carry))return {observed:true,state};
  const marker=parsed.rows.find(x=>x.kind==='expand'&&x.parent===(item.parent||item.id));guard();
  if(marker?.bounds){const result=await android.run('tap',{confirm:true,requestId:randomUUID(),observationId:state.observationId,args:center(marker)},key);if(!result.submitted||!result.state)return {observed:false,state};state=result.state;continue;}
  if(step<2){state=await android.run('state',{},key);continue;}
  const list=state.nodes.filter(n=>n.scrollable&&n.resourceId).sort((a,b)=>{const area=x=>{const b=x.bounds.match(/\d+/g).map(Number);return(b[2]-b[0])*(b[3]-b[1]);};return area(a)-area(b);})[0];if(!list)break;
  carry={parents:[...new Map([...(carry?.parents||[]),...parsed.evidenceRows.filter(x=>!x.parent)].map(p=>[p.id,p])).values()],evidence:[...new Set([...(carry?.evidence||[]),...parsed.evidence])]};
  const result=await android.run('scroll',{confirm:true,requestId:randomUUID(),observationId:state.observationId,args:{resourceId:list.resourceId,direction:'forward',commentStep:true}},key);if(!result.state||!result.submitted)break;state=result.state;
 }
 return {observed:verifyReply(state,item,reply,self,postId,carry),state};
}

export function fullyVisible(node){const b=(node?.bounds?.match(/\d+/g)||[]).map(Number);return b.length===4&&b[3]-b[1]>=20&&b[2]-b[0]>=20;}
export async function scrollCommentPage({state,key,android,guard=()=>{},direction='forward'}){
 guard();const list=state.nodes.filter(n=>n.scrollable&&n.resourceId).sort((a,b)=>{const area=n=>{const b=n.bounds.match(/\d+/g).map(Number);return(b[2]-b[0])*(b[3]-b[1]);};return area(a)-area(b);})[0];if(!list)throw Error('没有实际评论列表，不猜滚动坐标');
 const r=await android.run('scroll',{confirm:true,requestId:randomUUID(),observationId:state.observationId,args:{resourceId:list.resourceId,direction,commentStep:true}},key);if(!r.submitted||!r.state)throw Error('滚动前界面变化，请核实，不继续发送');return r.state;
}
export async function scanQueuedState({state,key,run,android,replies,guard=()=>{}}){
 for(let attempt=0;attempt<3;attempt++){
  try{const parsed=nativeCommentPage(state,replies.postQueue.identity(),run.targetPostId,queueCarry(replies.postQueue.state(key,run)));replies.postQueue.scan(key,run,parsed);return {state,parsed};}
  catch(error){if(attempt>=2||!/重叠锚点|顶部楼中楼归属尚未核实/.test(error.message))throw error;state=await scrollCommentPage({state,key,android,guard,direction:'backward'});}
 }
}
