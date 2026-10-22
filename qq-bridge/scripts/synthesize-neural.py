"""Generate Chinese neural speech; no API key or secret is printed."""
import argparse
import asyncio
import sys
from pathlib import Path

import edge_tts


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text-file', required=True)
    parser.add_argument('--output-file', required=True)
    parser.add_argument('--voice', default='zh-CN-XiaoyiNeural')
    parser.add_argument('--rate', default='-6%')
    parser.add_argument('--pitch', default='+4Hz')
    args = parser.parse_args()
    text = Path(args.text_file).read_text(encoding='utf-8').strip()
    if not text or len(text) > 250:
        raise ValueError('Speech must contain 1 to 250 characters')
    await edge_tts.Communicate(text, args.voice, rate=args.rate, pitch=args.pitch).save(args.output_file)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        # WebSocket errors may include request tokens in their URL. Never print
        # the raw exception or traceback into bridge logs.
        code = 'HTTP_403' if getattr(error, 'status', None) == 403 else type(error).__name__
        print('VOICE_GENERATION_FAILED: ' + code, file=sys.stderr)
        sys.exit(1)
