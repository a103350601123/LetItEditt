/* LetitEdit Background Remover — Pages Function.
 *
 * The browser posts raw image bytes here only after the visitor confirms the
 * consent dialog. This Function forwards the request to the dedicated
 * `letitedit-bgr` Worker through the `BGR_WORKER` service binding, because the
 * Cloudflare Images binding is available to Workers, not to Pages Functions.
 *
 * Nothing is written to storage. The response is the transparent PNG returned
 * by Cloudflare Images. If the monthly Free allowance is exhausted, the Worker
 * returns 429 and this Function passes that through unchanged; no paid upgrade
 * or overage is ever requested.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Non-browser clients are not the threat model here.
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (error) {
    return false;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!sameOrigin(request)) {
    return json(403, { error: 'forbidden', message: 'Cross-origin requests are not accepted.' });
  }
  if (!env.BGR_WORKER || typeof env.BGR_WORKER.fetch !== 'function') {
    return json(503, {
      error: 'unavailable',
      message:
        'Cloudflare processing is not configured. Add the BGR_WORKER service binding to this Pages project.'
    });
  }

  const contentType = (request.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    return json(415, {
      error: 'unsupported_type',
      message: 'Cloudflare processing supports JPG, PNG and WebP.'
    });
  }

  const declared = Number(request.headers.get('content-length')) || 0;
  if (declared > MAX_BYTES) {
    return json(413, {
      error: 'too_large',
      message: 'The image is larger than the 20 MB Cloudflare processing limit.'
    });
  }

  let body;
  try {
    body = await request.arrayBuffer();
  } catch (error) {
    return json(400, { error: 'unreadable', message: 'The image body could not be read.' });
  }
  if (!body || body.byteLength === 0) {
    return json(400, { error: 'empty', message: 'The request contained no image data.' });
  }
  if (body.byteLength > MAX_BYTES) {
    return json(413, {
      error: 'too_large',
      message: 'The image is larger than the 20 MB Cloudflare processing limit.'
    });
  }

  let upstream;
  try {
    upstream = await env.BGR_WORKER.fetch(
      new Request('https://bgr.internal/remove', {
        method: 'POST',
        headers: {
          'content-type': contentType,
          'content-length': String(body.byteLength),
          accept: 'image/png',
          'x-bgr-internal': '1'
        },
        body
      })
    );
  } catch (error) {
    return json(502, {
      error: 'processing',
      message: 'The Cloudflare processing service could not be reached.'
    });
  }

  if (!upstream.ok) {
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
    let payload = null;
    try {
      payload = await upstream.json();
    } catch (error) {
      payload = null;
    }
    return json(
      status,
      payload || {
        error: status === 429 ? 'quota' : 'processing',
        message:
          status === 429
            ? 'The monthly Cloudflare Images free allowance has been used up. No charge was made.'
            : 'Cloudflare could not process this image.'
      }
    );
  }

  const type = upstream.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) {
    return json(502, {
      error: 'bad_response',
      message: 'Cloudflare returned an unexpected response.'
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-bgr-engine': 'cloudflare'
    }
  });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json(405, { error: 'method_not_allowed', message: 'Use POST with an image body.' });
}
