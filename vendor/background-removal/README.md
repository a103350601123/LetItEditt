# BiRefNet Lite 512 — vendored model

`model_fp16.onnx` is the fp16 ONNX export published by Studio Ludens:

- Repository: https://huggingface.co/studioludens/birefnet-lite-512
- Revision: `962e67969ec6acec9c19fab76acee4f5e22e990c`
- File: `model_fp16.onnx`
- SHA-256: `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516`
  (verify locally with `certutil -hashfile model_fp16.onnx SHA256` before deployment)
- Size: 98,484,532 bytes
- Input: `input_image`, float32, `[1, 3, 512, 512]`, ImageNet mean/std normalisation
- Output: `output_image`, float32, `[1, 1, 512, 512]` logits (sigmoid applied by the worker)

## Licence

MIT. The model card and `LICENSE` in the repository carry:

> Copyright (c) 2024 ZhengPeng
> Copyright (c) 2026 Studio Ludens V.O.F.

The base model is `ZhengPeng7/BiRefNet_lite` (MIT). The model was trained on
DIS5K and related public datasets. Review the upstream model card before
redistributing the weights.

## Why this conversion

- Fixed 512 × 512 input keeps the download at ~94 MiB instead of ~214 MiB.
- fp16 was chosen over int8: `quantize_dynamic` produced a 170,636,757-byte
  file (larger than fp16) with almost identical output, so it was rejected.
- ONNX Runtime Web 1.24.3 runs the model with WebGPU where available and
  WebAssembly on the CPU otherwise.

## Runtime

The runtime files in `../onnxruntime/` are from the `onnxruntime-web` 1.24.3
npm package and are MIT licensed (see `../onnxruntime/LICENSE`). They are
vendored so the tool does not depend on a third-party CDN at runtime.

1.24.3 is used instead of 1.31.1 because its WebGPU `jsep.wasm` is 23.9 MiB,
below Cloudflare Pages' 25 MiB per-file limit. The newer runtime's 28.2 MiB
WebGPU WASM exceeds that limit. The model file and inference quality are
unchanged.

## Hosting

The model is too large for Cloudflare Pages (93.9 MiB against a 25 MiB
per-file limit). Publish it unchanged on Cloudflare R2 or another approved
static host. Exact bucket, CORS, public-access, Pages build and verification
steps are in [`HOSTING.md`](HOSTING.md). Set `BGR_MODEL_URL` when building the
Pages output:

```bash
BGR_MODEL_URL="https://<model-host>/<versioned-key>/model_fp16.onnx" npm run build:pages
```

`scripts/build-pages.js` copies the site into `dist/`, excludes the model,
injects the URL into the generated `model-config.mjs`, and fails if any output
file exceeds 25 MiB. The model host must allow cross-origin `GET` requests from
the production site and should serve the versioned object with
`Cache-Control: public, max-age=31536000, immutable`.

The worker verifies the downloaded model against the SHA-256 above before
passing it to ONNX Runtime. A partial or incorrect download is rejected and
retried once with a cache-bypassing request.
