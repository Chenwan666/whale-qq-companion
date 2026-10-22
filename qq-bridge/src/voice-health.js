import fs from 'node:fs';
export class VoiceHealth {
  constructor(file,{now=Date.now,cooldownMs=600000}={}){this.file=file;this.now=now;this.cooldownMs=cooldownMs;this.data={state:'unknown',failures:0,retryAfter:0};try{const d=JSON.parse(fs.readFileSync(file,'utf8'));if(['ready','unavailable','unknown'].includes(d.state))this.data=d;}catch{}}
  status(){return {...this.data,coolingDown:this.data.state==='unavailable'&&this.now()<this.data.retryAfter,voice:'zh-CN-XiaoyiNeural'};}
  assertAvailable(){const s=this.status();if(s.coolingDown)throw Error(`晓伊在线服务暂不可用（${s.reason}），约${Math.ceil((s.retryAfter-this.now())/60000)}分钟后可再试；文字回复和语音识别正常。`);}
  save(){const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data)+'\n',{mode:0o600});fs.renameSync(temp,this.file);}
  failed(error){const reason=/403|HTTP_403/i.test(String(error?.stderr||error?.message||error))?'HTTP 403':'网络或合成失败';this.data={...this.data,state:'unavailable',reason,lastCheckedAt:this.now(),failures:(this.data.failures||0)+1,retryAfter:this.now()+this.cooldownMs};this.save();}
  succeeded(){this.data={state:'ready',failures:0,lastCheckedAt:this.now(),lastSuccessAt:this.now(),retryAfter:0};this.save();}
}
