import {load} from 'cheerio';
import {safeFetch} from './safe-fetch.js';
import {readSharedLink} from './shared-content.js';

export async function resolveBilibiliLink(input,fetcher=safeFetch){
 input=String(input||'').trim();if(/^BV[0-9a-zA-Z]{10}$/.test(input))return {bvid:input,url:'https://www.bilibili.com/video/'+input};
 const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password||!['b23.tv','www.bilibili.com','m.bilibili.com','bilibili.com'].includes(u.hostname)||u.port)throw Error('只接受BV号或B站HTTPS视频链接，不携带凭据');
 const final=u.hostname==='b23.tv'?new URL((await fetcher(u.href,600000)).url):u;
 if(!['www.bilibili.com','m.bilibili.com','bilibili.com'].includes(final.hostname))throw Error('短链未指向B站视频');
 const bvid=final.pathname.match(/\/(BV[0-9a-zA-Z]{10})(?:\/|$)/)?.[1];if(!bvid)throw Error('未找到BV视频号；此链接可能是动态、直播或非视频页面');return {bvid,url:'https://www.bilibili.com/video/'+bvid};
}

// Parser selectors adapted from sjlgg/dsh-free-web-search (MIT).
export function parseSearch(html,engine){
 const $=load(html,engine==='bing-rss'?{xml:true}:{}),rows=[];
 const selectors=engine==='360'?'li.res-list':engine==='bing-rss'?'item':'li.b_algo';
 $(selectors).each((_,node)=>{
  const e=$(node),a=e.find(engine==='360'?'h3 a[data-mdurl]':'h2 a').first();
  const url=engine==='bing-rss'?e.find('link').text().trim():engine==='360'?a.attr('data-mdurl'):a.attr('href');
  const title=(engine==='bing-rss'?e.find('title').text():a.text()).trim();
  const snippet=(engine==='bing-rss'?e.find('description').text():e.find(engine==='360'?'p.res-desc,.res-list-summary':'p').first().text()).trim();
  try{const u=new URL(url);if(!/^https?:$/.test(u.protocol)||u.username||u.password||!title)return;rows.push({title:title.slice(0,240),url:u.href,snippet:snippet.slice(0,900),...(e.find('pubDate').text()?{publishedAt:e.find('pubDate').text()}:{}),engine});}catch{}
 });return rows;
}
export class WebResearch{
 constructor(fetcher=safeFetch){this.fetcher=fetcher;this.cache=new Map();}
 async search(query,{count=6,domains=[],freshness='any'}={}){
  query=String(query||'').replace(/[\x00-\x1f]|\[CQ:[^\]]*\]/g,' ').trim();if(!query||query.length>200)throw Error('搜索词需要1～200字');
  if(!Array.isArray(domains)||domains.length>5||domains.some(d=>!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d)))throw Error('搜索站点格式无效');
  count=Math.min(10,Math.max(1,Number(count)||6));const q=query+(domains.length?' '+domains.map(d=>'site:'+d).join(' OR '):'');
  const cached=this.cache.get(JSON.stringify([q,count,freshness]));if(cached&&Date.now()-cached.at<300000)return cached.result;
  const attempts=[],results=[],seen=new Set();
  for(const engine of ['360','bing-rss','bing-html']){
   const url=new URL(engine==='360'?'https://www.so.com/s':'https://cn.bing.com/search');url.searchParams.set('q',q);
   if(engine==='bing-rss')url.searchParams.set('format','rss');
   if(engine.startsWith('bing')){url.searchParams.set('mkt','zh-CN');if(freshness!=='any')url.searchParams.set('filters','ex1:"'+({day:'ez1',week:'ez2',month:'ez3'}[freshness]||'ez3')+'"');}
   try{const r=await this.fetcher(url.href,600000);if(r.statusCode!==200)throw Error('HTTP '+r.statusCode);const found=parseSearch(r.body,engine);attempts.push({engine,count:found.length});for(const row of found){const host=new URL(row.url).hostname;if(domains.length&&!domains.some(d=>host===d||host.endsWith('.'+d)))continue;if(!seen.has(row.url)){seen.add(row.url);results.push(row);}}if(results.length>=Math.min(count,3))break;}catch(e){attempts.push({engine,error:String(e.message).slice(0,180)});}
  }
  const result={status:results.length?'ok':attempts.every(a=>a.error)?'failed':'empty-or-limited',query,results:results.slice(0,count),attempts,freshnessRequested:freshness,checkedAt:new Date().toISOString(),note:'搜索摘要不是全文，也不保证是最新版本。推荐游戏配队时核对版本、发布日期与至少两个来源；空结果不证明网上没有资料；可用qq_browser_search的sogou入口再核验一次。B站若返回风控banned，不反复重试、不说成会话权限不足。'};
  if(results.length){this.cache.set(JSON.stringify([q,count,freshness]),{at:Date.now(),result});if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value);}return result;
 }
 async read(url){return readSharedLink(url);}
}
