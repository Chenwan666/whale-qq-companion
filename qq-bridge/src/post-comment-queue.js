import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>String(s||'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\[cube_[^\]\r\n]+\]/g,'').replace(/\s+/g,' ').trim();
const subText=s=>String(s||'').replace(/\s+(?:(?:刚刚|刚才|\d+(?:秒|分钟|小时|天|周|个月|月|年)前|今天|昨天|前天|\d{1,2}[-/]\d{1,2})(?:\d{1,2}:\d{2})?|\d{1,2}:\d{2})·[^\s]{1,30}[\ufeff\s]*$/u,'').replace(/\s+(?:北京|天津|河北|山西|内蒙古|辽宁|吉林|黑龙江|上海|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|重庆|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|香港|澳门|台湾|中国|美国|英国|日本|韩国|海外|未知)\ufeff\s*$/u,'').trim();
export function replyPostId(url){const u=new URL(url),id=u.searchParams.get('link_id')||u.pathname.match(/\/link\/([a-f0-9]{12,32})\/?$/i)?.[1];if(u.protocol!=='https:'||!['www.xiaoheihe.cn','api.xiaoheihe.cn','xiaoheihe.cn'].includes(u.hostname)||u.username||u.password||!/^[a-f0-9]{12,32}$/i.test(id||''))throw Error('请使用实际小黑盒帖子分享链接');return id.toLowerCase();}
export const replyPostUrl=url=>'https://www.xiaoheihe.cn/app/bbs/link/'+replyPostId(url);
export const queueCarry=s=>({parents:s.rows.filter(r=>r.kind==='comment'&&!r.parent),evidence:s.evidence||[]});
const itemId=(post,parent,author,comment)=>hash([post,parent||'',clean(author),clean(comment)].join('|'));

// Classification comes from actual native nodes, never from a model supplied
// "already replied" boolean. Missing or ambiguous evidence stays pending.
export function nativeCommentPage(state,selfName,postId,carryParent=null){
 if(state?.package!=='com.max.xiaoheihe'||state.truncated)throw Error('需完整的小黑盒评论界面；截断页面不能作为查完依据');
 const nodes=state.nodes||[],blocks=[];
 if(carryParent?.parents){
  const subIndex=nodes.findIndex(n=>/:id\/tv_sub_comment_content$/.test(n.resourceId||'')),rootIndex=nodes.findIndex(n=>/:id\/bbs_name$/.test(n.resourceId||''));
  if(subIndex>=0&&(rootIndex<0||subIndex<rootIndex)){
   const m=subText(String(nodes[subIndex].text||'')).match(/^(.{1,100}?)(?:\s+楼主)?(?:\s+回复\s*(.{1,100}?))?\s*[:：]\s*([\s\S]+)$/),evidence=new Set(carryParent.evidence);
   const matches=m?carryParent.parents.filter(p=>evidence.has(itemId(postId,p.id,m[1].trim(),m[3].trim()))):[];
   if(matches.length!==1)throw Error('屏幕顶部楼中楼归属尚未核实，请回滚衔接父评论，不按上一屏最后一楼猜归属');carryParent=matches[0];
  }else carryParent=null;
 }
 let block=carryParent?{author:carryParent.author,comment:carryParent.comment,subs:[],more:[],carried:true}:null;
 for(const n of nodes){const rid=n.resourceId||'',text=String(n.text||'').trim();
  if(/:id\/bbs_name$/.test(rid)){if(block?.comment&&(!block.carried||block.subs.length||block.more.length))blocks.push(block);block={author:text,comment:'',subs:[],more:[]};}
  else if(block&&/:id\/tv_comment$/.test(rid)&&!block.comment){block.comment=text;block.bounds=n.bounds;}
  else if(block&&/:id\/tv_sub_comment_content$/.test(rid)&&text){const m=subText(String(n.text||'')).match(/^(.{1,100}?)(?:\s+楼主)?(?:\s+回复\s*(.{1,100}?))?\s*[:：]\s*([\s\S]+)$/);if(m)block.subs.push({author:m[1].trim(),replyTo:m[2]?.trim(),comment:m[3].trim(),bounds:n.bounds});else block.more.push({text:'无法解析的楼中楼，需要展开核对'});}
  else if(block&&/^(?:查看|展开|还有|共|更多|全部).{0,20}(?:回复|评论)/.test(text))block.more.push({text,bounds:n.bounds});
  else if(block&&text==='收起')block.expanded=true;
 }
 if(block?.comment&&(!block.carried||block.subs.length||block.more.length))blocks.push(block);
 const rows=[],anchors=[],evidence=[],evidenceRows=[],expanded=[];for(const b of blocks){const parent=itemId(postId,'',b.author,b.comment),own=b.subs.filter(s=>s.author===selfName),answered=b.subs.some((s,i)=>s.author===selfName&&(!s.replyTo||s.replyTo===b.author&&!b.subs.slice(0,i).some(t=>t.author===b.author)));anchors.push(parent);evidence.push(parent,...b.subs.map(s=>itemId(postId,parent,s.author,s.comment)));evidenceRows.push({id:parent,parent:null,author:b.author,comment:b.comment},...b.subs.map(s=>({id:itemId(postId,parent,s.author,s.comment),parent,author:s.author,comment:s.comment,replyTo:s.replyTo})));if(b.expanded&&!b.more.length)expanded.push({parent,count:b.subs.length});
  if(b.more.length)rows.push({id:hash(postId+'|expand|'+parent),parent,kind:'expand',author:b.author,comment:b.comment,status:'pending',note:b.more.map(x=>x.text).join('；'),bounds:b.more[0].bounds,expectedReplies:Number(b.more[0].text.match(/(\d+)/)?.[1])||null});
  rows.push({id:parent,parent:null,kind:'comment',author:b.author,comment:b.comment,bounds:b.bounds,status:b.author===selfName?'self-comment':answered?'already-replied':'pending',evidence:answered?'原楼层可见本账号实际回复':undefined});
  const answeredChildren=new Set(),waiting=new Map();for(let index=0;index<b.subs.length;index++){const s=b.subs[index];if(s.author!==selfName){waiting.set(s.author,[...(waiting.get(s.author)||[]),index]);}else if(s.replyTo){const candidates=waiting.get(s.replyTo)||[];if(candidates.length===1){answeredChildren.add(candidates[0]);waiting.set(s.replyTo,[]);}}}
  for(const [index,s] of b.subs.entries()){if(s.author===selfName)continue;const replied=answeredChildren.has(index);rows.push({id:itemId(postId,parent,s.author,s.comment),parent,bounds:s.bounds,kind:'comment',author:s.author,comment:s.comment,status:replied?'already-replied':'pending',evidence:replied?'同楼层可见本账号对该作者的实际回复':undefined});}
 }
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('同一屏存在同作者同原文的不同评论，当前证据无法区分；需核实实际楼层，不合并成已回复');
 const count=nodes.map(n=>n.text||'').map(t=>t.match(/^评论\s*(\d+)$/)?.[1]).find(Boolean);
 return {rows,anchors,evidence,evidenceRows,expanded,visibleCount:count?Number(count):null,empty:nodes.some(n=>/^(?:还没有评论|暂无评论|暂无回复)/.test(n.text||'')),sort:nodes.map(n=>n.text).find(t=>['热门','最新','最早','按时间','正序','倒序'].includes(t))||null};
}

export class PostCommentQueue{
 constructor(store){this.db=store.db;this.db.exec('CREATE TABLE IF NOT EXISTS post_comment_queues(key TEXT NOT NULL,postId TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(key,postId));CREATE TABLE IF NOT EXISTS comment_reply_identity(id INTEGER PRIMARY KEY CHECK(id=1),nickname TEXT NOT NULL);');}
 identity(){return this.db.prepare('SELECT nickname FROM comment_reply_identity WHERE id=1').get()?.nickname;}
 observeIdentity(state){const name=state?.package==='com.max.xiaoheihe'&&state.nodes?.find(n=>/:id\/tv_me_home_fragment_username$/.test(n.resourceId||''))?.text?.trim();if(name)this.db.prepare('INSERT INTO comment_reply_identity VALUES(1,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname').run(name);return name||null;}
 get(key,postId){const r=this.db.prepare('SELECT data FROM post_comment_queues WHERE key=? AND postId=?').get(key,postId);return r?JSON.parse(r.data):null;}
 save(s){this.db.prepare('INSERT INTO post_comment_queues VALUES(?,?,?) ON CONFLICT(key,postId) DO UPDATE SET data=excluded.data').run(s.key,s.postId,JSON.stringify(s));return s;}
 begin(key,run){return this.save({key,postId:run.targetPostId,url:run.targetUrl,runId:run.id,rows:[],evidence:[],contexts:{},sourceVerifiedAt:null});}
 state(key,run){const s=this.get(key,run.targetPostId);if(!s||s.runId!==run.id)throw Error('单帖清单尚未创建或属于旧任务');return s;}
 scan(key,run,page,{context='main',top=false,bottom=false,sourceVerifiedAt}={}){
  const s=this.state(key,run),parent=context==='main'?null:s.rows.find(r=>r.id===context&&r.kind==='comment');if(context!=='main'&&!parent)throw Error('楼中楼必须绑定本篇已扫描的真实父评论');
  if(!s.sourceVerifiedAt&&!sourceVerifiedAt)throw Error('先在当前原帖复制实际分享链接核对帖子ID，再扫描；不能借用其他帖链接');if(sourceVerifiedAt)s.sourceVerifiedAt=sourceVerifiedAt;
  const c=s.contexts[context]||{started:false,last:[],bottom:false};if(!c.started&&!top)throw Error('先从评论区顶部开始扫描，不能从中间宣称已检查整帖');
  if(c.started&&c.sort&&page.sort&&c.sort!==page.sort)throw Error('评论排序已变化，先恢复原排序，避免跳页或重复');
  if(c.started&&!top&&c.last.length&&page.anchors.length&&!page.anchors.some(id=>c.last.includes(id))&&!page.anchors.every(id=>s.rows.some(r=>r.kind==='comment'&&!r.parent&&r.id===id)))throw Error('两屏评论没有重叠锚点，可能跳过中间评论；先回滚半屏衔接，不计为扫描完成');
  if(!page.rows.length&&!page.empty)throw Error('未识别到完整评论结构，不把空白、加载中或图片评论当作没有评论');
  const mapped=new Map(),root=parent&&page.rows.find(r=>clean(r.author)===clean(parent.author)&&clean(r.comment)===clean(parent.comment));if(root)mapped.set(root.id,context);
  if(context!=='main'&&!s.rows.some(r=>r.kind==='expand'&&r.parent===context))throw Error('此父评论没有待展开楼中楼，不创建虚假的分支');
  const evidence=[];for(const e of page.evidenceRows||[]){const id=context==='main'?e.id:mapped.get(e.id)||itemId(run.targetPostId,mapped.get(e.parent)||context,e.author,e.comment);mapped.set(e.id,id);evidence.push(id);}s.childEvidence??={};for(const e of page.evidenceRows||[]){if(e.parent)s.childEvidence[e.parent]=[...new Set([...(s.childEvidence[e.parent]||[]),e.id])];}s.evidence=[...new Set([...(s.evidence||[]),...(page.evidenceRows?evidence:page.evidence||[])])];
  if(context!=='main'&&top&&!page.rows.some(r=>clean(r.author)===clean(parent.author)&&clean(r.comment)===clean(parent.comment)))throw Error('当前楼中楼与待展开父评论不一致，不串楼登记');
  const marker=context==='main'?null:s.rows.find(r=>r.kind==='expand'&&r.parent===context);let insert=parent?s.rows.indexOf(parent)+1:s.rows.length;
  for(const row of page.rows){if(context!=='main'&&row.id===root?.id){if(root.status==='already-replied'&&parent.status==='pending')Object.assign(parent,{status:'already-replied',evidence:root.evidence});continue;}let fresh=row;if(context!=='main'){const owner=mapped.get(row.parent)||context;fresh={...row,parent:owner,id:row.kind==='expand'?hash(run.targetPostId+'|expand|'+owner):mapped.get(row.id)||itemId(run.targetPostId,owner,row.author,row.comment)};}
   const old=s.rows.find(r=>r.id===fresh.id);if(old){if(['pending','already-replied'].includes(old.status)&&fresh.status==='already-replied')Object.assign(old,fresh);insert=s.rows.indexOf(old)+1;continue;}s.rows.splice(insert++,0,fresh);
  }
  if(s.rows.length>500)throw Error('单帖清单超过500项，暂停并保留已有记录，不继续无界扫描');
  for(const x of page.expanded||[]){const mark=s.rows.find(r=>r.kind==='expand'&&r.parent===x.parent);if(mark&&mark.expectedReplies){const observed=(s.childEvidence?.[x.parent]||[]).length;mark.status='expanded';if(observed<mark.expectedReplies)mark.coverageGap={expected:mark.expectedReplies,observed,note:'已实际展开到收起，平台标注数量与可见回复不一致；保留缺口，不假定隐藏内容已回复'};}}
  Object.assign(c,{started:true,last:page.anchors,sort:c.sort||page.sort,bottom:bottom===true,lastParent:page.evidenceRows?.filter(e=>!e.parent).at(-1)||c.lastParent,visibleCount:c.visibleCount??page.visibleCount});s.contexts[context]=c;
  if(context!=='main'&&bottom&&marker)marker.status='expanded';this.save(s);return this.summary(key,run);
 }
 next(key,run){return this.state(key,run).rows.find(r=>['pending','reserved','submission-unverified'].includes(r.status));}
 requireNext(key,run,body){const s=this.state(key,run);if(replyPostId(body.url)!==run.targetPostId)throw Error('当前只回复指定帖子，不能登记其他新帖或老帖的评论');const next=this.next(key,run);if(!next)throw Error('当前已扫描清单没有待回复项，先继续扫描，不自行挑评论');if(next.kind==='expand')throw Error('前一楼还有未展开回复，先进入并扫描该楼中楼，不能跳到下一楼');if(body.queueItemId!==next.id||clean(body.author)!==clean(next.author)||clean(body.comment)!==clean(next.comment))throw Error('必须按单帖清单从上到下回复，不能跳过前面的未处理评论');return next;}
 mark(key,run,id,status,extra={}){const s=this.state(key,run),row=s.rows.find(r=>r.id===id);if(!row)throw Error('评论不在本篇扫描清单中');Object.assign(row,extra,{status});this.save(s);}
 recordTarget(key,run,body){const row=this.state(key,run).rows.find(r=>r.id===body.replyTargetId);if(!row||clean(row.author)!==clean(body.author)||clean(row.comment)!==clean(body.comment))throw Error('回读登记与本篇真实评论目标不一致，请沿用claim返回的replyTargetId和清单原文，不重发');return row;}
 newOwnIds(key,run,s){
  const ids=new Set(),self=this.identity();if(!self||!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='comment_reply_seen'").get())return ids;
  for(const row of this.db.prepare("SELECT data FROM comment_reply_seen WHERE key=? AND json_extract(data,'$.runId')=? AND json_extract(data,'$.reply') IS NOT NULL").all(key,run.id)){const d=JSON.parse(row.data),item=s.rows.find(r=>r.id===d.queueItemId);if(item&&d.reply)ids.add(itemId(run.targetPostId,item.parent||item.id,self,d.reply));}return ids;
 }
 summary(key,run){const s=this.state(key,run),pending=s.rows.filter(r=>['pending','reserved','submission-unverified'].includes(r.status)),unexpanded=s.rows.filter(r=>r.kind==='expand'&&r.status!=='expanded'),expected=s.contexts.main?.visibleCount??null,newOwn=this.newOwnIds(key,run,s),originalEvidenceCount=(s.evidence||[]).filter(id=>!newOwn.has(id)).length,countUnverified=expected!==null&&originalEvidenceCount<expected,coverageGaps=s.rows.filter(r=>r.kind==='expand'&&(r.coverageGap||r.status==='expanded'&&r.expectedReplies&&(s.childEvidence?.[r.parent]||[]).filter(id=>!newOwn.has(id)).length<r.expectedReplies)).map(r=>({parent:r.parent,author:r.author,...(r.coverageGap||{expected:r.expectedReplies,observed:(s.childEvidence?.[r.parent]||[]).filter(id=>!newOwn.has(id)).length,note:'平台标注与实际可见旧回复不一致，本轮新发回复不抵消原有缺口'})}));return {postId:s.postId,url:s.url,scanned:s.rows.filter(r=>r.kind==='comment').length,evidenceCount:(s.evidence||[]).length,originalEvidenceCount,expectedCount:expected,countUnverified,coverageGaps,alreadyReplied:s.rows.filter(r=>r.status==='already-replied').length,pending:pending.filter(r=>r.kind==='comment').length,unexpanded:unexpanded.length,topVerified:!!s.contexts.main?.started,bottomVerified:!!s.contexts.main?.bottom,complete:!!s.contexts.main?.started&&!!s.contexts.main?.bottom&&!pending.length&&!unexpanded.length&&!countUnverified&&!coverageGaps.length,next:pending.slice(0,5),skipped:s.rows.filter(r=>r.status==='skipped').map(r=>({author:r.author,reason:r.reason}))};}
}
