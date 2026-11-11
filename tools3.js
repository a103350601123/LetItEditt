/* LetItEdit: CV creator (50 layouts) and barcode creator. Runs in the browser. */
'use strict';
const BWIP='https://cdn.jsdelivr.net/npm/bwip-js@4/dist/bwip-js-min.js';

/* ---------- CV creator ---------- */
const CV_STRUCT=['Classic','Banner','Sidebar left','Sidebar right','Centered','Two column','Side labels','Boxed headings','Minimal','Timeline'];
const CV_KEY=['classic','banner','sideL','sideR','center','twoCol','label','boxed','minimal','timeline'];
const CV_PAL=[['Navy','#1f3a5f'],['Teal','#0f766e'],['Crimson','#9f1239'],['Charcoal','#374151'],['Violet','#5b21b6']];
const CV_TPL=[];
CV_KEY.forEach((k,si)=>CV_PAL.forEach((p,pi)=>CV_TPL.push({id:CV_TPL.length+1,s:k,name:CV_STRUCT[si]+' '+p[0],a:p[1],serif:(si+pi)%2===1})));
const CV_SAMPLE={name:'Alex Morgan',title:'Senior Marketing Manager',email:'alex.morgan@example.com',phone:'+1 555 010 2030',loc:'London, United Kingdom',link:'linkedin.com/in/alexmorgan',
  sum:'Results-driven marketing manager with 8+ years of experience leading digital campaigns, growing brand reach and managing cross-functional teams.',
  exp:[{role:'Marketing Manager',org:'Brightwave Ltd',dates:'2021 - Present',det:'Led a team of 6 and grew organic traffic by 85% in two years\nManaged an annual budget of $450,000 across paid and owned channels\nLaunched 3 product campaigns that increased revenue by 22%'},
       {role:'Digital Marketing Specialist',org:'Northfield Agency',dates:'2017 - 2021',det:'Planned and ran campaigns for 15+ clients\nImproved email conversion rates from 2.1% to 4.8%'}],
  edu:[{role:'BSc Business Administration',org:'University of Leeds',dates:'2013 - 2016',det:'First Class Honours'}],
  skills:'SEO, Google Analytics, Content Strategy, Team Leadership, Budgeting, Copywriting',langs:'English (native), Spanish (fluent), French (basic)'};
let cvLost=false;
/* Build a CV as a real PDF with selectable text */
async function cvBuild(d,t){
  const L=PDFLib,doc=await L.PDFDocument.create(),SF=L.StandardFonts,rgb=L.rgb;
  const fam=t.serif?[SF.TimesRoman,SF.TimesRomanBold,SF.TimesRomanItalic]:[SF.Helvetica,SF.HelveticaBold,SF.HelveticaOblique];
  const fr=await doc.embedFont(fam[0]),fb=await doc.embedFont(fam[1]),fi=await doc.embedFont(fam[2]);
  const W=595.28,H=841.89,M=42,top2=H-M;
  const hx=h=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
  const acc=hx(t.a),ink=rgb(.13,.15,.19),mute=rgb(.38,.41,.46),white=rgb(1,1,1),pages=[];
  const clean=s=>{s=String(s==null?'':s);const r=s.replace(/[^\x20-\x7E\xA0-\xFF\u2022\u20AC\n]/g,'?');if(r!==s)cvLost=true;return r};
  const fitSize=(f,tx,s,mw)=>{while(s>7&&f.widthOfTextAtSize(tx,s)>mw)s-=.5;return s};
  const decor=(p,i)=>{
    if(t.s==='sideL')p.drawRectangle({x:0,y:0,width:190,height:H,color:acc});
    else if(t.s==='sideR')p.drawRectangle({x:W-190,y:0,width:190,height:H,color:acc});
    else if(t.s==='banner'&&i===0)p.drawRectangle({x:0,y:H-120,width:W,height:120,color:acc});
    else if(t.s==='twoCol')p.drawRectangle({x:W-M-195,y:0,width:195+M,height:i===0?H-132:H,color:rgb(.95,.96,.97)});
  };
  const newPage=()=>{const p=doc.addPage([W,H]);pages.push(p);decor(p,pages.length-1);return p};
  const p0=newPage();
  const name=clean(d.name||'Your Name'),title=clean(d.title||''),contact=[d.email,d.phone,d.loc,d.link].filter(Boolean).map(clean);
  const col=(x,w,y,inv)=>({x,w,y,pi:0,inv:!!inv});
  let main,side=null;
  const ct=contact.join('   |   ');
  if(t.s==='banner'){
    const ns=fitSize(fb,name,28,W-2*M);p0.drawText(name,{x:M,y:H-58,size:ns,font:fb,color:white});
    if(title)p0.drawText(title,{x:M,y:H-80,size:12.5,font:fi,color:white});
    if(ct)p0.drawText(ct,{x:M,y:H-102,size:fitSize(fr,ct,9,W-2*M),font:fr,color:white});
    main=col(M,W-2*M,H-120-26);
  }else if(t.s==='center'){
    const ns=fitSize(fb,name,26,W-2*M);p0.drawText(name,{x:(W-fb.widthOfTextAtSize(name,ns))/2,y:top2-26,size:ns,font:fb,color:acc});let y=top2-30;
    if(title){p0.drawText(title,{x:(W-fi.widthOfTextAtSize(title,12))/2,y:y-14,size:12,font:fi,color:mute});y-=20}
    if(ct){const cs=fitSize(fr,ct,9,W-2*M);p0.drawText(ct,{x:(W-fr.widthOfTextAtSize(ct,cs))/2,y:y-12,size:cs,font:fr,color:mute})}
    y-=20;p0.drawLine({start:{x:M,y:y-4},end:{x:W-M,y:y-4},thickness:1.2,color:acc});
    main=col(M,W-2*M,y-18);
  }else if(t.s==='sideL'||t.s==='sideR'){
    const mx=t.s==='sideL'?216:M,mw=W-190-26-M-(t.s==='sideR'?10:0),sx=t.s==='sideL'?20:W-170;
    const ns=fitSize(fb,name,24,mw);p0.drawText(name,{x:mx,y:top2-24,size:ns,font:fb,color:ink});
    if(title)p0.drawText(title,{x:mx,y:top2-44,size:12,font:fi,color:acc});
    main=col(mx,mw,top2-66);side=col(sx,150,top2-4,true);
  }else{
    const HD={classic:[fb,acc,26],boxed:[fb,ink,26],minimal:[fr,ink,30],timeline:[fb,acc,26],label:[fb,acc,26],twoCol:[fb,acc,26]}[t.s]||[fb,acc,26];
    const ns=fitSize(HD[0],name,HD[2],W-2*M);let y=top2;
    p0.drawText(name,{x:M,y:y-ns,size:ns,font:HD[0],color:HD[1]});y-=ns+8;
    if(title){p0.drawText(title,{x:M,y:y-12,size:12,font:fi,color:(t.s==='boxed'||t.s==='minimal')?mute:ink});y-=20}
    if(ct)p0.drawText(ct,{x:M,y:y-10,size:fitSize(fr,ct,9,W-2*M),font:fr,color:mute});
    y-=18;p0.drawLine({start:{x:M,y:y-2},end:{x:W-M,y:y-2},thickness:t.s==='minimal'?.5:1.2,color:t.s==='minimal'?rgb(.75,.75,.75):acc});
    const top=y-20;
    if(t.s==='label')main=col(M+105,W-2*M-105,top);
    else if(t.s==='twoCol'){main=col(M,W-2*M-195-22,H-150);side=col(W-M-195+12,183,H-150)}
    else main=col(M,W-2*M,top);
  }
  const room=(c,need)=>{if(c.y-need<M){c.pi++;while(!pages[c.pi])newPage();c.y=top2}};
  function para(c,str,size,font,color,o={}){
    const lh=size*(o.lh||1.28),x=c.x+(o.dx||0),w=c.w-(o.dx||0)-(o.rw||0);
    for(const raw of clean(str).split('\n')){
      if(!raw.trim()){c.y-=lh*.5;continue}
      let line='';
      const out=l=>{room(c,lh);pages[c.pi].drawText(l,{x,y:c.y-size,size,font,color});c.y-=lh};
      for(const wd of raw.split(' ')){const tt=line?line+' '+wd:wd;if(font.widthOfTextAtSize(tt,size)>w&&line){out(line);line=wd}else line=tt}
      if(line)out(line);
    }
  }
  function head(c,label){
    const T=clean(label).toUpperCase();c.y-=8;room(c,34);const p=pages[c.pi];
    if(c.inv){p.drawText(T,{x:c.x,y:c.y-10,size:10.5,font:fb,color:white});c.y-=14;p.drawLine({start:{x:c.x,y:c.y},end:{x:c.x+c.w,y:c.y},thickness:.7,color:white,opacity:.5});c.y-=8;return}
    if(t.s==='boxed'){p.drawRectangle({x:c.x,y:c.y-15,width:c.w,height:15,color:acc});p.drawText(T,{x:c.x+6,y:c.y-11,size:9.5,font:fb,color:white});c.y-=22}
    else if(t.s==='center'){const w=fb.widthOfTextAtSize(T,11);p.drawText(T,{x:c.x+(c.w-w)/2,y:c.y-11,size:11,font:fb,color:acc});c.y-=16;p.drawLine({start:{x:c.x+c.w*.3,y:c.y},end:{x:c.x+c.w*.7,y:c.y},thickness:.8,color:acc});c.y-=8}
    else if(t.s==='label'){p.drawText(T,{x:M,y:c.y-10,size:10,font:fb,color:acc});c.y-=2}
    else if(t.s==='minimal'){p.drawText(T,{x:c.x,y:c.y-10,size:9.5,font:fb,color:mute});c.y-=14;p.drawLine({start:{x:c.x,y:c.y},end:{x:c.x+c.w,y:c.y},thickness:.5,color:rgb(.8,.8,.8)});c.y-=7}
    else{p.drawText(T,{x:c.x,y:c.y-11,size:11,font:fb,color:acc});c.y-=15;p.drawLine({start:{x:c.x,y:c.y},end:{x:c.x+c.w,y:c.y},thickness:.9,color:acc});c.y-=8}
  }
  function entry(c,e){
    const narrow=c.w<260,dx=t.s==='timeline'?16:0,ti=clean(e.role||''),da=clean(e.dates||'');
    room(c,44);
    const pi=c.pi,y0=c.y,p=pages[pi],tc=c.inv?white:ink,mc=c.inv?white:mute;
    const dw=da&&!narrow?fi.widthOfTextAtSize(da,9):0;
    if(t.s==='timeline')p.drawCircle({x:c.x+4,y:y0-7,size:3.2,color:acc});
    para(c,ti,10.5,fb,tc,{dx,rw:dw?dw+10:0,lh:1.25});
    if(dw&&c.pi===pi)p.drawText(da,{x:c.x+c.w-dw,y:y0-9.5,size:9,font:fi,color:mc});
    if(e.org)para(c,e.org,9.5,fi,c.inv?white:(t.s==='boxed'?mute:acc),{dx});
    if(da&&narrow)para(c,da,9,fi,mc,{dx});
    String(e.det||'').split('\n').map(s=>s.trim()).filter(Boolean).forEach(line=>{
      room(c,14);pages[c.pi].drawText('\u2022',{x:c.x+dx,y:c.y-9.5,size:9.5,font:fr,color:c.inv?white:acc});
      para(c,line,9.5,fr,tc,{dx:dx+10,lh:1.3});
    });
    if(t.s==='timeline'&&c.pi===pi)p.drawLine({start:{x:c.x+4,y:y0-11},end:{x:c.x+4,y:c.y+2},thickness:.8,color:acc,opacity:.5});
    c.y-=7;
  }
  const sec=(c,label,fn)=>{head(c,label);fn();c.y-=6};
  const items=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
  const list=(c,label,s)=>{const a=items(s);if(a.length)sec(c,label,()=>{if(c.inv||c.w<260)a.forEach(x=>para(c,x,9.5,fr,c.inv?white:ink));else para(c,a.join('   \u2022   '),9.5,fr,ink,{lh:1.5})})};
  const has=e=>e.role||e.org;
  const ex=(d.exp||[]).filter(has),ed=(d.edu||[]).filter(has);
  const profile=c=>{if(d.sum&&d.sum.trim())sec(c,'Profile',()=>para(c,d.sum,9.5,fr,ink,{lh:1.4}))};
  const exp=c=>{if(ex.length)sec(c,'Experience',()=>ex.forEach(e=>entry(c,e)))};
  const edu=c=>{if(ed.length)sec(c,'Education',()=>ed.forEach(e=>entry(c,e)))};
  if(t.s==='sideL'||t.s==='sideR'){
    if(contact.length)sec(side,'Contact',()=>contact.forEach(x=>para(side,x,9,fr,white)));
    list(side,'Skills',d.skills);list(side,'Languages',d.langs);
    profile(main);exp(main);edu(main);
  }else if(t.s==='twoCol'){
    profile(main);exp(main);list(side,'Skills',d.skills);edu(side);list(side,'Languages',d.langs);
  }else{profile(main);exp(main);edu(main);list(main,'Skills',d.skills);list(main,'Languages',d.langs)}
  return doc.save();
}

const CVM={sel:1,bytes:null,step:1};
let cvQ=Promise.resolve();
async function cvLibs(){await load(PDFLIB);await load(PDFJS);pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJSW}
function cvThumb(tpl,canvas){
  cvQ=cvQ.then(async()=>{
    try{
      const bytes=await cvBuild(CV_SAMPLE,tpl),d=await pdfjsLib.getDocument({data:bytes}).promise,p=await d.getPage(1),b=p.getViewport({scale:1}),vp=p.getViewport({scale:200/b.width});
      canvas.width=vp.width;canvas.height=vp.height;await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;d.destroy();
    }catch(e){}
  });
}
function cvGrid(){
  const g=$('#cvmGrid');if(g.children.length)return;
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){io.unobserve(e.target);cvThumb(CV_TPL[e.target.dataset.i],e.target.querySelector('canvas'))}}),{root:$('#cvmBody'),rootMargin:'300px'});
  CV_TPL.forEach((t,i)=>{
    const b=document.createElement('button');b.type='button';b.className='cvcard';b.dataset.i=i;b.setAttribute('aria-pressed',t.id===CVM.sel);
    b.innerHTML='<canvas width="200" height="283"></canvas><span></span>';b.querySelector('span').textContent=t.id+'. '+t.name;
    b.onclick=()=>{CVM.sel=t.id;$$('.cvcard').forEach(x=>x.setAttribute('aria-pressed',x===b))};
    g.appendChild(b);io.observe(b);
  });
}
function cvAddBlock(box,kind,v){
  v=v||{};const b=document.createElement('div');b.className='cvb';
  const lab=kind==='exp'?['Job title','Company','Dates (for example 2021 - Present)','What you did (one point per line)']:['Qualification','School or university','Dates','Details (optional)'];
  const k=['role','org','dates','det'];
  k.forEach((key,i)=>{
    const l=document.createElement('label'),inp=document.createElement(i===3?'textarea':'input');
    l.textContent=lab[i];inp.dataset.k=key;inp.value=v[key]||'';if(i===3)inp.rows=3;l.appendChild(inp);b.appendChild(l);
  });
  const r=document.createElement('button');r.type='button';r.className='btn alt sm';r.textContent='Remove';r.onclick=()=>b.remove();b.appendChild(r);
  box.appendChild(b);
}
function cvFill(d){
  const set=(id,v)=>{$('#'+id).value=v||''};
  set('cvmName',d.name);set('cvTitle',d.title);set('cvEmail',d.email);set('cvPhone',d.phone);set('cvLoc',d.loc);set('cvLink',d.link);set('cvSum',d.sum);set('cvSkills',d.skills);set('cvLangs',d.langs);
  $('#cvExp').textContent='';$('#cvEdu').textContent='';
  d.exp.forEach(e=>cvAddBlock($('#cvExp'),'exp',e));d.edu.forEach(e=>cvAddBlock($('#cvEdu'),'edu',e));
}
function cvCollect(){
  const g=id=>$('#'+id).value.trim();
  const blocks=sel=>[...$$(sel+' .cvb')].map(b=>{const o={};b.querySelectorAll('[data-k]').forEach(i=>{o[i.dataset.k]=i.value.trim()});return o});
  return{name:g('cvmName'),title:g('cvTitle'),email:g('cvEmail'),phone:g('cvPhone'),loc:g('cvLoc'),link:g('cvLink'),sum:g('cvSum'),exp:blocks('#cvExp'),edu:blocks('#cvEdu'),skills:g('cvSkills'),langs:g('cvLangs')};
}
function cvStep(n){
  CVM.step=n;[1,2,3].forEach(i=>{$('#cvmP'+i).hidden=(i!==n)});
  $('#cvmStep').textContent=['','Step 1 of 3: Choose a layout','Step 2 of 3: Add your details','Step 3 of 3: Preview and download'][n];
  $('#cvmBack').hidden=n===1;$('#cvmNext').textContent=n===3?'Download PDF':'Next';$('#cvmBody').scrollTop=0;
}
async function cvOpen(){
  if(!guard())return;
  try{
    await cvLibs();openWs('wsCvm');cvGrid();
    if(!$('#cvExp').children.length){cvAddBlock($('#cvExp'),'exp');cvAddBlock($('#cvEdu'),'edu')}
    cvStep(1);
  }catch(e){toast('The CV creator could not load. Check your internet connection and try again.')}
}
async function cvPreview(bytes){
  const box=$('#cvmPrev');box.textContent='';
  const d=await pdfjsLib.getDocument({data:bytes.slice()}).promise,w=Math.min(720,Math.max(280,$('#cvmBody').clientWidth-32)),dpr=Math.min(2,window.devicePixelRatio||1);
  for(let i=1;i<=d.numPages;i++){
    const p=await d.getPage(i),b=p.getViewport({scale:1}),vp=p.getViewport({scale:w/b.width}),c=document.createElement('canvas');
    c.width=Math.floor(vp.width*dpr);c.height=Math.floor(vp.height*dpr);c.style.width=vp.width+'px';c.style.height=vp.height+'px';c.className='cvpg';
    box.appendChild(c);await p.render({canvasContext:c.getContext('2d'),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise;
  }
}
async function cvMake(){
  const d=cvCollect();
  if(!d.name)throw new Error('name');
  cvLost=false;CVM.bytes=await cvBuild(d,CV_TPL[CVM.sel-1]);
  if(cvLost)toast('Letters outside the standard Latin set were replaced with ?');
}
function cvSave(){
  const nm=($('#cvmName').value||'cv').trim().replace(/[^\w]+/g,'-').toLowerCase()||'cv';
  saveBlob(new Blob([CVM.bytes],{type:'application/pdf'}),nm+'-cv.pdf');DIRTY.wsCvm=false;
}
$('#cvmCard').onclick=cvOpen;
$('#cvmBack').onclick=()=>cvStep(CVM.step-1);
$('#cvmNext').onclick=async()=>{
  if(CVM.step===1){cvStep(2);return}
  if(!guard())return;
  if(CVM.step===2){
    const b=$('#cvmNext');b.disabled=true;
    try{await cvMake();await cvPreview(CVM.bytes);cvStep(3)}
    catch(e){toast(e&&e.message==='name'?'Please enter your full name.':'The CV could not be created.')}
    finally{b.disabled=false}
    return;
  }
  cvSave();
};
$('#cvAddExp').onclick=()=>cvAddBlock($('#cvExp'),'exp');
$('#cvAddEdu').onclick=()=>cvAddBlock($('#cvEdu'),'edu');
$('#cvSample').onclick=()=>cvFill(CV_SAMPLE);
$('#cvmP2').addEventListener('input',()=>{DIRTY.wsCvm=true});
SAVE.wsCvm=async()=>{try{await cvMake();cvSave()}catch(e){toast('Please enter your name first.')}};

/* ---------- Barcode creator ---------- */
/* [bwip id, label, kind, hint, sample] */
const BCT=[
  ['qrcode','QR Code','2d','Any text, link, email, phone number or Wi-Fi details.','https://letitedit.com'],
  ['code128','Code 128','1d','Letters, numbers and symbols. The most common barcode for labels.','LETITEDIT-2026'],
  ['code39','Code 39','1d','Capital letters, numbers and - . $ / + % space.','CODE39'],
  ['code93','Code 93','1d','Capital letters, numbers and a few symbols.','CODE93'],
  ['ean13','EAN-13','1d','12 digits. The check digit is added for you. Used on products.','590123412345'],
  ['ean8','EAN-8','1d','7 digits. The check digit is added for you.','9638507'],
  ['upca','UPC-A','1d','11 digits. The check digit is added for you. Used on products in the USA.','01234567890'],
  ['upce','UPC-E','1d','7 digits starting with 0 or 1.','0123456'],
  ['itf14','ITF-14','1d','13 digits. The check digit is added for you. Used on cartons.','1234567890123'],
  ['interleaved2of5','Interleaved 2 of 5','1d','An even number of digits.','123456'],
  ['rationalizedCodabar','Codabar','1d','Digits and - $ : / . + with A, B, C or D at both ends.','A12345B'],
  ['msi','MSI Plessey','1d','Digits only.','123456'],
  ['pharmacode','Pharmacode','1d','A number from 3 to 131070.','1234'],
  ['datamatrix','Data Matrix','2d','Any text. A small square code for tiny parts and labels.','LetItEdit'],
  ['pdf417','PDF417','2d','Any text. A stacked code used on tickets and ID cards.','LetItEdit PDF417'],
  ['azteccode','Aztec Code','2d','Any text. Used on tickets and boarding passes.','LetItEdit'],
  ['gs1-128','GS1-128','1d','GS1 data with brackets, for example (01)09501101530003.','(01)09501101530003']];
const BC={t:BCT[0],timer:null};
function bcSetType(t){
  BC.t=t;$$('[data-bc]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.bc===t[0]));
  $('#bcHint').textContent=t[3];$('#bcText').value=t[4];
  $$('.bc1d').forEach(e=>{e.hidden=t[2]!=='1d'});$('#bcEcBox').hidden=t[0]!=='qrcode';
  bcDraw();
}
function bcOpts(){
  const o={bcid:BC.t[0],text:$('#bcText').value,scale:+$('#bcScale').value,barcolor:$('#bcFg').value.slice(1),backgroundcolor:$('#bcBg').value.slice(1),paddingwidth:+$('#bcPad').value,paddingheight:+$('#bcPad').value};
  if(BC.t[2]==='1d'){o.height=+$('#bcH').value;o.includetext=$('#bcTxt').checked;o.textxalign='center'}
  if(BC.t[0]==='qrcode')o.eclevel=$('#bcEc').value;
  return o;
}
async function bcDraw(){
  const err=$('#bcErr'),cv2=$('#bcCv');err.hidden=true;
  if(!$('#bcText').value.trim()){cv2.hidden=true;err.textContent='Type the information for the barcode.';err.hidden=false;return}
  if(!navigator.onLine){err.textContent='You are offline. Please reconnect to the internet and try again.';err.hidden=false;return}
  try{await load(BWIP)}catch(e){err.textContent='The barcode tool could not load. Check your internet connection and try again.';err.hidden=false;return}
  try{bwipjs.toCanvas(cv2,bcOpts());cv2.hidden=false;DIRTY.wsBc=true}
  catch(e){cv2.hidden=true;err.textContent='This barcode type cannot use that information. '+BC.t[3];err.hidden=false}
}
function bcLater(){clearTimeout(BC.timer);BC.timer=setTimeout(bcDraw,250)}
function bcOpen(){
  if(!guard())return;
  if(!$('#bcTypes').children.length){
    BCT.forEach(t=>{const b=document.createElement('button');b.type='button';b.className='btn alt sm';b.dataset.bc=t[0];b.textContent=t[1];b.setAttribute('aria-pressed','false');b.onclick=()=>bcSetType(t);$('#bcTypes').appendChild(b)});
  }
  openWs('wsBc');bcSetType(BCT[0]);DIRTY.wsBc=false;
}
$('#bcCard').onclick=bcOpen;
['bcText','bcScale','bcH','bcPad','bcFg','bcBg','bcTxt','bcEc'].forEach(id=>{$('#'+id).addEventListener('input',bcLater);$('#'+id).addEventListener('change',bcLater)});
$('#bcPng').onclick=()=>{
  if(!guard())return;if($('#bcCv').hidden)return toast('Create a barcode first.');
  $('#bcCv').toBlob(b=>{if(b){saveBlob(b,BC.t[0]+'-barcode.png');DIRTY.wsBc=false}else toast('The barcode could not be saved.')},'image/png');
};
$('#bcSvg').onclick=()=>{
  if(!guard())return;if($('#bcCv').hidden)return toast('Create a barcode first.');
  try{saveBlob(new Blob([bwipjs.toSVG(bcOpts())],{type:'image/svg+xml'}),BC.t[0]+'-barcode.svg');DIRTY.wsBc=false}catch(e){toast('The SVG could not be created.')}
};
SAVE.wsBc=()=>$('#bcPng').onclick();

/* Open straight from the home page buttons */
if(location.hash==='#cv'||location.hash==='#barcode')setTimeout(()=>{(location.hash==='#cv'?cvOpen:bcOpen)()},300);


/* ---------- Text extractor: choose languages ---------- */
const OCR_LANGS='afr:Afrikaans,amh:Amharic,ara:Arabic,asm:Assamese,aze:Azerbaijani,bel:Belarusian,ben:Bengali,bod:Tibetan,bos:Bosnian,bul:Bulgarian,cat:Catalan,ceb:Cebuano,ces:Czech,chi_sim:Chinese (Simplified),chi_tra:Chinese (Traditional),chr:Cherokee,cym:Welsh,dan:Danish,deu:German,dzo:Dzongkha,ell:Greek,eng:English,epo:Esperanto,est:Estonian,eus:Basque,fas:Persian (Farsi),fin:Finnish,fra:French,gle:Irish,glg:Galician,guj:Gujarati,hat:Haitian Creole,heb:Hebrew,hin:Hindi,hrv:Croatian,hun:Hungarian,iku:Inuktitut,ind:Indonesian,isl:Icelandic,ita:Italian,jav:Javanese,jpn:Japanese,kan:Kannada,kat:Georgian,kaz:Kazakh,khm:Khmer,kir:Kyrgyz,kor:Korean,kur:Kurdish,lao:Lao,lat:Latin,lav:Latvian,lit:Lithuanian,mal:Malayalam,mar:Marathi,mkd:Macedonian,mlt:Maltese,mon:Mongolian,mri:Maori,msa:Malay,mya:Burmese,nep:Nepali,nld:Dutch,nor:Norwegian,ori:Odia,pan:Punjabi,pol:Polish,por:Portuguese,pus:Pashto,ron:Romanian,rus:Russian,san:Sanskrit,sin:Sinhala,slk:Slovak,slv:Slovenian,spa:Spanish,sqi:Albanian,srp:Serbian,swa:Swahili,swe:Swedish,syr:Syriac,tam:Tamil,tat:Tatar,tel:Telugu,tgk:Tajik,tgl:Tagalog,tha:Thai,tir:Tigrinya,tur:Turkish,uig:Uyghur,ukr:Ukrainian,urd:Urdu,uzb:Uzbek,vie:Vietnamese,yid:Yiddish'.split(',').map(s=>{const i=s.indexOf(':');return[s.slice(0,i),s.slice(i+1)]});
const OCRL=new Set(['eng']);
function langRender(){
  const q=($('#langQ').value||'').toLowerCase(),L=$('#langList');L.textContent='';
  OCR_LANGS.filter(l=>!q||l[1].toLowerCase().includes(q)||l[0].includes(q)).forEach(([c,n])=>{
    const lb=document.createElement('label');lb.className='check';
    const i=document.createElement('input');i.type='checkbox';i.checked=OCRL.has(c);
    i.onchange=()=>{if(i.checked){if(OCRL.size>=5){i.checked=false;return toast('Choose up to 5 languages at a time.')}OCRL.add(c)}else OCRL.delete(c)};
    const s=document.createElement('span');s.textContent=n;lb.append(i,s);L.appendChild(lb);
  });
}
$('#ocrLangBtn').onclick=()=>{$('#langQ').value='';langRender();$('#ovLang').classList.add('on')};
$('#langQ').oninput=langRender;
$('#langOk').onclick=()=>{
  if(!OCRL.size)OCRL.add('eng');
  const codes=[...OCRL];$('#ocrLang').value=codes.join('+');
  $('#ocrLangBtn').textContent='Languages: '+codes.map(c=>(OCR_LANGS.find(l=>l[0]===c)||[c,c])[1]).join(', ');
  $('#ovLang').classList.remove('on');runOcr();
};

/* ---------- Word editor: fonts, sizes, colours, tables, pictures and more ---------- */
const WFONTS=['Calibri','Cambria','Arial','Arial Black','Arial Narrow','Times New Roman','Georgia','Verdana','Tahoma','Trebuchet MS','Segoe UI','Courier New','Consolas','Comic Sans MS','Impact','Garamond','Century Gothic','Book Antiqua','Palatino Linotype','Lucida Sans','Franklin Gothic Medium','Aptos'];
const WSIZES=[8,9,10,10.5,11,12,14,16,18,20,22,24,26,28,36,48,72];
let WSEL=null;
const wdoc=()=>$('#doc');
function fillSel(id,first,list,font){
  const s=$(id);const o0=document.createElement('option');o0.value='';o0.textContent=first;s.appendChild(o0);
  list.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=font?v:v+' pt';if(font)o.style.fontFamily=v;s.appendChild(o)});
}
fillSel('#wFont','Font',WFONTS,true);fillSel('#wSize','Size',WSIZES,false);
document.addEventListener('selectionchange',()=>{const s=getSelection();if(s.rangeCount&&wdoc().contains(s.anchorNode))WSEL=s.getRangeAt(0).cloneRange()});
function wRestore(){wdoc().focus();if(WSEL){const s=getSelection();s.removeAllRanges();s.addRange(WSEL)}}
function wCount(){const t=(wdoc().innerText||'').trim();$('#wCount').textContent=(t?t.split(/\s+/).length:0)+' words'}
function wCmd(c,v){wRestore();document.execCommand(c,false,v);DIRTY.wsDoc=true;wCount()}
wdoc().addEventListener('input',wCount);document.addEventListener('selectionchange',()=>{if(cur==='wsDoc')wCount()});
$$('[data-w]').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>wCmd(b.dataset.w)});
$('#wStyle').onchange=e=>{wCmd('formatBlock','<'+e.target.value+'>')};
$('#wFont').onchange=e=>{if(e.target.value)wCmd('fontName',e.target.value);e.target.value=''};
$('#wSize').onchange=e=>{
  const pt=e.target.value;e.target.value='';if(!pt)return;
  wRestore();document.execCommand('fontSize',false,'7');
  wdoc().querySelectorAll('font[size="7"]').forEach(f=>{f.removeAttribute('size');f.style.fontSize=pt+'pt'});DIRTY.wsDoc=true;
};
$('#wColor').oninput=e=>wCmd('foreColor',e.target.value);
$('#wHi').oninput=e=>wCmd('hiliteColor',e.target.value);
$('#wSpace').onchange=e=>{
  const v=e.target.value;e.target.value='';if(!v)return;
  wRestore();const s=getSelection();let n=s.anchorNode;
  while(n&&n!==wdoc()&&!(n.nodeType===1&&/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|TD)$/.test(n.tagName)))n=n.parentNode;
  if(n&&n!==wdoc()){n.style.lineHeight=v;DIRTY.wsDoc=true}
};
function askText(title,label,def){
  return new Promise(res=>{
    let d=$('#ovAsk');
    if(!d){
      d=document.createElement('div');d.className='ov';d.id='ovAsk';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
      d.innerHTML='<div class="modal"><h2 id="askT"></h2><div class="fld"><label id="askL" for="askI"></label><input id="askI"></div><div style="display:grid;gap:10px"><button class="btn" id="askOk" type="button">OK</button><button class="btn alt" id="askNo" type="button">Cancel</button></div></div>';
      document.body.appendChild(d);
    }
    $('#askT').textContent=title;$('#askL').textContent=label;$('#askI').value=def||'';d.classList.add('on');$('#askI').focus();
    const done=v=>{d.classList.remove('on');res(v)};
    $('#askOk').onclick=()=>done($('#askI').value.trim());$('#askNo').onclick=()=>done(null);
    $('#askI').onkeydown=e=>{if(e.key==='Enter')done($('#askI').value.trim())};
  });
}
$('#wTable').onclick=async()=>{
  const v=await askText('Insert a table','Rows x columns','3 x 3');if(!v)return;
  const m=v.match(/(\d+)\D+(\d+)/);if(!m)return toast('Type the size like 3 x 3.');
  const r=Math.min(30,+m[1]),c=Math.min(12,+m[2]);
  const cell='<td style="border:1px solid #999;padding:4px;min-width:40px">&nbsp;</td>';
  wCmd('insertHTML','<table style="border-collapse:collapse;width:100%;margin:8px 0">'+('<tr>'+cell.repeat(c)+'</tr>').repeat(r)+'</table><p><br></p>');
};
$('#wLink').onclick=async()=>{
  let u=await askText('Insert a link','Web address','https://');if(!u)return;
  if(!/^(https?:|mailto:)/i.test(u))u='https://'+u;wCmd('createLink',u);
};
$('#wBreak').onclick=()=>wCmd('insertHTML','<div style="page-break-after:always;border-top:1px dashed #999;margin:14px 0"></div><p><br></p>');
$('#wImg').onchange=e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!f.type.startsWith('image/'))return;
  const r=new FileReader();
  r.onload=()=>{wCmd('insertImage',r.result);wdoc().querySelectorAll('img:not([data-s])').forEach(i=>{i.dataset.s=1;i.style.maxWidth='100%'})};
  r.readAsDataURL(f);
};
