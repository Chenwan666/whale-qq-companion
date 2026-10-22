// A bounded public-data projection: exclude login cookies, tokens and internal fields.
export function qzoneDetailView(raw) {
  const text=(v,n=2000)=>String(v??'').slice(0,n);
  const comment=(r,depth=0)=>({id:text(r.tid||r.id,200),user_id:Number(r.uin)||0,nickname:text(r.name,100),content:text(r.content),time:Number(r.create_time||r.created_time)||0,...(depth===0?{replies:(Array.isArray(r.replylist)?r.replylist:[]).slice(0,20).map(x=>comment(x,1)),replyCount:Number(r.replyNum)||0}:{})});
  const comments=(Array.isArray(raw.commentlist)?raw.commentlist:[]).slice(0,30).map(x=>comment(x));
  const count=Number(raw.cmtnum)||0;
  return {tid:text(raw.tid,200),target:Number(raw.uin)||0,content:text(raw.content,5000),time:Number(raw.created_time)||0,commentCount:count,comments,commentsComplete:comments.length>=count&&comments.every(c=>c.replies.length>=c.replyCount),images:(Array.isArray(raw.pic)?raw.pic:[]).slice(0,9).map(p=>p.url3||p.url2||p.url1||p.smallurl).filter(u=>typeof u==='string'&&/^https?:\/\//.test(u))};
}
