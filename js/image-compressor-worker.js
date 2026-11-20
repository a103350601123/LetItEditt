/* Image Size Compressor — encoding worker.
 * Decodes the original, draws it once at its original dimensions (no resize),
 * optionally flattens transparency onto a JPEG background, and encodes the
 * requested output type with the browser's own encoder. */
'use strict';

self.onmessage = async function (event) {
  var data = event.data || {};
  try {
    var bitmap = await createImageBitmap(data.blob);
    var width = bitmap.width;
    var height = bitmap.height;
    var canvas = new OffscreenCanvas(width, height);
    var context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas drawing is unavailable in this browser.');

    if (data.type === 'image/jpeg') {
      context.fillStyle = data.background || '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();

    var hasAlpha = false;
    if (data.type !== 'image/jpeg') {
      try {
        var pixels = context.getImageData(0, 0, width, height).data;
        for (var i = 3; i < pixels.length; i += 4) {
          if (pixels[i] < 255) { hasAlpha = true; break; }
        }
      } catch (error) {
        hasAlpha = false;
      }
    }

    var options = { type: data.type };
    if (data.quality != null && data.type !== 'image/png') options.quality = data.quality;
    var blob = await canvas.convertToBlob(options);
    var buffer = await blob.arrayBuffer();
    self.postMessage({
      id: data.id,
      ok: true,
      buffer: buffer,
      mime: blob.type,
      width: width,
      height: height,
      hasAlpha: hasAlpha
    }, [buffer]);
  } catch (error) {
    self.postMessage({
      id: data.id,
      ok: false,
      message: (error && error.message) || 'The image could not be encoded.'
    });
  }
};
