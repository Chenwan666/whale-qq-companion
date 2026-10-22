import {Worker} from 'node:worker_threads';
export function isSilkBytes(b){return b.subarray(0,16).includes(Buffer.from('#!SILK_V3'));}
export function decodeSilkWav(buffer) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../scripts/decode-silk.mjs',import.meta.url),{workerData:buffer,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64}});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('QQ语音解码超时'));},15000);
    const done=()=>{clearTimeout(timer);worker.terminate();};
    worker.on('error',e=>{done();reject(e);});
    worker.on('message',r=>{done();if(r.error){reject(Error(r.error));return;}const pcm=Buffer.from(r.pcm),head=Buffer.alloc(44);head.write('RIFF');head.writeUInt32LE(36+pcm.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(24000,24);head.writeUInt32LE(48000,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40);resolve(Buffer.concat([head,pcm]));});
    worker.on('exit',code=>{if(code!==0){clearTimeout(timer);reject(Error('QQ语音解码进程退出'));}});
  });
}
