import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { extractPage } from './shared-content.js';

export function visibleTracks(links) {
  const songs=[];
  for(const link of links) {
    if(!/\/mixsong\//.test(link.url))continue;
    const text=link.title.replace(/^\s*\d+\s*/, '').replace(/\s+/g,' ').trim();
    const separator=text.indexOf(' - ');
    const song={title:separator<0?text:text.slice(separator+3),artist:separator<0?'':text.slice(0,separator),url:link.url};
    if(song.title&&!songs.some(s=>s.url===song.url))songs.push(song);
  }
  return songs.slice(0,80);
}

export class KugouReader {
  constructor(root) { this.profile = path.join(root,'state','companion','kugou-browser'); this.context=null; this.visible=false; this.starting=null; this.chain=Promise.resolve(); }
  async ensure(visible=false) {
    if (this.starting) await this.starting;
    if (this.context && (!visible || this.visible)) return this.context;
    this.starting=(async()=>{
      if(this.context)await this.context.close();
      const exe=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p=>fs.existsSync(p));
      if(!exe)throw new Error('未找到固定使用的Edge，无法打开酷狗登录页面');
      this.context=await chromium.launchPersistentContext(this.profile,{executablePath:exe,headless:!visible,viewport:{width:1100,height:850}});
      this.visible=visible;
      // This browser is scoped to Kugou, its assets and its normal Tencent login.
      await this.context.route('**/*',route=>{
        let url;try{url=new URL(route.request().url());}catch{return route.abort();}
        const allowed=['kugou.com','kugou.cn','kugou.net','kgimg.com','qq.com','gtimg.com','tencent.com'];
        if(!['http:','https:'].includes(url.protocol)||!allowed.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))return route.abort();
        return route.continue();
      });
      this.context.on('close',()=>{this.context=null;this.visible=false;});
      return this.context;
    })();
    try{return await this.starting;}finally{this.starting=null;}
  }
  async login() {
    const context=await this.ensure(true);
    const page=await context.newPage();
    await page.goto('https://www.kugou.com/',{waitUntil:'domcontentloaded',timeout:30000});
    await page.bringToFront();
    return {opened:true,instruction:'酷狗正常网页登录页面已打开。请你点击登录并扫码；登录状态仅保存在本机独立浏览器目录，模型不读取 Cookie。'};
  }
  read(url) {
    const parsed=new URL(url);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||(parsed.port&&!['80','443'].includes(parsed.port))||!['kugou.com','kugou.cn'].some(d=>parsed.hostname===d||parsed.hostname.endsWith('.'+d)))throw new Error('此浏览器只读取不含凭据的正常酷狗分享链接');
    const task=this.chain.then(async()=>{
      const context=await this.ensure();const page=await context.newPage();
      try {
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
        await page.waitForTimeout(2000);
        const final=new URL(page.url());
        if(!['kugou.com','kugou.cn'].some(d=>final.hostname===d||final.hostname.endsWith('.'+d)))throw new Error('酷狗链接跳转到了其他站点，停止读取');
        const result=extractPage(await page.content(),page.url());
        result.links=await page.locator('a[href]').evaluateAll(nodes=>nodes.filter(a=>a.getClientRects().length).map(a=>({title:(a.innerText||a.getAttribute('title')||'').trim().slice(0,200),url:a.href})).filter(a=>a.title&&/^https?:\/\//.test(a.url)&&/\.(?:kugou\.com|kugou\.cn)$/.test(new URL(a.url).hostname)).slice(0,120));
        result.links=result.links.filter(l=>!Array.from(new URL(l.url).searchParams.keys()).some(k=>/token|cookie|password|authorization/i.test(k)));
        result.tracks=visibleTracks(result.links);
        result.contentLimited=/仅展示部分|查看完整歌单|移步.{0,10}客户端|登录后.{0,10}查看/.test(result.body);
        result.rendered=true;result.audioListened=false;result.note='读取酷狗正常网页和登录后页面显示的文本；没有听辨音频。';
        if(result.contentLimited)result.note+='网站明确提示只展示部分内容，当前歌曲列表不完整。';
        return result;
      }finally{await page.close();}
    });
    this.chain=task.catch(()=>{});return task;
  }
}
