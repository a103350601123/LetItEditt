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
let cur=null,leaving=false;
const DIRTY={},SAVE={};
const dirtyNow=()=>!!(cur&&DIRTY[cur]);
function openWs(id){
  $$('.ws').forEach(w=>w.classList.remove('on'));
  const w=$('#'+id);w.classList.add('on');document.body.style.overflow='hidden';
  cur=id;DIRTY[id]=false;
  if(!(history.state&&history.state.ws))history.pushState({ws:id},'');
  w.focus();
}
function hideWs(){$$('.ws').forEach(w=>w.classList.remove('on'));$('#ovLeave').classList.remove('on');document.body.style.overflow='';cur=null}
function leave(){leaving=true;if(history.state&&history.state.ws)history.back();else{leaving=false;hideWs()}}
function askLeave(){$('#ovLeave').classList.add('on');$('#leaveSave').focus()}
function closeWs(){if(dirtyNow())askLeave();else leave()}
addEventListener('popstate',()=>{
  if(leaving){leaving=false;hideWs();return}
  if(dirtyNow()){history.pushState({ws:cur},'');askLeave();return}
  hideWs();
});
$('#leaveSave').onclick=async()=>{const f=SAVE[cur];if(f)await f();if(!dirtyNow()){$('#ovLeave').classList.remove('on');leave()}};
$('#leaveNo').onclick=()=>{DIRTY[cur]=false;$('#ovLeave').classList.remove('on');leave()};
$('#leaveKeep').onclick=()=>$('#ovLeave').classList.remove('on');
addEventListener('beforeunload',e=>{if(dirtyNow()){e.preventDefault();e.returnValue=''}});
function saveBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
$$('[data-close]').forEach(b=>b.onclick=closeWs);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if($('#ovLeave').classList.contains('on'))$('#ovLeave').classList.remove('on');else if(cur)closeWs();return}
  if(cur==='wsImg'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){
    if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo()}
    else if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();redo()}
    else if((e.key==='Delete'||e.key==='Backspace')&&IMG.sel){e.preventDefault();delText()}
  }
});

/* ---------- IMAGE EDITOR ---------- */
const cv=$('#cv'),cx=cv.getContext('2d',{willReadFrequently:true}),ov=$('#ov'),ox=ov.getContext('2d'),stage=$('#stageImg');
const IMG={mode:'draw',hist:[],redo:[],zoom:0,badge:1,texts:[],sel:null,es:false,nid:1};
const HINT={draw:'Drag on the image to draw.',hl:'Drag to highlight.',arrow:'Drag from the start to the end of the arrow.',rect:'Drag to draw a box.',text:'Tap the image to add text. Tap a text to select it, drag it to move it, and drag the round handles to stretch it sideways or up and down.',badge:'Tap to place the next step number.',crop:'Drag to choose the area to keep.',blur:'Drag over the area to blur.',pixel:'Drag over the area to pixelate.',pan:'Drag to move around a zoomed image. On a phone you can also pinch and move with two fingers.'};
const RESET='brightness(100%) contrast(100%) saturate(100%) grayscale(0%) blur(0px)';
const filterStr=()=>`brightness(${$('#bri').value}%) contrast(${$('#con').value}%) saturate(${$('#sat').value}%) grayscale(${$('#gry').value}%) blur(${$('#blr').value}px)`;
function resetAdjust(){[['bri',100],['con',100],['sat',100],['gry',0],['blr',0]].forEach(([i,v])=>$('#'+i).value=v);cv.style.filter='none'}
$$('.adj').forEach(i=>i.oninput=()=>{cv.style.filter=filterStr();DIRTY.wsImg=true});
const state=()=>cx.getImageData(0,0,cv.width,cv.height);
const clone=a=>a.map(o=>({...o}));
const fontStr=o=>`${o.size}px "${o.font}"`;
const sc=()=>Math.max(1,cv.width/800);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

/* text layer */
function paintTexts(c){IMG.texts.forEach(o=>{c.save();c.translate(o.x,o.y);c.scale(o.sx||1,1);c.font=fontStr(o);c.fillStyle=o.color;c.textBaseline='top';c.fillText(o.text,0,0);c.restore()})}
function box(o){ox.font=fontStr(o);return{x:o.x,y:o.y,w:ox.measureText(o.text||' ').width*(o.sx||1),h:o.size*1.2}}
const handleR=()=>(window.matchMedia&&matchMedia('(pointer:coarse)').matches?15:10)/curScale();
function handlesOf(b,p){return[{k:'r',x:b.x+b.w+p,y:b.y+b.h/2},{k:'b',x:b.x+b.w/2,y:b.y+b.h+p},{k:'c',x:b.x+b.w+p,y:b.y+b.h+p}]}
function handleAt(pt){const o=IMG.sel;if(!o)return null;const h=handlesOf(box(o),6*sc()).find(h=>Math.hypot(h.x-pt.x,h.y-pt.y)<handleR()*1.7);return h?h.k:null}
function drawOv(){
  ox.clearRect(0,0,ov.width,ov.height);paintTexts(ox);
  if(IMG.sel&&IMG.mode==='text'){
    const b=box(IMG.sel),p=6*sc();
    ox.save();ox.strokeStyle='#38bdf8';ox.lineWidth=2*sc();ox.setLineDash([6*sc(),4*sc()]);ox.strokeRect(b.x-p,b.y-p,b.w+2*p,b.h+2*p);ox.restore();
    ox.save();ox.fillStyle='#38bdf8';ox.strokeStyle='#fff';ox.lineWidth=2/curScale();handlesOf(b,p).forEach(h=>{ox.beginPath();ox.arc(h.x,h.y,handleR(),0,Math.PI*2);ox.fill();ox.stroke()});ox.restore();
  }
}
function syncOv(){ov.width=cv.width;ov.height=cv.height;drawOv()}
function hit(p){
  for(let i=IMG.texts.length-1;i>=0;i--){
    const o=IMG.texts[i],b=box(o),pad=10*sc();
    if(p.x>=b.x-pad&&p.x<=b.x+b.w+pad&&p.y>=b.y-pad&&p.y<=b.y+b.h+pad)return o;
  }
  return null;
}
function flatten(){if(IMG.texts.length){paintTexts(cx);IMG.texts=[];IMG.sel=null}}

/* zoom */
const fitScale=()=>Math.min(1,Math.max(.05,(stage.clientWidth-44)/cv.width),Math.max(.05,(stage.clientHeight-44)/cv.height));
const curScale=()=>IMG.zoom||fitScale();
function fit(){
  const z=curScale();
  cv.style.maxWidth='none';cv.style.maxHeight='none';cv.style.width=Math.round(cv.width*z)+'px';
  $('#zoomLbl').textContent=IMG.zoom?Math.round(IMG.zoom*100)+'%':'Fit';
  $('#zRange').value=Math.min(400,Math.max(10,Math.round(z*100)));
}
function setZoom(z){IMG.zoom=Math.min(4,Math.max(.1,z));fit()}
$('#zIn').onclick=()=>setZoom(curScale()*1.25);
$('#zOut').onclick=()=>setZoom(curScale()/1.25);
$('#zFit').onclick=()=>{IMG.zoom=0;fit()};
$('#z100').onclick=()=>setZoom(1);
$('#zRange').oninput=e=>setZoom(e.target.value/100);
addEventListener('resize',()=>{if(cur==='wsImg')fit()});
stage.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();setZoom(curScale()*(e.deltaY<0?1.1:1/1.1))}},{passive:false});

/* undo and redo (images and texts) */
function snap(img=true){IMG.hist.push({d:img?state():null,t:clone(IMG.texts)});if(IMG.hist.length>25)IMG.hist.shift();IMG.redo=[];DIRTY.wsImg=true}
function applyH(h){
  if(h.d){cv.width=h.d.width;cv.height=h.d.height;cx.putImageData(h.d,0,0);ov.width=cv.width;ov.height=cv.height}
  IMG.texts=clone(h.t);IMG.sel=null;IMG.es=false;drawOv();fit();
}
function undo(){const h=IMG.hist.pop();if(!h)return toast('Nothing to undo.');IMG.redo.push({d:h.d?state():null,t:clone(IMG.texts)});applyH(h);DIRTY.wsImg=true}
function redo(){const r=IMG.redo.pop();if(!r)return toast('Nothing to redo.');IMG.hist.push({d:r.d?state():null,t:clone(IMG.texts)});applyH(r);DIRTY.wsImg=true}
$('#undo').onclick=undo;$('#redo').onclick=redo;

$('#imgIn').onchange=e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!f.type.startsWith('image/'))return toast('Please choose an image file (JPG, PNG, WebP).');
  const im=new Image();
  im.onload=()=>{
    let w=im.naturalWidth,h=im.naturalHeight;const max=3200;
    if(Math.max(w,h)>max){const k=max/Math.max(w,h);w=Math.round(w*k);h=Math.round(h*k)}
    cv.width=w;cv.height=h;cx.drawImage(im,0,0,w,h);
    IMG.hist=[];IMG.redo=[];IMG.zoom=0;IMG.badge=1;IMG.texts=[];IMG.sel=null;IMG.es=false;
    $('#fs').max=Math.round(w/4);$('#fs').value=Math.max(24,Math.round(w/25));
    resetAdjust();syncOv();URL.revokeObjectURL(im.src);openWs('wsImg');setMode('draw');fit();
  };
  im.onerror=()=>toast('That image could not be opened.');
  im.src=URL.createObjectURL(f);
};
function setMode(m){
  IMG.mode=m;IMG.sel=null;IMG.es=false;drawOv();
  $$('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.mode===m));
  $('#hint').textContent=HINT[m];
  cv.style.cursor=m==='text'?'text':m==='pan'?'grab':'crosshair';
}
$$('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('#togglePanel').onclick=e=>{const p=$('#panel');p.classList.toggle('hide');e.currentTarget.setAttribute('aria-expanded',!p.classList.contains('hide'));setTimeout(fit,0)};
$('#badgeReset').onclick=()=>{IMG.badge=1;toast('Step numbers will start from 1 again.')};
function copyTo(w,h,fn){const t=document.createElement('canvas');t.width=w;t.height=h;fn(t.getContext('2d'));return t}
$('#rot').onclick=()=>{
  snap();flatten();
  const t=copyTo(cv.height,cv.width,c=>{c.translate(cv.height,0);c.rotate(Math.PI/2);c.drawImage(cv,0,0)});
  cv.width=t.width;cv.height=t.height;cx.drawImage(t,0,0);syncOv();fit();
};
$('#flip').onclick=()=>{
  snap();flatten();
  const t=copyTo(cv.width,cv.height,c=>c.drawImage(cv,0,0));
  cx.save();cx.translate(cv.width,0);cx.scale(-1,1);cx.drawImage(t,0,0);cx.restore();drawOv();
};

/* drawing helpers */
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
function seg(a,b){
  cx.save();cx.strokeStyle=$('#pen').value;cx.lineWidth=lw();cx.lineCap=cx.lineJoin='round';
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
  if(IMG.mode==='crop'){
    flatten();const d=cx.getImageData(r.x,r.y,r.w,r.h);
    cv.width=r.w;cv.height=r.h;cx.putImageData(d,0,0);syncOv();IMG.zoom=0;fit();
  }else fuzz(r,Math.max(6,Math.round(cv.width/100)),IMG.mode==='blur');
}
function addBadge(p){
  snap();const r=Math.max(14,cv.width/60);
  cx.save();cx.fillStyle=$('#pen').value;cx.beginPath();cx.arc(p.x,p.y,r,0,Math.PI*2);cx.fill();
  cx.fillStyle='#fff';cx.font=`bold ${Math.round(r*1.2)}px Arial`;cx.textAlign='center';cx.textBaseline='middle';
  cx.fillText(String(IMG.badge++),p.x,p.y+1);cx.restore();
}

/* text objects: add, edit, move, delete */
function selectText(o){
  IMG.sel=o;IMG.es=false;
  $('#txt').value=o.text;$('#ff').value=o.font;$('#fs').value=o.size;$('#tcol').value=o.color;drawOv();
}
function addText(p){
  snap(false);
  const o={id:IMG.nid++,text:$('#txt').value.trim()||'Your text',x:Math.round(p.x),y:Math.round(p.y),font:$('#ff').value,sx:1,size:+$('#fs').value,color:$('#tcol').value};
  IMG.texts.push(o);selectText(o);$('#txt').value=o.text;IMG.es=true;
}
function updSel(k,v){
  const o=IMG.sel;if(!o||IMG.mode!=='text')return;
  if(!IMG.es){snap(false);IMG.es=true}
  o[k]=v;DIRTY.wsImg=true;drawOv();
}
$('#txt').oninput=e=>updSel('text',e.target.value);
$('#ff').oninput=e=>updSel('font',e.target.value);
$('#fs').oninput=e=>updSel('size',+e.target.value);
$('#tcol').oninput=e=>updSel('color',e.target.value);
function delText(){if(!IMG.sel)return;snap(false);IMG.texts=IMG.texts.filter(o=>o!==IMG.sel);IMG.sel=null;drawOv()}
$('#txtDel').onclick=()=>{if(!IMG.sel)return toast('Tap a text first to select it.');delText()};

/* pointer input: mouse, pen and touch. Two fingers pinch and move the view. */
const ptrs=new Map();let drag=null,pinch=null;
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('pointerdown',e=>{
  e.preventDefault();
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  try{cv.setPointerCapture(e.pointerId)}catch(_){}
  if(ptrs.size===2){
    cancelDrag();const [a,b]=[...ptrs.values()];
    pinch={d:dist(a,b),z:curScale(),mx:(a.x+b.x)/2,my:(a.y+b.y)/2};return;
  }
  if(ptrs.size>2||pinch)return;
  const p=pos(e),m=IMG.mode,c={x:e.clientX,y:e.clientY};
  if(m==='pan'){drag={type:'pan',c,sl:stage.scrollLeft,st:stage.scrollTop};cv.style.cursor='grabbing';return}
  if(m==='text'){
    const hk=handleAt(p);
    if(hk){const o=IMG.sel,b=box(o);drag={type:'thandle',k:hk,o,c,w0:b.w,h0:o.size*1.2,size0:o.size,sx0:o.sx||1,moved:false};return}
    const h=hit(p);
    if(h){selectText(h);drag={type:'tmove',o:h,c,dx:p.x-h.x,dy:p.y-h.y,moved:false}}
    else drag={type:'tnew',p0:p,c,moved:false};
    return;
  }
  if(m==='badge'){drag={type:'badge',p0:p,c,moved:false};return}
  drag={type:'tool',p0:p,c,last:p,pts:[p],started:false,base:null};
});
function step(ev){
  const d=drag,p=pos(ev),c={x:ev.clientX,y:ev.clientY},m=IMG.mode;
  const far=dist(c,d.c)>(ev.pointerType==='touch'?8:4);
  if(d.type==='pan'){stage.scrollLeft=d.sl-(c.x-d.c.x);stage.scrollTop=d.st-(c.y-d.c.y);return}
  if(d.type==='thandle'){
    if(!d.moved&&far){snap(false);d.moved=true}
    if(d.moved){
      const o=d.o;
      if(d.k==='r')o.sx=Math.max(.2,Math.min(8,d.sx0*(p.x-o.x)/d.w0));
      else if(d.k==='b')o.size=Math.max(8,Math.min(600,(p.y-o.y)/1.2));
      else{const f=Math.max(.15,((p.x-o.x)/d.w0+(p.y-o.y)/d.h0)/2);o.size=Math.max(8,Math.min(600,d.size0*f))}
      $('#fs').value=Math.min(+$('#fs').max,Math.round(o.size));DIRTY.wsImg=true;drawOv();
    }
    return;
  }
  if(d.type==='tmove'){
    if(!d.moved&&far){snap(false);d.moved=true}
    if(d.moved){d.o.x=Math.round(p.x-d.dx);d.o.y=Math.round(p.y-d.dy);drawOv()}
    return;
  }
  if(d.type==='tnew'||d.type==='badge'){if(far)d.moved=true;return}
  if(!d.started){
    if(!far)return;
    d.started=true;snap();
    if(m==='hl'||m==='arrow'||m==='rect')d.base=state();
    d.last=d.p0;
  }
  if(m==='draw'){seg(d.last,p);d.last=p}
  else if(m==='hl'){d.pts.push(p);cx.putImageData(d.base,0,0);strokePath(d.pts)}
  else if(m==='arrow'||m==='rect'){cx.putImageData(d.base,0,0);shape(d.p0,p,m)}
  else showSel(rect(d.p0,p));
}
cv.addEventListener('pointermove',e=>{
  if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&ptrs.size>=2){
    const [a,b]=[...ptrs.values()],d=dist(a,b),mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    setZoom(pinch.z*d/pinch.d);stage.scrollLeft-=mx-pinch.mx;stage.scrollTop-=my-pinch.my;pinch.mx=mx;pinch.my=my;return;
  }
  if(!drag||ptrs.size>1)return;
  const list=e.getCoalescedEvents?e.getCoalescedEvents():[];
  (list.length?list:[e]).forEach(step);
});
function cancelDrag(){
  if(drag&&drag.type==='tool'&&drag.started){const h=IMG.hist.pop();if(h)applyH(h)}
  drag=null;$('#sel').style.display='none';
}
cv.addEventListener('pointerup',e=>{
  const had=ptrs.delete(e.pointerId);
  if(pinch){if(ptrs.size<2)pinch=null;return}
  if(!drag||!had)return;
  const d=drag,m=IMG.mode;drag=null;$('#sel').style.display='none';
  if(d.type==='pan'){cv.style.cursor='grab';return}
  if(d.type==='tnew'&&!d.moved)addText(d.p0);
  else if(d.type==='badge'&&!d.moved)addBadge(d.p0);
  else if(d.type==='tool'&&d.started&&(m==='crop'||m==='blur'||m==='pixel')){
    const r=rect(d.p0,pos(e));
    if(r.w>4&&r.h>4)applyArea(r);else{const h=IMG.hist.pop();if(h)applyH(h)}
  }
});
cv.addEventListener('pointercancel',e=>{ptrs.delete(e.pointerId);if(!pinch)cancelDrag()});

async function imgSave(){
  if(!guard())return;
  const fmt=$('#fmt').value,t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;
  const tc=t.getContext('2d');
  if(fmt!=='image/png'){tc.fillStyle='#fff';tc.fillRect(0,0,t.width,t.height)}
  const canF='filter' in tc;
  if(canF)tc.filter=filterStr();else if(filterStr()!==RESET)toast('This browser cannot apply adjustments when saving. Use Chrome, Edge or Firefox.');
  tc.drawImage(cv,0,0);
  if(canF)tc.filter='none';
  paintTexts(tc);
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[fmt];
  await new Promise(res=>t.toBlob(b=>{if(b){saveBlob(b,'edited-image.'+ext);DIRTY.wsImg=false}else toast('The image could not be saved.');res()},fmt,.92));
}
$('#imgDl').onclick=imgSave;SAVE.wsImg=imgSave;

/* ---------- TEXT EXTRACTOR (OCR) ---------- */
const TESS='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const HTMLDOCX='https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js';
let ocrFile=null;
const OCR={meta:null};
function prepImage(file){
  return new Promise((ok,no)=>{
    const im=new Image();
    im.onload=()=>{
      const k=Math.min(3,Math.max(1,2200/Math.max(im.naturalWidth,1)));
      const w=Math.round(im.naturalWidth*k),h=Math.round(im.naturalHeight*k);
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.imageSmoothingQuality='high';x.drawImage(im,0,0,w,h);
      URL.revokeObjectURL(im.src);ok(c);
    };
    im.onerror=()=>no(new Error('image'));im.src=URL.createObjectURL(file);
  });
}
$('#ocrIn').onchange=e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!f.type.startsWith('image/'))return toast('Please choose an image file (JPG, PNG, WebP).');
  ocrFile=f;$('#ocrImg').src=URL.createObjectURL(f);$('#ocrText').value='';openWs('wsOcr');runOcr();
};
async function runOcr(){
  if(!ocrFile||!guard())return;
  const btn=$('#ocrRun'),st=$('#ocrStat');btn.disabled=true;st.textContent='Preparing the image...';
  try{
    const canvas=await prepImage(ocrFile);
    st.textContent='Loading the text engine...';await load(TESS);
    const worker=await Tesseract.createWorker($('#ocrLang').value,1,{logger:m=>{if(m.status)st.textContent=m.status.replace(/_/g,' ')+(m.progress?' '+Math.round(m.progress*100)+'%':'')}});
    await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:$('#ocrMode').value});
    const {data}=await worker.recognize(canvas,{},{text:true,blocks:true});await worker.terminate();
    const ws=ocrWords(data);let txt;OCR.meta=null;
    if(ws.length>2){OCR.meta=layoutFromWords(ws);txt=OCR.meta.text}
    else txt=data.text.replace(/\r/g,'').replace(/[ \t]+$/gm,'').trim();
    $('#ocrText').value=txt;DIRTY.wsOcr=false;
    st.textContent=txt?`Done. Confidence ${Math.round(data.confidence)}%. Check the text for mistakes, then choose a format and save.`:'No text was found in this image.';
  }catch(err){st.textContent='Text extraction failed. Check your internet connection and try again.'}
  finally{btn.disabled=false}
}
$('#ocrRun').onclick=runOcr;$('#ocrLang').onchange=runOcr;
$('#ocrCopy').onclick=async()=>{
  const ta=$('#ocrText');if(!ta.value)return toast('There is no text to copy.');
  try{await navigator.clipboard.writeText(ta.value)}catch(e){ta.select();document.execCommand('copy')}
  toast('Text copied.');
};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function htmlDoc(v){
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Extracted text</title></head><body style="font-family:'+((OCR.meta&&OCR.meta.font)||'Arial')+',sans-serif;line-height:1.4">'+blocksHtmlBody(textBlocks(v,OCR.meta))+'</body></html>';
}
function toCsv(v){return blocksRows(textBlocks(v,OCR.meta)).map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n')}
async function textPdf(v){
  if(/[^\x00-\xFF\u20AC]/.test(v))return toast('PDF supports Latin letters only. Use Word or Web page for other languages.');
  const d=await PDFLib.PDFDocument.create(),f=await d.embedFont(PDFLib.StandardFonts.Courier);
  const lines=v.replace(/\t/g,'    ').split('\n'),W=595,H=842,M=40,longest=Math.max(...lines.map(l=>l.length),20);
  const S=Math.min(10,(W-2*M)/(longest*.6)),L=S*1.35;let p=d.addPage([W,H]),y=H-M;
  for(const ln of lines){if(y<M){p=d.addPage([W,H]);y=H-M}if(ln.trim())p.drawText(ln,{x:M,y:y-S,size:S,font:f});y-=L}
  saveBlob(new Blob([await d.save()],{type:'application/pdf'}),'extracted-text.pdf');
}
async function ocrSave(){
  const v=$('#ocrText').value,f=$('#ocrFmt').value,n='extracted-text';
  if(!v.trim())return toast('There is no text to save.');
  try{
    if(f==='txt'||f==='md')saveBlob(new Blob([v],{type:'text/plain'}),n+'.'+f);
    else if(f==='html')saveBlob(new Blob([htmlDoc(v)],{type:'text/html'}),n+'.html');
    else if(f==='csv')saveBlob(new Blob(['\ufeff'+toCsv(v)],{type:'text/csv'}),n+'.csv');
    else{
      if(!guard())return;
      if(f==='docx'){await load(HTMLDOCX);saveBlob(htmlDocx.asBlob(htmlDoc(v)),n+'.docx')}
      else if(f==='xlsx'){await load(SHEETJS);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(blocksRows(textBlocks(v,OCR.meta))),'Text');saveBlob(new Blob([XLSX.write(wb,{bookType:'xlsx',type:'array'})]),n+'.xlsx')}
      else{await load(PDFLIB);await textPdf(v)}
    }
    DIRTY.wsOcr=false;
  }catch(err){toast('The file could not be saved. Check your internet connection and try again.')}
}
$('#ocrDl').onclick=ocrSave;SAVE.wsOcr=ocrSave;
$('#ocrText').addEventListener('input',()=>{DIRTY.wsOcr=true});

/* ---------- PDF EDITOR ---------- */
const PDFLIB='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',PDFJSW='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const PDF={bytes:null,hist:[],name:'document',doc:null,pages:[],objs:[],sel:null,mode:'select',nid:1};
const pdfDoc=()=>PDFLib.PDFDocument.load(PDF.bytes);
async function pdfSet(doc){PDF.hist.push(PDF.bytes);PDF.bytes=await doc.save();DIRTY.wsPdf=true;await pdfRender()}
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
  try{if(!(await pdfApply()))return;await fn(await pdfDoc())}catch(err){toast(err&&err.message==='range'?'Please enter valid page numbers, for example 2,5-7.':'That change could not be applied.')}
}
$('#pdfIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  if(!/\.pdf$/i.test(f.name))return toast('Please choose a PDF file.');
  try{
    await load(PDFLIB);await load(PDFJS);pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJSW;
    const b=new Uint8Array(await f.arrayBuffer()),d=await PDFLib.PDFDocument.load(b);
    PDF.bytes=b;PDF.hist=[];PDF.name=f.name.replace(/\.pdf$/i,'');openWs('wsPdf');await pdfRender();
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
  if(PDF.objs.length){delObj(PDF.objs[PDF.objs.length-1]);return}
  const b=PDF.hist.pop();if(!b)return toast('Nothing to undo.');
  PDF.bytes=b;DIRTY.wsPdf=PDF.hist.length>0;try{await pdfRender()}catch(e){toast('Could not undo.')}
};
$('#pdfDl').onclick=async()=>{
  if(!PDF.bytes||!(await pdfApply()))return;
  saveBlob(new Blob([PDF.bytes],{type:'application/pdf'}),PDF.name+'-edited.pdf');DIRTY.wsPdf=false;
};
SAVE.wsPdf=()=>$('#pdfDl').onclick();
$('#togglePdf').onclick=e=>{const p=$('#pdfPanel');p.classList.toggle('hide');e.currentTarget.setAttribute('aria-expanded',!p.classList.contains('hide'))};

/* PDF page viewer and on-page editing (text, pictures, whiteout) */
const CSSF={helv:'Helvetica,Arial,sans-serif',times:'"Times New Roman",Times,serif',cour:'"Courier New",Courier,monospace'};
const PFONT={helv:['Helvetica','HelveticaBold','HelveticaOblique','HelveticaBoldOblique'],times:['TimesRoman','TimesRomanBold','TimesRomanItalic','TimesRomanBoldItalic'],cour:['Courier','CourierBold','CourierOblique','CourierBoldOblique']};
const PHINT={select:'Select an item to edit it. Drag its ✥ corner to move it and its round corner to resize it.',text:'Tap or click on the page to add text. Then type, and change the font, size and colour.',white:'Drag a box over the text you want to replace. The new text will use the closest matching font and colour.'};
async function pdfRender(){
  const box=$('#pdfPages');box.textContent='';PDF.pages=[];PDF.objs=[];PDF.sel=null;
  if(PDF.doc){try{PDF.doc.destroy()}catch(e){}}
  PDF.doc=await pdfjsLib.getDocument({data:PDF.bytes.slice()}).promise;
  const n=PDF.doc.numPages;$('#pdfCount').textContent=n+(n===1?' page':' pages');
  const avail=Math.max(280,Math.min(980,$('#pdfStage').clientWidth-24)),dpr=Math.min(2,window.devicePixelRatio||1);
  for(let i=1;i<=Math.min(n,60);i++){
    const page=await PDF.doc.getPage(i),b=page.getViewport({scale:1}),vp=page.getViewport({scale:avail/b.width});
    const wrap=document.createElement('div');wrap.className='pg';wrap.style.width=vp.width+'px';wrap.style.height=vp.height+'px';
    const c=document.createElement('canvas');c.width=Math.floor(vp.width*dpr);c.height=Math.floor(vp.height*dpr);c.style.width=vp.width+'px';c.style.height=vp.height+'px';
    const ovl=document.createElement('div');ovl.className='ovl';wrap.append(c,ovl);box.appendChild(wrap);
    const pg={wrap,canvas:c,ovl,w:vp.width,h:vp.height,page,vp};PDF.pages.push(pg);bindPage(pg,i-1);
    await page.render({canvasContext:c.getContext('2d',{willReadFrequently:true}),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise;
  }
  if(n>60)toast('Showing the first 60 pages. Page tools still apply to the whole file.');
}
function setPm(m){
  PDF.mode=m;$$('[data-pm]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.pm===m));
  $('#pdfHint').textContent=PHINT[m];
  const box=$('#pdfPages');box.classList.toggle('draw',m==='white');box.classList.toggle('addt',m==='text');
}
$$('[data-pm]').forEach(b=>b.onclick=()=>setPm(b.dataset.pm));
function bindPage(pg,pi){
  const o=pg.ovl;let rb=null;
  o.addEventListener('pointerdown',e=>{
    if(e.target!==o)return;
    const r=o.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    if(PDF.mode==='white'){const el=document.createElement('div');el.className='rb';o.appendChild(el);rb={x,y,el};o.setPointerCapture(e.pointerId)}
    else if(PDF.mode==='text')rb={x,y,tap:true};
    else selectObj(null);
  });
  o.addEventListener('pointermove',e=>{
    if(!rb||!rb.el)return;
    const r=o.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    Object.assign(rb.el.style,{left:Math.min(x,rb.x)+'px',top:Math.min(y,rb.y)+'px',width:Math.abs(x-rb.x)+'px',height:Math.abs(y-rb.y)+'px'});
  });
  o.addEventListener('pointerup',e=>{
    if(!rb)return;
    const r=o.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,s=rb;rb=null;
    if(s.tap){if(Math.hypot(x-s.x,y-s.y)<8)addPdfText(pi,s.x,s.y)}
    else{s.el.remove();const R={x:Math.min(x,s.x),y:Math.min(y,s.y),w:Math.abs(x-s.x),h:Math.abs(y-s.y)};if(R.w>6&&R.h>6)addWhite(pi,R)}
  });
}
function styleText(o){
  o.el.querySelector('.tx').style.cssText=`font:${o.ital?'italic ':''}${o.bold?'bold ':''}${o.size}px/1.2 ${CSSF[o.font]};color:${o.color}`;
}
const sizeEl=o=>{o.el.style.width=o.w+'px';o.el.style.height=o.h+'px'};
function mk(o){
  const el=document.createElement('div');el.className='pob '+o.type;el.style.left=o.x+'px';el.style.top=o.y+'px';o.el=el;
  if(o.type==='text'){
    const tx=document.createElement('div');tx.className='tx';tx.contentEditable='true';tx.spellcheck=false;tx.textContent=o.text;el.appendChild(tx);styleText(o);
    tx.addEventListener('input',()=>{o.text=tx.innerText;DIRTY.wsPdf=true});
    tx.addEventListener('focus',()=>selectObj(o));
  }else if(o.type==='img'){
    const im=new Image();im.src=o.src;im.draggable=false;im.style.cssText='width:100%;height:100%;display:block;pointer-events:none';el.appendChild(im);sizeEl(o);
  }else{el.style.background=o.fill;sizeEl(o)}
  const h=document.createElement('i');h.className='h';h.contentEditable='false';
  const mv=document.createElement('i');mv.className='mv';mv.contentEditable='false';mv.textContent='✥';
  el.append(h,mv);
  h.addEventListener('pointerdown',e=>pdfDrag(e,o,'size'));mv.addEventListener('pointerdown',e=>pdfDrag(e,o,'move'));
  if(o.type!=='text')el.addEventListener('pointerdown',e=>{if(e.target===el||e.target.tagName==='IMG')pdfDrag(e,o,'move')});
  PDF.pages[o.pi].ovl.appendChild(el);o.id=PDF.nid++;PDF.objs.push(o);DIRTY.wsPdf=true;selectObj(o);return o;
}
function pdfDrag(e,o,kind){
  e.preventDefault();e.stopPropagation();selectObj(o);
  const pg=PDF.pages[o.pi],sx=e.clientX,sy=e.clientY,ox=o.x,oy=o.y,ow=o.w||o.el.offsetWidth,oh=o.h,os=o.size;
  const mv=ev=>{
    const dx=ev.clientX-sx,dy=ev.clientY-sy;
    if(kind==='move'){o.x=Math.max(0,Math.min(pg.w-20,ox+dx));o.y=Math.max(0,Math.min(pg.h-10,oy+dy));o.el.style.left=o.x+'px';o.el.style.top=o.y+'px'}
    else if(o.type==='text'){o.size=Math.max(6,Math.min(400,os*(ow+dx)/ow));styleText(o);$('#pSize').value=Math.min(120,Math.round(o.size))}
    else if(o.type==='img'){o.w=Math.max(20,ow+dx);o.h=o.w*o.ih/o.iw;sizeEl(o)}
    else{o.w=Math.max(10,ow+dx);o.h=Math.max(10,oh+dy);sizeEl(o)}
    DIRTY.wsPdf=true;
  };
  const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);removeEventListener('pointercancel',up)};
  addEventListener('pointermove',mv);addEventListener('pointerup',up);addEventListener('pointercancel',up);
}
function selectObj(o){
  if(PDF.sel&&PDF.sel.el)PDF.sel.el.classList.remove('sel');
  PDF.sel=o;if(!o)return;o.el.classList.add('sel');
  if(o.type==='text'){
    $('#pFont').value=o.font;$('#pSize').value=Math.min(120,Math.round(o.size));$('#pCol').value=o.color;
    $('#pBold').setAttribute('aria-pressed',!!o.bold);$('#pItal').setAttribute('aria-pressed',!!o.ital);
  }
}
function delObj(o){if(!o)return;o.el.remove();PDF.objs=PDF.objs.filter(x=>x!==o);if(PDF.sel===o)PDF.sel=null}
$('#pDel').onclick=()=>{if(!PDF.sel)return toast('Select an item first.');delObj(PDF.sel)};
function curStyle(){return{font:$('#pFont').value,bold:$('#pBold').getAttribute('aria-pressed')==='true',ital:$('#pItal').getAttribute('aria-pressed')==='true',size:+$('#pSize').value,color:$('#pCol').value}}
function addPdfText(pi,x,y){
  const o=mk({type:'text',pi,x,y,text:'Type here',...curStyle()});
  const tx=o.el.querySelector('.tx');tx.focus();document.getSelection().selectAllChildren(tx);
}
function upd(k,v){const o=PDF.sel;if(!o||o.type!=='text')return;o[k]=v;styleText(o);DIRTY.wsPdf=true}
$('#pFont').oninput=e=>upd('font',e.target.value);
$('#pSize').oninput=e=>upd('size',+e.target.value);
$('#pCol').oninput=e=>upd('color',e.target.value);
$('#pBold').onclick=e=>{const v=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',v);upd('bold',v)};
$('#pItal').onclick=e=>{const v=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',v);upd('ital',v)};
document.addEventListener('keydown',e=>{
  if(cur==='wsPdf'&&(e.key==='Delete')&&PDF.sel&&!e.target.closest('.tx')&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){delObj(PDF.sel)}
});

/* Whiteout: sample the page colour, find the old text, match its font */
function sample(pg,R){
  const c=pg.canvas,k=c.width/pg.w,ctx=c.getContext('2d',{willReadFrequently:true});
  const X=Math.max(0,Math.floor(R.x*k)),Y=Math.max(0,Math.floor(R.y*k)),W=Math.max(1,Math.min(c.width-X,Math.ceil(R.w*k))),H=Math.max(1,Math.min(c.height-Y,Math.ceil(R.h*k)));
  const avg=(x,y,w,h)=>{if(w<=0||h<=0)return null;const d=ctx.getImageData(x,y,w,h).data,n=d.length/4;let r=0,g=0,b=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2]}return[r/n,g/n,b/n]};
  const t=3,edges=[avg(X,Math.max(0,Y-t),W,Math.min(t,Y)),avg(X,Y+H,W,Math.min(t,c.height-Y-H)),avg(Math.max(0,X-t),Y,Math.min(t,X),H),avg(X+W,Y,Math.min(t,c.width-X-W),H)].filter(Boolean);
  const bg=edges.length?[0,1,2].map(i=>edges.reduce((s,e)=>s+e[i],0)/edges.length):[255,255,255];
  const lum=a=>.3*a[0]+.59*a[1]+.11*a[2],dark=lum(bg)>=110,d=ctx.getImageData(X,Y,W,H).data;
  let best=null,bl=dark?999:-1;
  for(let i=0;i<d.length;i+=4){const px=[d[i],d[i+1],d[i+2]],l=lum(px);if(dark?l<bl:l>bl){bl=l;best=px}}
  if(!best||Math.abs(lum(best)-lum(bg))<40)best=dark?[0,0,0]:[255,255,255];
  const hex=a=>'#'+a.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  return{bg:hex(bg),fg:hex(best)};
}
async function matchStyle(pg,R){
  const tc=await pg.page.getTextContent(),U=pdfjsLib.Util,hits=[];
  tc.items.forEach(it=>{
    if(!it.str)return;
    const m=U.transform(pg.vp.transform,it.transform),h=Math.hypot(m[2],m[3]),w=it.width*pg.vp.scale,x=m[4],y=m[5]-h;
    const ix=Math.min(x+w,R.x+R.w)-Math.max(x,R.x),iy=Math.min(y+h,R.y+R.h)-Math.max(y,R.y);
    if(ix>0&&iy>0&&ix*iy>.3*w*h)hits.push({it,x,b:m[5],h,y});
  });
  if(!hits.length)return null;
  hits.sort((a,b)=>Math.abs(a.y-b.y)<a.h*.5?a.x-b.x:a.y-b.y);
  let text='',prev=null;
  hits.forEach(k=>{text+=(prev&&Math.abs(prev.y-k.y)>=k.h*.5?'\n':'')+k.it.str;prev=k});
  const f=hits.find(k=>k.it.str.trim())||hits[0],fam=(tc.styles[f.it.fontName]||{}).fontFamily||'';
  return{text:text.trim(),x:f.x,y:f.b-.85*f.h,size:f.h,font:/mono|courier/i.test(fam)?'cour':(/serif/i.test(fam)&&!/sans/i.test(fam)?'times':'helv')};
}
async function addWhite(pi,R){
  const pg=PDF.pages[pi],s=sample(pg,R);
  mk({type:'white',pi,x:R.x,y:R.y,w:R.w,h:R.h,fill:s.bg});
  let m=null;try{m=await matchStyle(pg,R)}catch(e){}
  const o=mk({type:'text',pi,text:m&&m.text?m.text:'Type the correct text',x:m?m.x:R.x,y:m?m.y:R.y,font:m?m.font:'helv',bold:false,ital:false,size:m?m.size:Math.max(10,R.h*.7),color:s.fg});
  const tx=o.el.querySelector('.tx');tx.focus();document.getSelection().selectAllChildren(tx);
  toast(m?'Old text found. Edit it to the correct text.':'No old text was found. Type the new text.');
}

/* Pictures */
$('#pdfImg').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!PDF.bytes)return;
  if(!f.type.startsWith('image/'))return toast('Please choose an image file.');
  try{
    const url=URL.createObjectURL(f),im=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=url});
    let bytes,kind;
    if(f.type==='image/jpeg'||f.type==='image/png'){bytes=new Uint8Array(await f.arrayBuffer());kind=f.type==='image/png'?'png':'jpg'}
    else{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);
      bytes=new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer());kind='png'}
    const st=$('#pdfStage').getBoundingClientRect(),mid=st.top+st.height/2;
    let pi=PDF.pages.findIndex(p=>p.wrap.getBoundingClientRect().bottom>mid);if(pi<0)pi=0;
    const pg=PDF.pages[pi],w=pg.w*.35,h=w*im.naturalHeight/im.naturalWidth,top=pg.wrap.getBoundingClientRect().top;
    mk({type:'img',pi,x:pg.w*.3,y:Math.max(0,Math.min(pg.h-h,mid-top-h/2)),w,h,iw:im.naturalWidth,ih:im.naturalHeight,src:url,bytes,kind});
    toast('Picture added. Drag it to move it and use the round corner to resize it.');
  }catch(err){toast('That picture could not be added.')}
};

/* Apply pending edits to the real PDF */
const hexRgb=x=>PDFLib.rgb(parseInt(x.slice(1,3),16)/255,parseInt(x.slice(3,5),16)/255,parseInt(x.slice(5,7),16)/255);
async function pdfApply(){
  if(!PDF.objs.length)return true;
  if(!guard())return false;
  try{
    const d=await PDFLib.PDFDocument.load(PDF.bytes),P=d.getPages(),fonts={};let lost=false;
    if(PDF.objs.some(o=>P[o.pi].getRotation().angle%360!==0)){toast('Rotate the page back to 0° before adding items to it.');return false}
    for(const o of PDF.objs){
      const pg=PDF.pages[o.pi],page=P[o.pi],cb=page.getCropBox(),s=cb.width/pg.w,X=cb.x+o.x*s,Y=cb.y+cb.height-o.y*s;
      if(o.type==='white')page.drawRectangle({x:X,y:Y-o.h*s,width:o.w*s,height:o.h*s,color:hexRgb(o.fill)});
      else if(o.type==='img'){const im=o.kind==='png'?await d.embedPng(o.bytes):await d.embedJpg(o.bytes);page.drawImage(im,{x:X,y:Y-o.h*s,width:o.w*s,height:o.h*s})}
      else{
        const key=PFONT[o.font][(o.bold?1:0)+(o.ital?2:0)];
        const font=fonts[key]||(fonts[key]=await d.embedFont(PDFLib.StandardFonts[key]));
        const txt=(o.text||'').replace(/\n$/,'');
        if(/[^\x20-\x7E\xA0-\xFF\n]/.test(txt))lost=true;
        txt.replace(/[^\x20-\x7E\xA0-\xFF\n]/g,'?').split('\n').forEach((ln,i)=>{
          if(ln)page.drawText(ln,{x:X+2*s,y:Y-(o.size*(.85+1.2*i))*s,size:o.size*s,font,color:hexRgb(o.color)});
        });
      }
    }
    PDF.hist.push(PDF.bytes);PDF.bytes=await d.save();DIRTY.wsPdf=true;
    if(lost)toast('Letters outside the standard Latin set were replaced with ?');
    await pdfRender();return true;
  }catch(err){toast('The edits could not be applied to the PDF.');return false}
}
$('#pApply').onclick=async()=>{if(!PDF.objs.length)return toast('There are no edits to apply.');if(await pdfApply())toast('Edits applied to the PDF.')};

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
  b.onclick=()=>{$('#doc').focus();document.execCommand(b.dataset.cmd);DIRTY.wsDoc=true};
});
$('#doc').addEventListener('input',()=>{DIRTY.wsDoc=true});
$('#docPrint').onclick=()=>{window.print();DIRTY.wsDoc=false};SAVE.wsDoc=()=>$('#docDl').onclick();
$('#docDl').onclick=async()=>{
  try{
    await load('https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js');
    const html='<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'+$('#doc').innerHTML+'</body></html>';
    saveBlob(htmlDocx.asBlob(html),DOC.name+'-edited.docx');DIRTY.wsDoc=false;
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
    DIRTY.wsXl=true;
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
  XLSX.writeFile(XL.wb,XL.name+'-edited.xlsx');DIRTY.wsXl=false;
  toast('Saved. If a formula shows an old value, open the file in Excel and press F9.');
};

SAVE.wsXl=()=>$('#xlDl').onclick();
