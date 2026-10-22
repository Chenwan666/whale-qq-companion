import fs from 'node:fs';
import path from 'node:path';
import {priceUsage,isPeakAt} from './model-prices.js';

export function buildCostAudit(lines,at=Date.now(),targetDate) {
  const date=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  const day=targetDate||date(at),unique=new Map();
  for(const line of lines.split(/\r?\n/)){try{const r=JSON.parse(line);if(r.k==='turn'&&Number.isFinite(r.t)&&r.t<=at&&date(r.t)===day)unique.set([r.sid,r.turn,r.step,r.retry].join('|'),r);}catch{}}
  const result={date:day,generatedAt:at,estimated:true,scope:'bridge-ledger-only',requests:0,cacheHit:0,cacheMiss:0,output:0,cost:0,peakSurcharge:0,conversations:{},coldRequests:[]};
  for(const r of unique.values()){
    if(!r.b||typeof r.b!=='object')continue;
    const p=priceUsage(r.b,{model:r.model,at:r.t}).cost;
    const row=result.conversations[r.key]??={requests:0,cost:0,maxInput:0};
    row.requests++;row.cost+=p.total;row.maxInput=Math.max(row.maxInput,(r.b.cacheHit||0)+(r.b.cacheMiss||0));
    result.requests++;result.cacheHit+=r.b.cacheHit||0;result.cacheMiss+=r.b.cacheMiss||0;result.output+=r.b.output||0;result.cost+=p.total;
    if(isPeakAt(r.t))result.peakSurcharge+=p.total/2;
    if(r.b.cacheMiss>=100000)result.coldRequests.push({at:r.t,key:r.key,cacheMiss:r.b.cacheMiss,cost:p.total});
  }
  result.cacheHitRate=result.cacheHit/(result.cacheHit+result.cacheMiss||1);
  result.coldRequests.sort((a,b)=>b.cost-a.cost);result.coldRequests=result.coldRequests.slice(0,20);
  return result;
}

export function writeCostAudit(root,at=Date.now(),targetDate) {
  const state=path.join(root,'state'),ledger=path.join(state,'token-usage.jsonl');
  const result=buildCostAudit(fs.existsSync(ledger)?fs.readFileSync(ledger,'utf8'):'',at,targetDate);
  const dir=path.join(state,'cost-reports');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,result.date+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2),{mode:0o600});fs.renameSync(tmp,file);
  const text=`# ${result.date} 小鲸鱼用量\n\n本地账本估算，非官方扣款。独立测试或其他使用同一密钥的程序可能不在其中。\n\n- 请求：${result.requests} 次\n- 估算：${result.cost.toFixed(4)} 元\n- 高峰额外费用：${result.peakSurcharge.toFixed(4)} 元\n- 输入缓存命中：${(result.cacheHitRate*100).toFixed(2)}%\n- 未缓存输入：${result.cacheMiss} token\n- 输出：${result.output} token\n\n| 会话 | 请求 | 估算费用（元） | 最大输入 token |\n|---|---:|---:|---:|\n${Object.entries(result.conversations).map(([key,r])=>`| ${key} | ${r.requests} | ${r.cost.toFixed(4)} | ${r.maxInput} |`).join('\n')}\n\n报告仅含用量，不含聊天正文、凭据或记忆。\n`;
  const md=path.join(dir,result.date+'.md');fs.writeFileSync(md+'.tmp',text,{mode:0o600});fs.renameSync(md+'.tmp',md);
  return result;
}
