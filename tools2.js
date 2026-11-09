/* LetItEdit extra tools: layout helpers, image enhance, file merger, file converter, help. Runs in the browser. */
'use strict';
const SHEETJS='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const JSZIP='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const MAMMOTH='https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
const H2C='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
const DOCXP='https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js';
const HEIC='https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
const baseName=n=>n.replace(/\.[^.]+$/,'');
const fileExt=n=>((n.match(/\.([^.]+)$/)||[])[1]||'').toLowerCase();
const blobOf=(c,t,q)=>new Promise(r=>c.toBlob(r,t,q));
const famOf=n=>/\.pdf$/i.test(n)?'pdf':/\.docx$/i.test(n)?'doc':/\.(xlsx|xls|csv)$/i.test(n)?'xl':null;
function loadImg(blob){return new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(new Error('img'));i.src=URL.createObjectURL(blob)})}
const newCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};

/* ---------- Layout helpers (used by the text extractor and the PDF converter) ---------- */
function ocrWords(data){
  let ws=[];
  if(data.blocks)data.blocks.forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>(l.words||[]).forEach(w=>ws.push(w)))));
  else ws=data.words||[];
  return ws.filter(w=>w.text&&w.text.trim()&&w.bbox).map(w=>({t:w.text.trim(),x0:w.bbox.x0,y0:w.bbox.y0,x1:w.bbox.x1,y1:w.bbox.y1,b:w.is_bold||w.bold,m:w.is_monospace||w.monospace,s:w.is_serif||w.serif}));
}
/* Words with positions to lines of text, kept in the same columns as the original page */
function layoutFromWords(words){
  const hs=words.map(w=>w.y1-w.y0).sort((a,b)=>a-b),med=hs[hs.length>>1]||10;
  words.sort((a,b)=>(a.y0+a.y1)-(b.y0+b.y1));
  const lines=[];
  words.forEach(w=>{
    const cy=(w.y0+w.y1)/2,L=lines[lines.length-1];
    if(L&&Math.abs(cy-L.cy)<Math.max(med*.6,(L.y1-L.y0)*.5)){L.w.push(w);L.cy=(L.cy*(L.w.length-1)+cy)/L.w.length;L.y0=Math.min(L.y0,w.y0);L.y1=Math.max(L.y1,w.y1)}
    else lines.push({w:[w],cy,y0:w.y0,y1:w.y1});
  });
  lines.forEach(L=>L.w.sort((a,b)=>a.x0-b.x0));
  const cw=words.filter(w=>w.t.length>1).map(w=>(w.x1-w.x0)/w.t.length).sort((a,b)=>a-b);
  const charW=cw[cw.length>>1]||med*.5,minX=Math.min(...words.map(w=>w.x0));
  const out=[],scale=[],bold=[];let prev=null;
  lines.forEach(L=>{
    if(prev&&L.y0-prev.y1>med*1.2){out.push('');scale.push(1);bold.push(false)}
    let s='';
    L.w.forEach(w=>{const col=Math.round((w.x0-minX)/charW);if(s.length<col)s+=' '.repeat(col-s.length);else if(s.length>0)s+=' ';s+=w.t});
    out.push(s);scale.push(Math.max(.6,Math.min(2.5,(L.y1-L.y0)/med)));bold.push(L.w.filter(w=>w.b).length>L.w.length/2);prev=L;
  });
  const mono=words.filter(w=>w.m).length>words.length/2,serif=words.filter(w=>w.s).length>words.length/2;
  return{text:out.join('\n'),scale,bold,font:mono?'Courier New':serif?'Times New Roman':'Arial'};
}
/* Split aligned text rows into columns wherever every row has a blank gap */
function splitCols(lines){
  const W=Math.max(...lines.map(l=>l.length)),blank=new Array(W).fill(true);
  lines.forEach(l=>{for(let i=0;i<l.length;i++)if(l[i]!==' ')blank[i]=false});
  const segs=[];let s=-1,gap=0;
  for(let i=0;i<=W;i++){
    if(i<W&&!blank[i]){if(s<0)s=i;gap=0}
    else if(s>=0){gap++;if(gap>=2||i===W){segs.push([s,i-gap]);s=-1;gap=0}}
  }
  return lines.map(l=>segs.map(([a,b])=>l.slice(a,b+1).trim()));
}
function textBlocks(text,meta){
  const lines=text.replace(/\t/g,'    ').split('\n'),ok=meta&&meta.scale&&meta.scale.length===lines.length,out=[];
  const tab=l=>/\S\s{2,}\S/.test(l.trim());
  for(let i=0;i<lines.length;){
    if(tab(lines[i])){let j=i;while(j<lines.length&&tab(lines[j]))j++;out.push({type:'table',rows:splitCols(lines.slice(i,j))});i=j}
    else{out.push({type:'p',text:lines[i].trim(),scale:ok?meta.scale[i]:1,bold:ok?meta.bold[i]:false});i++}
  }
  return out;
}
const isNum=c=>/^[^\w]*\d[\d.,]*\s*%?$/.test(c);
function blocksHtmlBody(b){
  return b.map(x=>x.type==='table'
    ?'<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;margin:6px 0">'+x.rows.map(r=>'<tr>'+r.map(c=>'<td'+(isNum(c)?' align="right"':'')+'>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</table>'
    :'<p style="margin:2px 0;font-size:'+(11*x.scale).toFixed(1)+'pt">'+(x.text?(x.bold?'<b>'+esc(x.text)+'</b>':esc(x.text)):'&nbsp;')+'</p>').join('');
}
const blocksRows=b=>b.flatMap(x=>x.type==='table'?x.rows:[[x.text]]);

/* ---------- Image enhance: noise reduction, Lanczos upscaling, sharpening, colour, background clean-up ---------- */
const EN={img:null,name:'image',mime:'image/png',res:null,alpha:false,key:null,pick:false};
const enSt=m=>{$('#enStat').textContent=m};
const tick=()=>new Promise(r=>setTimeout(r,0));
const ENP={photo:[35,60,25,35],text:[0,90,0,0],old:[70,55,35,45],logo:[0,40,0,10]};
function enOrig(){const c=newCanvas(EN.img.naturalWidth,EN.img.naturalHeight);c.getContext('2d').drawImage(EN.img,0,0);return c}
function enView(c,orig){
  const o=$('#enCv');o.width=c.width;o.height=c.height;o.getContext('2d').drawImage(c,0,0);
  const r=$('#enOr'),w=$('#enWrap');
  if(orig){r.width=orig.width;r.height=orig.height;r.getContext('2d').drawImage(orig,0,0);w.classList.add('cmp');enCut($('#enCmpR').value)}
  else w.classList.remove('cmp');
}
function enCut(v){const w=$('#enWrap');w.style.setProperty('--cut',(100-v)+'%');w.style.setProperty('--pos',v+'%')}
$('#enCmpR').oninput=e=>enCut(e.target.value);
$('#enActual').onchange=e=>$('#enWrap').classList.toggle('actual',e.target.checked);
$('#enMode').onchange=e=>{const p=ENP[e.target.value];['enDn','enSh','enCl','enCo'].forEach((id,i)=>{$('#'+id).value=p[i]})};
$('#enIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  try{
    let b=f;
    if(/heic|heif/i.test(f.type+f.name)){await load(HEIC);const o=await heic2any({blob:f,toType:'image/png'});b=Array.isArray(o)?o[0]:o}
    EN.img=await loadImg(b);EN.name=baseName(f.name);EN.res=null;EN.alpha=false;EN.key=null;EN.pick=false;
    EN.mime=/jpe?g/i.test(f.type)?'image/jpeg':/webp/i.test(f.type)?'image/webp':'image/png';
    const c=enOrig();enView(c,null);enSt(`Loaded ${c.width} x ${c.height} px. Choose a target size, then press Enhance.`);openWs('wsEn');
  }catch(err){toast('This image could not be opened. Your browser may not support this format. Try JPG, PNG, WebP or HEIC.')}
};
/* target size */
function enTarget(w,h){
  const v=$('#enScale').value;
  let k=v[0]==='x'?+v.slice(1):+v.slice(1)/Math.max(w,h);
  let tw=Math.round(w*k),th=Math.round(h*k);
  const cap=Math.min(1,6000/Math.max(tw,th),Math.sqrt(24e6/(tw*th)));
  if(cap<1){tw=Math.round(tw*cap);th=Math.round(th*cap)}
  return[Math.max(1,tw),Math.max(1,th)];
}
/* Lanczos-3 resampling */
const lz=x=>{x=Math.abs(x);if(x===0)return 1;if(x>=3)return 0;const p=Math.PI*x;return 3*Math.sin(p)*Math.sin(p/3)/(p*p)};
function lzWeights(dn,sn){
  const sc=dn/sn,fs=Math.min(1,sc),sup=3/fs,out=[];
  for(let i=0;i<dn;i++){
    const c=(i+.5)/sc-.5,s=Math.max(0,Math.ceil(c-sup)),e=Math.min(sn-1,Math.floor(c+sup)),w=[];let sum=0;
    for(let j=s;j<=e;j++){const v=lz((j-c)*fs);w.push(v);sum+=v}
    for(let k=0;k<w.length;k++)w[k]/=sum||1;
    out.push({s,w});
  }
  return out;
}
async function lzResize(d,sw,sh,dw,dh){
  const wx=lzWeights(dw,sw),wy=lzWeights(dh,sh),tmp=new Uint8ClampedArray(dw*sh*4);
  for(let y=0;y<sh;y++){
    for(let x=0;x<dw;x++){
      const {s,w}=wx[x];let r=0,g=0,b=0,a=0;
      for(let k=0;k<w.length;k++){const i=(y*sw+s+k)*4,q=w[k];r+=d[i]*q;g+=d[i+1]*q;b+=d[i+2]*q;a+=d[i+3]*q}
      const o=(y*dw+x)*4;tmp[o]=r;tmp[o+1]=g;tmp[o+2]=b;tmp[o+3]=a;
    }
    if(y%64===63)await tick();
  }
  const out=new Uint8ClampedArray(dw*dh*4);
  for(let y=0;y<dh;y++){
    const {s,w}=wy[y];
    for(let x=0;x<dw;x++){
      let r=0,g=0,b=0,a=0;
      for(let k=0;k<w.length;k++){const i=((s+k)*dw+x)*4,q=w[k];r+=tmp[i]*q;g+=tmp[i+1]*q;b+=tmp[i+2]*q;a+=tmp[i+3]*q}
      const o=(y*dw+x)*4;out[o]=r;out[o+1]=g;out[o+2]=b;out[o+3]=a;
    }
    if(y%64===63)await tick();
  }
  return out;
}
/* box blur on the colour channels */
function boxBlur(src,w,h,r){
  const tmp=new Uint8ClampedArray(src.length),out=new Uint8ClampedArray(src.length),n=2*r+1,rw=w*4;
  for(let y=0;y<h;y++)for(let c=0;c<3;c++){
    const row=y*rw+c;let sum=0;
    for(let x=-r;x<=r;x++)sum+=src[row+Math.min(w-1,Math.max(0,x))*4];
    for(let x=0;x<w;x++){tmp[row+x*4]=sum/n;sum+=src[row+Math.min(w-1,x+r+1)*4]-src[row+Math.max(0,x-r)*4]}
  }
  for(let x=0;x<w;x++)for(let c=0;c<3;c++){
    const col=x*4+c;let sum=0;
    for(let y=-r;y<=r;y++)sum+=tmp[Math.min(h-1,Math.max(0,y))*rw+col];
    for(let y=0;y<h;y++){out[y*rw+col]=sum/n;sum+=tmp[Math.min(h-1,y+r+1)*rw+col]-tmp[Math.max(0,y-r)*rw+col]}
  }
  for(let i=3;i<src.length;i+=4)out[i]=src[i];
  return out;
}
function unsharp(d,w,h,r,amount){
  const b=boxBlur(boxBlur(d,w,h,r),w,h,r);
  for(let i=0;i<d.length;i+=4){d[i]+=amount*(d[i]-b[i]);d[i+1]+=amount*(d[i+1]-b[i+1]);d[i+2]+=amount*(d[i+2]-b[i+2])}
}
/* edge-preserving noise reduction (3x3 bilateral) */
async function denoise(d,w,h,strength){
  const sig=8+strength*.5,lut=new Float32Array(256);
  for(let i=0;i<256;i++)lut[i]=Math.exp(-(i*i)/(2*sig*sig));
  const out=new Uint8ClampedArray(d.length),k=Math.min(1,strength/70);
  out.set(d);
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const i=(y*w+x)*4;
      for(let c=0;c<3;c++){
        const v=d[i+c];let sum=0,ws=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const p=d[i+(dy*w+dx)*4+c],wt=lut[Math.abs(p-v)];sum+=p*wt;ws+=wt}
        out[i+c]=v+(sum/ws-v)*k;
      }
    }
    if(y%128===0)await tick();
  }
  d.set(out);
}
/* auto light (levels) and vibrance */
function colourPass(d,auto,co){
  let lo=0,hi=255,k=1,m=128;
  if(auto){
    const hist=new Uint32Array(256);let cnt=0;
    for(let i=0;i<d.length;i+=4)if(d[i+3]>200){hist[Math.round(.3*d[i]+.59*d[i+1]+.11*d[i+2])]++;cnt++}
    if(cnt){
      let a=0;for(;lo<255&&a+hist[lo]<cnt*.005;lo++)a+=hist[lo];
      a=0;for(;hi>0&&a+hist[hi]<cnt*.005;hi--)a+=hist[hi];
      a=0;for(m=0;m<255&&a+hist[m]<cnt*.5;m++)a+=hist[m];
      if(hi-lo>30)k=Math.min(1.35,255/(hi-lo));
    }
  }
  const v=co/100*.6;
  for(let i=0;i<d.length;i+=4){
    let r=m+(d[i]-m)*k,g=m+(d[i+1]-m)*k,b=m+(d[i+2]-m)*k;
    if(v>0){const l=.3*r+.59*g+.11*b,mx=Math.max(r,g,b),mn=Math.min(r,g,b),s=mx>0?(mx-mn)/mx:0,f=1+v*(1-Math.min(1,s));r=l+(r-l)*f;g=l+(g-l)*f;b=l+(b-l)*f}
    d[i]=r;d[i+1]=g;d[i+2]=b;
  }
}
/* background clean-up for plain (solid colour) backgrounds */
function autoKey(d,w,h){
  const pts=[[0,0],[w-5,0],[0,h-5],[w-5,h-5]];let r=0,g=0,b=0,n=0;
  pts.forEach(([x0,y0])=>{for(let y=Math.max(0,y0);y<Math.min(h,y0+5);y++)for(let x=Math.max(0,x0);x<Math.min(w,x0+5);x++){const i=(y*w+x)*4;r+=d[i];g+=d[i+1];b+=d[i+2];n++}});
  return[r/n,g/n,b/n];
}
function removeBg(d,w,h,key,tol,feather){
  const t2=tol*tol*3,seen=new Uint8Array(w*h),stack=new Int32Array(w*h);let sp=0;
  const near=(i,t)=>{const j=i*4,dr=d[j]-key[0],dg=d[j+1]-key[1],db=d[j+2]-key[2];return dr*dr+dg*dg+db*db<=t};
  const push=i=>{if(!seen[i]&&near(i,t2)){seen[i]=1;stack[sp++]=i}};
  for(let i=0;i<w;i++){push(i);push((h-1)*w+i)}
  for(let j=0;j<h;j++){push(j*w);push(j*w+w-1)}
  while(sp){const i=stack[--sp],x=i%w,y=(i/w)|0;if(x>0)push(i-1);if(x<w-1)push(i+1);if(y>0)push(i-w);if(y<h-1)push(i+w)}
  const edge=new Uint8Array(w*h),t4=t2*4;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(!seen[i]&&(seen[i-1]||seen[i+1]||seen[i-w]||seen[i+w])&&near(i,t4))edge[i]=1}
  for(let i=0;i<w*h;i++)if(seen[i]||edge[i])d[i*4+3]=0;
  if(feather>0){
    const tmp=new Uint8ClampedArray(d.length);
    for(let i=0;i<w*h;i++)tmp[i*4]=d[i*4+3];
    const b=boxBlur(tmp,w,h,feather);
    for(let i=0;i<w*h;i++)if(d[i*4+3]>0||b[i*4]>0)d[i*4+3]=Math.min(d[i*4+3],b[i*4]*1.0+(d[i*4+3]>0?0:0));
  }
}
$('#enBgPick').onclick=()=>{if(!EN.img)return toast('Open an image first.');EN.pick=true;enSt('Click the background colour on the picture.')};
$('#enCv').addEventListener('click',e=>{
  if(!EN.pick)return;EN.pick=false;
  const c=$('#enCv'),r=c.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)*c.width/r.width),y=Math.floor((e.clientY-r.top)*c.height/r.height);
  const p=c.getContext('2d').getImageData(Math.max(0,Math.min(c.width-1,x)),Math.max(0,Math.min(c.height-1,y)),1,1).data;
  EN.key=[p[0],p[1],p[2]];$('#enBgSw').style.background=`rgb(${p[0]},${p[1]},${p[2]})`;$('#enBg').checked=true;enSt('Background colour picked. Press Enhance.');
});
$('#enRun').onclick=async()=>{
  if(!EN.img||!guard())return;
  const b=$('#enRun');b.disabled=true;
  try{
    enSt('Reading the image...');await tick();
    const src=enOrig(),sw=src.width,sh=src.height,sd=src.getContext('2d').getImageData(0,0,sw,sh);
    let d=sd.data;
    const dn=+$('#enDn').value;
    if(dn>0&&sw*sh<=16e6){enSt('Reducing noise...');await denoise(d,sw,sh,dn)}
    const [tw,th]=enTarget(sw,sh);
    if(tw!==sw||th!==sh){enSt(`Upscaling to ${tw} x ${th} px...`);d=await lzResize(d,sw,sh,tw,th)}
    enSt('Sharpening and improving colour...');await tick();
    const L=Math.max(tw,th),co=+$('#enCo').value,cl=+$('#enCl').value,sp=+$('#enSh').value;
    if($('#enAuto').checked||co>0)colourPass(d,$('#enAuto').checked,co);
    if(cl>0)unsharp(d,tw,th,Math.max(8,Math.round(L/70)),cl/100*.6);
    if(sp>0)unsharp(d,tw,th,Math.max(1,Math.round(L/1800)),sp/100*1.1);
    EN.alpha=false;
    if($('#enBg').checked){
      enSt('Removing the background...');await tick();
      removeBg(d,tw,th,EN.key||autoKey(d,tw,th),+$('#enTol').value,+$('#enFeather').value);EN.alpha=true;
    }
    const out=newCanvas(tw,th);out.getContext('2d').putImageData(new ImageData(d,tw,th),0,0);
    EN.res=out;enView(out,src);DIRTY.wsEn=true;
    enSt(`Done: ${tw} x ${th} px. Drag the slider to compare, then choose a format and download.`);
  }catch(err){enSt('Something went wrong. Try a smaller target size or a smaller image.')}
  finally{b.disabled=false}
};
$('#enDl').onclick=async()=>{
  if(!EN.res)return toast('Press Enhance first.');
  let mime=$('#enFmt').value==='same'?EN.mime:$('#enFmt').value;
  const keep=EN.alpha&&$('#enFill').value==='none';
  if(keep&&mime==='image/jpeg'){mime='image/png';toast('JPG cannot be see-through, so PNG was used.')}
  const t=newCanvas(EN.res.width,EN.res.height),x=t.getContext('2d');
  if(!keep){x.fillStyle=EN.alpha?$('#enColor').value:'#ffffff';x.fillRect(0,0,t.width,t.height)}
  x.drawImage(EN.res,0,0);
  const blob=await blobOf(t,mime,.95);
  if(blob){saveBlob(blob,EN.name+'-enhanced.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]));DIRTY.wsEn=false}
  else toast('The image could not be saved.');
};
SAVE.wsEn=()=>$('#enDl').onclick();

/* ---------- File merger ---------- */
const MG={items:[],fam:null,pend:null};
const MGFMT={pdf:[['pdf','PDF (.pdf)']],doc:[['docx','Word (.docx)'],['html','Web page (.html)']],xl:[['xlsx','Excel (.xlsx)'],['xls','Excel 97 (.xls)'],['ods','OpenDocument (.ods)'],['csv','CSV (.csv)']]};
function mgAsk(f){
  const fm=famOf(f.name);
  if(!fm)return toast('Please choose a PDF, Word (.docx) or spreadsheet file (.xlsx, .xls, .csv).');
  if(MG.fam&&fm!==MG.fam)return toast('Merge files of the same type. To mix types, convert them first with the file converter.');
  MG.pend=f;$('#posFile').textContent=f.name;$('#posNum').value=MG.items.length+1;$('#posErr').hidden=true;
  $('#ovPos').classList.add('on');$('#posNum').focus();
}
const mgPick=e=>{const f=e.target.files[0];e.target.value='';if(f&&guard())mgAsk(f)};
$('#mgIn').onchange=mgPick;$('#mgAdd').onchange=mgPick;
const posErr=m=>{const e=$('#posErr');e.textContent=m;e.hidden=false};
$('#posNo').onclick=()=>{MG.pend=null;$('#ovPos').classList.remove('on')};
$('#posOk').onclick=()=>{
  const n=+$('#posNum').value;
  if(!Number.isInteger(n)||n<1)return posErr('Enter a position number, 1 or higher.');
  if(MG.items.some(i=>i.pos===n))return posErr('Position '+n+' is already used. Choose another number.');
  const f=MG.pend;MG.pend=null;MG.fam=famOf(f.name);MG.items.push({f,pos:n});
  $('#ovPos').classList.remove('on');if(cur!=='wsMg')openWs('wsMg');mgRender();
};
function mgRender(){
  MG.items.sort((a,b)=>a.pos-b.pos);
  const L=$('#mgList');L.textContent='';
  MG.items.forEach(it=>{
    const r=document.createElement('div');r.className='mgrow';
    const n=document.createElement('input');n.type='number';n.min=1;n.value=it.pos;n.setAttribute('aria-label','Position of '+it.f.name);
    n.onchange=()=>{const v=+n.value;if(!Number.isInteger(v)||v<1||MG.items.some(o=>o!==it&&o.pos===v)){toast('That position is not valid or is already used.');n.value=it.pos;return}it.pos=v;mgRender()};
    const nm=document.createElement('span');nm.textContent=it.f.name+' ('+Math.max(1,Math.round(it.f.size/1024))+' KB)';
    const x=document.createElement('button');x.className='btn alt sm';x.textContent='Remove';
    x.onclick=()=>{MG.items=MG.items.filter(o=>o!==it);if(!MG.items.length)MG.fam=null;mgRender()};
    r.append(n,nm,x);L.appendChild(r);
  });
  const s=$('#mgFmt');s.textContent='';
  (MGFMT[MG.fam]||[]).forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;s.appendChild(o)});
  DIRTY.wsMg=MG.items.length>0;
}
$('#mgGo').onclick=async()=>{
  if(MG.items.length<2)return toast('Add at least two files to merge.');
  if(!guard())return;
  const fmt=$('#mgFmt').value,b=$('#mgGo'),items=[...MG.items].sort((a,c)=>a.pos-c.pos);b.disabled=true;
  try{
    if(MG.fam==='pdf'){
      await load(PDFLIB);const out=await PDFLib.PDFDocument.create();
      for(const it of items){const s=await PDFLib.PDFDocument.load(await it.f.arrayBuffer());(await out.copyPages(s,s.getPageIndices())).forEach(p=>out.addPage(p))}
      saveBlob(new Blob([await out.save()],{type:'application/pdf'}),'merged.pdf');
    }else if(MG.fam==='doc'){
      await load(MAMMOTH);const parts=[];
      for(const it of items)parts.push((await mammoth.convertToHtml({arrayBuffer:await it.f.arrayBuffer()})).value);
      const html='<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'+parts.join('<p style="page-break-before:always"></p>')+'</body></html>';
      if(fmt==='html')saveBlob(new Blob([html],{type:'text/html'}),'merged.html');
      else{await load(HTMLDOCX);saveBlob(htmlDocx.asBlob(html),'merged.docx')}
    }else{
      await load(SHEETJS);const wb=XLSX.utils.book_new(),used=new Set();let rows=[];
      for(const it of items){
        const w=XLSX.read(await it.f.arrayBuffer(),{cellDates:true});
        w.SheetNames.forEach(n=>{
          let nm=(it.pos+'-'+n).slice(0,31),k=2;while(used.has(nm))nm=(it.pos+'-'+n).slice(0,28)+'_'+k++;
          used.add(nm);XLSX.utils.book_append_sheet(wb,w.Sheets[n],nm);
          rows=rows.concat(XLSX.utils.sheet_to_json(w.Sheets[n],{header:1,blankrows:false}));
        });
      }
      if(fmt==='csv')saveBlob(new Blob(['\ufeff'+XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(rows))],{type:'text/csv'}),'merged.csv');
      else saveBlob(new Blob([XLSX.write(wb,{bookType:fmt,type:'array'})]),'merged.'+fmt);
    }
    DIRTY.wsMg=false;toast('Merged file downloaded.');
  }catch(err){toast('The files could not be merged. They may be protected or damaged.')}
  finally{b.disabled=false}
};
SAVE.wsMg=()=>$('#mgGo').onclick();

/* ---------- File converter ---------- */
const CV={f:null,fam:null};
const CVFMT={
  pdf:[['docx','Word (.docx)'],['xlsx','Excel (.xlsx)'],['txt','Text (.txt)'],['html','Web page (.html)'],['png','Images (.png)'],['jpg','Images (.jpg)']],
  doc:[['pdf','PDF (.pdf)'],['txt','Text (.txt)'],['html','Web page (.html)'],['xlsx','Excel, tables only (.xlsx)']],
  xl:[['pdf','PDF (.pdf)'],['docx','Word (.docx)'],['csv','CSV (.csv)'],['html','Web page (.html)'],['ods','OpenDocument (.ods)'],['xls','Excel 97 (.xls)'],['xlsx','Excel (.xlsx)'],['txt','Text (.txt)']]};
$('#cvIn').onchange=e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!guard())return;
  const fm=famOf(f.name);
  if(!fm)return toast('Please choose a PDF, Word (.docx) or spreadsheet file (.xlsx, .xls, .csv). Old .doc files are not supported.');
  CV.f=f;CV.fam=fm;$('#cvName').textContent=f.name;$('#cvStat').textContent='';
  const s=$('#cvFmt');s.textContent='';
  CVFMT[fm].filter(o=>o[0]!==fileExt(f.name)).forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;s.appendChild(o)});
  openWs('wsCv');
};
function cvHidden(){const d=document.createElement('div');d.className='cvhide';document.body.appendChild(d);return d}
async function canvasToPdf(canvas,pw,ph,m,name){
  const d=await PDFLib.PDFDocument.create(),s=(pw-2*m)/canvas.width,sl=Math.floor((ph-2*m)/s);
  for(let y=0;y<canvas.height;y+=sl){
    const h=Math.min(sl,canvas.height-y),c=newCanvas(canvas.width,h);c.getContext('2d').drawImage(canvas,0,y,canvas.width,h,0,0,canvas.width,h);
    const im=await d.embedPng(new Uint8Array(await (await blobOf(c,'image/png')).arrayBuffer())),p=d.addPage([pw,ph]);
    p.drawImage(im,{x:m,y:ph-m-h*s,width:canvas.width*s,height:h*s});
  }
  saveBlob(new Blob([await d.save()],{type:'application/pdf'}),name+'.pdf');
}
async function cvParts(parts,name,fmt){
  if(fmt==='txt')return saveBlob(new Blob([parts.map(p=>p.text).join('\n\n')],{type:'text/plain'}),name+'.txt');
  if(fmt==='xlsx'){
    await load(SHEETJS);const wb=XLSX.utils.book_new();
    parts.forEach((p,i)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(blocksRows(p.blocks)),'Page '+(i+1)));
    return saveBlob(new Blob([XLSX.write(wb,{bookType:'xlsx',type:'array'})]),name+'.xlsx');
  }
  const doc='<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'+parts.map(p=>blocksHtmlBody(p.blocks)).join('<p style="page-break-before:always"></p>')+'</body></html>';
  if(fmt==='html')return saveBlob(new Blob([doc],{type:'text/html'}),name+'.html');
  await load(HTMLDOCX);saveBlob(htmlDocx.asBlob(doc),name+'.docx');
}
async function cvRun(f,fam,fmt){
  const name=baseName(f.name),buf=await f.arrayBuffer();
  if(fam==='pdf'){
    await load(PDFJS);pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJSW;
    const d=await pdfjsLib.getDocument({data:buf.slice(0)}).promise;
    if(fmt==='png'||fmt==='jpg'){
      await load(JSZIP);const zip=new JSZip(),mime=fmt==='png'?'image/png':'image/jpeg';
      for(let i=1;i<=d.numPages;i++){
        const p=await d.getPage(i),vp=p.getViewport({scale:2}),c=newCanvas(vp.width,vp.height),x=c.getContext('2d');
        x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);await p.render({canvasContext:x,viewport:vp}).promise;
        zip.file(`${name}-page-${i}.${fmt}`,await blobOf(c,mime,.92));
      }
      if(d.numPages===1){const one=Object.values(zip.files)[0];return saveBlob(await one.async('blob'),one.name)}
      return saveBlob(await zip.generateAsync({type:'blob'}),name+'-pages.zip');
    }
    const parts=[];
    for(let i=1;i<=d.numPages;i++){
      const p=await d.getPage(i),vp=p.getViewport({scale:1}),tc=await p.getTextContent();
      const ws=tc.items.filter(it=>it.str&&it.str.trim()).map(it=>{const m=pdfjsLib.Util.transform(vp.transform,it.transform),h=Math.hypot(m[2],m[3]);return{t:it.str.trim(),x0:m[4],x1:m[4]+it.width,y0:m[5]-h,y1:m[5]}});
      const L=ws.length?layoutFromWords(ws):{text:'',scale:[],bold:[],font:'Arial'};
      parts.push({text:L.text,blocks:textBlocks(L.text,L)});
    }
    if(!parts.some(p=>p.text.trim()))throw new Error('scanned');
    return cvParts(parts,name,fmt);
  }
  if(fam==='doc'){
    if(fmt==='pdf'){
      await load(DOCXP);await load(H2C);await load(PDFLIB);
      const box=cvHidden();
      try{
        await docx.renderAsync(buf,box,box,{className:'docx',inWrapper:false,breakPages:true,renderHeaders:true,renderFooters:true});
        const d=await PDFLib.PDFDocument.create();
        for(const s of box.querySelectorAll('section.docx')){
          const c=await html2canvas(s,{scale:2,backgroundColor:'#ffffff',useCORS:true});
          const im=await d.embedPng(new Uint8Array(await (await blobOf(c,'image/png')).arrayBuffer())),p=d.addPage([c.width*.375,c.height*.375]);
          p.drawImage(im,{x:0,y:0,width:p.getWidth(),height:p.getHeight()});
        }
        return saveBlob(new Blob([await d.save()],{type:'application/pdf'}),name+'.pdf');
      }finally{box.remove()}
    }
    await load(MAMMOTH);
    if(fmt==='txt')return saveBlob(new Blob([(await mammoth.extractRawText({arrayBuffer:buf})).value],{type:'text/plain'}),name+'.txt');
    const html=(await mammoth.convertToHtml({arrayBuffer:buf})).value;
    if(fmt==='html')return saveBlob(new Blob(['<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'+html+'</body></html>'],{type:'text/html'}),name+'.html');
    await load(SHEETJS);
    const dom=new DOMParser().parseFromString(html,'text/html'),wb=XLSX.utils.book_new(),tbs=[...dom.querySelectorAll('table')];
    if(tbs.length)tbs.forEach((t,i)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.table_to_sheet(t),'Table '+(i+1)));
    else XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([...dom.body.querySelectorAll('p,h1,h2,h3,li')].map(e=>[e.textContent])),'Text');
    return saveBlob(new Blob([XLSX.write(wb,{bookType:'xlsx',type:'array'})]),name+'.xlsx');
  }
  await load(SHEETJS);
  const wb=XLSX.read(buf,{cellDates:true});
  if(['xlsx','xls','ods'].includes(fmt))return saveBlob(new Blob([XLSX.write(wb,{bookType:fmt,type:'array'})]),name+'.'+fmt);
  if(fmt==='csv'){
    saveBlob(new Blob(['\ufeff'+XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])],{type:'text/csv'}),name+'.csv');
    if(wb.SheetNames.length>1)toast('CSV holds one sheet, so only the first sheet was saved.');return;
  }
  if(fmt==='txt')return saveBlob(new Blob([wb.SheetNames.map(n=>n+'\n'+XLSX.utils.sheet_to_csv(wb.Sheets[n],{FS:'\t'})).join('\n\n')],{type:'text/plain'}),name+'.txt');
  const tables=wb.SheetNames.map(n=>'<h3>'+esc(n)+'</h3>'+(XLSX.utils.sheet_to_html(wb.Sheets[n]).match(/<table[\s\S]*<\/table>/)||[''])[0].replace('<table','<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse"')).join('');
  const doc='<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif">'+tables+'</body></html>';
  if(fmt==='html')return saveBlob(new Blob([doc],{type:'text/html'}),name+'.html');
  if(fmt==='docx'){await load(HTMLDOCX);return saveBlob(htmlDocx.asBlob(doc),name+'.docx')}
  await load(H2C);await load(PDFLIB);
  const box=cvHidden();
  try{box.innerHTML=tables;box.style.cssText='position:fixed;left:-99999px;top:0;width:max-content;background:#fff;color:#000;font-family:Arial,sans-serif;padding:16px';
    const c=await html2canvas(box,{scale:2,backgroundColor:'#ffffff'});await canvasToPdf(c,842,595,24,name)}
  finally{box.remove()}
}
$('#cvGo').onclick=async()=>{
  if(!CV.f||!guard())return;
  const st=$('#cvStat'),b=$('#cvGo');b.disabled=true;st.textContent='Converting...';
  try{await cvRun(CV.f,CV.fam,$('#cvFmt').value);st.textContent='Done. Your file was downloaded.'}
  catch(err){st.textContent=err&&err.message==='scanned'?'This PDF has no selectable text, so it looks scanned. Use the Text extractor instead.':'The file could not be converted. It may be protected, damaged or too complex, or the internet connection dropped.'}
  finally{b.disabled=false}
};

/* ---------- Help buttons inside every tool ---------- */
const TIPS={
  wsImg:['Resize and file size (in the panel): set a width or height, or a target size such as 24 KB, then press Resize and download.','Pick a tool in the panel. On a phone the tools are below the image, and Tools hides them.','Draw, Highlight, Arrow, Box, Crop, Blur and Pixelate work by dragging. Text and Step number work by tapping.','Added text: tap it to select it. Drag it to move it, and drag the round handles to stretch it sideways or up and down.','Zoom with the slider, or with two fingers on a phone. Press Download image to save.'],
  wsOcr:['Choose the language of the text, and the document type. Pick Receipt or table for bills and tables.','The text keeps its columns, so prices stay in line. Check numbers and currency symbols for mistakes.','Pick a format such as Word, PDF, Excel or CSV, then press Save text.'],
  wsPdf:['Use Add text, Add picture or Whiteout and replace, then tap the page.','Select an item to move it with the ✥ corner and resize it with the round corner.','Press Apply edits to the PDF, then Download PDF. Page tools rotate, delete or keep pages.'],
  wsDoc:['Click in the page to edit the text. Use the bold, italic, underline and list buttons.','Download .docx is a best effort copy. Use Print or save as PDF for an exact copy.'],
  wsXl:['Click a cell to edit it. Formulas start with =.','Use the sheet tabs at the top to change sheets. Press Download .xlsx to save.'],
  wsEn:['Pick a mode (Photo, Screenshot or text, Old or noisy photo, Logo), choose a target size, then press Enhance.','Drag the slider under the picture to compare the original with the result. Tick View at actual size to inspect details.','Remove background works best on plain backgrounds. Pick the background colour from the picture if it is not found automatically.','Choose a format or Same format as original, then press Download.'],
  wsCvm:['Step 1: tap a layout. Step 2: type your details, or use sample details to see how it looks. Step 3: check the preview and download the PDF.','The CV uses standard fonts, so letters outside the Latin alphabet are replaced with ?.'],
  wsBc:['Pick a barcode type, then type the information. The preview updates as you type.','Download PNG for pictures or SVG for printing at any size. Check that your scanner can read it before printing many copies.'],
  wsMg:['Add a file, then type its position number. Add the next file and give it another number.','Files are merged from the lowest number to the highest. You can change numbers in the list.','Choose the format to save as, then press Merge and download.'],
  wsCv:['Choose the format to convert to, then press Convert and download.','PDF to Word or Excel is best effort, so check the result. Scanned PDFs need the Text extractor.']};
const hp=document.createElement('div');hp.className='ov';hp.id='ovHelp';hp.setAttribute('role','dialog');hp.setAttribute('aria-modal','true');hp.setAttribute('aria-labelledby','helpT');
hp.innerHTML='<div class="modal"><h2 id="helpT">Help</h2><ul id="helpL" style="padding-left:20px;color:var(--mute);display:grid;gap:8px;margin:12px 0"></ul><div style="display:grid;gap:10px"><a class="btn" id="helpWa" target="_blank" rel="noopener">Ask for help on WhatsApp</a><button class="btn alt" id="helpX" type="button">Close</button></div></div>';
document.body.appendChild(hp);
$('#helpX').onclick=()=>hp.classList.remove('on');
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&hp.classList.contains('on')){hp.classList.remove('on');e.stopImmediatePropagation()}},true);
$$('.ws').forEach(w=>{
  const b=document.createElement('button');b.className='btn alt sm';b.type='button';b.textContent='Help';
  b.onclick=()=>{
    const title=w.querySelector('h2').textContent,L=$('#helpL');L.textContent='';
    (TIPS[w.id]||[]).forEach(t=>{const li=document.createElement('li');li.textContent=t;L.appendChild(li)});
    $('#helpT').textContent='Help: '+title;
    $('#helpWa').href=window.contactHref?contactHref('Hi LetItEdit, I need help with the '+title+' tool.'):'#';
    hp.classList.add('on');
  };
  w.querySelector('.top').insertBefore(b,w.querySelector('[data-close]'));
});
