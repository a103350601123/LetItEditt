/* LetitEdit image-processing worker.
 * Keeps full-resolution pixel work off the main thread.
 */
'use strict';

importScripts('image-processing.js');

self.onmessage = function (event) {
  const message = event.data || {};
  if (message.type !== 'process') return;
  try {
    const imageData = new ImageData(
      new Uint8ClampedArray(message.buffer),
      message.width,
      message.height
    );
    self.LetitEditImageProcessing.processImageData(imageData, message.settings || {});
    self.postMessage({
      type: 'processed',
      id: message.id,
      buffer: imageData.data.buffer,
      width: imageData.width,
      height: imageData.height
    }, [imageData.data.buffer]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: message.id,
      message: error && error.message ? error.message : String(error)
    });
  }
};
