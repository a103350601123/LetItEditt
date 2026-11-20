/* Optional local speech recognition worker.
 * Loaded only after a user opts in. The audio samples are sent from the page
 * and never leave the browser; model and runtime files are fetched from the
 * official Hugging Face / jsDelivr hosts by Transformers.js. */
import { env, pipeline } from './vendor/transformers.min.js';

const wasmBase = new URL('./vendor/onnx/', self.location.href).href;
env.allowLocalModels = false;
env.backends = env.backends || {};
env.backends.onnx = env.backends.onnx || {};
env.backends.onnx.wasm = env.backends.onnx.wasm || {};
env.backends.onnx.wasm.wasmPaths = wasmBase;
env.backends.onnx.wasm.numThreads = 1;

let recognizer = null;
let loading = null;
let lastProgress = 0;

function progress(message) {
  const now = Date.now();
  if (now - lastProgress < 450) return;
  lastProgress = now;
  self.postMessage({ type: 'progress', message: message });
}

function ensureRecognizer() {
  if (recognizer) return Promise.resolve(recognizer);
  if (!loading) {
    loading = pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: event => {
        if (event && event.status === 'progress' && typeof event.progress === 'number') {
          progress(`Downloading local model: ${Math.round(event.progress)}%`);
        } else if (event && event.status) {
          progress(`Preparing local model: ${event.status}`);
        }
      }
    }).then(model => { recognizer = model; return model; }).catch(error => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== 'transcribe') return;
  try {
    progress('Loading local Whisper tiny model (first use downloads about 75-80 MB)…');
    const model = await ensureRecognizer();
    progress('Recognising speech on this device…');
    const result = await model(new Float32Array(message.samples), {
      language: message.language && message.language !== 'auto' ? message.language : undefined,
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5
    });
    self.postMessage({
      type: 'done',
      result: {
        text: String(result.text || '').trim(),
        chunks: Array.isArray(result.chunks) ? result.chunks.map(chunk => ({
          text: String(chunk.text || ''),
          timestamp: Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, 0]
        })) : []
      }
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: String((error && error.message) || error) });
  }
};
