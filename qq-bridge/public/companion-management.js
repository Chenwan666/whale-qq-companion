// Shared dashboard renderer. User data is always inserted as text.
function managementLink(label,url){const a=make('a',label,'button');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function addSocialCommentActions(e,target,tid){
 e.append(button('读取评论',async()=>{const r=await call('social-detail',{target,tid});let list=e.querySelector('.social-comments');if(!list){list=make('div',undefined,'social-comments');e.append(list);}list.replaceChildren();for(const c of r.comments){const item=card(c.nickname||String(c.user_id),c.content);for(const reply of c.replies||[])item.append(make('p',(reply.nickname||reply.user_id)+'：'+reply.content));list.append(item);}if(!r.comments.length)list.append(make('p','接口未返回可读评论。'));notice(r.commentsComplete?'已读取全部返回的评论。':'当前仅返回部分评论，不能视作完整列表。');}));
 const input=make('textarea');input.placeholder='要发表的评论正文';input.setAttribute('aria-label','评论正文');input.maxLength=600;input.style='margin-top:12px;min-height:60px';e.append(input,button('发表评论',async()=>{const r=await call('social-comment',{target,tid,content:input.value,confirm:true});notice(r.alreadySubmitted?'此前已经提交过这条评论。':'评论已提交。');}));
}
function serviceText(s){return (s.dshReady?'● AI已就绪':'○ AI未连接')+' · '+(s.snowluma?.accountOnline?'QQ小号已在线':'QQ小号未在线')+' · '+(s.mode==='closed-agent'?'电脑任务模式':'陪聊模式');}
async function checkServiceStatus(){try{const s=await api('/api/status');status=s;$('serviceStatus').textContent=serviceText(s)+' · 检查于 '+new Date().toLocaleTimeString();if(tab==='voices'&&typeof refreshVoiceSettingsIfChanged==='function')await refreshVoiceSettingsIfChanged({panel:$('panel'),call,refresh:showVoices,isActive:()=>tab==='voices'});if(tab==='overview'){const e=$('liveServices');if(e)e.textContent=serviceText(s);}}catch(e){const live=$('liveServices');if(live)live.textContent='未能确认服务状态；若已停止，请用桌面入口恢复。';$('serviceStatus').textContent='○ 连接中断 · '+new Date().toLocaleTimeString()+' · '+e.message;}}
function renderManagement(tab,panel,bar){
 if(tab==='permissions'){renderConversationPermissions(panel).catch(e=>notice(e.message,true));return;}
 if(tab==='groups'){
  panel.append(make('p','小鲸鱼自己的群：实际验证群主身份后开放对话。小鲸鱼可以管理头衔、名片、群名、公告、管理员、禁言、踢人与入群申请；电脑和跨私聊记忆仍只属于管理员。'));
  const output=make('div',undefined,'list');panel.append(output);
  bar.append(button('查看小鲸鱼的群',async()=>{const rows=await call('self-groups');output.replaceChildren();for(const g of rows){const e=card(g.name,String(g.groupId));e.append(button('核对群主与成员',async()=>{const r=await api('/api/socialV2/group-admin',{key,groupId:String(g.groupId),operation:'members'});let detail=e.querySelector('.group-members');if(!detail){detail=make('div',undefined,'group-members');e.append(detail);}detail.textContent=r.data.map(m=>(m.card||m.nickname)+' · '+m.user_id+' · '+(m.role==='owner'?'群主':m.role==='admin'?'管理员':'成员')).join('\n');notice('已核对真实群主与成员。');}));output.append(e);}if(!rows.length)output.append(make('p','尚未登记自己的群。'));notice('已读取 '+rows.length+' 个实际登记的群。');}));
  bar.append(button('查看申请收件箱',async()=>{const rows=await call('requests');output.replaceChildren();for(const r of rows)output.append(card((r.kind==='friend'?'好友':'群')+'申请 · '+r.userId,(r.groupId?'群号 '+r.groupId+'\n':'')+r.comment+'\n状态：'+r.status+'\n申请ID：'+r.id));if(!rows.length)output.append(make('p','尚未收到可处理的真实申请。'));notice('已读取实际申请；没有自动通过。');}));
 }
 if(tab==='memoryArchives'){
  panel.append(make('p','管理员可跨会话查看所有私聊档案，包括历史用户。每份资料保留所属QQ号；查看不会导入管理员记忆。'));
  const target=make('input');target.placeholder='QQ号，或 群:群号';target.setAttribute('aria-label','档案QQ号');const query=make('input');query.placeholder='记忆关键词（可留空）';bar.append(target,query);
  const output=make('div',undefined,'list');panel.append(output);
  const inspect=async(scope)=>{const raw=target.value.trim();const targetKey=typeof scope==='string'?scope:raw.startsWith('群:')?'group:'+raw.slice(2):'private:'+raw;const r=await call('profile-memories',{target:targetKey,query:query.value});output.replaceChildren(card('资料归属',r.key));for(const m of r.memories)output.append(card(m.subject,m.content));if(!r.memories.length)output.append(make('p','没有查到这份长期记忆。'));for(const m of r.recentMessages||[])output.append(card((m.role==='user'?'对方':'小鲸鱼')+' · '+new Date(m.time).toLocaleString(),m.content));notice('只读查看 '+r.key+'；未写入管理员的记忆。');};
  bar.append(button('查看指定档案',inspect),button('列出所有档案',async()=>{const rows=await call('memory-profiles');output.replaceChildren();for(const r of rows){const e=card((r.nickname||r.key)+' · '+(r.key.startsWith('group:')?'群聊':'私聊'),`记忆 ${r.memoryCount} 条 · 消息 ${r.messageCount} 条 · ${r.allowed?'当前已许可':'历史档案'}`);e.append(button('查看这份档案',async()=>{target.value=r.key.startsWith('group:')?'群:'+r.key.slice(6):r.key.slice(8);await inspect(r.key);}));output.append(e);}notice('已列出 '+rows.length+' 份独立档案。');}));
 }
 if(tab==='workbench'){
  panel.append(make('p','完整QQ私聊工作台。这里先只读检查；写操作直接在管理员私聊里提出具体任务，小鲸鱼按真实工具执行。'));
  const target=make('input');target.placeholder='QQ号';target.setAttribute('aria-label','工作台QQ号');const query=make('input');query.placeholder='好友昵称或备注';bar.append(target,query);const output=make('div',undefined,'list');panel.append(output);
  const run=async(operation,args)=>{const r=await call('qq-workbench',{operation,args});output.replaceChildren(card('真实QQ结果',JSON.stringify(r,null,2)));notice('实际查询完成；未写入记忆。');};
  bar.append(button('查好友',()=>run('contacts',{query:query.value})),button('查私聊历史',()=>run('history',{target:target.value.trim(),count:10})),button('查在线状态',()=>run('user-status',{target:target.value.trim()})),button('查看动作目录',async()=>{const r=await call('qq-workbench-catalog');output.replaceChildren();for(const spec of Object.values(r))output.append(card(spec.readOnly?'只读查询':'可执行操作',spec.description));notice('已读取实际接入的动作目录。');}));
 }
 if(tab==='social'){
  panel.append(make('p','小鲸鱼可以查看真实QQ资料、头像和可见空间，并适度点赞。权限只属于管理员会话；空间内容不会自动记成管理员的喜好。'));
  const target=make('input');target.placeholder='目标QQ号';target.setAttribute('aria-label','目标QQ号');bar.append(target);
  const output=make('div',undefined,'list');panel.append(output);
  bar.append(button('查看资料',async()=>{const r=await call('social-profile',{target:target.value.trim()});output.replaceChildren(card('QQ资料',JSON.stringify(r.profile,null,2)));output.append(managementLink('空间主页 ↗',r.homepage));notice('已读取QQ实际返回的资料');}));
  bar.append(button('查看头像',async()=>{const r=await call('social-avatar',{target:target.value.trim()});output.replaceChildren();const img=make('img');img.alt=r.description;img.style='max-width:240px;max-height:240px;object-fit:contain';img.src='data:'+r.image.mimeType+';base64,'+r.image.data;output.append(img);notice('已读取实际头像');}));
  bar.append(button('查看动态',async()=>{const r=await call('social-feed',{target:target.value.trim()});output.replaceChildren();if(!r.msglist.length)output.append(make('p','没有读取到可见动态。'));for(const row of r.msglist){const e=card(row.time?new Date(row.time*1000).toLocaleString():'发表时间未返回',row.content);e.append(make('div',row.tid,'meta'));e.append(button('点赞这条',async()=>{const liked=await call('social-like',{target:r.target,tid:row.tid,confirm:true});notice(liked.alreadySubmitted?'已经提交过点赞，不重复操作。':'点赞已成功。');}));addSocialCommentActions(e,r.target,row.tid);for(const url of row.images)if(/^https:\/\//i.test(url))e.append(managementLink('动态图片 ↗',url));output.append(e);}notice('已读取 '+r.msglist.length+' 条实际动态');}));
 }
 if(tab==='overview'){
  const learningPanel=card('后台学习与费用','正在读取本地策略…');panel.append(learningPanel);void (async()=>{try{const s=await api('/api/background-work');const enabled=make('input');enabled.type='checkbox';enabled.style.width='auto';enabled.checked=s.policy.enabled;const label=make('label','允许自动黑话提取与研究 ');label.append(enabled);const limit=make('input');limit.type='number';limit.min='1';limit.max='50';limit.value=s.policy.maxDailyJobs;limit.setAttribute('aria-label','每日自动学习任务上限');learningPanel.replaceChildren(make('h3','后台学习与费用'),make('p',`今日已启动 ${s.used}/${s.policy.maxDailyJobs} 个自动任务；这是任务次数保护，单任务仍可能有多次模型请求。重复素材不重学，失败退避，重启不清零。明确记住喜好和约定仍独立保存。`),label,limit,button('保存后台学习策略',async()=>{await api('/api/background-work',{enabled:enabled.checked,maxDailyJobs:Number(limit.value)});notice('已保存。关闭后不再派发新的自动学习任务；普通聊天与记忆保存不受影响。');}));}catch(error){learningPanel.lastChild.textContent='暂未读取到学习策略：'+error.message;}})();
  const health=card('现在还开着吗？',serviceText(status));health.lastChild.id='liveServices';health.append(make('p','此页可见时每15秒检查服务。关闭网页不会关闭小鲸鱼；电脑和机器人小号QQ需要保持运行。'));panel.append(health);
  const links=make('div',undefined,'toolbar');links.style.marginTop='20px';
  const bridge=managementLink('桥接控制台 ↗','/');bridge.onclick=e=>{e.preventDefault();window.open('/?token='+encodeURIComponent(localStorage.getItem('consoleToken')||''),'_blank','noopener,noreferrer');};
  links.append(bridge,button('AI任务后台 ↗',async()=>{const w=window.open('about:blank','_blank');try{const r=await api('/api/ui/ai-link');if(w){w.opener=null;w.location.href=r.url;}else notice('浏览器拦截新窗口，请允许本站弹窗',true);}catch(e){w?.close();throw e;}}),managementLink('QQ接入管理 ↗','http://127.0.0.1:5099/processes'));panel.append(links);
  panel.append(card('启动与打开页面','桌面唯一入口「启动小鲸鱼」：启动或复用服务，并打开此页。\nAI后台、QQ接入管理都从上面的按钮进入。\n根目录「一键启动小鲸鱼.cmd」也可启动。\n机器人账号请在运行状态中查看。你的大号不必在这台电脑常开。'));
  const stop=button('停止小鲸鱼',async()=>{if(!window.confirm('保存记忆并停止本分享包的聊天桥接和AI后台？QQ客户端及独立接入端保持运行。停止后用桌面「启动小鲸鱼」恢复。')){notice('已取消停止，小鲸鱼继续运行。');return;}await api('/api/services/stop',{confirm:true});stop.disabled=true;$('serviceStatus').textContent='正在保存并停止服务…';notice('约半分钟完成。停止报告写入 launcher-logs/shutdown-latest.json；恢复后可在这里查看检查结果。关闭网页本身不会停止小鲸鱼。');});stop.style='color:#a2303a;border-color:#e3b4b8;margin:18px 0';panel.append(stop);
  panel.append(button('查看最近停止检查',async()=>{const r=await api('/api/services/last-stop');if(!r.report){notice('还没有停止记录。');return;}const s=r.report;notice(`${s.completed?'后台和所属子进程已全部停止':'停止未完成'} · ${s.finishedAt||s.startedAt} · QQ接入：${s.hookUnload} · 强制收尾 ${s.forced.length} 个 · 残留 ${s.remaining.length} 个${s.error?' · '+s.error:''}`);}));
  panel.append(card('常用入口','记忆档案：查看和更正管理员记忆。\n角色与会话：查看两套人设、权限与各自记忆。\n功能扩展：查看小鲸鱼已启用的功能与版本。\n下载库：预览保存的图片与来源。\nQQ命令：/功能、/会话、/扩展、/任务 具体任务。'));
 }
 if(tab==='profiles'){
  panel.append(make('p','公开表情库共用，记忆、学习游标和日记按QQ号独立保存。按真实身份选择角色，电脑和升级权限固定只属于管理员。'));
  for(const p of profiles){const e=card((p.nickname||p.key.slice(8))+' · '+p.role,`${p.computerAllowed?'管理员：电脑、下载、账号草稿与升级':'对外：聊天及本会话记忆'}\n长期记忆 ${p.memoryCount} 条 · 消息 ${p.messages} 条\n首次联系：${p.firstContactAt?new Date(p.firstContactAt).toLocaleString():'尚未联系'}\n最近联系：${p.lastContactAt?new Date(p.lastContactAt).toLocaleString():'尚未联系'}`);
   e.append(button('查看角色卡',async()=>{const r=await api('/api/socialV2/prompt?key='+encodeURIComponent(p.key));const existing=e.querySelector('.rolecard');if(existing)existing.remove();else e.append(make('div',r.role.hint,'content rolecard'));notice('已读取当前会话使用的角色卡');}));
   e.append(button('查看这份记忆',async()=>{const r=p.computerAllowed?{memories:await call('recall',{query:'',limit:30})}:await call('profile-memories',{target:p.key,query:''});let list=e.querySelector('.profile-memory');if(!list){list=make('div',undefined,'list profile-memory');e.append(list);}list.replaceChildren();if(!r.memories.length)list.append(make('p','这份长期记忆还是空的。'));for(const m of r.memories)list.append(card(m.subject,m.content));notice('已读取 '+p.key+' 的独立记忆');}));panel.append(e);
  }
 }
 if(tab==='extensions'){
  panel.append(button('查看插件审查队列',async()=>{const rows=await call('plugin-reviews');let list=panel.querySelector('.plugin-reviews');if(!list){list=make('div',undefined,'plugin-reviews');panel.append(list);}list.replaceChildren();for(const r of rows)list.append(card(r.status==='installed-tested'?'已接入并实测':'待大管家审查',r.repository+'\n固定版本：'+r.revision+'\n目的：'+r.goal));if(!rows.length)list.append(make('p','尚无插件提案。'));notice('已读取插件审查记录；没有执行安装。');}));
  panel.append(make('p','新功能先写代码和真实测试，通过后启用。执行失败或超时自动回退；核心权限和角色卡不走自主升级通道。'));
  if(!extensions.length)panel.append(make('p','还没有扩展。可以在QQ让小鲸鱼增加一个小功能。'));
  for(const v of extensions){const e=card(v.name+' · '+(v.active?'已启用':({draft:'草稿',failed:'验证失败',verified:'通过验证', 'rolled-back':'已回退'}[v.status]||'旧版本')),v.goal);e.append(make('div',v.id+' · '+new Date(v.createdAt).toLocaleString(),'meta'));if(v.active)e.append(make('div','QQ回退指令：/扩展回退 '+v.name,'meta'));panel.append(e);}
 }
 if(tab==='downloads'){
  panel.append(make('p','QQ文件与公开直链下载，每份最多20MB。Word/PDF可读正文，压缩包可查目录、读取成员。文件不会自动执行。'));
  const received=make('div',undefined,'list');panel.append(button('查看管理员发来的文件',async()=>{const r=await call('file-list');received.replaceChildren();for(const f of r.received){const row=card(f.name,'消息ID：'+f.messageId);row.append(button('下载到文件库',async()=>{const file=await call('file-receive',{messageId:f.messageId,fileId:f.fileId});notice('已保存：'+file.name);await refresh();}));received.append(row);}if(!r.received.length)received.append(make('p','尚未收到文件消息。'));}),received);
  if(!downloads.length)panel.append(make('p','下载库还是空的。'));
  for(const f of downloads){const e=card(f.name,`${(f.bytes/1024).toFixed(1)} KB · ${f.contentType||'未知类型'}\n${f.id}`);if(/^https?:\/\//i.test(f.url))e.append(managementLink('查看来源 ↗',f.url));if(/^image\//.test(f.contentType||''))e.append(button('预览图片',async()=>{const r=await call('download-preview',{id:f.id});let img=e.querySelector('img');if(!img){img=make('img');img.style='max-width:100%;max-height:240px;display:block;object-fit:contain;margin-top:12px';e.append(img);}img.alt=f.name;img.src='data:'+r.image.mimeType+';base64,'+r.image.data;notice('已读取本地实际图片');}));const member=make('input');member.placeholder='压缩包内文件名（可留空）';member.setAttribute('aria-label','压缩包成员 '+f.id);const output=make('pre');output.style='white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto';let offset=0;const read=async(reset)=>{if(reset)offset=0;const r=await call('file-read',{id:f.id,member:member.value.trim()||undefined,offset});output.textContent=r.entries?r.entries.map(x=>x.name+' · '+x.bytes+'字节').join('\n'):(r.text||r.note||'没有可提取正文');offset=r.offset+(r.text||'').length;if(r.hasMore)output.textContent+='\n（还有后续，点击继续读取）';};e.append(member,button('读取正文／压缩包目录',()=>read(true)),button('继续读取',()=>read(false)),button('发给管理员',async()=>{const r=await call('file-send',{id:f.id,confirm:true,requestId:crypto.randomUUID()});notice('已发送原文件：'+r.name);}),output);panel.append(e);}
 }
}

async function renderConversationPermissions(panel){
 panel.append(make('h2','每个会话，独立权限'),make('p','这里控制AI可调用的功能。唯一管理员仍是管理员本人；开启手机或网页，不会授予Windows电脑、跨会话记忆、账号管理或权限修改权。关闭记忆不会删除已有记录。'));
 const admission=await call('admission-list');
 const admissionCard=card('新会话自主接入','仅核验真实QQ好友和机器人已加入的群；首次来信建档，普通社交权限，不增加后台轮询。管理员和黑名单不变。');
 const policy={...admission.policy};
 for(const [field,label]of [['enabled','启用自主接入'],['friends','好友首次私聊自动开放'],['groups','已加入群首次消息自动开放']]){const wrap=make('label');wrap.style.cssText='display:inline-flex;align-items:center;gap:8px;margin:8px 18px 8px 0';const input=make('input');input.type='checkbox';input.checked=policy[field];input.style.cssText='width:18px;height:18px';input.setAttribute('aria-label',label);input.addEventListener('change',()=>{policy[field]=input.checked;});wrap.append(input,document.createTextNode(label));admissionCard.append(wrap);}
 const daily=make('input');daily.type='number';daily.min='1';daily.max='100';daily.value=policy.maxPerDay;daily.setAttribute('aria-label','每日自动接入上限');daily.style.cssText='max-width:100px';admissionCard.append(make('p','每日自动接入上限（达到后留待处理）'),daily,button('保存接入规则',async()=>{policy.maxPerDay=Number(daily.value);await call('admission-policy',{changes:policy});notice('已保存新会话接入规则；关闭只停止后续自动接入，已有会话可单独停用。');}));
 for(const r of admission.records.slice().sort((a,b)=>b.firstSeenAt-a.firstSeenAt).slice(0,30)){
  const item=card((r.label||r.key)+' · '+({allowed:'已接入',pending:'待核验／待处理',denied:'已停用'}[r.status]||r.status),r.key+' · '+(r.reason||r.note||'仅真实事件，不保存陌生人正文'));
  const decide=async(decision,profile)=>{await call('admission-decide',{target:r.key,decision,profile,reason:'管理员在小窝调整新会话接入'});notice('已更新 '+(r.label||r.key)+'，刷新权限页可查看结果。');};
  item.append(button('开放社交',()=>decide('allow','social')),button('收紧为聊天',()=>decide('restrict','chat')),button('停用此会话',()=>decide('deny','chat')));admissionCard.append(item);
 }
 if(admission.audit.length){const audit=make('details');audit.append(make('summary','最近接入决定'));for(const r of admission.audit.slice(-10).reverse())audit.append(make('p',new Date(r.at).toLocaleString()+' · '+r.key+' · '+r.decision+' · '+r.reason));admissionCard.append(audit);}
 panel.append(admissionCard);
 const result=await call('capability-list');
 for(const profile of result.profiles){
  const row=card(profile.label+' · '+(profile.key.startsWith('group:')?'群聊':'私聊'),profile.key+(profile.administrator?' · 唯一管理员':' · 普通会话')+(profile.allowed?'':' · 已停用会话'));
  const values={...profile.features};
  for(const [feature,label]of Object.entries(result.features)){
   const field=make('label');field.style.cssText='display:inline-flex;align-items:center;gap:8px;margin:8px 18px 8px 0;cursor:pointer';
   const input=make('input');input.type='checkbox';input.checked=values[feature];input.disabled=!profile.allowed;input.style.cssText='width:18px;height:18px;flex-shrink:0';input.setAttribute('aria-label',profile.key+' '+label);input.addEventListener('change',()=>{values[feature]=input.checked;});field.append(input,document.createTextNode(label));row.append(field);
  }
  const save=button('保存本会话权限',async()=>{save.disabled=true;try{await call('capability-set',{target:profile.key,features:values});notice('已保存 '+profile.label+' 的功能开关；管理员身份不变');}finally{save.disabled=!profile.allowed;}});save.disabled=!profile.allowed;row.append(make('div'),save);panel.append(row);
 }
}
// On-demand task progress. The monitor is read-only and never launches a shell.
function mountWhaleTaskProgress({read,onLogin}){
 const root=document.getElementById('taskProgress'),view=root.querySelector('[data-task-view]'),message=root.querySelector('[data-task-message]'),meter=root.querySelector('progress'),meterText=root.querySelector('[data-task-percent]'),terminal=root.querySelector('pre');
 let generation=0,timer,controller,pending=false,run=null,kind='surf';
 const active=()=>root.open&&!document.hidden;
 const time=ms=>{const n=Math.max(0,Math.floor((Number(ms)||0)/1000));return `${Math.floor(n/60)}分${String(n%60).padStart(2,'0')}秒`;};
 const date=at=>at?new Date(at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'未记录';
 const text=(field,value)=>{root.querySelector(`[data-task-${field}]`).textContent=value;};
 const reasons={budget:'达到手机任务费用或次数保护线',completed:'已完成',limit:'已达本轮上限',cancelled:'已取消',expired:'时限已到',restart:'重启后已暂停','batch-limit':'批次预算已用完',permission:'权限已关闭',blocked:'遇到平台或页面障碍','no-new-comments':'本轮可见评论已处理完','no-progress':'已暂停：没有核实到新进展','delivery-unverified':'已暂停，发送结果待核实','batch-timeout':'已暂停：批次超时'};
 const postLabels={draft:'草稿已生成',previewed:'已预览，等待本篇确认',approved:'已确认，等待准备发布','needs-review':'需要重新预览确认','submission-unverified':'提交结果待核实',published:'已核实发布',cancelled:'草稿已取消',superseded:'已被新草稿替换'};
 function postLabel(draft,manual,ownerPublishes){
  if(['submission-unverified','published','cancelled','superseded','needs-review'].includes(draft.status))return postLabels[draft.status];
  if(manual?.mode==='verify')return '等待核对已发布结果';
  if(manual?.mode==='ready')return '已交接，等待你点击发布';
  if(manual?.mode==='prepare')return '准备阶段，最终由你发布';
  if(draft.status==='approved'&&draft.approvedAt&&Date.now()-draft.approvedAt>7200000)return '确认已过期，需要重新预览';
  if(ownerPublishes&&draft.status==='approved')return '已确认，最终由你发布';
  return postLabels[draft.status]||'状态待核对';
 }
 function paint(){
  const now=Date.now();meter.closest('.task-progress-meter').hidden=kind==='posts';
  if(kind==='posts'){
   const drafts=Array.isArray(run)?run:run?.drafts||[],draft=drafts.filter(d=>!['superseded','cancelled'].includes(d.status)).at(-1)||drafts.at(-1);
   if(!draft){view.hidden=true;message.textContent='尚无已登记的帖子草稿。写作准备的信息会在草稿生成后显示；这里不会把准备中算作已发布。';return;}
   view.hidden=false;const label=postLabel(draft,run?.manual,run?.ownerPublishes);
   text('title',draft.title||'帖子草稿');text('status',label);text('count-label','配图数量');text('count',(draft.imageCount??draft.imageIds?.length??0)+' 张');text('elapsed-label','草稿创建于');text('elapsed',date(draft.createdAt));text('remaining-label','发布方式');text('remaining',run?.ownerPublishes?'管理员手动发布':'按本篇确认执行');
   message.textContent='刚刚更新 · '+new Date(now).toLocaleTimeString('zh-CN')+' · 按真实阶段显示，不估算写作百分比';
   const lines=[`当前阶段：${label}`,`草稿编号：${draft.id}`,`标题：${draft.title||'未记录'}`];
   if(draft.previewedAt)lines.push('已预览：'+date(draft.previewedAt));if(draft.approvedAt)lines.push('已确认：'+date(draft.approvedAt));if(draft.submissionAt)lines.push('尝试提交：'+date(draft.submissionAt));
   if(draft.status==='submission-unverified'||run?.manual?.mode==='verify')lines.push('先回读核实实际帖子，不重复发布；此状态不代表发布成功。');
   if(draft.lastFailure)lines.push('最近检查：'+draft.lastFailure);
   if(drafts.length>1){lines.push('','其他草稿记录：');for(const d of drafts.filter(d=>d.id!==draft.id).slice(-3).reverse())lines.push(`${d.id} · ${postLabels[d.status]||d.status} · ${d.title||''}`);}
   terminal.textContent=lines.join('\n');return;
  }
  if(!run?.id){view.hidden=true;message.textContent=kind==='replies'?'尚无评论回复任务。在 QQ 说「回复评论」，开始一轮按需回复。':'还没有刷帖任务。在 QQ 发「刷15个帖子」或「刷20分钟」，这里会显示进度。';return;}
  view.hidden=false;const reply=kind==='replies',expired=run.enabled&&now>=run.expiresAt,live=run.enabled&&!expired,label=live?'任务进行中':(run.stopReason==='dispatch-failed'?'任务派发失败':reasons[expired?'expired':run.stopReason]||'任务已停止');
  const started=run.startedAt||run.createdAt,end=live?now:Math.min(now,run.stoppedAt||run.lastFinishedAt||run.expiresAt);
  const current=reply?(run.count||0):run.targetPosts?(run.readCount||0):Math.max(0,end-run.startedAt),total=reply?run.limit:run.targetPosts||(run.expiresAt-run.startedAt),percent=total>0?Math.max(0,Math.min(100,Math.floor(current/total*100))):0;
  meter.value=percent;meterText.textContent=percent+'%';meter.setAttribute('aria-label',reply?'本轮回复上限使用比例':run.targetPosts?'已核实阅读进度':'本轮计时进度');
  text('title',reply?(run.targetPostId?'按帖子回复 · 单帖补漏':'按消息回复 · 消息列表'):run.targetPosts?`刷 ${run.targetPosts} 篇帖子`:'按时长刷帖');text('status',label);text('count-label',reply?'已核实回复':'已核实阅读');text('count',reply?`${run.count||0} / 最多${run.limit||0} 条`:run.targetPosts?`${run.readCount||0} / ${run.targetPosts} 篇`:`${run.readCount||0} 篇`);text('elapsed-label','已用时');text('elapsed',started?time(end-started):'未记录');text('remaining-label','剩余时限');text('remaining',live?time(run.expiresAt-now):'本轮已结束');
  message.textContent='刚刚更新 · '+new Date(now).toLocaleTimeString('zh-CN')+(reply?' · 百分比仅表示本轮上限使用量，不代表剩余评论总数':run.targetPosts?' · 数量只计入已回读登记的帖子':' · 百分比表示时间进度，不代表阅读数量');
  const phase=!live?label:run.batch?`当前批次已派发，经过 ${time(now-run.batch.at)}，等待核实登记`:run.nextAt>now?`约 ${Math.ceil((run.nextAt-now)/1000)} 秒后检查续接`:'等待手机或会话空闲后派发';
  const lines=[label,reply?`已核实回复：${run.count||0} 条（本轮上限 ${run.limit||0} 条）`:`已核实阅读：${run.readCount||0}${run.targetPosts?'/'+run.targetPosts:''} 篇`,`剩余时限：${live?time(run.expiresAt-now):'已结束'}`,phase];
  if(reply){lines.push(run.targetPostId?'回复入口：指定帖子的评论区，只处理本篇':'回复入口：消息列表，通知来自老帖也处理，不按最新帖子筛选');if(run.lastDispatchError)lines.push('派发错误：'+run.lastDispatchError);if(run.targetUrl)lines.push('指定帖子：'+run.targetUrl);if(run.queue)lines.push(`清单已识别 ${run.queue.scanned} 条，待处理 ${run.queue.pending} 条，待展开楼层 ${run.queue.unexpanded} 个`,run.queue.complete?'本帖扫描覆盖已核实':'本帖尚未证明全部检查完成');for(const gap of run.queue?.coverageGaps||[])lines.push(`平台计数缺口：${gap.author||'该楼'} 标注 ${gap.expected} 条，实际核对 ${gap.observed} 条（保留缺口）`);lines.push(`待登记目标：${run.pendingCount??'未记录'} 条`,`已提交、待核实：${run.unverifiedCount??'未记录'} 条`);if(run.cursor?.author)lines.push('最近登记对象：'+run.cursor.author);if(run.stopReason==='delivery-unverified')lines.push('发送结果尚未核实，不自动重发。');}
  else if(run.comments)lines.push(`已核实评论：${run.commentCount||0}${run.targetComments?'/'+run.targetComments:''} 条`);
  if(run.seen?.length)lines.push('最近确认来源：'+run.seen.at(-1));if(run.note)lines.push(String(run.note));terminal.textContent=lines.join('\n');
 }
 function stop(){generation++;clearTimeout(timer);controller?.abort();controller=null;pending=false;}
 async function refresh(){
  if(!active()||pending)return;pending=true;const id=generation;controller=new AbortController();const requestController=controller,deadline=setTimeout(()=>requestController.abort(),5000);
  try{const next=await read(kind,requestController.signal);if(id!==generation||!active())return;run=next;paint();}
  catch(error){if(id!==generation||!active())return;message.textContent='暂时未能刷新，保留上次进度；2秒后重试。';if(error.status===401)onLogin?.();}
  finally{clearTimeout(deadline);if(id===generation){controller=null;pending=false;if(active())timer=setTimeout(refresh,2000);}}
 }
 root.addEventListener('toggle',()=>{stop();if(active())void refresh();});document.addEventListener('visibilitychange',()=>{stop();if(active())void refresh();});root.querySelector('[data-task-refresh]').addEventListener('click',()=>{stop();if(active())void refresh();});
 root.querySelectorAll('[data-task-kind]').forEach(b=>b.addEventListener('click',()=>{stop();kind=b.dataset.taskKind;run=null;root.querySelectorAll('[data-task-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));paint();message.textContent='正在读取进度…';if(active())void refresh();}));
}
