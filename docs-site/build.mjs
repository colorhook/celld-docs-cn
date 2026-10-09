import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import hljs from 'highlight.js';

export const siteRoot = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.dirname(siteRoot);
export const outDir = path.join(siteRoot, 'dist');
export const pages = [
  ['README.md', '概览'], ['cloudflare-compat.md', 'Cloudflare 兼容性'],
  ['limitations.md', '限制'], ['security.md', '安全'], ['telemetry.md', '遥测'],
  ['testing.md', '测试'], ['wasm.md', 'WebAssembly'], ['guarantees.md', 'celld 的保证'],
  ['services/containers.md', 'Containers · 容器'], ['services/cron-triggers.md', '定时触发器'],
  ['services/d1.md', 'D1'], ['services/durable-object-facets.md', 'Durable Object 子对象'],
  ['services/durable-objects.md', 'Durable Objects / 单元'], ['services/dynamic-workers.md', '动态 Workers'],
  ['services/kv.md', 'KV'], ['services/queues.md', 'Queues · 消息队列'], ['services/r2.md', 'R2'],
  ['services/static-assets.md', '静态资源'], ['services/workers.md', 'Workers'],
  ['services/workflows.md', 'Workflows · 工作流'],
];
export const pageUrl = name => '/' + (name === 'README.md' ? '' : name.replace(/\.md$/, '/'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function linkUrl(href, file) {
  if (/^(?:https?:|mailto:|#)/.test(href)) return href;
  const [pathname, hash] = href.split('#');
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname));
  if (pages.some(([name]) => name === target)) return pageUrl(target) + (hash ? '#' + hash : '');
  if (pathname.endsWith('.svg')) return '/' + target;
  // Example links stay local, with the original repository available in the header.
  if (target.startsWith('../examples/')) {
    const name=target.slice('../examples/'.length);exampleNames.add(name);
    return '/examples/' + name + '/';
  }
  throw new Error(`无法解析文档链接：${file} → ${href}`);
}
const language = name => ({js:'javascript',py:'python',rs:'rust',jsonc:'json',toml:'toml',html:'xml'})[name.split('.').pop()] || (name === 'Dockerfile' ? 'dockerfile' : 'plaintext');
const commentTranslations = JSON.parse(await fs.readFile(path.join(siteRoot,'example-comments.json'),'utf8'));
function translateComments(code) {
 return code.split('\n').map(line => {
  const text=line.trimStart();
  return commentTranslations[text] ? line.slice(0,line.length-text.length)+commentTranslations[text] : line;
 }).join('\n');
}
async function exampleFiles(name) {
  const base = path.join(repoRoot, 'examples', name);
  const candidates = ['wrangler.jsonc','package.json','index.js','src/entry.py','pyproject.toml','Dockerfile','server.py','src/lib.rs','Cargo.toml','public/index.html','public/_headers','public/_redirects'];
  const found = [];
  for (const file of candidates) {
    try { found.push([file, translateComments(await fs.readFile(path.join(base,file),'utf8'))]); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  if (!found.length) throw new Error(`示例不存在：${name}`);
  return found;
}
const exampleNames = new Set();
await fs.rm(outDir,{recursive:true,force:true});
await fs.mkdir(outDir,{recursive:true});
for (const file of ['style.css','client.js']) await fs.copyFile(path.join(siteRoot,file),path.join(outDir,file));
await fs.copyFile(path.join(siteRoot,'node_modules/highlight.js/styles/github.css'),path.join(outDir,'highlight.css'));
await fs.copyFile(path.join(siteRoot,'node_modules/highlight.js/styles/github-dark.css'),path.join(outDir,'highlight-dark.css'));
await fs.mkdir(path.join(outDir,'services'),{recursive:true});
for (const name of ['workers-flow.svg','static-assets-flow.svg']) await fs.copyFile(path.join(repoRoot,'docs/services',name),path.join(outDir,'services',name));

function navigation(current) {
  return pages.map(([name,title],i) => (i===8 ? '<div class="nav-label">服务</div>' : '') + `<a href="${pageUrl(name)}"${current===name?' class="current" aria-current="page"':''}>${esc(title)}</a>`).join('');
}
function shell(title,current,article,toc=[],pager='',canonicalPath=current ? pageUrl(current) : null) {
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="celld v0.6.2 中文文档：自托管 Workers、Durable Objects 与有状态分布式系统。"><title>${esc(title)} · celld 中文文档</title>${canonicalPath ? `<link rel="canonical" href="https://celld.genhub.me${esc(canonicalPath)}">` : ''}<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2310803f'/%3E%3Ctext x='18' y='46' fill='white' font-size='48' font-family='monospace'%3Ec%3C/text%3E%3C/svg%3E"><link rel="stylesheet" href="/highlight.css" media="(prefers-color-scheme: light)"><link rel="stylesheet" href="/highlight-dark.css" media="(prefers-color-scheme: dark)"><link rel="stylesheet" href="/style.css"><script src="/client.js" defer></script></head><body><a class="skip" href="#main">跳到正文</a><header><a class="brand" href="/">celld<span>中文文档</span></a><span class="version">v0.6.2</span><div class="header-actions"><button id="search-open" aria-label="搜索文档">搜索文档 <kbd>⌘ K</kbd></button><a href="https://github.com/colorhook/celld-docs-cn" target="_blank" rel="noreferrer">GitHub ↗</a><button id="menu" aria-expanded="false" aria-controls="sidebar">目录</button></div></header><div class="layout"><aside id="sidebar" aria-label="文档导航"><div class="nav-label">文档</div><nav>${navigation(current)}</nav><div class="sidebar-footer">自托管的有状态运行时<br><a href="https://celld.dev/docs/" target="_blank" rel="noreferrer">原版文档 ↗</a></div></aside><main id="main"><div class="eyebrow">${current?.startsWith('services/')?'服务 / 参考文档':'文档 / 入门与运行'}</div><article>${article}</article>${pager}<footer>celld v0.6.2 · 简体中文文档<br>产品名、API、命令与示例代码保留原始写法。</footer></main><aside class="toc" aria-label="本页目录"><div class="nav-label">本页内容</div>${toc.map(item=>`<a href="#${esc(item.id)}" class="depth-${item.depth}">${esc(item.text)}</a>`).join('')}</aside></div><dialog id="search-dialog"><div class="search-top"><label class="sr-only" for="search-input">搜索全部文档</label><input id="search-input" type="search" placeholder="搜索全部中文文档…" autocomplete="off"><button id="search-close" aria-label="关闭搜索">关闭</button></div><div id="search-results" aria-live="polite"><p>输入关键词，搜索 20 篇中文文档。</p></div><div class="search-hint">支持中文术语、API 与环境变量 · Esc 关闭</div></dialog></body></html>`;
}
const index=[];
for (let i=0;i<pages.length;i++) {
 const [file,title]=pages[i];
 let source=await fs.readFile(path.join(repoRoot,'docs',file),'utf8');
 const headings=[...source.matchAll(/<a id="([^"]+)"><\/a>\s*\n(#{1,6}) (.+)/g)].map(m=>({id:m[1],depth:m[2].length,text:m[3].replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/`/g,'')}));
 source=source.replace(/<a id="[^"]+"><\/a>\s*\n/g,'');
 const matches=[...source.matchAll(/<!-- celld-example: ([\w-]+) -->/g)];
 for (const match of matches) {
   const name=match[1];exampleNames.add(name);
   const files=await exampleFiles(name);
   const code=files.map(([name,content])=>`<h3 class="example-file">${esc(name)}</h3>\n\n\`\`\`${language(name)}\n${content.trimEnd()}\n\`\`\``).join('\n\n');
   source=source.replace(match[0],code);
 }
 let headingIndex=0;
 const renderer={
   heading({depth,tokens}) {
     const h=headings[headingIndex++];
     if(!h || h.depth!==depth) throw new Error(`标题结构不匹配：${file}`);
     return `<h${depth} id="${esc(h.id)}">${this.parser.parseInline(tokens)}${depth>1?`<a class="heading-link" href="#${esc(h.id)}" aria-label="链接到此章节">#</a>`:''}</h${depth}>\n`;
   },
   code({text,lang}) {
     const selected=hljs.getLanguage(lang)?lang:'plaintext';
     return `<div class="code-block"><div class="code-toolbar"><span>${esc(lang||'代码')}</span><button class="copy-code" aria-label="复制代码">复制</button></div><pre><code class="hljs language-${esc(selected)}">${hljs.highlight(text,{language:selected}).value}</code></pre></div>\n`;
   },
   link({href,title,tokens}) {
     const url=linkUrl(href,file);
     return `<a href="${esc(url)}"${title?` title="${esc(title)}"`:''}${/^https?:/.test(url)?' target="_blank" rel="noreferrer"':''}>${this.parser.parseInline(tokens)}</a>`;
   },
   image({href,text}) { return `<img src="${esc(linkUrl(href,file))}" alt="${esc(text)}" loading="lazy">`; },
 };
 const markdown=new Marked();
 markdown.use({renderer,gfm:true});
 let article=markdown.parse(source);
 article=article.replace(/<table>[\s\S]*?<\/table>/g,html=>`<div class="table-scroll">${html}</div>`);
 if(headingIndex!==headings.length) throw new Error(`未渲染全部标题：${file}`);
 const previous=pages[i-1],next=pages[i+1];
 const pager=`<nav class="pager" aria-label="前后文档">${previous?`<a href="${pageUrl(previous[0])}"><small>← 上一篇</small>${esc(previous[1])}</a>`:'<span></span>'}${next?`<a href="${pageUrl(next[0])}"><small>下一篇 →</small>${esc(next[1])}</a>`:''}</nav>`;
 const dir=path.join(outDir,pageUrl(file));
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'index.html'),shell(title,file,article,headings.filter(h=>h.depth>1),pager));
 const plain=article.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').replace(/&[a-z]+;/g,' ');
 index.push({title,url:pageUrl(file),text:plain,headings});
}
for(const name of exampleNames) {
 const files=await exampleFiles(name);
 let article=`<h1>${esc(name)} 示例源码</h1><p>这些文件来自仓库的 <code>examples/${esc(name)}</code>，可结合对应中文文档阅读和运行。</p>`;
 for (const [file,content] of files) article+=`<h2>${esc(file)}</h2><div class="code-block"><div class="code-toolbar"><span>${esc(language(file))}</span><button class="copy-code">复制</button></div><pre><code class="hljs">${hljs.highlight(content,{language:language(file)}).value}</code></pre></div>`;
 const dir=path.join(outDir,'examples',name);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'index.html'),shell(`${name} 示例`,null,article,[],'',`/examples/${name}/`));
}
await fs.writeFile(path.join(outDir,'search-index.json'),JSON.stringify(index));
await fs.copyFile(path.join(siteRoot,'_redirects'),path.join(outDir,'_redirects'));
await fs.writeFile(path.join(outDir,'404.html'),shell('页面未找到',null,'<h1>页面未找到</h1><p>这个地址没有对应的文档。</p><p><a href="/">返回文档首页</a></p>'));
console.log(`已构建 ${pages.length} 篇中文文档、${exampleNames.size} 个示例与 2 张流程图。`);
