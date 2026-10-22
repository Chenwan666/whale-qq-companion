import {randomUUID} from 'node:crypto';
import {safeFetch} from './safe-fetch.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);

export class PluginReview{
 constructor(store,fetcher=safeFetch){this.store=store;this.fetcher=fetcher;store.db.exec('CREATE TABLE IF NOT EXISTS plugin_reviews(id TEXT PRIMARY KEY,repository TEXT,revision TEXT,goal TEXT,status TEXT,report TEXT,time INTEGER)');}
 async propose(repository,goal){
  const match=/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(repository));if(!match)throw Error('请提供明确的GitHub公开仓库首页，不接受命令、任意下载地址或登录凭据');
  const repo=match[1]+'/'+match[2];
  const json=async url=>{const r=await this.fetcher(url,300000);if(r.statusCode!==200||r.truncated)throw Error('GitHub资料未完整返回，不能形成可审查方案');return JSON.parse(r.body);};
  let metadata={name:match[2]},commit,sourceStatus='complete';
  try{metadata=await json('https://api.github.com/repos/'+repo);commit=await json('https://api.github.com/repos/'+repo+'/commits/'+encodeURIComponent(metadata.default_branch));}
  catch{const r=await exec('git',['ls-remote','https://github.com/'+repo+'.git','HEAD'],{windowsHide:true,timeout:20000,maxBuffer:16384});commit={sha:r.stdout.match(/^([a-f0-9]{40})\s+HEAD/m)?.[1]};sourceStatus='partial';}
  if(!/^[a-f0-9]{40}$/.test(commit.sha))throw Error('未取得可固定的真实版本');
  let pkg;try{pkg=await this.fetcher('https://raw.githubusercontent.com/'+repo+'/'+commit.sha+'/package.json',65536);}catch{pkg={statusCode:0};sourceStatus='partial';}
  const manifest=pkg.statusCode===200&&!pkg.truncated?JSON.parse(pkg.body):null;
  const report={repository:'https://github.com/'+repo,revision:commit.sha,sourceStatus,name:manifest?.name||metadata.name,version:manifest?.version||null,license:manifest?.license||metadata.license?.spdx_id||null,scripts:manifest?.scripts||{},dependencies:manifest?.dependencies||{},peerDependencies:manifest?.peerDependencies||{},needsCodeReview:true,needsCompatibilityTest:true,installAllowed:false,note:'这是待审查提案，未执行仓库代码、依赖脚本或安装。sourceStatus=partial时资料尚未完整取得。固定版本后仍需大管家审查代码与权限、真实测试、备份与回退；不能把资料扫描当安全批准。'};
  const id=randomUUID();this.store.db.prepare('INSERT INTO plugin_reviews VALUES(?,?,?,?,?,?,?)').run(id,report.repository,commit.sha,String(goal||'').slice(0,2000),'pending-review',JSON.stringify(report),Date.now());return {id,status:'pending-review',...report};
 }
 list(){return this.store.db.prepare('SELECT id,repository,revision,goal,status,time FROM plugin_reviews ORDER BY time DESC LIMIT 50').all();}
}
