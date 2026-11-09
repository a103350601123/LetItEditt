/* Cloudflare Pages Function: GET /geo
   Returns the visitor's country so the site can hide the WhatsApp number from visitors in Pakistan. */
export function onRequestGet({request}){
  const c=(request.cf&&request.cf.country)||request.headers.get('cf-ipcountry')||'';
  return new Response(JSON.stringify({country:c}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
