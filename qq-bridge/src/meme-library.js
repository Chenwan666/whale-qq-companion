import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeFetch, safeFetchBuffer, looksLikeImageBuffer } from './safe-fetch.js';

const BASE='https://cst-cat.github.io/capoo-gallery/';
const hash=b=>createHash('sha256').update(b).digest('hex');
function onlineSource(metadata){
  if(metadata.sourceKind!=='online-browsing')return null;
  let sourceUrl;try{const u=new URL(metadata.sourceUrl);if(u.protocol!=='https:'||u.username||u.password)return null;sourceUrl=u.href.slice(0,2500);}catch{return null;}
  const source={sourceUrl,context:['browsing','reply-inbox','reply-post'].includes(metadata.collectionContext)?metadata.collectionContext:'browsing',excerpt:String(metadata.sourceExcerpt||'').slice(0,1000)};
  if(Number.isSafeInteger(metadata.androidMediaId))source.androidMediaId=metadata.androidMediaId;
  if(metadata.sourceImageUrl)try{const u=new URL(metadata.sourceImageUrl);if(u.protocol==='https:'&&!u.username&&!u.password){u.search='';u.hash='';source.imageUrl=u.href.slice(0,2500);}}catch{}
  return source;
}
function addSource(row,source){
  if(!source)return;
  row.sourceKind='online-browsing';row.sourceUrl??=source.sourceUrl;row.collectionContext??=source.context;row.sourceExcerpt??=source.excerpt;
  if(source.androidMediaId)row.androidMediaId??=source.androidMediaId;if(source.imageUrl)row.sourceImageUrl??=source.imageUrl;
  const sources=row.sources||[];if(!sources.some(s=>s.sourceUrl===source.sourceUrl&&s.context===source.context))row.sources=[...sources,source].slice(-5);
}
export function rankMemes(rows, query, limit=8) {
  const terms=String(query).trim().split(/[\s,，]+/).filter(Boolean);
  if(!terms.length || String(query).length>80) throw new Error('请输入1～80字表情关键词');
  return rows.map(r=>({...r,score:terms.reduce((n,t)=>n+(String(r.description).includes(t)?2:0)+(String(r.action).includes(t)?3:0)+(String(r.emotion).includes(t)?3:0)+(Array.isArray(r.tags)&&r.tags.some(s=>s.includes(t))?4:0),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}
export class MemeLibrary {
  constructor(root,{fetchPage=safeFetch,fetchImage=safeFetchBuffer}={}) {
    this.root=path.join(root,'memes');fs.mkdirSync(this.root,{recursive:true});
    this.file=path.join(this.root,'library.json');this.catalogFile=path.join(this.root,'catalog.json');
    this.rows=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];
    if(!Array.isArray(this.rows))throw new Error('本地表情库损坏');
    this.inboxFile=path.join(this.root,'inbox.json');
    this.inbox=fs.existsSync(this.inboxFile)?JSON.parse(fs.readFileSync(this.inboxFile,'utf8')):[];
    if(!Array.isArray(this.inbox))throw Error('图片审核库损坏');
    this.fetchPage=fetchPage;this.fetchImage=fetchImage;this.sending=false;this.lastSent=0;this.deleteRevision=0;
  }
  async catalog() {
    if(this.catalogRows)return this.catalogRows;
    if(fs.existsSync(this.catalogFile))this.catalogRows=JSON.parse(fs.readFileSync(this.catalogFile,'utf8'));
    else {
      const r=await this.fetchPage(BASE+'data/gallery.json',5000000);
      if(r.statusCode!==200)throw new Error('联网表情目录暂不可用');
      const rows=JSON.parse(r.body);
      if(!Array.isArray(rows)||rows.length>20000)throw new Error('表情目录格式异常');
      this.catalogRows=rows.filter(r=>typeof r.folder==='string'&&typeof r.gif==='string'&&r.folder.length<200&&r.gif.length<200&&!/[\\/]|\.\./.test(r.folder+r.gif)&&/\.gif$/i.test(r.gif)).map(r=>({id:hash(r.folder+'/'+r.gif).slice(0,16),description:String(r.description||'').slice(0,300),emotion:String(r.emotion||'').slice(0,50),action:String(r.action||'').slice(0,100),tags:Array.isArray(r.tags)?r.tags.slice(0,15).map(s=>String(s).slice(0,50)):[],url:BASE+'gifs/'+encodeURIComponent(r.folder)+'/'+encodeURIComponent(r.gif),source:BASE}));
      fs.writeFileSync(this.catalogFile,JSON.stringify(this.catalogRows),{mode:0o600});
    }
    return this.catalogRows;
  }
  async search(query) {return {results:rankMemes(await this.catalog(),query),source:BASE,note:'来源为公开咖波表情目录，描述是第三方标注。图片按需下载；未进行图片视觉判断。'};}
  list(query='',all=false) {return query?rankMemes(this.rows,query):(all?this.rows.slice():this.rows.slice(-20)).reverse();}
  remove(id) {
    if(!/^[a-f0-9]{16}$/.test(String(id)))throw Error('图片ID无效');
    if(this.sending)throw Error('正在发送图片，请稍后再删除');
    const row=this.rows.find(r=>r.id===id);
    if(!row)return {id,deleted:false,alreadyDeleted:true};
    if(!/^[a-f0-9]{64}\.(gif|png|jpg|webp)$/.test(row.filename))throw Error('图片缓存文件名无效，未删除');
    const target=path.resolve(this.root,row.filename);
    if(path.dirname(target)!==path.resolve(this.root))throw Error('图片路径无效');
    // Identical bytes may have both a catalogue ID and a received-image ID.
    const previousRows=this.rows,previousInbox=this.inbox;
    const rows=this.rows.filter(r=>r.filename!==row.filename),inbox=this.inbox.filter(r=>r.filename!==row.filename);
    this.persist(this.file,rows);
    try{this.persist(this.inboxFile,inbox);}catch(error){this.persist(this.file,previousRows);throw error;}
    this.rows=rows;this.inbox=inbox;this.deleteRevision++;
    let fileRemoved=false,cleanupPending=false;
    try{fs.unlinkSync(target);fileRemoved=true;}catch(error){if(error.code!=='ENOENT')cleanupPending=true;}
    return {id,deleted:true,removed:previousRows.length-rows.length,fileRemoved,cleanupPending};
  }
  persist(file,rows){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows,null,2),{mode:0o600});fs.renameSync(tmp,file);}
  collect(buffer,metadata={}) {
    if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>20*1024*1024||!looksLikeImageBuffer(buffer))throw Error('图片无效或超过20MB');
    const mime=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':/^GIF8[79]a/.test(buffer.subarray(0,6).toString('ascii'))?'image/gif':buffer[0]===255&&buffer[1]===216?'image/jpeg':buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP'?'image/webp':null;
    if(!mime)throw Error('仅收集PNG、JPEG、GIF或WebP图片');
    const sha=hash(buffer),id=sha.slice(0,16),filename=sha+'.'+({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'}[mime]);
    const prior=this.inbox.find(r=>r.id===id);
    if(prior){prior.lastSeenAt=Date.now();addSource(prior,onlineSource(metadata));this.persist(this.inboxFile,this.inbox);return {id,status:prior.status,alreadySaved:true};}
    const approved=this.rows.find(r=>r.filename===filename);
    if(approved)return {id:approved.id,status:'approved',alreadySaved:true};
    if(this.inbox.length>=10000||this.inbox.reduce((n,r)=>n+(r.bytes||0),0)+buffer.length>1024*1024*1024)throw Error('图片审核库已满，请在小窝整理');
    const row={id,filename,mimeType:mime,bytes:buffer.length,status:'pending',createdAt:Date.now(),lastSeenAt:Date.now(),key:String(metadata.key||'').slice(0,40),userId:String(metadata.userId||'').slice(0,20),messageId:String(metadata.messageId||'').slice(0,40),description:String(metadata.description||'待管理员标注的聊天图片').slice(0,300),tags:[]};
    addSource(row,onlineSource(metadata));
    fs.writeFileSync(path.join(this.root,filename),buffer,{mode:0o600});this.inbox.push(row);this.persist(this.inboxFile,this.inbox);
    return {id,status:'pending',bytes:buffer.length};
  }
  pending(){const rows=this.inbox.filter(r=>r.status==='pending');return {total:rows.length,items:rows.slice(-30).reverse()};}
  reviewPreview(id){const row=this.inbox.find(r=>r.id===id&&r.status==='pending');if(!row)throw Error('没有这张待审核图片');return this.image(row);}
  review(id,{approve,description,tags=[]}={}){
    if(typeof approve!=='boolean')throw Error('请明确通过或拒绝');
    const row=this.inbox.find(r=>r.id===id);if(!row||row.status!=='pending')throw Error('图片不存在或已经审核');
    if(approve){
      const label=String(description||'').trim();if(!label||label.length>300)throw Error('通过前请写1～300字的用途描述，帮助小鲸鱼选择图片');
      this.image(row);
      if(!this.rows.some(r=>r.filename===row.filename))this.rows.push({id:row.id,filename:row.filename,mimeType:row.mimeType,bytes:row.bytes,description:label,tags:Array.isArray(tags)?tags.slice(0,15).map(t=>String(t).slice(0,50)):[],source:'管理员审核通过的聊天图片',status:'approved',...(row.sourceKind==='online-browsing'?{sourceKind:row.sourceKind,sourceUrl:row.sourceUrl,collectionContext:row.collectionContext,sourceExcerpt:row.sourceExcerpt,sources:row.sources}:{}),savedAt:Date.now()});
      this.persist(this.file,this.rows);
    }
    row.status=approve?'approved':'rejected';row.reviewedAt=Date.now();this.persist(this.inboxFile,this.inbox);
    return {id,status:row.status};
  }
  image(row){
    if(!row||!/^[a-f0-9]{64}\.(gif|png|jpg|webp)$/.test(row.filename))throw Error('没有这张本地图片');
    const buffer=fs.readFileSync(path.join(this.root,row.filename));
    if(buffer.length>20*1024*1024||!looksLikeImageBuffer(buffer)||hash(buffer)!==row.filename.split('.')[0])throw Error('图片缓存校验失败');
    return {image:{mimeType:row.mimeType||'image/gif',data:buffer.toString('base64')},description:row.description};
  }
  async save(id) {
    const deleteRevision=this.deleteRevision;
    if(!/^[a-f0-9]{16}$/.test(String(id)))throw new Error('表情ID无效');
    const prior=this.rows.find(r=>r.id===id);if(prior)return {...prior,alreadySaved:true};
    if(this.rows.length>=500)throw new Error('本地表情库已达500张上限');
    const item=(await this.catalog()).find(r=>r.id===id);if(!item)throw new Error('请使用搜索返回的真实表情ID');
    const {buffer}=await this.fetchImage(item.url,4*1024*1024);
    if(!looksLikeImageBuffer(buffer)||buffer.toString('ascii',0,6)!=='GIF89a'&&buffer.toString('ascii',0,6)!=='GIF87a')throw new Error('图片格式与目录不符');
    const w=buffer.readUInt16LE(6),h=buffer.readUInt16LE(8);
    if(!w||!h||w*h>16000000)throw new Error('表情图片像素异常');
    if(this.rows.reduce((n,r)=>n+r.bytes,0)+buffer.length>200*1024*1024)throw new Error('本地表情库已达200MB上限');
    // Check again after network I/O: simultaneous requests must not duplicate rows.
    if(deleteRevision!==this.deleteRevision)throw Error('图片库刚完成删除，本次下载已取消；需要时请重新收藏');
    const existing=this.rows.find(r=>r.id===id);if(existing)return {...existing,alreadySaved:true};
    const filename=hash(buffer)+'.gif';fs.writeFileSync(path.join(this.root,filename),buffer,{mode:0o600});
    const row={...item,filename,bytes:buffer.length,width:w,height:h,savedAt:Date.now()};this.rows.push(row);
    const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.rows,null,2),{mode:0o600});fs.renameSync(tmp,this.file);
    return row;
  }
  async send(id, deliver) {
    if(this.sending||Date.now()-this.lastSent<10000)throw new Error('表情发送间隔至少10秒');
    this.sending=true;
    try {
      const row=this.rows.find(r=>r.id===id);if(!row)throw new Error('请先收藏这张表情');
      if(!/^[a-f0-9]{64}\.(gif|png|jpg|webp)$/.test(row.filename))throw new Error('表情缓存文件名无效');
      const buffer=fs.readFileSync(path.join(this.root,row.filename));
      if(buffer.length>20*1024*1024||!looksLikeImageBuffer(buffer)||hash(buffer)!==row.filename.split('.')[0])throw new Error('表情缓存校验失败');
      this.lastSent=Date.now();
      const result=await deliver([{type:'image',data:{file:'base64://'+buffer.toString('base64')}}]);
      return {sent:true,id:row.id,description:row.description,messageId:result?.message_id};
    } finally {this.sending=false;}
  }
  preview(id) {
    const row=this.rows.find(r=>r.id===id);
    if(!row)throw new Error('没有这张本地表情');
    return this.image(row);
  }
}
