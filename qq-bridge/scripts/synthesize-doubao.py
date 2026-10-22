"""Doubao HTTP streaming TTS; credentials stay in the local settings file."""
import argparse
import asyncio
import base64
import json
import sys
import uuid
from pathlib import Path
import aiohttp

async def main():
    p=argparse.ArgumentParser()
    p.add_argument('--settings-file',required=True)
    p.add_argument('--text-file',required=True)
    p.add_argument('--output-file',required=True)
    p.add_argument('--speaker')
    p.add_argument('--resource-id',choices=['seed-icl-2.0','seed-tts-2.0'])
    args=p.parse_args()
    config=json.loads(Path(args.settings_file).read_text(encoding='utf-8-sig'))
    text=Path(args.text_file).read_text(encoding='utf-8-sig').strip()
    if not text or len(text)>250: raise ValueError('TEXT_LENGTH')
    key=config.get('apiKey','')
    speaker=args.speaker or config.get('speaker','')
    if not key or not speaker: raise ValueError('MISSING_SETTINGS')
    clone=speaker.startswith('S_')
    resource=args.resource_id or config.get('resourceId') or ('seed-icl-2.0' if clone else 'seed-tts-2.0')
    params={'text':text,'speaker':speaker,'audio_params':{'format':'mp3','sample_rate':24000,'speech_rate':int(config.get('speechRate',0))}}
    if clone: params['model']=config.get('model','seed-tts-2.0-standard')
    headers={'X-Api-Key':key,'X-Api-Resource-Id':resource,'X-Api-Request-Id':str(uuid.uuid4()),'Content-Type':'application/json'}
    chunks=[]
    def packet(raw):
        obj=json.loads(raw)
        detail=obj.get('header') or obj
        code=detail.get('code',0)
        if code not in (0,20000000):
            message=str(detail.get('message','')).replace(key,'[redacted]')[:160]
            raise RuntimeError(f'SERVICE_{code}: {message}')
        if obj.get('data'): chunks.append(base64.b64decode(obj['data'],validate=True))
    async with aiohttp.ClientSession(trust_env=True,timeout=aiohttp.ClientTimeout(total=45)) as session:
        async with session.post('https://openspeech.bytedance.com/api/v3/tts/unidirectional',headers=headers,json={'req_params':params}) as response:
            if response.status!=200:
                try:
                    obj=await response.json(content_type=None)
                    detail=obj.get('header') or obj
                    message=str(detail.get('message',detail.get('error','request rejected'))).replace(key,'[redacted]')[:160]
                except Exception: message='request rejected'
                raise RuntimeError(f'HTTP_{response.status}: {message}')
            pending=b''
            size=0
            async for chunk in response.content.iter_chunked(16384):
                size+=len(chunk)
                if size>12*1024*1024: raise ValueError('AUDIO_TOO_LARGE')
                pending+=chunk
                while b'\n' in pending:
                    line,pending=pending.split(b'\n',1)
                    if line.strip(): packet(line)
            if pending.strip(): packet(pending)
    data=b''.join(chunks)
    if not data: raise ValueError('EMPTY_AUDIO')
    Path(args.output_file).write_bytes(data)
    print(json.dumps({'ok':True,'bytes':len(data),'engine':'doubao','resource':resource}))

if __name__=='__main__':
    try: asyncio.run(main())
    except Exception as error:
        message=str(error) if isinstance(error,(RuntimeError,ValueError)) else type(error).__name__
        print('DOUBAO_GENERATION_FAILED: '+message,file=sys.stderr)
        sys.exit(1)
