import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const reasons={completed:'已完成',cancelled:'已取消',expired:'时限已到',restart:'服务重启后已暂停','batch-limit':'本轮批次预算已用完',permission:'权限已关闭',blocked:'遇到平台或页面障碍','dispatch-failed':'任务派发失败'};
export function duration(ms){
 const seconds=Math.max(0,Math.floor((Number(ms)||0)/1000));
 return `${Math.floor(seconds/60)}分${String(seconds%60).padStart(2,'0')}秒`;
}
export function bar(value,total,width=24){
 const fraction=total>0?Math.max(0,Math.min(1,value/total)):0;
 const filled=Math.floor(fraction*width);
 return `[${'#'.repeat(filled)}${'-'.repeat(width-filled)}] ${Math.floor(fraction*100)}%`;
}
export function readSurfSnapshot(root){
 const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
 if(!/^[1-9]\d*$/.test(String(config.ownerQQ)))throw Error('管理员账号配置无效');
 const file=path.join(root,'state','companion','companion.sqlite');
 if(!fs.existsSync(file))return null;
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='surf_runs'").get())return null;
  const row=db.prepare('SELECT data FROM surf_runs WHERE key=?').get(`private:${config.ownerQQ}`);
  return row?JSON.parse(row.data):null;
 }finally{db.close();}
}
export function buildSurfView(run,{now=Date.now(),online=true}={}){
 const clock=new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 const lines=['小鲸鱼 · 刷帖任务实时进度',`更新时间：${clock}   桥接服务：${online?'在线':'离线，当前显示本地保存进度'}`,''];
 if(!run?.id)return [...lines,'当前没有刷帖任务。','在 QQ 私聊发「刷15个帖子」或「刷20分钟」，这里会自动显示。','','本窗口只读，不调用模型、不产生 API 费用。','关闭窗口 / Ctrl+C：只关闭面板，不停止机器人。'];
 const expired=!!run.enabled&&now>=run.expiresAt;
 const active=!!run.enabled&&!expired;
 const reason=expired?'expired':run.stopReason;
 const count=Math.max(0,Number(run.readCount)||0);
 let status=active?(online?'进行中':'服务离线，任务无法执行'):(reasons[reason]||'已停止');
 if(active&&online&&run.stopAfterCurrent)status='完成当前评论后停止';
 lines.push(`任务：${run.targetPosts?`刷 ${run.targetPosts} 篇帖子`:'按时长刷帖'}   状态：${status}`);
 if(run.targetPosts)lines.push(`阅读进度  ${bar(count,run.targetPosts)}  已核实 ${count}/${run.targetPosts} 篇`);
 else{
  const end=active?now:Math.min(now,Number(run.stoppedAt)||Number(run.lastFinishedAt)||run.expiresAt);
  lines.push(`计时进度  ${bar(end-run.startedAt,run.expiresAt-run.startedAt)}  （时间进度，不代表阅读数量）`,`已核实阅读：${count} 篇`);
 }
 const endTime=active?now:Math.min(now,Number(run.stoppedAt)||Number(run.lastFinishedAt)||run.expiresAt);
 lines.push(`已用时：${duration(endTime-run.startedAt)}   ${active?'剩余时限：'+duration(run.expiresAt-now):'本轮已结束'}`);
 lines.push(`截止时间：${new Date(run.expiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`);
 if(run.comments)lines.push(`已核实评论：${run.commentCount||0}${run.targetComments?'/'+run.targetComments:''} 条`);
 if(active&&online){
  if(run.batch)lines.push(`当前批次：执行中，已运行 ${duration(now-run.batch.at)}；本批完成并登记后更新数量`);
  else if(run.nextAt>now)lines.push(`当前批次：等待续接，约 ${Math.ceil((run.nextAt-now)/1000)} 秒后检查`);
  else lines.push('当前批次：等待手机或会话空闲后派发');
 }
 lines.push(`已收尾批次：${run.batches||0}   任务编号：${String(run.id).slice(0,8)}`);
 if(run.seen?.length)lines.push(`最近确认来源：${run.seen.at(-1)}`);
 if(run.note)lines.push(`说明：${String(run.note).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,180)}`);
 lines.push('','QQ 发「刷帖状态」查进度；发「取消任务」停止执行。','数量只显示后台已核实登记的帖子，不把点击或等待算成完成。','本窗口只读，不调用模型。关闭窗口 / Ctrl+C 不会停止机器人。');
 return lines;
}
