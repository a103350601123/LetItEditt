# Vendored browser libraries

LetitEdit keeps its generated tools fully local: the files below are served from this directory and are never fetched from a CDN at runtime. They are loaded only by the tools that need them.

| Files | Package / version | Source | License | Used by |
| --- | --- | --- | --- | --- |
| `libheif-bundle.js` | `libheif-js` 1.19.8 | `https://www.npmjs.com/package/libheif-js` | LGPL-3.0 (`libheif-js-LICENSE.txt`, upstream `libheif-upstream-LICENSE.txt`) | HEIC Viewer & Converter |
| `tesseract.min.js`, `tesseract-worker.min.js` | `tesseract.js` 5.1.1 | `https://www.npmjs.com/package/tesseract.js` | Apache-2.0 (`tesseract-LICENSE.md`) | Image to Text |
| `tesseract-core-lstm.wasm.js` | `tesseract.js-core` 5.1.1 | `https://www.npmjs.com/package/tesseract.js-core` | Apache-2.0 (`tesseract-core-LICENSE.txt`) | Image to Text |
| `eng.traineddata.gz` | Tesseract English traineddata, matching the 5.1.1 core | `https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz` | Apache-2.0 | Image to Text |
| `qrcode-generator.js` | `qrcode-generator` 1.4.4 | `https://www.npmjs.com/package/qrcode-generator` | MIT (`qrcode-generator-LICENSE.txt`) | QR Code Generator |
| `jsQR.js` | `jsQR` 1.4.0 | `https://www.npmjs.com/package/jsqr` | Apache-2.0 (`jsQR-LICENSE.txt`) | Test-only QR decoding verification |

## Local-only loading

- The HEIC tool creates a decoder from the bundled factory before decoding files. Unsupported or corrupt files produce real errors; no result is fabricated.
- The OCR tool points Tesseract at local `workerPath`, `corePath` and `langPath` values. It recognises English only, in the browser, with no image upload.
- The QR generator embeds an image data URL only when it fits QR capacity. Larger private images require a hosted public URL; LetitEdit does not upload them.
- `jsQR.js` is not loaded by any public page. It is used by the test suite to prove that downloaded QR PNGs contain the expected payload.

License texts are included verbatim alongside the files they cover.
