export const ONLINE_IMAGE_COLLECTION_POLICY='【网上图片自动收集】刷帖、按消息回复、按帖子回复时，遇到正文或评论区的表情包和普通内容图片都收集，不只挑有用或有趣的表情。仅处理实际遇到的内容图；头像、按钮和广告素材不当内容图。打开原图，使用实际保存图片入口；多图逐张保存或使用实际保存全部按钮，不拿截图、缩略图或cube代码冒充原图。先从当前原帖copy-link核对来源，再qq_android_media_list核对本次新增媒体ID，qq_surf_media_save(mediaIds=[真实ID列表],url=当前帖链接,excerpt=实际阅读摘录,description=图片说明)可一次导入本帖多张；一张也兼容mediaId。网页原图直链用qq_surf_image_save。不同帖子分开导入，老帖的新回复仍用老帖链接。图片在电脑待审核库真正保存后才算已收集，App提示保存成功不代表已导入电脑。重复图片合并，拒绝过的图片不反复入队；待审核及拒绝的图片不得发送或用于发帖配图，只有管理员在小窝审核通过后才能使用。不为收图切换消息/帖子回复模式，不改变本轮数量、时限或费用保护。单张保存入口受限、太大或失败时记录具体原因继续主任务，不反复尝试，不为凑数编造已保存。';

// Media IDs must already have been observed in this conversation by AndroidDevice.
// Keep successful imports when another image fails; no model is called here.
export function visibleImageCandidates(page){
 const nodes=(page?.nodes||[]).filter(n=>n.imageCandidate===true).filter(n=>{const b=(n.bounds?.match(/-?\d+/g)||[]).map(Number);return b.length===4&&b[2]>b[0]&&b[3]>b[1]&&b[0]>=0&&b[2]<=page.width&&b[1]>=0&&b[3]<=page.height;}).slice(0,16).map(({resourceId,bounds,text,description})=>({resourceId,bounds,text,description}));
 return nodes.length?{observationId:page.observationId,nodes,note:'实际界面中的内容图候选，按原图保存规则核对；候选不等于已保存，也不等于已经看过图像内容。'}:undefined;
}

export async function collectOnlineMedia({body,key,url,context,readMedia,collect,describe=String,now=Date.now}){
 const batch=body.mediaIds!==undefined;
 if(batch&&body.mediaId!==undefined)throw Error('mediaId和mediaIds请选择一种，不能混用');
 const ids=batch?body.mediaIds:[body.mediaId];
 if(!Array.isArray(ids)||!ids.length||ids.length>12||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('请使用媒体列表中的1～12个真实图片ID');
 const images=[],failures=[],deadline=now()+120000;
 for(const mediaId of new Set(ids)){
  try{
   if(now()>=deadline)throw Error('本次批量导入时限已到，剩余图片未导入');
   const result=await readMedia(mediaId);
   const saved=collect(Buffer.from(result.image.data,'base64'),{key,description:'网上收图：'+describe(body.description||result.name),sourceUrl:url,sourceKind:'online-browsing',collectionContext:context,sourceExcerpt:body.excerpt,androidMediaId:mediaId});
   images.push({...saved,mediaId,name:result.name});
  }catch(error){if(!batch)throw error;failures.push({mediaId,error:'图片取回或校验失败，未入库；先核对媒体ID、原图大小和当前App，不自动重试'});}
 }
 if(!batch)return {...images[0],sourceUrl:url,note:'已从安卓取回图片原文件，保存在电脑本地；pending为待审核，approved为以前已审核，rejected为以前已拒绝。不是截图，不会自动发送。'};
 return {images,failures,sourceUrl:url,pending:images.filter(r=>r.status==='pending').length,newImages:images.filter(r=>!r.alreadySaved).length,note:'逐张按真实文件校验并保存在电脑。每项status是实际审核状态，部分失败不抹掉成功项；未审核图片不自动发送。'};
}
