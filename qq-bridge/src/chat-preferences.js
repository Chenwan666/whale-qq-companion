import {randomUUID,randomInt} from 'node:crypto';

export class ChatPreferences {
  constructor(store,{settings=()=>({}),random=randomInt}={}){
    this.db=store.db;this.settings=settings;this.random=random;
    this.db.exec(`CREATE TABLE IF NOT EXISTS voice_catalog(id TEXT PRIMARY KEY,name TEXT NOT NULL,speaker TEXT NOT NULL,resource TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS voice_preferences(key TEXT PRIMARY KEY,voiceId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_defaults(key TEXT PRIMARY KEY,voiceId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_configs(key TEXT PRIMARY KEY,version INTEGER NOT NULL,createdAt INTEGER NOT NULL,lastSeenAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meme_cadence(key TEXT PRIMARY KEY,count INTEGER NOT NULL,target INTEGER NOT NULL);`);
  }
  next(){return this.random(5,11);}
  ensure(key){
    if(!/^(private|group):[1-9]\d*$/.test(String(key)))throw Error('配置会话无效');
    const now=Date.now();
    this.db.prepare('INSERT INTO conversation_configs VALUES(?,1,?,?) ON CONFLICT(key) DO UPDATE SET version=MAX(version,excluded.version),lastSeenAt=excluded.lastSeenAt').run(key,now,now);
    this.db.prepare("INSERT OR IGNORE INTO voice_preferences VALUES(?,'')").run(key);
    this.db.prepare('INSERT OR IGNORE INTO meme_cadence VALUES(?,0,?)').run(key,this.next());
  }
  cadence(key){this.ensure(key);const row=this.db.prepare('SELECT count,target FROM meme_cadence WHERE key=?').get(key);return {...row,due:row.count>=row.target};}
  textSent(key){this.cadence(key);this.db.prepare('UPDATE meme_cadence SET count=count+1 WHERE key=?').run(key);}
  memeSent(key){this.db.prepare('INSERT INTO meme_cadence VALUES(?,0,?) ON CONFLICT(key) DO UPDATE SET count=0,target=excluded.target').run(key,this.next());}
  fullVoices(){let s={};try{s=this.settings();}catch{}return [{id:'default',name:this.db.prepare("SELECT value FROM chat_settings WHERE key='originalVoiceName'").get()?.value||'原来的小鲸鱼音色',speaker:s.speaker||'',resource:s.resourceId||(String(s.speaker||'').startsWith('S_')?'seed-icl-2.0':'seed-tts-2.0'),enabled:1},...this.db.prepare('SELECT * FROM voice_catalog ORDER BY rowid').all()];}
  defaultSelection(key){const voices=this.fullVoices(),global=this.db.prepare("SELECT value FROM chat_settings WHERE key='defaultVoice'").get()?.value,local=this.db.prepare('SELECT voiceId FROM voice_defaults WHERE key=?').get(key)?.voiceId;return voices.find(v=>v.id===local&&v.enabled)||voices.find(v=>v.id===global&&v.enabled)||voices[0];}
  selection(key){const selected=this.db.prepare('SELECT voiceId FROM voice_preferences WHERE key=?').get(key)?.voiceId;return this.fullVoices().find(v=>v.id===selected&&v.enabled)||this.defaultSelection(key);}
  list(key){const selected=this.selection(key).id,defaultVoice=this.defaultSelection(key);return {selected,defaultId:defaultVoice.id,defaultName:defaultVoice.name,voices:this.fullVoices().filter(v=>v.enabled).map(({id,name})=>({id,name,current:id===selected}))};}
  resolve(key,value){value=String(value||'').trim();if(['默认','本群默认','本会话默认'].includes(value))return this.defaultSelection(key);const found=this.fullVoices().find(v=>v.enabled&&(v.id===value||v.name.toLocaleLowerCase()===value.toLocaleLowerCase()));if(!found)throw Error('音色不存在或已停用，请先查看音色列表');return found;}
  select(key,value){this.ensure(key);if(['默认','本群默认','本会话默认'].includes(String(value))){this.db.prepare("UPDATE voice_preferences SET voiceId='' WHERE key=?").run(key);return this.list(key);}const id=this.resolve(key,value).id;this.db.prepare('INSERT INTO voice_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET voiceId=excluded.voiceId').run(key,id);return this.list(key);}
  setDefault(key,value){const id=this.resolve(key||'',value).id;if(key){this.db.prepare('INSERT INTO voice_defaults VALUES(?,?) ON CONFLICT(key) DO UPDATE SET voiceId=excluded.voiceId').run(key,id);this.db.prepare('DELETE FROM voice_preferences WHERE key=?').run(key);}else{this.db.prepare("INSERT INTO chat_settings VALUES('defaultVoice',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);}return {key:key||'global',defaultId:id};}
  save({id,name,speaker,resource,enabled=true}){
    name=String(name||'').trim();speaker=String(speaker||'').trim();
    if(['默认','本群默认','本会话默认'].includes(name)||this.fullVoices().some(v=>v.id!==id&&v.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('音色名称重复或使用了保留名称，请换一个名字');
    if(!name||name.length>60||!/^[-_a-zA-Z0-9]{3,128}$/.test(speaker))throw Error('请填写音色名称和有效音色ID，不要填API Key');
    resource=resource||(speaker.startsWith('S_')?'seed-icl-2.0':'seed-tts-2.0');if(!['seed-icl-2.0','seed-tts-2.0'].includes(resource))throw Error('音色资源类型无效');
    if(id==='default'){this.db.prepare("INSERT INTO chat_settings VALUES('originalVoiceName',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(name);return {id,name,enabled:true};}
    if(id){if(!this.db.prepare('SELECT 1 FROM voice_catalog WHERE id=?').get(id))throw Error('没有这条可编辑音色');}else{id=randomUUID();}
    this.db.prepare('INSERT INTO voice_catalog VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,speaker=excluded.speaker,resource=excluded.resource,enabled=excluded.enabled').run(id,name,speaker,resource,enabled?1:0);
    return {id,name,enabled:!!enabled};
  }
}
