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
var wa='https://wa.me/923456006438?text='+encodeURIComponent('Hi LetItEdit, I need help. I am on this page: '+location.pathname);
hpn.innerHTML='<strong>How can we help?</strong><a href="'+wa+'" target="_blank" rel="noopener">Chat on WhatsApp</a><a href="mailto:hello@letitedit.com">Send an email</a><a href="/how-to-use">How to use LetItEdit</a><a href="/faq">Read the FAQ</a>';
hf.onclick=function(){var o=hpn.classList.toggle('on');hf.setAttribute('aria-expanded',o)};
document.addEventListener('keydown',function(e){if(e.key==='Escape')hpn.classList.remove('on')});
document.body.appendChild(hpn);document.body.appendChild(hf);
})();
