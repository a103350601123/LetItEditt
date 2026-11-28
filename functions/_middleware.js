/* Redirect the www host to the canonical apex host.
 *
 * Cloudflare Pages serves the same project on every custom domain. The
 * canonical URLs in every page use https://letitedit.com, so www requests are
 * permanently redirected instead of being indexed as duplicate content.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.letitedit.com') {
    url.hostname = 'letitedit.com';
    return Response.redirect(url.toString(), 308);
  }
  return context.next();
}
