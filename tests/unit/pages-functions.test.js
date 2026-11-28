import { describe, it, expect, vi } from 'vitest';
import { onRequest as middleware } from '../../functions/_middleware.js';
import { onRequest, onRequestPost } from '../../functions/api/background-removal.js';
import worker from '../../workers/background-removal/src/index.js';

/* PNG signature plus padding. The Workers code checks magic bytes only; the
 * Images binding itself is mocked, so a real decodable image is unnecessary. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function postRequest({ type = 'image/png', body = PNG, origin, length } = {}) {
  const headers = { 'content-type': type };
  if (origin) headers.origin = origin;
  if (length !== undefined) headers['content-length'] = String(length);
  return new Request('https://letitedit.com/api/background-removal', {
    method: 'POST',
    headers,
    body
  });
}

function mockImages({ outputError } = {}) {
  const calls = { transform: null, output: null };
  return {
    calls,
    input(bytes) {
      expect(bytes.byteLength).toBe(PNG.byteLength);
      return {
        transform(options) {
          calls.transform = options;
          return this;
        },
        async output(options) {
          calls.output = options;
          if (outputError) throw outputError;
          return {
            async response(init = {}) {
              return new Response(PNG, {
                status: 200,
                headers: { 'content-type': 'image/png', ...(init.headers || {}) }
              });
            }
          };
        }
      };
    }
  };
}

describe('www to apex middleware', () => {
  it('redirects www requests to the canonical apex host', async () => {
    const next = vi.fn(() => new Response('ok'));
    const response = await middleware({
      request: new Request('https://www.letitedit.com/about/?x=1'),
      next
    });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://letitedit.com/about/?x=1');
    expect(next).not.toHaveBeenCalled();
  });

  it('passes apex requests through', async () => {
    const next = vi.fn(() => new Response('ok'));
    const response = await middleware({
      request: new Request('https://letitedit.com/about/'),
      next
    });
    expect(await response.text()).toBe('ok');
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('Pages Function /api/background-removal', () => {
  it('returns 503 when the Worker service binding is missing', async () => {
    const response = await onRequestPost({ request: postRequest(), env: {} });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('unavailable');
  });

  it('rejects cross-origin requests', async () => {
    const response = await onRequestPost({
      request: postRequest({ origin: 'https://evil.example' }),
      env: { BGR_WORKER: { fetch: vi.fn() } }
    });
    expect(response.status).toBe(403);
  });

  it('rejects unsupported content types', async () => {
    const response = await onRequestPost({
      request: postRequest({ type: 'image/gif' }),
      env: { BGR_WORKER: { fetch: vi.fn() } }
    });
    expect(response.status).toBe(415);
  });

  it('rejects an oversized declared body before reading it', async () => {
    const response = await onRequestPost({
      request: postRequest({ length: 21 * 1024 * 1024 }),
      env: { BGR_WORKER: { fetch: vi.fn() } }
    });
    expect(response.status).toBe(413);
  });

  it('forwards a valid request through the service binding', async () => {
    let forwarded;
    const response = await onRequestPost({
      request: postRequest(),
      env: {
        BGR_WORKER: {
          async fetch(request) {
            forwarded = request;
            return new Response(PNG, { headers: { 'content-type': 'image/png' } });
          }
        }
      }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-bgr-engine')).toBe('cloudflare');
    expect(forwarded.headers.get('x-bgr-internal')).toBe('1');
    expect(forwarded.method).toBe('POST');
  });

  it('passes a 429 quota response through unchanged', async () => {
    const response = await onRequestPost({
      request: postRequest(),
      env: {
        BGR_WORKER: {
          async fetch() {
            return new Response(JSON.stringify({ error: 'quota', message: 'used up' }), {
              status: 429,
              headers: { 'content-type': 'application/json' }
            });
          }
        }
      }
    });
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('quota');
  });

  it('returns 405 for non-POST requests', async () => {
    const response = await onRequest({
      request: new Request('https://letitedit.com/api/background-removal'),
      env: {}
    });
    expect(response.status).toBe(405);
  });
});

describe('Cloudflare Images Worker', () => {
  const call = (overrides = {}) => {
    const headers = { 'content-type': 'image/png', 'x-bgr-internal': '1', ...overrides.headers };
    return worker.fetch(
      new Request('https://bgr.internal/remove', {
        method: overrides.method || 'POST',
        headers,
        body: overrides.body === undefined ? PNG : overrides.body
      }),
      overrides.env || { IMAGES: mockImages() }
    );
  };

  it('hides the Worker from non-internal callers', async () => {
    const response = await call({ headers: { 'x-bgr-internal': '0' } });
    expect(response.status).toBe(403);
  });

  it('returns 404 outside the /remove route', async () => {
    const response = await worker.fetch(
      new Request('https://bgr.internal/other', {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'x-bgr-internal': '1' },
        body: PNG
      }),
      { IMAGES: mockImages() }
    );
    expect(response.status).toBe(404);
  });

  it('rejects a file whose bytes do not match the declared type', async () => {
    const response = await call({ body: new Uint8Array([1, 2, 3, 4]) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('bad_signature');
  });

  it('uses segment=foreground and returns a PNG', async () => {
    const images = mockImages();
    const response = await call({ env: { IMAGES: images } });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-bgr-engine')).toBe('cloudflare');
    expect(images.calls.transform).toEqual({ segment: 'foreground' });
    expect(images.calls.output).toEqual({ format: 'image/png' });
  });

  it('maps Cloudflare error 9422 to a 429 quota response', async () => {
    const images = mockImages({
      outputError: Object.assign(new Error('9422: monthly limit'), { code: '9422' })
    });
    const response = await call({ env: { IMAGES: images } });
    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.error).toBe('quota');
    expect(payload.message).toContain('No charge was made');
  });

  it('returns 503 when the Images binding is absent', async () => {
    const response = await call({ env: {} });
    expect(response.status).toBe(503);
  });
});
