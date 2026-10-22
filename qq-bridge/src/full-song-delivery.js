// A file transport reset at byte zero is distinct from an ambiguous accepted upload.
// Only a successful read-back showing no matching new group file permits voice fallback.
export async function deliverFullSong({onebot,key,file,name,since,sendRecord,output='file'}){
 if(!['record','file'].includes(output))throw Error('发送方式必须为语音或文件');
 if(output==='record'){
  const result=await sendRecord(file);
  if(result?.message_id==null)throw Error('语音送达未确认，不自动重试');
  return {delivery:'record',messageId:result.message_id};
 }
 const [kind,id]=key.split(':');
 try{
  const result=await onebot(kind==='group'?'upload_group_file':'upload_private_file',{[kind==='group'?'group_id':'user_id']:Number(id),file,name,...(kind==='private'?{upload_file:true}:{})});
  if(!result?.file_id)throw Error('QQ没有返回文件ID，整首文件送达待核实');
  return {delivery:'file',fileId:result.file_id};
 }catch(error){
  if(kind!=='group'||!/highway upload transport failed[\s\S]*cmdId=71[\s\S]*offset=0\)/i.test(error.message))throw error;
  const check=await onebot('get_group_root_files',{group_id:Number(id)});
  if(!Array.isArray(check?.files)||check.files.some(f=>(f.file_name||f.name)===name&&(!f.upload_time||Number(f.upload_time)*1000>=since-60000)))throw Error('文件结果未能排除已上传，不自动补发');
  const result=await sendRecord(file);
  if(result?.message_id==null)throw Error('整首语音送达未确认，不自动重试');
  return {delivery:'record',messageId:result.message_id,fileUploadFailed:true};
 }
}
