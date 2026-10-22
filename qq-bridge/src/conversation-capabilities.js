import fs from 'node:fs';import path from 'node:path';
import {releaseEdition,editionAllows} from './release-edition.js';
export const CAPABILITIES={android:'手机操控',web:'网页读取与浏览',voice:'语音合成与发送',singing:'本地唱歌',singingOnline:'在线点歌找素材',files:'文件读取与发送',memory:'长期记忆与学习',memes:'表情包发送',proactive:'主动搭话'};
const ACTIONS={singingOnline:['song-search','song-select'],singing:['singing-start','singing-select','singing-import','singing-cancel'],web:['read-link','browser-state','browser-open','browser-search','browser-read','browser-screenshot','browser-click','browser-scroll','browser-back','music-playlist'],voice:['speak','voice-select','voice-delivery-status','voice-retry'],files:['file-list','file-download','file-receive','file-read','file-send'],memory:['remember','recall','forget','diary','archive','music-save-daily','music-feedback'],memes:['meme-send']};
export function actionCapability(action){if(action.startsWith('xhh-dm-'))return 'android';if(action.startsWith('browser-'))return 'web';if(action.startsWith('android-')&&action!=='android-config')return 'android';return Object.keys(ACTIONS).find(k=>ACTIONS[k].includes(action));}
export function routeCapability(route){
 if(route.startsWith('/api/socialV2/companion/'))return actionCapability(route.split('/').at(-1));
 if(/\/(send-voice|speak)$/.test(route))return 'voice';
 if(/\/(send-sticker|send-meme)$/.test(route))return 'memes';
 return null;
}
export class ConversationCapabilities{
 supported(feature){return editionAllows(releaseEdition(path.resolve(path.dirname(this.file),'../..')),feature);}
 constructor(root,getConfig){this.file=path.join(root,'conversation-capabilities.json');this.getConfig=getConfig;this.overrides=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{};}
 enabled(key,feature){if(!editionAllows(releaseEdition(path.resolve(path.dirname(this.file),'../..')),feature))return false;const cfg=this.getConfig();const value=this.overrides[key]?.[feature];if(typeof value==='boolean')return value;if(feature==='android')return key===`private:${cfg.ownerQQ}`||key.startsWith('group:');if(feature==='web')return key===`private:${cfg.ownerQQ}`;return true;}
 resolve(key){return Object.fromEntries(Object.keys(CAPABILITIES).map(f=>[f,this.enabled(key,f)]));}
 set(key,changes){if(!/^(private|group):[1-9]\d*$/.test(key))throw Error('会话格式无效');if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.entries(changes).some(([f,v])=>!Object.hasOwn(CAPABILITIES,f)||typeof v!=='boolean'))throw Error('只能修改已列出的功能布尔开关，管理员身份不可授予');const edition=releaseEdition(path.resolve(path.dirname(this.file),'../..'));if(Object.entries(changes).some(([f,v])=>v&&!editionAllows(edition,f)))throw Error('当前分享版不包含所选功能，不能通过权限开关启用');const next={...this.overrides,[key]:{...this.overrides[key],...changes}};const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(tmp,this.file);this.overrides=next;return this.resolve(key);}
 assert(key,feature){if(feature&&!this.enabled(key,feature))throw Error(`本会话的${CAPABILITIES[feature]}已关闭`);}
 assertAction(key,action){this.assert(key,actionCapability(action));}
 assertRoute(key,route){this.assert(key,routeCapability(route));}
}
