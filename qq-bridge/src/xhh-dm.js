import {randomBytes,timingSafeEqual} from 'node:crypto';export class DmTaskAuthority{
 constructor({now=Date.now}={}){this.now=now;this.tokens=new Map();this.keys=new Map();}
 issue(key,taskId){for(const [t,r]of this.tokens)if(r.expiresAt<=this.now())this.tokens.delete(t);const token=randomBytes(24).toString('hex'),r={key,taskId,expiresAt:this.now()+10*60000};this.tokens.set(token,r);this.keys.set(key,r);return token;}
 lookup(token){if(typeof token!=='string'||!token)return null;for(const [candidate,r]of this.tokens){if(r.expiresAt<=this.now())continue;const a=Buffer.from(candidate),b=Buffer.from(token);if(a.length===b.length&&timingSafeEqual(a,b))return r;}return null;}
 restriction(key){const r=this.keys.get(key);return r&&r.expiresAt>this.now()?r:null;}
 clear(key){this.keys.delete(key);}
 allowed(scope,pathname,taskId,active){if(pathname==='/api/socialV2/mark-read')return true;return active&&scope.taskId===taskId&&/^\/api\/socialV2\/companion\/xhh-dm-(?:read|send|finish)$/.test(pathname);}
}
function unavailable(){throw Error('当前公开分享版未包含此功能');}
export const XHH_DM_POLICY='';export const dmPage=()=>null;export const dmRows=()=>[];export const dmBarrier=()=>null;export class XiaoheiheDM{constructor(){this.config={enabled:false,auto:false};this.poll={};this.grants=new Map();this.busy=false;}active(){return false;}status(){return {config:this.config};}guardNavigation(){}guardWrite(){}cancel(){}async tick(){}configure(){unavailable();}prompt(){return '';}}