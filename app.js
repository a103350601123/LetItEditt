const SUPABASE_URL='https://bjragiylhglqfodbihvd.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqcmFnaXlsaGdscWZvZGJpaHZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMjQ1NzMsImV4cCI6MjEwODkwMDU3M30.upa96t4q9W1AXIr8wry3kL_8U7L__GmTZZ3kWNjurYU';
const PAYPAL='https://www.paypal.me/mujahidhussain78y';

// 🚀 TEST SWITCH: Change this to `true` when you want to receive real emails!
const SEND_TEST_EMAILS = false; 

const $=i=>document.getElementById(i);
let db=null,poll,price=0,cur='',oid='',up=false;

try{db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY)}catch(e){}
const cl=i=>$(i).classList.remove('on'),op=i=>$(i).classList.add('on');
const M=(i,h)=>'<div class="overlay" id="'+i+'" role="dialog" aria-modal="true"><div class="modal">'+h+'</div></div>';

document.body.insertAdjacentHTML('beforeend',
M('oM','<button class="x" data-cl="oM" aria-label="Close">×</button><p class="stepno">Step 1 of 3: Your details</p><h3>Order details</h3><form id="of" novalidate><div class="fld"><label for="nm">Full name</label><input id="nm" autocomplete="name"></div><p class="note">Add one way to reach you: email or WhatsApp.</p><div class="fld"><label for="em">Email address</label><input id="em" type="email"></div><div class="fld"><label for="wa">or WhatsApp number</label><input id="wa" type="tel" placeholder="+44 7393 652862"></div><div class="fld"><label for="rq">What do you need done?</label><textarea id="rq" rows="3"></textarea></div><p class="total" id="tt"></p><p class="err" id="er" hidden></p><button class="btn full" type="submit">Continue to payment</button></form>')+
M('dM','<button class="x" data-cl="dM" aria-label="Close">×</button><h3 style="color:#d63a73">User Agreement &amp; Disclaimer</h3><div class="agree"><strong>1. User responsibility:</strong> you own the rights to the content or have permission to edit it.<br><br><strong>2. No liability:</strong> LetItEdit is not responsible for how edited files are used or distributed.<br><br><strong>3. Freelance service:</strong> provided as-is, with no endorsement of the final use of the materials.</div><button class="btn full" id="ag">I Agree</button><p class="fine" style="margin-top:10px"><a href="#" data-back="1">Cancel</a></p>')+
M('pM','<button class="x" data-cl="pM" aria-label="Close">×</button><p class="stepno">Step 2 of 3: Payment</p><h3>Pay with PayPal</h3><p class="fine">Your order number is:</p><div class="ref" id="rf"></div><p class="fine">Pay <strong id="am"></strong> via PayPal and put this number in the payment note. Choose Goods and services if asked.</p><a class="btn full" id="pl" href="#" target="_blank" rel="noopener">Pay with PayPal</a><div class="wait"><span class="spin"></span><span>Waiting for payment confirmation.</span></div><p class="fine" style="margin-top:15px; text-align:center;"><a href="#" onclick="cancelOrder(event)" style="color:#f87171; font-weight:bold; text-decoration:underline;">Cancel this order and go back</a></p>')+
M('uM','<p class="stepno">Step 3 of 3: Upload</p><h3><span class="tick">Payment confirmed.</span> Upload your file</h3><form id="uf"><div class="drop"><input type="file" id="fl" required></div><p class="fine">Maximum file size is 20 MB.</p><p class="err" id="ue" hidden></p><button class="btn full" id="ub" type="submit">Upload file</button></form>')+
M('fM','<h3><span class="tick">Order received.</span></h3><p>Thank you. LetItEdit has your file and will deliver it by email or WhatsApp within your chosen time. Revisions are free within 48 hours.</p><br><button class="btn full" onclick="location.href=\'/\'">Return to home</button>'));

document.addEventListener('click',e=>{const t=e.target;if(t.dataset.cl)cl(t.dataset.cl);if(t.dataset.back){e.preventDefault();cl('dM');op('oM')}});

function openOrder(t,p){cur=t;price=p;$('tt').textContent='Total: $'+p+' for '+t+' delivery';$('er').hidden=true;op('oM')}

$('of').onsubmit=e=>{e.preventDefault();const n=$('nm').value.trim(),m=$('em').value.trim(),w=$('wa').value.trim(),r=$('rq').value.trim();let s='';
if(n.length<3)s='Enter your full name.';else if(!m&&!w)s='Add your email or WhatsApp number.';else if(m&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m))s='Enter a valid email address.';else if(r.length<10)s='Describe the job in at least 10 characters.';
$('er').hidden=!s;$('er').textContent=s;if(!s){cl('oM');op('dM')}};

$('ag').onclick=async()=>{const b=$('ag');b.disabled=true;b.textContent='Saving order...';
try{if(!db)throw Error('no connection');
const {data,error}=await db.from('orders').insert([{name:$('nm').value.trim(),email:$('em').value.trim(),whatsapp:$('wa').value.trim(),requirements:'[UNPAID - '+(typeof SVC!=='undefined'?SVC.k:'General')+'] '+$('rq').value.trim(),delivery_time:cur+' ($'+price+')',status:'pending',terms_accepted:true}]).select();
if(error)throw error;oid=data[0].id;const s=String(oid);

// 🚀 ONLY SEND EMAIL IF THE SWITCH IS TRUE
if (SEND_TEST_EMAILS) {
  fetch('/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: oid,
      name: $('nm').value.trim(),
      email: $('em').value.trim(),
      whatsapp: $('wa').value.trim(),
      delivery_time: cur + ' ($' + price + ')',
      requirements: '[UNPAID - ' + (typeof SVC!=='undefined'?SVC.k:'General') + '] ' + $('rq').value.trim(),
      approveLink: 'https://letitedit.com/approve-order?id=' + oid
    })
  }).catch(err => console.error('Email function failed:', err));
}

$('rf').textContent=s.length>12?s.slice(0,8).toUpperCase():s;$('am').textContent='$'+price;$('pl').href=PAYPAL+'/'+price+'USD';
cl('dM');op('pM');clearInterval(poll);
localStorage.setItem('pendingOrder', JSON.stringify({id: oid, price: price}));
poll=setInterval(async()=>{const {data:d}=await db.from('orders').select('status').eq('id',oid).single();if(d&&d.status==='paid'){clearInterval(poll);localStorage.removeItem('pendingOrder');cl('pM');op('uM')}},3000);
}catch(x){alert('Order could not be saved ('+x.message+').');cl('dM');op('oM')}
b.disabled=false;b.textContent='I Agree'};

function cancelOrder(e){
  e.preventDefault();
  localStorage.removeItem('pendingOrder');
  closeModal('pM');
  if(poll) clearInterval(poll);
  if($('resumeBtn')) $('resumeBtn').remove();
}

function openPay(id,p){
  const s=String(id);
  $('rf').textContent=s.length>12?s.slice(0,8).toUpperCase():s;$('am').textContent='$'+p;$('pl').href=PAYPAL+'/'+p+'USD';
  $('upId').value=id;
  op('pM');
  localStorage.setItem('pendingOrder', JSON.stringify({id: id, price: p}));
  startPoll(id);
}

function startPoll(id){
  if(poll)clearInterval(poll);
  poll=setInterval(async()=>{
    if(!db)return;
    const {data}=await db.from('orders').select('status').eq('id',id).single();
    if(data&&data.status==='paid'){
      clearInterval(poll);
      localStorage.removeItem('pendingOrder');
      closeModal('pM');
      if($('resumeBtn')) $('resumeBtn').remove();
      up=false;
      op('uM');
    }
  },3000);
}

function showResume(o){
  if($('resumeBtn'))$('resumeBtn').remove();
  const b=document.createElement('button');
  b.id='resumeBtn'; b.className='btn glow-btn'; b.innerHTML='⏳ Resume Pending Order';
  b.style='position:fixed; left:50%; bottom:20px; transform:translateX(-50%); z-index:99; padding:15px 30px; border-radius:99px;';
  b.onclick=()=>{b.remove(); openPay(o.id,o.price);};
  document.body.appendChild(b);
}

document.addEventListener('DOMContentLoaded',()=>{
  const o=JSON.parse(localStorage.getItem('pendingOrder')||'null');
  if(o)showResume(o);
});

$('uf').onsubmit=async e=>{e.preventDefault();const f=$('fl').files[0],er=$('ue'),b=$('ub');er.hidden=true;if(!f)return;
if(f.size>20*1048576){er.textContent='File is over 20 MB.';er.hidden=false;return}
b.disabled=true;b.textContent='Uploading...';const p=oid+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-]/g,'_');
try{const a=await db.storage.from('uploads').upload(p,f);if(a.error)throw a.error;
const c=await db.from('orders').update({file_url:p,status:'completed'}).eq('id',oid);if(c.error)throw c.error;cl('uM');op('fM')}
catch(x){er.textContent='Upload failed ('+x.message+').';er.hidden=false;b.disabled=false;b.textContent='Upload file'}};

if(typeof SVC!=='undefined'){
  if($('fl'))$('fl').setAttribute('accept',SVC.a);
  SVC.pr.forEach(([t,p])=>{const b=document.createElement('button');b.className='speed';b.innerHTML='<small>'+t+'</small><strong>$'+p+'</strong>';b.onclick=()=>openOrder(t,p);$('speeds').appendChild(b)})
}

if($('cSvc')){
  const PRICES=[['30 minutes',5],['1 hour',4],['2 hours',3],['3-5 hours',2],['6-12 hours',1]];
  window.calcUpdate=function(){const c=PRICES[$('cSpd').value];$('cOut').textContent='$'+c[1]+' for delivery in '+c[0]};
  window.calcOrder=function(){if(typeof SVC!=='undefined'&&$('fl'))$('fl').setAttribute('accept',SVC.a);const c=PRICES[$('cSpd').value];openOrder(c[0],c[1]);};
  calcUpdate();
}
