# ONNX Runtime Web 1.24.3

These files are copied unmodified from the `onnxruntime-web` 1.24.3 npm
package (`dist/`). ONNX Runtime is MIT licensed; see `LICENSE`.

Source: https://www.npmjs.com/package/onnxruntime-web/v/1.24.3

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `ort.wasm.min.mjs` | 49,997 | `d5a6d7bc8ee587648fb3742dde8c0094d17cbd3822a68bbec8ddfcd4f2adb88e` |
| `ort-wasm-simd-threaded.mjs` | 24,274 | `5687566b1bc1c8cf628d76c2ddb16b2a3b81a7997273d4666564880495088e57` |
| `ort-wasm-simd-threaded.wasm` | 12,361,745 | `be0e129949062ad50290ef94683fac8be5bb6156f709e030b7a5f1661a2f6c17` |
| `ort.webgpu.min.mjs` | 67,100 | `c50f835ca8ee0999fef441f9319e507b0247923943aec034418b889904e94789` |
| `ort-wasm-simd-threaded.jsep.mjs` | 46,595 | `9a99acd12acc495184c9ea4d458ac9424f8180aacfbc7b8371ed64f9351e4a81` |
| `ort-wasm-simd-threaded.jsep.wasm` | 25,014,754 | `2e0a3d0e3f6b7c13ecfaba38c13691fd19c9ed470e72f9d7d8416ca59ab6dbcd` |

Version 1.24.3 is used instead of 1.31.1 because Cloudflare Pages rejects files
larger than 25 MiB (26,214,400 bytes). The 1.31.1 WebGPU WASM is 29,520,971
bytes. The 1.24.3 WebGPU WASM is 25,014,754 bytes and remains below the limit.

`ort.webgpu.min.mjs` is used only when `navigator.gpu` is available and session
creation succeeds. The worker otherwise imports `ort.wasm.min.mjs` with its
own non-JSEP WASM pair. The WebGPU entry is not used as a WASM fallback because
that path would request an unvendored asyncify file.

All files are served from LetitEdit. Model inference stays in the browser.
