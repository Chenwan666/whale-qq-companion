import {z} from 'zod';
export const CORE_CHAT_TOOLS=new Set(['qq_status','qq_get_prompt','qq_get_unread_messages','qq_get_recent_messages','qq_social_state','qq_mark_read','qq_send_message','qq_reply','qq_wait_for_messages','qq_set_wake_config','qq_remember','qq_recall','qq_forget','qq_read_link','qq_get_message_images','qq_get_message_detail','qq_list_stickers','qq_send_sticker','qq_meme_list','qq_meme_preview','qq_meme_send','qq_share_link','qq_speak','qq_capability_find','qq_capability_call']);
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
export class McpToolCatalog{
 constructor(){this.hidden=new Map();}
 register(register,name,rest){
  const description=typeof rest[0]==='string'?rest[0]:'',shape=typeof rest[0]==='string'?rest[1]:rest[0],handler=rest.at(-1);
  // Legacy unscoped tools keep their original registration and validation.
  // Only session-bound tools can be reached through the catalog dispatcher.
  if(CORE_CHAT_TOOLS.has(name)||!shape?.key||!shape?.token||typeof handler!=='function')return register(name,...rest);
  const schema=z.object(shape);this.hidden.set(name,{name,description,shape,schema,handler});return undefined;
 }
 find(query,limit=5){const terms=String(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);return [...this.hidden.values()].map(t=>({t,score:terms.reduce((n,w)=>n+(t.name+' '+t.description).toLocaleLowerCase().includes(w),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.min(8,limit)).map(({t})=>{const {key,token,...input}=t.shape;return {name:t.name,description:t.description,inputSchema:z.toJSONSchema(z.object(input),{io:'input'})};});}
 async call({key,token,name,args={}},extra){const tool=this.hidden.get(name);if(!tool)throw Error('没有这个可按需调用的功能；先查qq_capability_find，版本未包含或已关闭的功能不能调用');const parsed=tool.schema.parse({...args,key,token});return tool.handler(parsed,extra);}
 install(register){const session={key:z.string().regex(/^(?:private|group):[1-9]\d*$/),token:z.string().min(1)};
  register('qq_capability_find','按需发现低频工具，减少每轮重复携带的schema。关键词可用“文件”“网页”“群”“音色”“日记”等，返回真实工具名称与参数schema；再用qq_capability_call执行。这里不会发消息或执行功能。',{...session,query:z.string().min(1).max(100),limit:z.number().int().min(1).max(8).default(5)},async({query,limit})=>result({tools:this.find(query,limit),available:this.hidden.size,note:'仅列本版本已启用的会话工具；key/token由调用工具强制绑定，不能在args改换会话。'}));
  register('qq_capability_call','调用刚由qq_capability_find查到的功能。name与args必须符合返回schema；仍走原有权限、白名单、预算、内容审计和发送去重，不授予管理员或额外能力。',{...session,name:z.string().min(1).max(100),args:z.record(z.string(),z.unknown()).default({})},async(body,extra)=>{try{return await this.call(body,extra);}catch(error){return {content:[{type:'text',text:'按需功能未执行：'+error.message}],isError:true};}});
 }
}
