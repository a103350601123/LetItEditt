/* Cloudflare Pages Function: GET and POST /approve-order
   GET shows a confirmation page, POST marks the order as paid. This stops email scanners from approving by accident. */
const enc=new TextEncoder();
async function sign(id,secret){
  const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const s=await crypto.subtle.sign('HMAC',k,enc.encode(id));
  return [...new Uint8Array(s)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function same(a,b){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sb(env,path,init){
  return fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...init,headers:{apikey:env.SUPABASE_SERVICE_KEY,...(String(env.SUPABASE_SERVICE_KEY).startsWith('eyJ')?{Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY}:{}),'Content-Type':'application/json',...((init&&init.headers)||{})}});
}

const page=(title,body)=>new Response('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>'+esc(title)+'</title></head>'
  +'<body style="font-family:Arial,sans-serif;background:#0b1020;color:#eaf0ff;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><div style="max-width:480px;width:100%;background:#131a30;border:1px solid #2a3560;border-radius:16px;padding:28px">'+body+'</div></body></html>',
  {headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});
async function check(env,id,t){
  if(!UUID.test(id||'')||!t||!env.APPROVE_SECRET)return false;
  return same(await sign(id,env.APPROVE_SECRET),t);
}
export async function onRequestGet({request,env}){
  const u=new URL(request.url),id=u.searchParams.get('id'),t=u.searchParams.get('t');
  if(!(await check(env,id,t)))return page('Invalid link','<h2>Invalid link</h2><p>This approval link is not valid.</p>');
  const r=await sb(env,'editing_orders?id=eq.'+id+'&select=name,service,delivery,price,status');
  const o=(await r.json())[0];
  if(!o)return page('Not found','<h2>Order not found</h2>');
  if(o.status!=='pending')return page('Already handled','<h2>Already handled</h2><p>This order is already marked as <b>'+esc(o.status)+'</b>.</p>');
  return page('Approve order','<h2>Approve this order?</h2><p><b>'+esc(o.service)+'</b><br>'+esc(o.delivery)+'<br>Customer: '+esc(o.name)+'<br>Amount: <b>$'+esc(o.price)+'</b></p>'
    +'<p>Only approve after you see the PayPal payment.</p><form method="POST"><input type="hidden" name="id" value="'+esc(id)+'"><input type="hidden" name="t" value="'+esc(t)+'">'
    +'<button style="background:#2563eb;color:#fff;border:0;border-radius:10px;padding:14px 22px;font-size:16px;cursor:pointer;width:100%">Approve payment</button></form>');
}
export async function onRequestPost({request,env}){
  const f=await request.formData(),id=f.get('id'),t=f.get('t');
  if(!(await check(env,id,t)))return page('Invalid link','<h2>Invalid link</h2>');
  const r=await sb(env,'editing_orders?id=eq.'+id+'&status=eq.pending',{method:'PATCH',body:JSON.stringify({status:'paid'}),headers:{Prefer:'return=representation'}});
  const rows=r.ok?await r.json():[];
  if(!rows.length)return page('Not updated','<h2>Nothing changed</h2><p>The order was already approved or could not be found.</p>');
  return page('Approved','<h2 style="color:#34d399">Order approved</h2><p>The customer&#39;s order page now asks them to upload their file.</p>');
}
