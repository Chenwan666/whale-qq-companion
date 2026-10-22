async function renderPersonaGrowth({panel,call,notice,make,button,card,isActive=()=>true}){
 const data=await call('persona-dashboard');if(!isActive())return;
 panel.replaceChildren();
 panel.append(make('h2','小鲸鱼的成长日记'),make('p','把真实经历慢慢积累成自己的表达和兴趣。原有人设、每个人的独立记忆和权限边界仍保留。'));
 const control=data.control,labels={interaction:'真实交流',feedback:'表达反馈',activity:'已验证的实践'};
 const state=!control.enabled?(control.startedAt?'培养已停止':'尚未开启'):control.paused?'观察继续，融合暂停':'已开启，正在成长';
 panel.append(card(state,`已记录 ${data.stats.total||0} 条观察 · 待融合 ${data.stats.pending||0} 条 · 最近融合 ${control.lastFusedDay||'尚无'}。日常融合安排在23点后；离线遗漏会补处理。`));
 const reload=()=>renderPersonaGrowth({panel,call,notice,make,button,card,isActive});
 const actions=make('div',undefined,'toolbar');
 actions.append(button(control.enabled?(control.paused?'恢复融合':'暂停融合'):'开启培养',async()=>{await call('persona-control',{enabled:true,paused:control.enabled?!control.paused:false});await reload();notice('人格培养状态已更新');}));
 if(control.enabled)actions.append(button('立即融合新观察',async()=>{const r=await call('persona-fuse');await reload();notice(r.applied?'已融合，版本 '+r.revision:r.alreadyFused?'今天已融合，新增观察留待下一次':r.reason);}));
 if(control.enabled)actions.append(button('停止培养',async()=>{await call('persona-control',{enabled:false});await reload();notice('已停止收集与融合，成长版本和原有记忆仍保留。');}));
 panel.append(actions,make('h3','正在形成的性格'));
 const grid=make('div',undefined,'grid');for(const t of data.traits){const stage=t.stage||'观察中';grid.append(card(t.label+' · '+stage,`支持证据来自 ${t.evidenceDays} 个不同日期；分歧日期 ${t.conflictDays}。证据不足时沿用初始底色。`));}panel.append(grid);
 panel.append(make('h3','各自珍藏的关系'));
 if(!data.relations.length)panel.append(make('p','还没有融合后的关系记录。正常聊天会自动积累，不需要为了培养而反复说同一句话。'));
 for(const r of data.relations)panel.append(card(r.nickname||r.key,`在 ${r.days} 个不同日期有真实交流 · 最近 ${r.lastDay}。`));
 panel.append(make('h3','近期真实观察'));
 if(!data.observations.length)panel.append(make('p',control.enabled?'已开始等待新的真实交流和工具实践；不会把旧聊天批量推断成性格。':'开启后的新交流和已验证工具实践会出现在这里，不会批量改写旧记忆。'));
 for(const o of data.observations){
  const detail=o.kind==='feedback'?`${data.traits.find(t=>t.id===o.payload.trait)?.label||o.payload.trait}，${o.payload.direction>0?'更愿意表现':'适当收敛'}`:o.payload.domain||'只记录交流发生，不把这句话自动当作鲸鱼自己的喜好';
  const e=card(`${labels[o.kind]||o.kind} · ${o.day}`,`${o.nickname||o.key} · ${detail} · ${o.rejected?'已排除':o.fused?'已融合':'待融合'}`);
  const source=make('details'),summary=make('summary','查看证据来源');source.append(summary,make('p',`会话：${o.key}；来源ID：${o.sourceId}。原文在对应聊天记录中，当前页面不复制私人正文。`));e.append(source);
  if(!o.rejected)e.append(button('排除此观察',async()=>{const r=await call('persona-reject',{id:o.id,confirm:true});await reload();notice(r.note);}));panel.append(e);
 }
 panel.append(make('h3','成长版本'));
 if(!data.revisions.length)panel.append(make('p','还没有融合版本；积累真实观察后才会生成。'));
 for(const r of data.revisions){const e=card('版本 '+r.id+' · '+r.day,r.reason);e.append(button('回退到此版本之前并暂停融合',async()=>{await call('persona-rollback',{id:r.id,confirm:true});await reload();notice('已回退，自动融合已暂停；观察仍继续。');}));panel.append(e);}
}
