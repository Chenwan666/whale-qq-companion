import fs from 'node:fs';import path from 'node:path';
export const XHH_ACTIONS=new Set(['xhh-history','xhh-record']);
export class XiaoheiheExperience{
 constructor(root,audit){this.file=path.join(root,'xiaoheihe-experience.json');this.audit=audit;this.rows=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];}
 canonical(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!['api.xiaoheihe.cn','www.xiaoheihe.cn','xiaoheihe.cn'].includes(u.hostname))throw Error('只记录实际小黑盒帖子链接');const id=u.searchParams.get('link_id')||u.pathname.match(/\/link\/([a-f0-9]{12,32})\/?$/i)?.[1];if(!/^[a-f0-9]{12,32}$/i.test(id||''))throw Error('缺少有效帖子ID');return 'https://www.xiaoheihe.cn/app/bbs/link/'+id.toLowerCase();}
 history(key){return this.rows.filter(r=>r.key===key).slice(-20).map(({key,...r})=>r);}
 recentPosted(){return this.rows.filter(r=>r.status!=='skipped').slice(-10).map(r=>({url:r.url,status:r.status}));}
 record(key,body){
  const url=this.canonical(body.url);if(!['observed','submitted','skipped'].includes(body.status))throw Error('状态必须区分回读可见、仅提交或跳过');
  const fields={};for(const field of ['title','reason','reply','lesson','commentId','author','comment','replyKind','imageId','appEmoji']){const value=String(body[field]||'').trim();if(value.length>1000)throw Error('每项最多1000字');fields[field]=value?this.audit(value):'';}
  if(!fields.title||!fields.reason||!fields.lesson||(body.status!=='skipped'&&!fields.reply))throw Error('需记录实际标题、选择理由、回复原文和经验');
  const old=this.rows.find(r=>r.key===key&&r.url===url&&r.reply===fields.reply);if(old&&(old.status===body.status||old.status==='observed'))return {recorded:true,alreadyRecorded:true,url,status:old.status};
  const row={key,url,...fields,status:body.status,at:new Date().toISOString()},next=(old?this.rows.map(r=>r===old?row:r):[...this.rows,row]).slice(-300),tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(tmp,this.file);this.rows=next;
  return {recorded:true,url,status:row.status,note:'保存的是阅读互动经验，不是用户个人记忆；observed为工具观察记录，不是平台独立审核结论。'};
 }
}
