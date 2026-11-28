/* LetitEdit Background Remover — Cloudflare Images Worker.
 *
 * This Worker is intentionally not given a public route. It is reached only
 * through the Pages Function service binding `BGR_WORKER`, which forwards the
 * browser request after a same-origin check. The Images binding accepts raw
 * image bytes, so no base64 and no temporary storage are used.
 *
 * Cloudflare Images Free: 5,000 unique transformations per calendar month.
 * When the allowance is exhausted Cloudflare returns 9422. This Worker turns
 * that into a clear 429 response; it never enables a paid upgrade or overage.
 */

const MAX_BYTES = 20 * 1024 * 1024; // Images binding raw-byte limit
const TIMEOUT_MS = 30000;

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

function hasMagicBytes(bytes, type) {
  if (type === 'image/jpeg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === 'image/png') {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return png.every((byte, index) => bytes[index] === byte);
  }
  if (type === 'image/webp') {
    return (
      bytes.length > 12 &&
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
      String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
    );
  }
  return false;
}

function timeout(ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Cloudflare Images timed out.'), { code: 'timeout' }));
    }, ms);
    // Do not keep the Worker alive only for this timer.
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== 'POST' || url.pathname !== '/remove') {
      return json(404, { error: 'not_found', message: 'Not found.' });
    }
    if (request.headers.get('x-bgr-internal') !== '1') {
      return json(403, { error: 'forbidden', message: 'This endpoint is not public.' });
    }
    if (!env.IMAGES || typeof env.IMAGES.input !== 'function') {
      return json(503, {
        error: 'unavailable',
        message: 'Cloudflare Images is not bound to this Worker.'
      });
    }

    const contentType = (request.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      return json(415, {
        error: 'unsupported_type',
        message: 'Cloudflare processing supports JPG, PNG and WebP. Save the image in one of those formats and try again.'
      });
    }

    const declared = Number(request.headers.get('content-length')) || 0;
    if (declared > MAX_BYTES) {
      return json(413, {
        error: 'too_large',
        message: 'The image is larger than the 20 MB Cloudflare processing limit.'
      });
    }

    let bytes;
    try {
      bytes = new Uint8Array(await request.arrayBuffer());
    } catch (error) {
      return json(400, { error: 'unreadable', message: 'The image body could not be read.' });
    }
    if (bytes.byteLength === 0) {
      return json(400, { error: 'empty', message: 'The request contained no image data.' });
    }
    if (bytes.byteLength > MAX_BYTES) {
      return json(413, {
        error: 'too_large',
        message: 'The image is larger than the 20 MB Cloudflare processing limit.'
      });
    }
    if (!hasMagicBytes(bytes, contentType)) {
      return json(400, {
        error: 'bad_signature',
        message: 'The file does not match its declared image type.'
      });
    }

    try {
      const work = (async () => {
        const image = await env.IMAGES.input(bytes)
          .transform({ segment: 'foreground' })
          .output({ format: 'image/png' });
        return image.response({
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'x-bgr-engine': 'cloudflare'
          }
        });
      })();
      return await Promise.race([work, timeout(TIMEOUT_MS)]);
    } catch (error) {
      const code = error && (error.code || error.status);
      const text = String((error && error.message) || error || '');
      if (String(code) === '9422' || /9422/.test(text)) {
        return json(429, {
          error: 'quota',
          message:
            'The monthly Cloudflare Images free allowance has been used up. No charge was made and no paid fallback was attempted.'
        });
      }
      if (String(code) === 'timeout') {
        return json(504, {
          error: 'timeout',
          message: 'Cloudflare processing took too long. Try a smaller image or process it on your device.'
        });
      }
      return json(502, {
        error: 'processing',
        message: 'Cloudflare could not process this image. Try a different JPG, PNG or WebP file.'
      });
    }
  }
};
