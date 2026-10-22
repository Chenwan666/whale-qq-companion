export function imageToolResult(messageId,data){
 const images=Array.isArray(data?.images)?data.images:[],content=[],notes=[];
 for(const img of images){if(img?.data&&img?.mimeType){content.push({type:'image',mimeType:img.mimeType,data:img.data});notes.push(`实际取得${img.kind==='face'?'表情':'图片'}${img.index??''}${img.text?' '+img.text:''}`);}else notes.push(`图片${img?.index??''}未获取：${img?.text||'读取失败'}`);}
 const n=content.length;
 content.unshift({type:'text',text:`消息 ${messageId}：实际取得 ${n} 张图片。\n${notes.join('\n')||data?.note||'没有可读取的图片元数据'}${!n?'\n未下载/未返回图像不代表图片白屏、全白或透明；不要描述未取得的图，也不要反复要求用户重发同一张。应报告读取故障，网络恢复后读取原消息。':''}`});
 return {content,...(!n?{isError:true}:{})};
}
