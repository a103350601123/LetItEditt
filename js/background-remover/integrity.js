/* SHA-256 verification for the downloaded BiRefNet model.
 * Only a complete, verified buffer is passed to ONNX Runtime. */

export async function sha256Hex(buffer) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyModelBuffer(buffer, config) {
  if (config.bytes && buffer.byteLength !== config.bytes) {
    throw new Error(
      'The AI model download was incomplete (' +
        buffer.byteLength +
        ' of ' +
        config.bytes +
        ' bytes). Check your connection and try again.'
    );
  }
  const actual = await sha256Hex(buffer);
  if (!actual) {
    return { verified: false, sha256: null };
  }
  if (actual !== config.sha256) {
    throw new Error(
      'The AI model failed its SHA-256 integrity check. Clear this site’s cached data and try again. ' +
        'If the error persists, the hosted model file does not match the published hash.'
    );
  }
  return { verified: true, sha256: actual };
}
