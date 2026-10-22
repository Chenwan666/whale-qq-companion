// 安全版 Web Search / Fetch MCP server（stdio）。由 DSH 的 MCP 客户端 spawn。
//
// 安全设计：
// - 只暴露只读工具 `web_search` 与 `web_fetch`：多入口联网搜索、读取网页正文、解析B站短链。
// - 不暴露任何本地文件、命令执行、写操作。
// - 查询词做基础清洗：去 CQ 码、控制字符、超长截断。
// - `web_fetch` 仅允许 http/https：
//   - 禁止 URL 内嵌凭据；
//   - 禁止 localhost / .local / 私有 IP / 环回 / 链路本地 / CGNAT 等内网地址；
//   - 域名会先做 DNS 解析并检查全部解析结果，避免解析到内网；
//   - 手动跟随重定向，每一跳都重新校验；
//   - 响应体按字节流限量读取，避免超大响应拖垮进程。
// - 搜索结果/抓取结果仅作为“候选解释”，最终是否入库仍由控制台人工确认。
import {WebResearch,resolveBilibiliLink} from './web-research.js';
const research=new WebResearch();
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function sanitizeQuery(query) {
  return String(query ?? '')
    // 去掉 CQ 码（[CQ:xxx]）
    .replace(/\[CQ:[^\]]*\]/gi, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

const server = new McpServer({ name: 'web-search-safe', version: '0.2.0-r3' });
server.tool('bilibili_resolve','把用户提供的BV号、B站视频网址或b23.tv短链接解析为真实BV号和规范URL，供bilibili_video/subtitles/frames使用。不会播放、登录或下载视频。',{input:z.string().min(1).max(2000)},async({input})=>{try{return {content:[{type:'text',text:JSON.stringify(await resolveBilibiliLink(input))}]};}catch(e){return {content:[{type:'text',text:e.message}],isError:true};}});

server.tool(
  'web_search',
  '联网搜索：游戏攻略、最新资讯、技术资料、梗、网页和视频；360/Bing自动回退。返回真实来源链接、摘要和尝试记录。最新配队必须核对版本与来源日期，不能靠旧知识猜测。失败或empty-or-limited时可用qq_browser_search的sogou入口核验一次；B站banned是平台风控，不能靠扩大权限解决，不反复重试。',
  { query: z.string().min(1).max(200),count:z.number().int().min(1).max(10).default(6),domains:z.array(z.string()).max(5).default([]),freshness:z.enum(['any','day','week','month']).default('any') },
  async ({ query,...options }) => {
    const clean = sanitizeQuery(query);
    if (!clean) {
      return { content: [{ type: 'text', text: '查询词为空，已拒绝。' }], isError: true };
    }
    try {
      const result = await research.search(clean,options);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `搜索失败：${error?.message ?? error}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'web_fetch',
  '只读读取公开网页的标题、元数据与正文（最多18000字符，明确截断或访问限制），用于核对搜索来源。禁止内网和凭据。',
  { url: z.string().describe('要抓取的 http(s) URL') },
  async ({ url }) => {
    try {
      const result = await research.read(url);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `抓取失败：${error?.message ?? error}` }],
        isError: true,
      };
    }
  }
);

await server.connect(new StdioServerTransport());
