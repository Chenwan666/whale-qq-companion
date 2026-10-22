function unavailable(){throw Error('当前公开分享版未包含此功能');}
export class OneOffComment{constructor(){}observe(){}guard(e){if(e.args?.oneOffCommentId)unavailable();}clear(){}issue(){unavailable();}}