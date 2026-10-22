"""Bounded, read-only document/archive inspection. Never execute uploaded files."""
import argparse, io, json, pathlib, sys, zipfile, xml.etree.ElementTree as ET

LIMIT = 8 * 1024 * 1024
TEXT_TYPES = {'.txt', '.md', '.csv', '.json', '.log', '.yaml', '.yml', '.xml', '.html', '.htm', '.ini', '.srt', '.lrc'}

def safe_name(name):
    p = pathlib.PurePosixPath(name.replace('\\', '/'))
    return not p.is_absolute() and '..' not in p.parts and ':' not in name and '\x00' not in name

def validate(entries):
    if len(entries) > 500 or sum(x['bytes'] for x in entries) > 100 * 1024 * 1024:
        raise ValueError('压缩包目录超过500项或解压总量超过100MB')
    if any(not safe_name(x['name']) for x in entries):
        raise ValueError('压缩包包含不安全路径，未解压')

def zip_entries(z):
    entries = [{'name': x.filename, 'bytes': x.file_size, 'directory': x.is_dir(), 'encrypted': bool(x.flag_bits & 1)} for x in z.infolist()]
    validate(entries)
    if any(x.file_size > max(1, x.compress_size) * 200 for x in z.infolist()):
        raise ValueError('压缩比过高，未解压')
    return entries

def document(data, name):
    ext = pathlib.Path(name).suffix.lower()
    if ext in TEXT_TYPES:
        for encoding in ('utf-8-sig', 'utf-16', 'gb18030'):
            try:
                text = data.decode(encoding)
                if '\x00' in text: continue
                return {'format': ext[1:], 'text': text}
            except UnicodeError: pass
        raise ValueError('未能识别文本编码')
    if ext == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted: raise ValueError('PDF加密，需要无密码副本')
        if len(reader.pages) > 300: raise ValueError('PDF超过300页，请拆分')
        pages = [f'【第{i+1}页】\n{p.extract_text() or ""}' for i,p in enumerate(reader.pages)]
        has_text = any((p.extract_text() or '').strip() for p in reader.pages)
        return {'format': 'pdf', 'pages': len(pages), 'text': '\n\n'.join(pages) if has_text else '', 'note': '' if has_text else '扫描或图片PDF没有可提取文字，尚未进行OCR，不能声称已读懂正文'}
    if ext in ('.docx', '.pptx', '.xlsx', '.odt'):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            zip_entries(z)
            names = z.namelist()
            if ext == '.docx': selected = [n for n in names if n == 'word/document.xml' or n.startswith(('word/header','word/footer')) and n.endswith('.xml')]
            elif ext == '.pptx': selected = sorted(n for n in names if n.startswith('ppt/slides/slide') and n.endswith('.xml'))
            elif ext == '.xlsx': selected = [n for n in names if n == 'xl/sharedStrings.xml' or n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
            else: selected = ['content.xml']
            if not selected: raise ValueError('文档缺少正文结构')
            text = []
            for n in selected:
                info = z.getinfo(n)
                if info.file_size > LIMIT: raise ValueError('文档正文超过8MB')
                raw = z.read(n)
                if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('不支持含DTD的文档')
                tree = ET.fromstring(raw)
                text.append('【'+n+'】\n'+'\n'.join(e.text for e in tree.iter() if e.tag.split('}')[-1] in ('t','v','p') and e.text))
            return {'format': ext[1:], 'text': '\n\n'.join(text), 'note': '提取正文文字和表格单元文字，未解析图片；电子表格公式与单元格布局未还原' if ext == '.xlsx' else '提取实际文字；未执行宏或文档链接，未识别内嵌图片'}
    if ext == '.doc': raise ValueError('旧版DOC二进制格式暂不能可靠提取，请另存为DOCX或PDF；文件仍可下载转发')
    raise ValueError('该格式可保存转发，暂不支持正文读取')

def inspect(data, name, member):
    ext = pathlib.Path(name).suffix.lower()
    if ext not in ('.zip','.7z','.rar'): 
        if member: raise ValueError('该文件不是压缩包')
        return document(data,name)
    if ext == '.zip':
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            entries = zip_entries(z)
            if not member: return {'format':'zip','entries':entries,'text':'','note':'仅列目录，指定member后可读取其中支持的文档；不执行文件'}
            item = next((x for x in entries if x['name']==member),None)
            if not item or item['directory'] or item['encrypted'] or item['bytes']>LIMIT: raise ValueError('成员不存在、加密、是目录或超过8MB')
            return {**document(z.read(member),member),'member':member}
    if ext == '.7z':
        import py7zr
        from py7zr.io import BytesIOFactory
        with py7zr.SevenZipFile(io.BytesIO(data),'r') as z:
            if z.needs_password(): raise ValueError('7z加密，需要无密码副本')
            entries=[{'name':x.filename,'bytes':x.uncompressed or 0,'directory':x.is_directory} for x in z.list()]
            validate(entries)
            if not member: return {'format':'7z','entries':entries,'text':'','note':'仅列目录；不执行文件'}
            item=next((x for x in entries if x['name']==member),None)
            if not item or item['directory'] or item['bytes']>LIMIT: raise ValueError('成员不存在、是目录或超过8MB')
            factory=BytesIOFactory(LIMIT);z.extract(targets=[member],factory=factory)
            product=factory.get(member);product.seek(0)
            return {**document(product.read(),member),'member':member}
    import rarfile
    system_tar=pathlib.Path('C:/Windows/System32/tar.exe')
    if system_tar.exists(): rarfile.BSDTAR_TOOL=str(system_tar)
    with rarfile.RarFile(io.BytesIO(data)) as z:
        entries=[{'name':x.filename,'bytes':x.file_size,'directory':x.isdir(),'encrypted':x.needs_password()} for x in z.infolist()]
        validate(entries)
        if not member: return {'format':'rar','entries':entries,'text':'','note':'仅列目录；读取成员还取决于本机RAR解码器，不执行文件'}
        item=next((x for x in entries if x['name']==member),None)
        if not item or item['directory'] or item['encrypted'] or item['bytes']>LIMIT: raise ValueError('成员不存在、加密、是目录或超过8MB')
        return {**document(z.read(member),member),'member':member}

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--name',required=True);p.add_argument('--member');p.add_argument('--offset',type=int,default=0);p.add_argument('--limit',type=int,default=12000)
    a=p.parse_args()
    try:
        if pathlib.Path(a.input).stat().st_size>20*1024*1024: raise ValueError('文件超过20MB')
        result=inspect(pathlib.Path(a.input).read_bytes(),a.name,a.member)
        text=result.get('text','');limit=max(1,min(12000,a.limit));offset=max(0,a.offset)
        result.update(text=text[offset:offset+limit],totalCharacters=len(text),offset=offset,hasMore=offset+limit<len(text))
        if len(text)>2_000_000: raise ValueError('正文过长，请拆分文件')
        print(json.dumps(result,ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error':str(e)[:300]},ensure_ascii=False));sys.exit(1)
