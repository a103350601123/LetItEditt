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
- ONNX Runtime Web 1.31.1 runs the model with WebGPU where available and
  WebAssembly on the CPU otherwise.

## Runtime

The runtime files in `../onnxruntime/` are from the `onnxruntime-web` 1.31.1
npm package and are MIT licensed (see `../onnxruntime/LICENSE`). They are
vendored so the tool does not depend on a third-party CDN at runtime.
