export function isOwnerConversation(key,ownerQQ){return String(key)===`private:${ownerQQ}`;}
export function selectAudienceRole(key,ownerQQ,ownerText,externalText){
  if(!key||isOwnerConversation(key,ownerQQ))return ownerText;
  return externalText||'你是小鲸鱼，正在与初次认识的人聊天。礼貌、轻松地认识对方，不称对方为管理员，不透露其他会话资料，不执行电脑或账号操作。';
}
