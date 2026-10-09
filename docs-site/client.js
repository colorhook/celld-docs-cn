const dialog=document.querySelector('#search-dialog');
const input=document.querySelector('#search-input');
const results=document.querySelector('#search-results');
let indexPromise;
function loadIndex(){return indexPromise??=fetch('/search-index.json').then(r=>{if(!r.ok)throw new Error('搜索索引不可用');return r.json();}).catch(error=>{indexPromise=undefined;throw error;});}
function openSearch(){dialog.showModal();input.focus();loadIndex().catch(()=>{results.textContent='搜索暂时不可用，请稍后重试。';});}
document.querySelector('#search-open').addEventListener('click',openSearch);
document.querySelector('#search-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!dialog.open)openSearch();}if(event.key==='Escape')closeMenu();});
let searchVersion=0;
input.addEventListener('input',async()=>{
 const version=++searchVersion;
 const query=input.value.trim().toLowerCase();
 if(!query){results.innerHTML='<p>输入关键词，搜索 20 篇中文文档。</p>';return;}
 try {
  const index=await loadIndex();if(version!==searchVersion)return;
  const terms=query.split(/\s+/);
  const matches=index.filter(page=>terms.every(term=>(page.title+' '+page.text).toLowerCase().includes(term))).sort((a,b)=>Number(b.title.toLowerCase().includes(query))-Number(a.title.toLowerCase().includes(query)));
  results.replaceChildren();
  if(!matches.length){const p=document.createElement('p');p.textContent='未找到相关文档，试试其他关键词。';results.append(p);return;}
  for(const page of matches){
   const link=document.createElement('a');link.href=page.url;
   const heading=page.headings.find(h=>terms.some(term=>h.text.toLowerCase().includes(term)));
   if(heading)link.href+='#'+heading.id;
   const title=document.createElement('strong');title.textContent=page.title+(heading?' / '+heading.text:'');
   const snippet=document.createElement('span');const start=Math.max(0,page.text.toLowerCase().indexOf(terms[0])-35);snippet.textContent=(start?'…':'')+page.text.slice(start,start+150)+'…';
   link.append(title,snippet);results.append(link);
  }
 }catch(error){if(version===searchVersion)results.textContent='搜索暂时不可用，请稍后重试。';}
});
for(const button of document.querySelectorAll('.copy-code'))button.addEventListener('click',async()=>{
 try{const text=button.closest('.code-block').querySelector('code').textContent;await navigator.clipboard.writeText(text);button.textContent='已复制';}
 catch{button.textContent='复制失败';}
 setTimeout(()=>button.textContent='复制',1600);
});
const menu=document.querySelector('#menu');
function closeMenu(){document.body.classList.remove('menu-open');menu.setAttribute('aria-expanded','false');}
menu.addEventListener('click',()=>{const open=document.body.classList.toggle('menu-open');menu.setAttribute('aria-expanded',String(open));});
document.querySelector('main').addEventListener('click',closeMenu);
for(const a of document.querySelectorAll('#sidebar a'))a.addEventListener('click',closeMenu);
const active=document.querySelector('#sidebar .current');if(active)active.scrollIntoView({block:'nearest'});
const sections=[...document.querySelectorAll('article h2[id],article h3[id]')];
const tocLinks=[...document.querySelectorAll('.toc>a')];
let scheduled=false;
function updateToc(){scheduled=false;let current=sections[0];for(const h of sections){if(h.getBoundingClientRect().top<=130)current=h;else break;}for(const link of tocLinks){link.classList.toggle('active',link.hash==='#'+current?.id);}}
window.addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(updateToc);}},{passive:true});updateToc();
