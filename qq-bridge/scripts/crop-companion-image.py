import argparse,json
from io import BytesIO
from pathlib import Path
from PIL import Image
Image.MAX_IMAGE_PIXELS=16000000
p=argparse.ArgumentParser()
p.add_argument('--input',required=True)
p.add_argument('--output',required=True)
for name in ('x','y','width','height'): p.add_argument('--'+name,type=int,required=True)
a=p.parse_args()
with Image.open(a.input) as im:
    if im.width*im.height>16000000: raise ValueError('IMAGE_TOO_LARGE')
    if min(a.x,a.y)<0 or min(a.width,a.height)<1 or a.x+a.width>im.width or a.y+a.height>im.height: raise ValueError('CROP_OUT_OF_BOUNDS')
    output=BytesIO()
    im.convert('RGBA').crop((a.x,a.y,a.x+a.width,a.y+a.height)).save(output,format='PNG')
    data=output.getvalue()
    if len(data)>4*1024*1024: raise ValueError('CROP_TOO_LARGE')
    Path(a.output).write_bytes(data)
    print(json.dumps({'width':a.width,'height':a.height,'bytes':len(data)}))
