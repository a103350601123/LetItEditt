/* Order page: details, PayPal payment, approval, file upload. */
(function(){
'use strict';
const C=window.LIE,$=s=>document.querySelector(s);
const q=new URLSearchParams(location.search),svc=q.get('service'),tier=+q.get('tier');
const S=C.SERVICES[svc];
let order=null,poll=null,done=false,db=null;
try{db=supabase.createClient(C.SUPABASE_URL,C.SUPABASE_KEY)}catch(e){console.error(e)}
const saved=JSON.parse(localStorage.getItem('lie_order')||'null');

if(S&&S.prices[tier]!==undefined){
  $('#sName').textContent=S.name;$('#sTime').textContent='Delivery: '+C.TIERS[tier];$('#sPrice').textContent='$'+S.prices[tier];
}else if(!saved){location.replace('/freelance');return}
else{$('#form').hidden=true;$('#sName').textContent='You have an unfinished order';$('#sTime').textContent='Tap Resume order below.';$('#sPrice').textContent=''}

const show=id=>$('#'+id).classList.add('on'),hide=id=>$('#'+id).classList.remove('on');
const msg=(t)=>{const e=$('#err');e.textContent=t;e.hidden=!t};

/* One contact only */
function pick(e){
  const mail=e.target.id==='email',other=$(mail?'#wa':'#email'),has=e.target.value.trim()!=='';
  if(has)other.value='';
  const g=$(mail?'#g-wa':'#g-email');g.classList.toggle('skip',has);if(has)g.classList.remove('bad');
  $(mail?'#g-email':'#g-wa').classList.remove('skip');msg('');
}
$('#email').addEventListener('input',pick);$('#wa').addEventListener('input',pick);
document.addEventListener('input',e=>{const g=e.target.closest('.fld');if(g)g.classList.remove('bad')});

function validate(){
  const v={name:$('#name').value.trim(),email:$('#email').value.trim(),wa:$('#wa').value.trim(),req:$('#req').value.trim()};
  const none=!v.email&&!v.wa;
  const bad={'g-name':v.name.length<3,'g-email':!!v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email),'g-wa':!!v.wa&&v.wa.length<7,'g-req':v.req.length<10};
  let ok=true;
  for(const k in bad){$('#'+k).classList.toggle('bad',bad[k]);if(bad[k])ok=false}
  if(none){msg('Please add your email or your WhatsApp number. You only need one.');return false}
  if(!$('#agree').checked){msg('Please accept the Terms of Service to continue.');return false}
  msg('');return ok;
}

$('#form').onsubmit=async e=>{
  e.preventDefault();
  if(!navigator.onLine)return msg('You are offline. Please reconnect to the internet and try again.');
  if(!validate())return;
  if(!db)return msg('Could not connect to the order system. Please refresh the page and try again.');
  const btn=$('#go');btn.disabled=true;btn.textContent='Saving your order...';
  const id=crypto.randomUUID(),price=S.prices[tier];
  try{
    const {error}=await db.from('editing_orders').insert({
      id:id,name:$('#name').value.trim(),email:$('#email').value.trim(),whatsapp:$('#wa').value.trim(),
      requirements:$('#req').value.trim(),service:S.name,delivery:C.TIERS[tier],price:price,terms_accepted:true,status:'pending'
    });
    if(error)throw error;
    order={id:id,price:price,svc:svc};
    localStorage.setItem('lie_order',JSON.stringify(order));
    openPay(true);notify();
  }catch(ex){
    msg('Your order could not be saved. Please check your internet connection and try again, or message LetItEdit on WhatsApp.');
  }finally{btn.disabled=false;btn.textContent='Proceed to payment'}
};

function openPay(push){
  const id=String(order.id);
  $('#ref').textContent=id.slice(0,8).toUpperCase();
  $('#payAmt').textContent='$'+order.price;
  $('#payLink').href='https://paypal.me/'+C.PAYPAL_USER+'/'+order.price+'USD';
  $('#file').setAttribute('accept',(C.SERVICES[order.svc]||{}).accept||'');
  show('ovPay');if(push)history.pushState({m:'pay'},'');
  startPoll();
}
function closePay(fromUi){
  hide('ovPay');if(poll)clearInterval(poll);
  if(fromUi&&history.state&&history.state.m==='pay')history.back();
  showResume();
}
$('#payX').onclick=()=>closePay(true);
addEventListener('popstate',()=>{
  if($('#ovUp').classList.contains('on')&&!done){history.pushState({m:'up'},'');return}
  if($('#ovPay').classList.contains('on'))closePay(false);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#ovPay').classList.contains('on'))closePay(true)});

/* Tell LetItEdit about the order by email (Cloudflare function) */
async function notify(){
  const note=$('#mailNote'),btn=$('#retryMail');btn.hidden=true;note.textContent='Sending your order to LetItEdit...';
  for(let i=0;i<3;i++){
    try{
      const r=await fetch('/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:order.id})});
      if(r.ok){note.textContent='LetItEdit has been notified and will approve your payment soon.';return}
    }catch(e){}
    await new Promise(r=>setTimeout(r,1500*(i+1)));
  }
  note.textContent='We could not send the confirmation email. Check your connection and try again, or message LetItEdit on WhatsApp with your order number.';
  btn.hidden=false;
}
$('#retryMail').onclick=notify;

/* Wait for approval */
function startPoll(){
  if(poll)clearInterval(poll);
  poll=setInterval(async()=>{
    if(!navigator.onLine){$('#waitTxt').textContent='You are offline. Reconnect to keep checking your payment.';return}
    try{
      const {data,error}=await db.rpc('order_status',{oid:String(order.id)});
      if(error)throw error;
      $('#waitTxt').textContent='Waiting for LetItEdit to approve your payment. Keep this tab open.';
      if(data==='paid'){clearInterval(poll);hide('ovPay');const r=$('#resume');if(r)r.remove();show('ovUp')}
      else if(data==='completed'){clearInterval(poll);localStorage.removeItem('lie_order');hide('ovPay');done=true;show('ovDone')}
    }catch(e){$('#waitTxt').textContent='Connection problem. Retrying...'}
  },4000);
}
function showResume(){
  if($('#resume')||!order)return;
  const b=document.createElement('button');b.id='resume';b.className='btn';b.textContent='Resume order: waiting for approval';
  b.onclick=()=>{b.remove();openPay(true)};document.body.appendChild(b);
}

/* Upload after approval */
$('#upForm').onsubmit=async e=>{
  e.preventDefault();
  const err=$('#upErr'),btn=$('#upBtn'),f=$('#file').files[0];err.hidden=true;
  if(!navigator.onLine){err.textContent='You are offline. Please reconnect to the internet and try again.';err.hidden=false;return}
  if(!f||!db||!order)return;
  if(f.size>20*1024*1024){err.textContent='That file is over 20 MB. Please send a smaller file or message LetItEdit on WhatsApp.';err.hidden=false;return}
  btn.disabled=true;btn.textContent='Uploading...';
  const path=order.id+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-]/g,'_');
  try{
    const {error:se}=await db.storage.from('uploads').upload(path,f);if(se)throw se;
    const {data,error:de}=await db.rpc('complete_order',{oid:String(order.id),path:path});
    if(de||!data)throw de||new Error('not completed');
    done=true;localStorage.removeItem('lie_order');hide('ovUp');show('ovDone');
  }catch(ex){
    err.textContent='Upload failed. Please check your internet connection and try again.';err.hidden=false;
    btn.disabled=false;btn.textContent='Upload file';
  }
};
addEventListener('beforeunload',e=>{if($('#ovUp').classList.contains('on')&&!done){e.preventDefault();e.returnValue=''}});

if(saved){order=saved;if(!$('#ovPay').classList.contains('on'))showResume()}
})();
