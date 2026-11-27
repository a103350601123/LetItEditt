/* Background Remover model location and integrity data.
 *
 * The URL below is the development/test default and points at the copy in this
 * repository. `scripts/build-pages.js` replaces this module in the Cloudflare
 * Pages output with the production model URL supplied through the
 * BGR_MODEL_URL environment variable. The model hash and byte count never
 * change: the published model is BiRefNet Lite 512 fp16 at revision
 * 962e67969ec6acec9c19fab76acee4f5e22e990c.
 */
export const MODEL_CONFIG = Object.freeze({
  url: '/vendor/background-removal/model_fp16.onnx',
  sha256: 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516',
  bytes: 98484532,
  version: 'birefnet-lite-512-fp16-962e679'
});
