# Hosting the background-removal model outside Cloudflare Pages

Cloudflare Pages rejects any single file larger than 25 MiB. The BiRefNet
model is 98,484,532 bytes (93.9 MiB), so it cannot be part of the Pages
deployment. Nothing in this document has been created yet: no R2 bucket,
domain, DNS record, or credential is assumed to exist.

The model must stay byte-for-byte identical:

- SHA-256: `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516`
- Bytes: `98484532`
- Source: https://huggingface.co/studioludens/birefnet-lite-512
- Revision: `962e67969ec6acec9c19fab76acee4f5e22e990c`

Do not re-export, quantise, or otherwise change the file. The worker rejects a
download whose byte count or SHA-256 does not match the values in
`js/background-remover/model-config.mjs`.

## 1. Upload the model to R2

The bucket name and public hostname below are placeholders. Choose your own;
do not copy them into the frontend as if they were already configured.

```sh
npx wrangler login
npx wrangler r2 bucket create <YOUR_BUCKET>

# Confirm the local file before uploading.
certutil -hashfile vendor/background-removal/model_fp16.onnx SHA256
# Expected: eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516

npx wrangler r2 object put \
  <YOUR_BUCKET>/birefnet/962e67969ec6acec9c19fab76acee4f5e22e990c/model_fp16.onnx \
  --file vendor/background-removal/model_fp16.onnx \
  --content-type application/octet-stream \
  --cache-control "public, max-age=31536000, immutable" \
  --remote
```

Use a versioned key (the revision above, or the SHA-256) so the object can be
cached forever without ever serving a different model under the same URL.

## 2. Enable public read access

Choose one of these delivery methods:

### Option A — r2.dev development URL (quickest, not for production traffic)

1. In the Cloudflare dashboard, open **R2 object storage** and select the
   bucket.
2. Open **Settings** → **Public access** → **r2.dev subdomain**.
3. Enable it and copy the generated `https://pub-<assigned-id>.r2.dev` origin.

This URL is assigned by Cloudflare. Do not invent it. r2.dev is rate-limited
and is intended for development; a custom domain is the production option.

### Option B — custom domain (recommended for production)

1. In the bucket's **Settings** → **Public access** → **Custom domains**, add a
   hostname such as `static.example.com`.
2. Create the required DNS record when Cloudflare prompts you. **This changes
   DNS and needs your approval before it is done.**
3. Wait for the certificate and DNS to become active.

The resulting origin is `https://<your-public-model-host>`. No R2 API token or
access key belongs in frontend code. Public read access is sufficient.

## 3. Allow CORS from the website

The browser downloads the model from a different origin, so the bucket must
return CORS headers. Create `cors.json` (not committed with real values):

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://letitedit.com"],
        "methods": ["GET"]
      }
    }
  ]
}
```

Apply and verify it:

```sh
npx wrangler r2 bucket cors set <YOUR_BUCKET> --file cors.json
npx wrangler r2 bucket cors list <YOUR_BUCKET>
```

If Cloudflare Pages preview deployments must also load the model, add each
preview origin explicitly. Wildcards are supported, but list exact production
origins where possible. CORS changes can take up to about 30 seconds to
propagate.

## 4. Point the Pages build at the model

The production URL is injected at build time by `scripts/build-pages.js`; it is
not hard-coded in the worker.

In **Cloudflare Pages → your project → Settings → Build & deployments**:

- **Build command:** `npm run build:pages`
- **Build output directory:** `dist`
- **Environment variable:** `BGR_MODEL_URL` =
  `https://<your-public-model-host>/birefnet/962e67969ec6acec9c19fab76acee4f5e22e990c/model_fp16.onnx`

Then trigger a deployment. `npm run build:pages`:

- copies the site into `dist/`;
- excludes `vendor/background-removal/model_fp16.onnx`;
- writes the production URL into `dist/js/background-remover/model-config.mjs`;
- fails the build if any output file is still larger than 25 MiB;
- refuses non-HTTPS URLs, credentials in the URL, and non-`.onnx` paths.

Verify a local build:

```sh
BGR_MODEL_URL="https://<your-public-model-host>/birefnet/962e67969ec6acec9c19fab76acee4f5e22e990c/model_fp16.onnx" npm run build:pages
```

The script prints the file count, total size, largest file, and the injected
model URL. The model file must not exist under `dist/`.

## 5. Verify delivery

After the bucket is live, check the exact production URL with an `Origin`
header (R2 only returns CORS headers to cross-origin requests):

```sh
curl -I -H "Origin: https://letitedit.com" \
  "https://<your-public-model-host>/birefnet/962e67969ec6acec9c19fab76acee4f5e22e990c/model_fp16.onnx"
```

The response must include:

- `HTTP/2 200` (or `HTTP/1.1 200`);
- `Content-Length: 98484532`;
- `Content-Type: application/octet-stream`;
- `Cache-Control: public, max-age=31536000, immutable`;
- `Access-Control-Allow-Origin: https://letitedit.com` (or `*`).

Then open the production tool, select **Remove background**, and confirm the
progress text reaches “Verifying the AI model SHA-256 integrity…” and the model
note says “SHA-256 verified.”

## Privacy boundary

Only this one `.onnx` model object is fetched from R2. User images are never
uploaded to R2 or any server: decoding, inference, refinement, and export all
run in the browser. The Pages deployment continues to serve the HTML, CSS,
JavaScript, and ONNX Runtime Web files.
