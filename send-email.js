/* Cloudflare Pages Function: POST /send-email */
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
  return fetch(env.SUPABASE_URL+'/rest/v1/'+path,{
    ...init,
    headers:{
      apikey:env.SUPABASE_SERVICE_KEY,
      ...(String(env.SUPABASE_SERVICE_KEY).startsWith('eyJ')?{Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY}:{}),
      'Content-Type':'application/json',
      ...((init&&init.headers)||{})
    }
  });
}

const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'Content-Type':'application/json'}});

export async function onRequestPost({request,env}){
  try{
    for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','APPROVE_SECRET','RESEND_API_KEY','OWNER_EMAIL'])if(!env[k])return json({error:'server not configured',detail:'missing '+k},500);
    
    // Changed table to 'orders'
    const {record} = await request.json(); 
    const o = record; // Supabase Webhooks send the row data inside 'record'
    const id = o.id;
    
    if(typeof id!=='string'||!UUID.test(id))return json({error:'bad request'},400);

    if(o.status!=='pending')return json({ok:true,skipped:o.status});
    if(o.notified)return json({ok:true,already:true});
    
    const token=await sign(id,env.APPROVE_SECRET);
    const link=new URL(request.url).origin+'/approve-order?id='+id+'&t='+token;
    
    const contact = o.email ? 'Email: ' + esc(o.email) : 'WhatsApp: ' + esc(o.whatsapp);
    const html='<div style="font-family:Arial,sans-serif;max-width:560px">'
      +'<h2>New LetItEdit order: '+esc(o.delivery_time)+'</h2>'
      +'<p><b>Order number:</b> '+esc(id.slice(0,8).toUpperCase())+'<br><b>Name:</b> '+esc(o.name)+'<br><b>'+contact.replace(': ',':</b> ')+'</p>'
      +'<p><b>Details:</b><br>'+esc(o.requirements).replace(/\n/g,'<br>')+'</p>'
      +'<p>The customer accepted the User Agreement.</p>'
      +'<p><b>Check that the PayPal payment arrived, then approve.</b></p>'
      +'<p><a href="'+link+'" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Review and approve order</a></p></div>';
      
    const m=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:env.FROM_EMAIL||'LetItEdit Orders <onboarding@resend.dev>',
        to:[env.OWNER_EMAIL],
        subject:'New order: '+o.name,
        html:html
      })
    });
    
    if(!m.ok){let d='';try{d=(await m.text()).slice(0,300)}catch(e){}return json({error:'email service refused the message',detail:d},502)}
    
    // Changed table to 'orders'
    await sb(env,'orders?id=eq.'+id,{method:'PATCH',body:JSON.stringify({notified:true}),headers:{Prefer:'return=minimal'}});
    
    return json({ok:true});
  }catch(e){return json({error:'server error',detail:String(e&&e.message||e).slice(0,120)},500)}
}
