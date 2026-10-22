import fs from 'node:fs';import path from 'node:path';
export function releaseEdition(root){
 const file=path.join(root,'release.json');
 if(!fs.existsSync(file))return {edition:'personal',features:{android:true,voice:true,singing:true,desktop:true}};
 const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!['lite','ultimate'].includes(data.edition))throw Error('分享版清单无效');
 return {edition:data.edition,features:{android:false,voice:data.edition==='ultimate',singing:false,desktop:false}};
}
export function editionAllows(edition,feature){return edition.features[feature==='singingOnline'?'singing':feature]!==false;}
export function editionActionFeature(action){
 if(/^(?:android-|xhh-dm-|comment-reply-|surf-|post-(?:capture|stage|handoff|editor|verify))/.test(action))return 'android';
 if(/^(?:speak|audio-read|voice-|voice-list|voice-select)/.test(action))return 'voice';
 if(/^(?:singing-|song-)/.test(action))return 'singing';
 if(/^(?:agent-task|extension-|upgrade-|plugin-)/.test(action))return 'desktop';
}
export function editionToolAllowed(edition,name){
 if(!edition.features.android&&/^qq_(?:android_|xhh_dm_|comment_reply_|surf_(?:start|stop|status|finish|media|image)|post_(?:capture|stage|handoff|editor|verify))/.test(name))return false;
 if(!edition.features.voice&&/^qq_(?:speak|voice_|send_voice|list_voices|audio_)/.test(name))return false;
 if(!edition.features.singing&&/^qq_(?:sing|song_|singing_)/.test(name))return false;
 if(!edition.features.desktop&&/^qq_(?:agent_task|upgrade_|extension_|plugin_)/.test(name))return false;
 return true;
}
