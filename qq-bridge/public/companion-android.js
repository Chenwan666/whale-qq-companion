function renderWhaleGuide(text){
 const root=document.createElement('article');root.className='content';
 function inline(node,value){
  const pattern=/(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;let start=0;
  for(const match of value.matchAll(pattern)){
   node.append(document.createTextNode(value.slice(start,match.index)));
   let item;
   if(match[2]){item=document.createElement('strong');item.textContent=match[2];}
   else if(match[3]){item=document.createElement('code');item.textContent=match[3];}
   else {item=document.createElement(/^https?:\/\//.test(match[5])?'a':'span');item.textContent=match[4];if(item.tagName==='A'){item.href=match[5];item.target='_blank';item.rel='noopener noreferrer';}}
   node.append(item);start=match.index+match[0].length;
  }
  node.append(document.createTextNode(value.slice(start)));
 }
 const lines=text.split(/\r?\n/);let list=null;
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();if(!line){list=null;continue;}
  if(line.startsWith('|')&&lines[i+1]?.trim().match(/^\|[\s:|-]+\|$/)){
   const wrap=document.createElement('div');wrap.style.overflowX='auto';const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse;margin:12px 0';
   const row=(value,head)=>{const tr=document.createElement('tr');for(const cell of value.replace(/^\||\|$/g,'').split('|')){const td=document.createElement(head?'th':'td');td.style.cssText='padding:10px;text-align:left;border-bottom:1px solid #d9eaf4;min-width:90px';inline(td,cell.trim());tr.append(td);}table.append(tr);};
   row(line,true);i+=2;while(i<lines.length&&lines[i].trim().startsWith('|'))row(lines[i++].trim(),false);i--;wrap.append(table);root.append(wrap);list=null;continue;
  }
  const heading=line.match(/^(#{1,3})\s+(.+)$/),entry=line.match(/^(?:([-])|\d+\.)\s+(.+)$/);
  if(heading){const h=document.createElement('h'+Math.min(heading[1].length+1,4));inline(h,heading[2]);root.append(h);list=null;}
  else if(entry){const tag=entry[1]?'UL':'OL';if(!list||list.tagName!==tag){list=document.createElement(tag);root.append(list);}const li=document.createElement('li');li.style.marginBottom='8px';inline(li,entry[2]);list.append(li);}
  else{const p=document.createElement('p');inline(p,line);root.append(p);list=null;}
 }
 return root;
}
async function renderAndroidDevice({panel,make}){panel.replaceChildren(make('p','公开分享版不包含手机功能。'));}
