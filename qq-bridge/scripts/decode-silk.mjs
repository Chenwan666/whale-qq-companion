import {parentPort,workerData} from 'node:worker_threads';
import {decode,getDuration} from 'silk-wasm';
try {
  const input=new Uint8Array(workerData);
  const duration=getDuration(input);
  if(!Number.isFinite(duration)||duration<=0||duration>120000)throw Error('QQ语音仅支持120秒内的SILK音频');
  const result=await decode(input,24000);
  if(result.data.length>24000*2*121)throw Error('语音解码结果超限');
  parentPort.postMessage({pcm:result.data,duration});
}catch(error){parentPort.postMessage({error:error.message});}
