# Vendored browser libraries

LetitEdit keeps its generated tools local: the files below are served from this directory and are never fetched from a CDN at runtime. Heavy engines are imported only by the tool that needs them, so unrelated pages stay light. License texts are included verbatim alongside the files they cover.

| Files | Package / version | Source | License | Used by |
| --- | --- | --- | --- | --- |
| `libheif-bundle.js` | `libheif-js` 1.19.8 | `https://www.npmjs.com/package/libheif-js` | LGPL-3.0 (`libheif-js-LICENSE.txt`, upstream `libheif-upstream-LICENSE.txt`) | HEIC Viewer & Converter |
| `tesseract.min.js`, `tesseract-worker.min.js` | `tesseract.js` 5.1.1 | `https://www.npmjs.com/package/tesseract.js` | Apache-2.0 (`tesseract-LICENSE.md`) | Image to Text |
| `tesseract-core-lstm.wasm.js` | `tesseract.js-core` 5.1.1 | `https://www.npmjs.com/package/tesseract.js-core` | Apache-2.0 (`tesseract-core-LICENSE.txt`) | Image to Text |
| `eng.traineddata.gz` | Tesseract English traineddata, matching the 5.1.1 core | `https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz` | Apache-2.0 | Image to Text |
| `qrcode-generator.js` | `qrcode-generator` 1.4.4 | `https://www.npmjs.com/package/qrcode-generator` | MIT (`qrcode-generator-LICENSE.txt`) | QR Code Generator |
| `jsQR.js` | `jsQR` 1.4.0 | `https://www.npmjs.com/package/jsqr` | Apache-2.0 (`jsQR-LICENSE.txt`) | Test-only QR decoding verification |
| `mediabunny.min.mjs` | `mediabunny` 1.64.0 | `https://www.npmjs.com/package/mediabunny` | MPL-2.0 (`mediabunny-LICENSE.txt`) | Video & Audio tools (demux, decode, conversion, encode) |
| `mediabunny-mp3-encoder.mjs` | `@mediabunny/mp3-encoder` 1.66.1 | `https://www.npmjs.com/package/@mediabunny/mp3-encoder` | MPL-2.0 (`mediabunny-mp3-encoder-LICENSE.txt`); bundled LAME is LGPL | Audio Editor MP3 export |
| `gifenc.esm.js` | `gifenc` 1.0.3 | `https://www.npmjs.com/package/gifenc` | MIT (`gifenc-LICENSE.txt`) | MP4 to GIF |
| `mediapipe/vision_bundle.mjs`, `mediapipe/wasm/` | `@mediapipe/tasks-vision` 1.2.3 | `https://www.npmjs.com/package/@mediapipe/tasks-vision` | Apache-2.0 (`mediapipe-LICENSE.txt`) | Video Background Remover |
| `transformers.min.js`, `onnx/` | `@huggingface/transformers` 3.7.5 (with its bundled ONNX Runtime Web files) | `https://www.npmjs.com/package/@huggingface/transformers` | Apache-2.0 (`transformers-LICENSE.txt`, `onnx-LICENSE.txt`) | Multilingual Subtitle Generator, optional ranking in Video-to-Shorts |

## Local-only loading

- The HEIC tool creates a decoder from the bundled factory before decoding files. Unsupported or corrupt files produce real errors; no result is fabricated.
- The OCR tool points Tesseract at local `workerPath`, `corePath` and `langPath` values. It recognises English only, in the browser, with no image upload.
- The QR generator embeds an image data URL only when it fits QR capacity. Larger private images require a hosted public URL; LetitEdit does not upload them.
- `jsQR.js` is not loaded by any public page. It is used by the test suite to prove that downloaded QR PNGs contain the expected payload.
- Mediabunny and the MP3 extension are loaded on demand by `js/video-core.js`. No user media leaves the browser.
- MediaPipe WASM, model and Transformers.js/ONNX files are local runtime code. The **models** below are fetched from official hosts only after explicit user opt-in.

## External model downloads (opt-in only)

| Model | Approximate size | Official URL | Used by |
| --- | --- | --- | --- |
| MediaPipe selfie segmenter (float16) | about 15 MB | `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite` | Video Background Remover |
| `onnx-community/whisper-tiny` | about 75–80 MB of model/tokenizer files, plus local ONNX WASM (~21.6 MB) | `https://huggingface.co/onnx-community/whisper-tiny` | Multilingual Subtitle Generator; optional Video-to-Shorts speech ranking |

The tool pages disclose these downloads next to the checkbox. Media is decoded and processed in the browser and is never uploaded. Cancelling or leaving the page terminates the worker/segmenter and releases object URLs.
