export function durableMemory(row){
 if(row.source!=='auto-learn'&&!/^(?:archive|diary)/.test(row.source||''))return true;
 if(/以后|每次|一直|长期|习惯/.test(row.content||''))return true;
 return !/停止指令|本次任务|当前任务|发帖操作分工/.test(row.subject||'');
}
