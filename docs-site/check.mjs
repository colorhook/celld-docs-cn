import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { pages, pageUrl, repoRoot, outDir } from './build.mjs';

const sourceCommit='90b43017241f81189453d326d05948f388b34652';
const markdown=new Marked();
const collect=(tokens,type)=>{
 let count=0;
 for(const token of tokens){
  if(token.type===type)count++;
  if(token.tokens)count+=collect(token.tokens,type);
  if(token.items)for(const item of token.items)count+=collect([item],type);
 }
 return count;
};
const codeBlocks=source=>[...source.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map(m=>m[1].replace(/^-- .*\n/gm,''));
const clean=source=>source.replace(/^```[^\n]*\n[\s\S]*?^```/gm,'').replace(/<!--.*?-->/gs,'').replace(/<a id="[^"]+"><\/a>/g,'');
let headingCount=0,codeCount=0,checkedLinks=0;
const htmlCache=new Map();
async function htmlAt(url){
 const name=path.join(outDir,url.endsWith('/')?url+'index.html':url);
 if(!htmlCache.has(name))htmlCache.set(name,await fs.readFile(name,'utf8'));
 return htmlCache.get(name);
}
for(const [name] of pages){
 const source=await fs.readFile(path.join(repoRoot,'docs',name),'utf8');
 const original=execFileSync('git',['show',`${sourceCommit}:docs/${name}`],{cwd:repoRoot,encoding:'utf8'});
 const oldTokens=markdown.lexer(original),newTokens=markdown.lexer(clean(source));
 const oldHeadings=oldTokens.filter(t=>t.type==='heading');
 const newHeadings=newTokens.filter(t=>t.type==='heading');
 assert.equal(newHeadings.length,oldHeadings.length,`${name} 标题遗漏`);
 assert.deepEqual(codeBlocks(source),codeBlocks(original),`${name} 可执行代码发生变化`);
 // Retain every list item and every table row from the source documentation.
 assert.equal(collect(newTokens,'list_item'),collect(oldTokens,'list_item'),`${name} 列表项遗漏`);
 const tableRows=tokens=>tokens.filter(t=>t.type==='table').map(t=>t.rows.length);
 assert.deepEqual(tableRows(newTokens),tableRows(oldTokens),`${name} 表格行遗漏`);
 assert(!/@@CODE_\d+@@/.test(source),`${name} 存在占位符`);
 assert(/[\u4e00-\u9fff]/.test(source),`${name} 未翻译`);
 const prose=clean(source).replace(/`[^`]*`/g,'').replace(/\]\([^)]*\)/g,']');
 assert(!/\b(?:The|This|Each|Every|celld)\s+(?:is|has|runs|keeps|does|can|accepts|returns|stores|reads|writes|provides|makes|sets|enforces)\b/.test(prose),`${name} 残留英文正文`);
 const html=await htmlAt(pageUrl(name));
 assert(html.includes('lang="zh-CN"')&&html.includes('中文文档'),`${name} 页面语言错误`);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,`${name} 重复锚点`);
 for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const href=match[1].replace(/&amp;/g,'&');
  if(/^(?:https?:|data:|mailto:)/.test(href))continue;
  const [pathname,fragment]=href.split('#');
  const targetUrl=pathname||pageUrl(name);
  if(path.extname(targetUrl)&&!targetUrl.endsWith('.html')){await fs.access(path.join(outDir,targetUrl));}
  else{
   const target=await htmlAt(targetUrl);
   if(fragment)assert(target.includes(`id="${decodeURIComponent(fragment)}"`),`${name} 链接锚点不存在：${href}`);
  }
  checkedLinks++;
 }
 headingCount+=newHeadings.length;codeCount+=codeBlocks(source).length;
}
const index=JSON.parse(await fs.readFile(path.join(outDir,'search-index.json'),'utf8'));
assert.equal(index.length,pages.length);
assert(index.some(p=>p.text.includes('所有权')));
assert.deepEqual(index.map(p=>p.url),pages.map(([name])=>pageUrl(name)), '搜索结果未使用最新文档路径');
assert.equal(pageUrl('README.md'), '/', '首页必须位于网站根路径');
assert((await htmlAt('/')).includes('<h1 id="celld">'), '根路径未包含概览正文');
assert(!(await htmlAt('/')).includes('http-equiv="refresh"'), '首页不能跳转到 /docs');
for(const [name] of pages) {
 const html=await htmlAt(pageUrl(name));
 assert(!/(?:href|src)="\/docs(?:\/|")/.test(html), `${name} 残留 /docs 链接`);
}
await fs.access(path.join(outDir, '404.html'));
assert((await fs.readFile(path.join(outDir,'_redirects'),'utf8')).includes('/docs/* /:splat 301'), '缺少旧文档地址跳转');
const report={sourceCommit,pages:pages.length,headings:headingCount,codeBlocks:codeCount,internalLinks:checkedLinks,checks:['标题数量完整','列表项完整','表格行完整','代码保留（仅翻译 SQL 注释）','无占位符或未翻译英文正文','无重复锚点','所有本地链接和章节锚点有效','搜索索引包含全部文档']};
await fs.writeFile(path.join(repoRoot,'docs-site','validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
