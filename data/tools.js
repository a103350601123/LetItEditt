/* Published tool registry.
 * Only tools with real, working browser-side functionality belong here.
 */
'use strict';

const TOOLS = [
  {
    key: 'image-photo-editor',
    name: 'Image & Photo Editor',
    shortName: 'Photo Editor',
    slug: 'image-photo-editor',
    path: '/media-and-motion/image-photo-editor/',
    categoryKey: 'image',
    icon: '🖼️',
    status: 'live',
    title: 'Image & Photo Editor Online – Edit, Resize and Compress Images | LetitEdit',
    description: 'Edit photos online with LetitEdit. Crop, resize, compress, rotate, adjust colours, add text and shapes, apply filters, and export images in popular formats.',
    intro: 'A browser-side photo editor for real edits: crop, resize, compress, rotate, adjust colour, add text, shapes and layers, then export the finished image. Your file stays on your device.',
    keywords: [
      'image editor',
      'photo editor',
      'crop image',
      'resize image',
      'compress image',
      'convert image',
      'add text to photo',
      'image filters',
      'webp',
      'avif',
      'heic',
      'tiff'
    ]
  }
];

module.exports = { TOOLS };
