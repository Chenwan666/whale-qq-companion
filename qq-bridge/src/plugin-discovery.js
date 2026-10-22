// Reuse the reviewed community plugin behind the owner-only bridge endpoint.
// It can read public registries and write its public cache, but gets no host
// credential service, browser, shell, or plugin installation capability.
let discovery;
export async function discoverPlugins(query){
 query=String(query||'').trim();if(!query||query.length>200)throw Error('插件搜索词需要1～200字');
 if(!discovery){const {apply}=await import('../../qq-bridge-runtime/plugins-vendor/find-plugin/lib/index.js');apply({tools:{register:tool=>{discovery=tool;}},get:()=>undefined});}
 return discovery.execute({query,limit:5,lang:'zh'},{signal:AbortSignal.timeout(45000)});
}
