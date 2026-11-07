/* LetItEdit tools. Everything runs in the browser. Nothing is uploaded. */
'use strict';
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const libs={};
function load(src){
  if(!navigator.onLine)return Promise.reject(new Error('offline'));
  return libs[src]||(libs[src]=new Promise((ok,no)=>{
    const s=document.createElement('script');s.src=src;s.onload=ok;
    s.onerror=()=>{delete libs[src];no(new Error('load'))};
    document.head.appendChild(s);
  }));
}
function openWs(id){
  $$('.ws').forEach(w=>w.classList.remove('on'));
  const w=$('#'+id);w.classList.add('on');document.body.style.overflow='hidden';
  if(!(history.state&&history.state.ws))history.pushState({ws:id},'');
  w.focus();
}
function hideWs(){$$('.ws').forEach(w=>w.classList.remove('on'));document.body.style.overflow=''}
function closeWs(){if(history.state&&history.state.ws)history.back();else hideWs()}
addEventListener('popstate',hideWs);
function saveBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
$$('[data-close]').forEach(b=>b.onclick=closeWs);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')return closeWs();
  if($('#wsImg').classList.contains('on')&&(e.ctrlKey||e.metaKey)&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){
    if(e.key==='z'){e.preventDefault();undo()}else if(e.key==='y'){e.preventDefault();redo()}
  }
});

/* ---------- IMAGE EDITOR ---------- */
const cv=$('#cv'),cx=cv.getContext('2d',{willReadFrequently:true});
const IMG={mode:'draw',hist:[],redo:[],zoom:0,badge:1};
const HINT={draw:'Drag on the image to draw.',hl:'Drag to highlight.',arrow:'Drag from the start to the end of the arrow.',rect:'Drag to draw a box.',text:'Type your text above, then tap where it should go.',badge:'Tap to place the next step number.',crop:'Drag to choose the area to keep.',blur:'Drag over the area to blur.',pixel:'Drag over the area to pixelate.'};
const RESET='brightness(100%) contrast(100%) saturate(100%) grayscale(0%) blur(0px)';
const filterStr=()=>`brightness(${$('#bri').value}%) contrast(${$('#con').value}%) saturate(${$('#sat').value}%) grayscale(${$('#gry').value}%) blur(${$('#blr').value}px)`;
function resetAdjust(){[['bri',100],['con',100],['sat',100],['gry',0],['blr',0]].forEach(([i,v])=>$('#'+i).value=v);cv.style.filter='none'}
$$('.adj').forEach(i=>i.oninput=()=>cv.style.filter=filterStr());
const state=()=>cx.getImageData(0,0,cv.width,cv.height);
function fit(){
  if(IMG.zoom){cv.style.maxWidth='none';cv.style.maxHeight='none';cv.style.width=Math.round(cv.width*IMG.zoom)+'px'}
  else{cv.style.width='';cv.style.maxWidth='100%';cv.style.maxHeight='calc(100vh - 160px)'}
  $('#zoomLbl').textContent=IMG.zoom?Math.round(IMG.zoom*100)+'%':'Fit';
}
function restore(d){cv.width=d.width;cv.height=d.height;cx.putImageData(d,0,0);fit()}
function snap(){IMG.hist.push(state());if(IMG.hist.length>25)IMG.hist.shift();IMG.redo=[]}
function undo(){const h=IMG.hist.pop();if(!h)return toast('Nothing to undo.');IMG.redo.push(state());restore(h)}
function redo(){const r=IMG.redo.pop();if(!r)return toast('Nothing to redo.');IMG.hist.push(state());restore(r)}
$('#undo').onclick=undo;$('#redo').onclick=redo;
const curScale=()=>cv.getBoundingClientRect().width/cv.width;
$('#zIn').onclick=()=>{IMG.zoom=Math.min(4,(IMG.zoom||curScale())*1.25);fit()};
$('#zOut').onclick=()=>{IMG.zoom=Math.max(.1,(IMG.zoom||curScale())/1.25);fit()};
$('#zFit').onclick=()=>{IMG.zoom=0;fit()};
$('#imgIn').onchange=e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!f.type.startsWith('image/'))return toast('Please choose an image file (JPG, PNG, WebP).');
  const im=new Image();
  im.onload=()=>{
    let w=im.naturalWidth,h=im.naturalHeight;const max=3200;
    if(Math.max(w,h)>max){const k=max/Math.max(w,h);w=Math.round(w*k);h=Math.round(h*k)}
    cv.width=w;cv.height=h;cx.drawImage(im,0,0,w,h);
    IMG.hist=[];IMG.redo=[];IMG.zoom=0;IMG.badge=1;resetAdjust();fit();URL.revokeObjectURL(im.src);openWs('wsImg');
  };
  im.onerror=()=>toast('That image could not be opened.');
  im.src=URL.createObjectURL(f);
};
$$('[data-mode]').forEach(b=>b.onclick=()=>{
  IMG.mode=b.dataset.mode;
  $$('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',x===b));
  $('#hint').textContent=HINT[IMG.mode];
  cv.style.cursor=IMG.mode==='text'?'text':'crosshair';
});
$('#togglePanel').onclick=e=>{const p=$('#panel');p.classList.toggle('hide');e.currentTarget.setAttribute('aria-expanded',!p.classList.contains('hide'))};
$('#badgeReset').onclick=()=>{IMG.badge=1;toast('Step numbers will start from 1 again.')};
function copyTo(w,h,fn){const t=document.createElement('canvas');t.width=w;t.height=h;fn(t.getContext('2d'));return t}
$('#rot').onclick=()=>{
  snap();const t=copyTo(cv.height,cv.width,c=>{c.translate(cv.height,0);c.rotate(Math.PI/2);c.drawImage(cv,0,0)});
  cv.width=t.width;cv.height=t.height;cx.drawImage(t,0,0);fit();
};
$('#flip').onclick=()=>{
  snap();const t=copyTo(cv.width,cv.height,c=>c.drawImage(cv,0,0));
  cx.save();cx.translate(cv.width,0);cx.scale(-1,1);cx.drawImage(t,0,0);cx.restore();
};
function pos(e){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*cv.width/r.width,y:(e.clientY-r.top)*cv.height/r.height}}
function rect(a,b){
  const x=Math.max(0,Math.min(a.x,b.x)),y=Math.max(0,Math.min(a.y,b.y));
  return{x:Math.round(x),y:Math.round(y),w:Math.round(Math.min(cv.width,Math.max(a.x,b.x))-x),h:Math.round(Math.min(cv.height,Math.max(a.y,b.y))-y)};
}
function showSel(r){
  const s=$('#sel');s.style.display='block';
  s.style.left=r.x/cv.width*100+'%';s.style.top=r.y/cv.height*100+'%';
  s.style.width=r.w/cv.width*100+'%';s.style.height=r.h/cv.height*100+'%';
}
const lw=()=>Math.max(1,+$('#size').value*cv.width/1200);
function seg(a,b,hl){
  cx.save();cx.strokeStyle=$('#pen').value;cx.lineWidth=lw()*(hl?4:1);cx.lineCap=cx.lineJoin='round';cx.globalAlpha=hl?.4:1;
  cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();cx.restore();
}
function strokePath(pts){
  cx.save();cx.strokeStyle=$('#pen').value;cx.lineWidth=lw()*4;cx.lineCap=cx.lineJoin='round';cx.globalAlpha=.4;
  cx.beginPath();cx.moveTo(pts[0].x,pts[0].y);pts.forEach(q=>cx.lineTo(q.x,q.y));cx.stroke();cx.restore();
}
function shape(a,b,m){
  cx.save();cx.strokeStyle=cx.fillStyle=$('#pen').value;cx.lineWidth=lw();cx.lineCap=cx.lineJoin='round';
  if(m==='rect')cx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
  else{
    const ang=Math.atan2(b.y-a.y,b.x-a.x),hl=lw()*4+12;
    cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();
    cx.beginPath();cx.moveTo(b.x,b.y);
    cx.lineTo(b.x-hl*Math.cos(ang-.45),b.y-hl*Math.sin(ang-.45));
    cx.lineTo(b.x-hl*Math.cos(ang+.45),b.y-hl*Math.sin(ang+.45));cx.closePath();cx.fill();
  }
  cx.restore();
}
function fuzz(r,k,smooth){
  const t=document.createElement('canvas');
  t.width=Math.max(1,Math.round(r.w/k));t.height=Math.max(1,Math.round(r.h/k));
  t.getContext('2d').drawImage(cv,r.x,r.y,r.w,r.h,0,0,t.width,t.height);
  cx.imageSmoothingEnabled=smooth;cx.imageSmoothingQuality='high';
  cx.drawImage(t,0,0,t.width,t.height,r.x,r.y,r.w,r.h);cx.imageSmoothingEnabled=true;
}
function applyArea(r){
  const k=Math.max(6,Math.round(cv.width/100));
  if(IMG.mode==='crop'){const d=cx.getImageData(r.x,r.y,r.w,r.h);cv.width=r.w;cv.height=r.h;cx.putImageData(d,0,0);fit()}
  else fuzz(r,k,IMG.mode==='blur');
}
function addText(p){
  const txt=$('#txt').value.trim();
  if(!txt)return toast('Type some text first.');
  snap();cx.font=`${$('#fs').value}px "${$('#ff').value}"`;cx.fillStyle=$('#pen').value;cx.textBaseline='top';cx.fillText(txt,p.x,p.y);
}
function addBadge(p){
  snap();const r=Math.max(14,cv.width/60);
  cx.save();cx.fillStyle=$('#pen').value;cx.beginPath();cx.arc(p.x,p.y,r,0,Math.PI*2);cx.fill();
  cx.fillStyle='#fff';cx.font=`bold ${Math.round(r*1.2)}px Arial`;cx.textAlign='center';cx.textBaseline='middle';
  cx.fillText(String(IMG.badge++),p.x,p.y+1);cx.restore();
}
let drag=null;
cv.addEventListener('pointerdown',e=>{
  const p=pos(e),m=IMG.mode;
  if(m==='text')return addText(p);
  if(m==='badge')return addBadge(p);
  cv.setPointerCapture(e.pointerId);snap();
  drag={p0:p,last:p,pts:[p],base:(m==='hl'||m==='arrow'||m==='rect')?state():null};
  if(m==='draw')seg(p,{x:p.x+.1,y:p.y},false);
});
cv.addEventListener('pointermove',e=>{
  if(!drag)return;const p=pos(e),m=IMG.mode;
  if(m==='draw'){seg(drag.last,p,false);drag.last=p}
  else if(m==='hl'){drag.pts.push(p);cx.putImageData(drag.base,0,0);strokePath(drag.pts)}
  else if(m==='arrow'||m==='rect'){cx.putImageData(drag.base,0,0);shape(drag.p0,p,m)}
  else showSel(rect(drag.p0,p));
});
function endDrag(e){
  if(!drag)return;const m=IMG.mode;
  if(m==='crop'||m==='blur'||m==='pixel'){const r=rect(drag.p0,pos(e));if(r.w>4&&r.h>4)applyArea(r);else IMG.hist.pop()}
  drag=null;$('#sel').style.display='none';
}
cv.addEventListener('pointerup',endDrag);
cv.addEventListener('pointercancel',()=>{drag=null;$('#sel').style.display='none'});
$('#imgDl').onclick=()=>{
  if(!guard())return;
  const fmt=$('#fmt').value,t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;
  const tc=t.getContext('2d');
  if(fmt!=='image/png'){tc.fillStyle='#fff';tc.fillRect(0,0,t.width,t.height)}
  if('filter' in tc)tc.filter=filterStr();else if(filterStr()!==RESET)toast('This browser cannot apply adjustments when saving. Use Chrome, Edge or Firefox.');
  tc.drawImage(cv,0,0);
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[fmt];
  t.toBlob(b=>b?saveBlob(b,'edited-image.'+ext):toast('The image could not be saved.'),fmt,.92);
};

/* ---------- TEXT EXTRACTOR (OCR) ---------- */
const TESS='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let ocrFile=null;
$('#ocrIn').onchange=e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!f.type.startsWith('image/'))return toast('Please choose an image file (JPG, PNG, WebP).');
  ocrFile=f;$('#ocrImg').src=URL.createObjectURL(f);$('#ocrText').value='';openWs('wsOcr');runOcr();
};
async function runOcr(){
  if(!ocrFile||!guard())return;
  const btn=$('#ocrRun'),st=$('#ocrStat');btn.disabled=true;st.textContent='Loading the text engine...';
  try{
    await load(TESS);
    const r=await Tesseract.recognize(ocrFile,$('#ocrLang').value,{logger:m=>{if(m.status)st.textContent=m.status.replace(/_/g,' ')+(m.progress?' '+Math.round(m.progress*100)+'%':'')}});
    const t=r.data.text.trim();$('#ocrText').value=t;
    st.textContent=t?'Done. Check the text for mistakes.':'No text was found in this image.';
  }catch(err){st.textContent='Text extraction failed. Check your internet connection and try again.'}
  finally{btn.disabled=false}
}
$('#ocrRun').onclick=runOcr;
$('#ocrLang').onchange=runOcr;
$('#ocrCopy').onclick=async()=>{
  const ta=$('#ocrText');if(!ta.value)return toast('There is no text to copy.');
  try{await navigator.clipboard.writeText(ta.value)}catch(e){ta.select();document.execCommand('copy')}
  toast('Text copied.');
};
$('#ocrDl').onclick=()=>{const v=$('#ocrText').value;if(!v)return toast('There is no text to download.');saveBlob(new Blob([v],{type:'text/plain'}),'extracted-text.txt')};

/* ---------- PDF EDITOR ---------- */
const PDFLIB='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const PDF={bytes:null,hist:[],name:'document',url:null};
const pdfDoc=()=>PDFLib.PDFDocument.load(PDF.bytes);
function pdfShow(n){
  $('#pdfCount').textContent=n+(n===1?' page':' pages');
  if(PDF.url)URL.revokeObjectURL(PDF.url);
  PDF.url=URL.createObjectURL(new Blob([PDF.bytes],{type:'application/pdf'}));$('#pdfView').src=PDF.url;
}
async function pdfSet(doc){PDF.hist.push(PDF.bytes);PDF.bytes=await doc.save();pdfShow(doc.getPageCount())}
function parseRange(s,n){
  const out=new Set();
  for(const part of s.split(',')){
    const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)return null;
    const a=+m[1],b=m[2]?+m[2]:a;if(a<1||b<a||b>n)return null;
    for(let i=a;i<=b;i++)out.add(i-1);
  }
  return[...out].sort((x,y)=>x-y);
}
async function pdfRun(fn){
  if(!PDF.bytes||!guard())return;
  try{await fn(await pdfDoc())}catch(err){toast(err&&err.message==='range'?'Please enter valid page numbers, for example 2,5-7.':'That change could not be applied.')}
}
$('#pdfIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!/\.pdf$/i.test(f.name))return toast('Please choose a PDF file.');
  try{
    await load(PDFLIB);
    const b=new Uint8Array(await f.arrayBuffer()),d=await PDFLib.PDFDocument.load(b);
    PDF.bytes=b;PDF.hist=[];PDF.name=f.name.replace(/\.pdf$/i,'');pdfShow(d.getPageCount());openWs('wsPdf');
  }catch(err){toast(err&&err.message==='offline'?'You are offline. Please reconnect and try again.':'This PDF could not be opened. It may be password-protected or damaged.')}
};
$('#pdfRot').onclick=()=>pdfRun(async d=>{d.getPages().forEach(p=>p.setRotation(PDFLib.degrees((p.getRotation().angle+90)%360)));await pdfSet(d)});
$('#pdfDelGo').onclick=()=>pdfRun(async d=>{
  const r=parseRange($('#pdfDel').value,d.getPageCount());
  if(!r||!r.length)throw new Error('range');
  if(r.length>=d.getPageCount())return toast('You cannot delete every page.');
  r.reverse().forEach(i=>d.removePage(i));await pdfSet(d);
});
$('#pdfKeepGo').onclick=()=>pdfRun(async d=>{
  const r=parseRange($('#pdfKeep').value,d.getPageCount());
  if(!r||!r.length)throw new Error('range');
  const n=await PDFLib.PDFDocument.create();(await n.copyPages(d,r)).forEach(p=>n.addPage(p));await pdfSet(n);
});
$('#pdfAdd').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!PDF.bytes||!guard())return;
  try{
    const d=await pdfDoc(),o=await PDFLib.PDFDocument.load(new Uint8Array(await f.arrayBuffer()));
    (await d.copyPages(o,o.getPageIndices())).forEach(p=>d.addPage(p));await pdfSet(d);toast('PDF added to the end.');
  }catch(err){toast('That PDF could not be added. It may be password-protected or damaged.')}
};
$('#pdfNum').onclick=()=>pdfRun(async d=>{
  const f=await d.embedFont(PDFLib.StandardFonts.Helvetica),n=d.getPageCount();
  d.getPages().forEach((p,i)=>{const t=`${i+1} / ${n}`,w=f.widthOfTextAtSize(t,10);p.drawText(t,{x:(p.getWidth()-w)/2,y:18,size:10,font:f,color:PDFLib.rgb(.25,.25,.25)})});
  await pdfSet(d);
});
$('#pdfWmGo').onclick=()=>pdfRun(async d=>{
  const t=$('#pdfWm').value.trim();if(!t)return toast('Type the watermark text first.');
  const f=await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
  d.getPages().forEach(p=>{
    const size=Math.min(64,p.getWidth()/Math.max(6,t.length)*1.4),w=f.widthOfTextAtSize(t,size);
    p.drawText(t,{x:p.getWidth()/2-w/2*.707,y:p.getHeight()/2-w/2*.707,size,font:f,color:PDFLib.rgb(.5,.5,.5),opacity:.25,rotate:PDFLib.degrees(45)});
  });
  await pdfSet(d);
});
$('#pdfUndo').onclick=async()=>{
  const b=PDF.hist.pop();if(!b)return toast('Nothing to undo.');
  PDF.bytes=b;try{pdfShow((await pdfDoc()).getPageCount())}catch(e){toast('Could not undo.')}
};
$('#pdfDl').onclick=()=>{if(PDF.bytes)saveBlob(new Blob([PDF.bytes],{type:'application/pdf'}),PDF.name+'-edited.pdf')};

/* ---------- WORD EDITOR ---------- */
const DOC={name:'document'};
$('#docIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!/\.docx$/i.test(f.name))return toast('Please choose a .docx file. Older .doc files are not supported.');
  try{
    toast('Opening your document...');
    await load('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    await load('https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js');
    const box=$('#doc');box.innerHTML='';
    await docx.renderAsync(f,box,box,{className:'docx',inWrapper:false,breakPages:true,renderHeaders:true,renderFooters:true,renderFootnotes:true});
    box.contentEditable='true';box.spellcheck=true;
    DOC.name=f.name.replace(/\.docx$/i,'');
    openWs('wsDoc');
  }catch(err){toast('This document could not be opened. Check your connection and try again.')}
};
$$('[data-cmd]').forEach(b=>{
  b.onmousedown=e=>e.preventDefault();
  b.onclick=()=>{$('#doc').focus();document.execCommand(b.dataset.cmd)};
});
$('#docPrint').onclick=()=>window.print();
$('#docDl').onclick=async()=>{
  try{
    await load('https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js');
    const html='<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'+$('#doc').innerHTML+'</body></html>';
    saveBlob(htmlDocx.asBlob(html),DOC.name+'-edited.docx');
    toast('Saved. For an exact copy of the layout, use Print or save as PDF.');
  }catch(err){toast('Could not create the .docx. Use Print or save as PDF instead.')}
};

/* ---------- EXCEL EDITOR ---------- */
const XL={wb:null,sh:'',name:'spreadsheet'};
function shown(c){return c?(c.w!==undefined?c.w:(c.v===undefined?'':String(c.v))):''}
$('#xlIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!/\.(xlsx|xls|csv)$/i.test(f.name))return toast('Please choose an .xlsx, .xls or .csv file.');
  try{
    toast('Opening your spreadsheet...');
    await load('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
    XL.wb=XLSX.read(await f.arrayBuffer(),{cellFormula:true,cellDates:true});
    XL.name=f.name.replace(/\.[^.]+$/,'');XL.sh=XL.wb.SheetNames[0];
    drawTabs();drawGrid();openWs('wsXl');
  }catch(err){toast('This spreadsheet could not be opened.')}
};
function drawTabs(){
  const t=$('#tabs');t.textContent='';
  XL.wb.SheetNames.forEach(n=>{
    const b=document.createElement('button');
    b.className='btn alt sm';b.textContent=n;b.setAttribute('aria-pressed',n===XL.sh);
    b.onclick=()=>{XL.sh=n;drawTabs();drawGrid()};
    t.appendChild(b);
  });
}
function drawGrid(){
  const ws=XL.wb.Sheets[XL.sh];
  const R=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
  const rows=Math.max(Math.min(R.e.r,499),29),cols=Math.max(Math.min(R.e.c,51),11);
  const tb=document.createElement('table');tb.className='grid';
  const hr=tb.insertRow();hr.appendChild(document.createElement('th'));
  for(let c=0;c<=cols;c++){const th=document.createElement('th');th.textContent=XLSX.utils.encode_col(c);hr.appendChild(th)}
  for(let r=0;r<=rows;r++){
    const tr=tb.insertRow();const h=document.createElement('th');h.textContent=r+1;tr.appendChild(h);
    for(let c=0;c<=cols;c++){
      const a=XLSX.utils.encode_cell({r,c}),td=tr.insertCell();
      td.dataset.a=a;td.contentEditable='true';td.textContent=shown(ws[a]);
    }
  }
  tb.addEventListener('focusin',e=>{const td=e.target,c=ws[td.dataset.a];if(c&&c.f)td.textContent='='+c.f});
  tb.addEventListener('focusout',e=>commit(ws,e.target));
  $('#xlStage').textContent='';$('#xlStage').appendChild(tb);
}
function commit(ws,td){
  const a=td.dataset.a;if(!a)return;
  const c=ws[a],t=td.textContent,old=c?(c.f?'='+c.f:shown(c)):'';
  if(t!==old){
    if(t==='')delete ws[a];
    else if(t[0]==='=')ws[a]={t:'n',f:t.slice(1),v:c&&typeof c.v==='number'?c.v:0};
    else if(t.trim()!==''&&!isNaN(+t))ws[a]={t:'n',v:+t};
    else ws[a]={t:'s',v:t};
    const d=XLSX.utils.decode_cell(a),r=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
    r.e.r=Math.max(r.e.r,d.r);r.e.c=Math.max(r.e.c,d.c);ws['!ref']=XLSX.utils.encode_range(r);
  }
  td.textContent=shown(ws[a]);
}
$('#xlDl').onclick=()=>{
  if(!XL.wb)return;
  const f=document.activeElement;if(f&&f.dataset&&f.dataset.a)f.blur();
  XLSX.writeFile(XL.wb,XL.name+'-edited.xlsx');
  toast('Saved. If a formula shows an old value, open the file in Excel and press F9.');
};
