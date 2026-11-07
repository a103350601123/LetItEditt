'use strict';
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const libs={};
function load(src){
  return libs[src]||(libs[src]=new Promise((ok,no)=>{
    const s=document.createElement('script');
    s.src=src;s.onload=ok;
    s.onerror=()=>{delete libs[src];no(new Error('load'))};
    document.head.appendChild(s);
  }));
}
function toast(msg){
  const t=$('#toast');t.textContent=msg;t.classList.add('on');
  clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),4500);
}

// 🚀 FIX: History handling for Back Button
function openWs(id){
  $$('.ws').forEach(w=>w.classList.remove('on'));
  const w=$('#'+id);w.classList.add('on');document.body.style.overflow='hidden';w.focus();
  history.pushState({ ws: id }, '', window.location.pathname); // Add state
}

function closeWs(){
  $$('.ws').forEach(w=>w.classList.remove('on'));
  document.body.style.overflow='';
}

// 🚀 FIX: Listen to the browser back button
window.addEventListener('popstate', (e) => {
  const open = document.querySelector('.ws.on');
  if (open) {
    closeWs();
    // Push state back so they stay on the page if they press back again
    history.pushState(null, '', window.location.pathname);
  }
});

function saveBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
$$('[data-close]').forEach(b=>b.onclick=closeWs);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeWs()});

/* ---------- IMAGE EDITOR ---------- */
const cv=$('#cv'),cx=cv.getContext('2d',{willReadFrequently:true});
const IMG={mode:'draw',hist:[],sel:null};
const HINT={draw:'Drag on the image to draw.',text:'Type your text in the popup, then click where it should go.',crop:'Drag to choose the area to keep.',blur:'Drag over the area to blur.',pixel:'Drag over the area to pixelate.'};
function filterStr(){
  return `brightness(${$('#bri').value}%) contrast(${$('#con').value}%) saturate(${$('#sat').value}%) grayscale(${$('#gry').value}%) blur(${$('#blr').value}px)`;
}
function resetAdjust(){
  [['bri',100],['con',100],['sat',100],['gry',0],['blr',0]].forEach(([i,v])=>$('#'+i).value=v);
  cv.style.filter='none';
}
$$('.adj').forEach(i=>i.oninput=()=>cv.style.filter=filterStr());
function snap(){
  IMG.hist.push(cx.getImageData(0,0,cv.width,cv.height));
  if(IMG.hist.length>20)IMG.hist.shift();
}
$('#undo').onclick=()=>{
  const h=IMG.hist.pop();
  if(!h)return toast('Nothing to undo.');
  cv.width=h.width;cv.height=h.height;cx.putImageData(h,0,0);
};
$('#imgIn').onchange=e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f)return;
  if(!f.type.startsWith('image/'))return toast('Please choose an image file.');
  const im=new Image();
  im.onload=()=>{
    let w=im.naturalWidth,h=im.naturalHeight;
    const max=4096;
    if(Math.max(w,h)>max){const k=max/Math.max(w,h);w=Math.round(w*k);h=Math.round(h*k)}
    cv.width=w;cv.height=h;cx.drawImage(im,0,0,w,h);
    IMG.hist=[];resetAdjust();URL.revokeObjectURL(im.src);openWs('wsImg');
    if($('#zoom')) { $('#zoom').value = 100; $('#zoom').dispatchEvent(new Event('input')); }
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
$('#togglePanel').onclick=e=>{
  const p=$('#panel');p.classList.toggle('hide');
  e.currentTarget.setAttribute('aria-expanded',!p.classList.contains('hide'));
};
$('#rot').onclick=()=>{
  snap();
  const t=document.createElement('canvas');t.width=cv.height;t.height=cv.width;
  const tc=t.getContext('2d');tc.translate(t.width,0);tc.rotate(Math.PI/2);tc.drawImage(cv,0,0);
  cv.width=t.width;cv.height=t.height;cx.drawImage(t,0,0);
};
function pos(e){
  const r=cv.getBoundingClientRect();
  return{x:(e.clientX-r.left)*cv.width/r.width,y:(e.clientY-r.top)*cv.height/r.height};
}
function rect(a,b){
  const x=Math.max(0,Math.min(a.x,b.x)),y=Math.max(0,Math.min(a.y,b.y));
  return{x:Math.round(x),y:Math.round(y),w:Math.round(Math.min(cv.width,Math.max(a.x,b.x))-x),h:Math.round(Math.min(cv.height,Math.max(a.y,b.y))-y)};
}
function showSel(r){
  const s=$('#sel');s.style.display='block';
  s.style.left=r.x/cv.width*100+'%';s.style.top=r.y/cv.height*100+'%';
  s.style.width=r.w/cv.width*100+'%';s.style.height=r.h/cv.height*100+'%';
}
function fuzz(r,k,smooth){
  const t=document.createElement('canvas');
  t.width=Math.max(1,Math.round(r.w/k));t.height=Math.max(1,Math.round(r.h/k));
  t.getContext('2d').drawImage(cv,r.x,r.y,r.w,r.h,0,0,t.width,t.height);
  cx.imageSmoothingEnabled=smooth;cx.imageSmoothingQuality='high';
  cx.drawImage(t,0,0,t.width,t.height,r.x,r.y,r.w,r.h);
  cx.imageSmoothingEnabled=true;
}
function applyArea(r){
  const k=Math.max(6,Math.round(cv.width/100));
  if(IMG.mode==='crop'){
    const d=cx.getImageData(r.x,r.y,r.w,r.h);
    cv.width=r.w;cv.height=r.h;cx.putImageData(d,0,0);
  }else if(IMG.mode==='blur')fuzz(r,k,true);
  else fuzz(r,k,false);
}

// 🚀 FIX: Text Prompt
function addText(p){
  const txt = prompt("Enter the text you want to add to the image:");
  if(!txt) return;
  snap();
  cx.font=`${$('#fs').value}px "${$('#ff').value}"`;
  cx.fillStyle=$('#pen').value;cx.textBaseline='top';cx.fillText(txt,p.x,p.y);
}
let start=null;
cv.addEventListener('pointerdown',e=>{
  const p=pos(e);
  if(IMG.mode==='text')return addText(p);
  cv.setPointerCapture(e.pointerId);start=p;snap();
  if(IMG.mode==='draw'){cx.beginPath();cx.moveTo(p.x,p.y)}
});
cv.addEventListener('pointermove',e=>{
  if(!start)return;
  const p=pos(e);
  if(IMG.mode==='draw'){
    cx.strokeStyle=$('#pen').value;cx.lineWidth=+$('#size').value*cv.width/1000+1;
    cx.lineCap=cx.lineJoin='round';cx.lineTo(p.x,p.y);cx.stroke();
  }else showSel(rect(start,p));
});
function endDrag(e){
  if(!start)return;
  if(IMG.mode!=='draw'){
    const r=rect(start,pos(e));
    if(r.w>4&&r.h>4)applyArea(r);else IMG.hist.pop();
  }
  start=null;$('#sel').style.display='none';
}
cv.addEventListener('pointerup',endDrag);
cv.addEventListener('pointercancel',()=>{start=null;$('#sel').style.display='none'});
$('#imgDl').onclick=()=>{
  const t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;
  const tc=t.getContext('2d');
  if('filter' in tc)tc.filter=filterStr();else if(filterStr()!==resetFilter)toast('This browser cannot apply adjustments when saving.');
  tc.drawImage(cv,0,0);
  t.toBlob(b=>b?saveBlob(b,'edited-image.png'):toast('The image could not be saved.'),'image/png');
};
const resetFilter='brightness(100%) contrast(100%) saturate(100%) grayscale(0%) blur(0px)';

const zoomSlider = $('#zoom');
const zoomVal = $('#zoomVal');
const cvwrap = document.querySelector('.cvwrap');
if (zoomSlider) {
  zoomSlider.oninput = (e) => {
    const scale = e.target.value / 100;
    cvwrap.style.transform = `scale(${scale})`;
    zoomVal.textContent = `${e.target.value}%`;
  };
}

/* ---------- WORD EDITOR ---------- */
const DOC={name:'document'};
$('#docIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f)return;
  if(!/\.docx$/i.test(f.name))return toast('Please choose a true .docx file.');
  try{
    toast('Opening your document...');
    await load('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    await load('https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js');
    
    const buffer = await f.arrayBuffer();
    const uint = new Uint8Array(buffer);
    if (uint[0] !== 0x50 || uint[1] !== 0x4B) { 
        toast('Error: This file is not a valid .docx file.');
        return;
    }

    const box=$('#doc');box.innerHTML='';
    await docx.renderAsync(f,box,box,{className:'docx',inWrapper:false,breakPages:true});
    box.contentEditable='true';box.spellcheck=true;
    DOC.name=f.name.replace(/\.docx$/i,'');
    openWs('wsDoc');
  }catch(err){
    toast('This document could not be opened.');
  }
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
    toast('Saved.');
  }catch(err){toast('Could not create the .docx.')}
};

/* ---------- EXCEL EDITOR ---------- */
const XL={wb:null,sh:'',name:'spreadsheet'};
function shown(c){return c?(c.w!==undefined?c.w:(c.v===undefined?'':String(c.v))):''}
$('#xlIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f)return;
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
  toast('Saved.');
};
