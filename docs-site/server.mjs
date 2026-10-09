import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const port=Number(process.env.PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try {
   if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
   const url=new URL(req.url,'http://localhost');
   const name=decodeURIComponent(url.pathname);
   if(name==='/docs'||name.startsWith('/docs/')) {
     const destination=(name==='/docs'?'/' : name.slice('/docs'.length))+url.search;
     res.writeHead(301,{Location:destination});res.end();return;
   }
   let file=path.resolve(root,'.'+name);
   if(!file.startsWith(root+path.sep)&&file!==root) {res.writeHead(403);res.end();return;}
   const stat=await fs.stat(file);
   if(stat.isDirectory()) {
     if(!name.endsWith('/')) {res.writeHead(302,{Location:name+'/'+url.search});res.end();return;}
     file=path.join(file,'index.html');
   }
   const bytes=await fs.readFile(file);
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-cache'});
   res.end(req.method==='HEAD'?undefined:bytes);
 } catch(err) {
   const status=['ENOENT','ENOTDIR','URIError'].includes(err.code||err.name)?404:500;
   res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});
   res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>页面未找到</title><h1>页面未找到</h1><a href="/">返回文档首页</a></html>');
 }
});
server.listen(port,'127.0.0.1',()=>console.log(`中文文档已启动：http://127.0.0.1:${port}/`));
