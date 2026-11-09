/* Cloudflare Pages Function: POST /send-email
   Emails the owner when a customer places an order. The email has a secure approve link. */
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

const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'Content-Type':'application/json'}});

export async function onRequestPost({request,env}){
  try{
    for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','APPROVE_SECRET','RESEND_API_KEY','OWNER_EMAIL'])if(!env[k])return json({error:'server not configured',detail:'missing '+k},500);
    const {id}=await request.json();
    if(typeof id!=='string'||!UUID.test(id))return json({error:'bad request'},400);
    const r=await sb(env,'editing_orders?id=eq.'+id+'&select=*');
    if(!r.ok)return json({error:'database error',detail:'status '+r.status},502);
    const o=(await r.json())[0];
    if(!o)return json({error:'order not found'},404);
    if(o.status!=='pending')return json({ok:true,skipped:o.status});
    if(o.notified)return json({ok:true,already:true});
    const token=await sign(id,env.APPROVE_SECRET);
    const link=new URL(request.url).origin+'/approve-order?id='+id+'&t='+token;
    const contact=o.email?'Email: '+esc(o.email):'WhatsApp: '+esc(o.whatsapp);
    const html='<div style="font-family:Arial,sans-serif;max-width:560px">'
      +'<h2>New LetItEdit order: $'+esc(o.price)+'</h2>'
      +'<p><b>Order number:</b> '+esc(id.slice(0,8).toUpperCase())+'<br><b>Service:</b> '+esc(o.service)+'<br><b>Delivery:</b> '+esc(o.delivery)
      +'<br><b>Name:</b> '+esc(o.name)+'<br><b>'+contact.replace(': ',':</b> ')+'</p>'
      +'<p><b>Details:</b><br>'+esc(o.requirements).replace(/\n/g,'<br>')+'</p>'
      +'<p>The customer accepted the Terms of Service.</p>'
      +'<p><b>Check that the PayPal payment arrived, then approve.</b></p>'
      +'<p><a href="'+link+'" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Review and approve order</a></p></div>';
    const m=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({from:env.FROM_EMAIL||'LetItEdit Orders <onboarding@resend.dev>',to:[env.OWNER_EMAIL],subject:'New order $'+o.price+': '+o.service,html:html})});
    if(!m.ok){let d='';try{d=(await m.text()).replace(/[\w.+-]+@[\w.-]+/g,'[email]').slice(0,300)}catch(e){}return json({error:'email service refused the message',detail:d},502)}
    await sb(env,'editing_orders?id=eq.'+id,{method:'PATCH',body:JSON.stringify({notified:true}),headers:{Prefer:'return=minimal'}});
    return json({ok:true});
  }catch(e){return json({error:'server error',detail:String(e&&e.message||e).slice(0,120)},500)}
}

/* Visit /send-email in your browser to see which settings are present.
   Visit /send-email?test=YOUR_APPROVE_SECRET to send a test email and see exactly what Resend answers. */
export async function onRequestGet({request,env}){
  const k=['SUPABASE_URL','SUPABASE_SERVICE_KEY','APPROVE_SECRET','RESEND_API_KEY','OWNER_EMAIL'];
  const t=new URL(request.url).searchParams.get('test');
  const info={configured:Object.fromEntries(k.map(x=>[x,!!env[x]])),fromAddress:env.FROM_EMAIL||'(FROM_EMAIL not set, so onboarding@resend.dev is used, which only delivers to your Resend sign-up email)'};
  if(!t||!env.APPROVE_SECRET||!same(t,env.APPROVE_SECRET))return json(info);
  if(!env.RESEND_API_KEY||!env.OWNER_EMAIL)return json({...info,error:'RESEND_API_KEY or OWNER_EMAIL is missing'},500);
  const m=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:env.FROM_EMAIL||'LetItEdit Orders <onboarding@resend.dev>',to:[env.OWNER_EMAIL],subject:'LetItEdit test email',html:'<p>If you can read this, order emails work.</p>'})});
  return json({...info,resendStatus:m.status,resend:await m.text()},m.ok?200:502);
}
