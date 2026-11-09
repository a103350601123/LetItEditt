(function(){
'use strict';
var n=document.createElement('div');n.id='net';n.setAttribute('role','alert');
n.textContent='You are offline. Please reconnect to the internet. Tools and orders will not work until you do.';
document.body.appendChild(n);
var t=document.createElement('div');t.id='toast';t.setAttribute('role','status');t.setAttribute('aria-live','polite');document.body.appendChild(t);
function upd(){n.classList.toggle('on',!navigator.onLine)}
addEventListener('online',upd);addEventListener('offline',upd);upd();
window.toast=function(m){t.textContent=m;t.classList.add('on');clearTimeout(window._tt);window._tt=setTimeout(function(){t.classList.remove('on')},4500)};
window.guard=function(){if(navigator.onLine)return true;window.toast('You are offline. Please reconnect to the internet and try again.');return false};
var m=document.getElementById('menu'),nav=document.getElementById('nav');
if(m)m.addEventListener('click',function(){var o=nav.classList.toggle('open');m.setAttribute('aria-expanded',o)});
try{
var o=JSON.parse(localStorage.getItem('lie_order')||'null');
if(o&&o.id&&location.pathname.indexOf('/order')!==0&&!sessionStorage.getItem('lie_hide')){
var b=document.createElement('div');b.className='resumebar';
b.innerHTML='<span>You have an unfinished order.</span><a class="btn sm" href="/order?resume=1">Resume order</a><button class="btn alt sm" type="button" aria-label="Dismiss">×</button>';
b.querySelector('button').onclick=function(){sessionStorage.setItem('lie_hide','1');b.remove()};
document.body.appendChild(b);}
}catch(e){}
var hf=document.createElement('button');hf.type='button';hf.className='btn helpfab';hf.textContent='Need help?';hf.setAttribute('aria-expanded','false');
var hpn=document.createElement('div');hpn.className='helppanel';
var wa='https://wa.me/447777647095?text='+encodeURIComponent('Hi LetItEdit, I need help. I am on this page: '+location.pathname);
hpn.innerHTML='<strong>How can we help?</strong><a class="wa-only" href="'+wa+'" target="_blank" rel="noopener">Chat on WhatsApp</a><a href="mailto:hello@letitedit.com">Send an email</a><a href="/how-to-use">How to use LetItEdit</a><a href="/faq">Read the FAQ</a>';
hf.onclick=function(){var o=hpn.classList.toggle('on');hf.setAttribute('aria-expanded',o)};
document.addEventListener('keydown',function(e){if(e.key==='Escape')hpn.classList.remove('on')});
document.body.appendChild(hpn);document.body.appendChild(hf);

/* WhatsApp: green icon for visitors outside Pakistan. Visitors in Pakistan get email links instead. */
var NUM='447777647095',MAIL='hello@letitedit.com';
window.LIE_PK=false;
window.contactHref=function(msg){return window.LIE_PK?'mailto:'+MAIL+'?subject='+encodeURIComponent(msg):'https://wa.me/'+NUM+'?text='+encodeURIComponent(msg)};
var wf=document.createElement('a');wf.className='wafab';wf.href='https://wa.me/'+NUM+'?text='+encodeURIComponent('Hi LetItEdit, I have a question.');
wf.target='_blank';wf.rel='noopener';wf.setAttribute('aria-label','Chat with LetItEdit on WhatsApp');
wf.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
document.body.appendChild(wf);
function swapText(el){var w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),n;while((n=w.nextNode())){n.nodeValue=n.nodeValue.replace(/on WhatsApp/gi,'by email').replace(/WhatsApp/gi,'email')}}
function applyGeo(pk){
  window.LIE_PK=pk;
  if(pk){
    document.querySelectorAll('a[href*="wa.me"]').forEach(function(a){
      if(a===wf||a.classList.contains('wa-only')){a.remove();return}
      a.href='mailto:'+MAIL+'?subject='+encodeURIComponent('LetItEdit enquiry');a.removeAttribute('target');swapText(a);
    });
  }
  document.documentElement.classList.add('geo-ok');
}
fetch('/geo',{cache:'no-store'}).then(function(r){return r.json()}).then(function(g){applyGeo(!!g&&g.country==='PK')}).catch(function(){applyGeo(false)});
})();
