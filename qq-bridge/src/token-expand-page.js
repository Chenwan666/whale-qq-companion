export function expandPage(text,args={}) {
  const points=Array.from(text);
  const offset=Math.min(points.length,Math.max(0,Number.isSafeInteger(args.offset)?args.offset:0));
  const limit=Math.min(6000,Math.max(1,Number.isSafeInteger(args.limit)?args.limit:4000));
  const end=Math.min(points.length,offset+limit);
  return {text:points.slice(offset,end).join(''),offset,end,total:points.length,hasMore:end<points.length,nextOffset:end};
}
