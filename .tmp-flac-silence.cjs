function crc8(bytes, start, end) { let crc=0; for(let i=start;i<end;i++){crc^=bytes[i];for(let b=0;b<8;b++)crc=(crc&0x80)?((crc<<1)^0x07)&0xff:(crc<<1)&0xff;} return crc; }
function crc16(bytes, start, end) { let crc=0; for(let i=start;i<end;i++){crc^=bytes[i]<<8;for(let b=0;b<8;b++)crc=(crc&0x8000)?((crc<<1)^0x8005)&0xffff:(crc<<1)&0xffff;} return crc; }
function utf8Number(value){ if(value<0x80) return [value]; let bytes=0,v=value; while(v>0){bytes++;v>>=6;} const total=bytes+1; const arr=new Array(total); v=value; for(let i=total-1;i>0;i--){arr[i]=0x80|(v&0x3f);v>>=6;} arr[0]=((0xff<<(8-total))&0xff)|v; return arr; }
class BitWriter {
  constructor(){ this.bytes=[]; this.current=0; this.bits=0; }
  write(value, count){ for(let i=count-1;i>=0;i--){ this.current=(this.current<<1)|((value>>i)&1); this.bits++; if(this.bits===8){this.bytes.push(this.current);this.current=0;this.bits=0;} } }
  align(){ if(this.bits>0){ this.bytes.push((this.current<<(8-this.bits))&0xff); this.current=0; this.bits=0; } }
}
function residualFor(samples, offset, size, order){
  const out = new Int32Array(size-order);
  for(let i=order;i<size;i++){
    const s=samples[offset+i];
    let r;
    if(order===0) r=s;
    else if(order===1) r=s-samples[offset+i-1];
    else if(order===2) r=s-2*samples[offset+i-1]+samples[offset+i-2];
    else if(order===3) r=s-3*samples[offset+i-1]+3*samples[offset+i-2]-samples[offset+i-3];
    else r=s-4*samples[offset+i-1]+6*samples[offset+i-2]-4*samples[offset+i-3]+samples[offset+i-4];
    out[i-order]=r;
  }
  return out;
}
function zigzag(v){ return (v<<1)^(v>>31); }
function chooseRice(residuals){
  let bestK=0,bestBits=Infinity;
  for(let k=0;k<=14;k++){
    let bits=residuals.length*(1+k);
    for(let i=0;i<residuals.length;i++) bits += zigzag(residuals[i])>>>k;
    if(bits<bestBits){bestBits=bits;bestK=k;}
  }
  return bestK;
}
function encodeFlac(floatChannels, sampleRate){
  const channels = floatChannels.map((ch) => { const a = new Int16Array(ch.length); for (let i = 0; i < ch.length; i++) { const v = Math.max(-1, Math.min(1, ch[i])); a[i] = Math.round(v < 0 ? v * 32768 : v * 32767); } return a; });
  const frames=channels[0].length, channelCount=channels.length, blockSize=4096;
  const blocks=[]; for(let s=0;s<frames;s+=blockSize) blocks.push(Math.min(blockSize,frames-s));
  if(blocks.length>1 && blocks[blocks.length-1]<16){ const need=16-blocks[blocks.length-1]; blocks[blocks.length-2]-=need; blocks[blocks.length-1]=16; }
  if(blocks[0]<16) throw new Error('too short');
  const info=new Uint8Array(34), dv=new DataView(info.buffer);
  dv.setUint16(0,Math.min(...blocks)); dv.setUint16(2,Math.max(...blocks));
  let bitPos=0; const wb=(value,bits)=>{for(let i=bits-1;i>=0;i--){if((value>>i)&1) info[10+(bitPos>>3)]|=0x80>>(bitPos&7); bitPos++;}};
  wb(sampleRate,20); wb(channelCount-1,3); wb(15,5); wb(frames,36);
  const header=new Uint8Array(42); header.set([0x66,0x4c,0x61,0x43],0); header[4]=0x80; header[7]=34; header.set(info,8);
  const parts=[header];
  let offset=0, frameNumber=0;
  for(const size of blocks){
    const h=[0xff,0xf8,(7<<4)|0,((channelCount-1)<<4),...utf8Number(frameNumber),(size-1)>>8,(size-1)&0xff];
    const hb=Uint8Array.from(h); const frameHead=Uint8Array.from([...hb,crc8(hb,0,hb.length)]);
    const bw=new BitWriter();
    for(let c=0;c<channelCount;c++){
      const data=channels[c];
      let bestOrder=0,bestResiduals=null,bestBits=Infinity;
      for(let order=0;order<=0;order++){
        if(size<=order) continue;
        const res=residualFor(data,offset,size,order);
        let absSum=0; for(let i=0;i<res.length;i++) absSum+=Math.abs(res[i]);
        const estimate=absSum + order*16;
        if(estimate<bestBits){bestBits=estimate;bestOrder=order;bestResiduals=res;}
      }
      bw.write(0,1); bw.write(8+bestOrder,6); bw.write(0,1);
      for(let i=0;i<bestOrder;i++) bw.write(data[offset+i]&0xffff,16);
      const res=bestResiduals;
      bw.write(0,4); bw.write(0,4);
      const k=chooseRice(res); if(frameNumber===0) console.log("order", bestOrder, "k", k, "res", res[0], res[1], res[2], res[3]);
      bw.write(k,4);
      for(let i=0;i<res.length;i++){
        const u=zigzag(res[i]);
        const q=u>>>k;
        for(let j=0;j<q;j++) bw.write(0,1);
        bw.write(1,1);
        if(k>0) bw.write(u&((1<<k)-1),k);
      }
    }
    bw.align();
    const sub=Uint8Array.from(bw.bytes);
    const total=frameHead.length+sub.length;
    const frame=new Uint8Array(total+2);
    frame.set(frameHead,0); frame.set(sub,frameHead.length);
    const c16=crc16(frame,0,total); frame[total]=c16>>8; frame[total+1]=c16&0xff;
    parts.push(frame);
    offset+=size; frameNumber++;
  }
  let len=parts.reduce((n,p)=>n+p.length,0); const out=new Uint8Array(len); let pos=0;
  for(const p of parts){out.set(p,pos);pos+=p.length;}
  return out;
}
const rate=44100, frames=rate, left=new Float32Array(frames), right=new Float32Array(frames);
for(let i=0;i<frames;i++){const v=0; left[i]=v; right[i]=v;}
const flac=encodeFlac([left,right],rate);
require('fs').writeFileSync('.tmp-test.flac',Buffer.from(flac));
console.log('flac bytes',flac.length,'wav would be',44+frames*4);
const { chromium } = require('@playwright/test');
(async()=>{
  const browser=await chromium.launch({channel:'chrome'}); const page=await browser.newPage(); await page.goto('http://127.0.0.1:4173/');
  const b64=Buffer.from(flac).toString('base64');
  const result=await page.evaluate(async(data)=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));try{const ctx=new OfflineAudioContext(1,1,44100);const buf=await ctx.decodeAudioData(bytes.buffer.slice(0));const ch=buf.getChannelData(0);let sum=0,peak=0;for(let i=0;i<ch.length;i++){sum+=ch[i]*ch[i];peak=Math.max(peak,Math.abs(ch[i]));}return{duration:buf.duration,rate:buf.sampleRate,channels:buf.numberOfChannels,rms:Math.sqrt(sum/ch.length),peak};}catch(e){return'ERROR '+e.message;}},b64);
  console.log(result); await browser.close();
})();



