/* LetitEdit Professional Video Editor — shared presets for the UI. */

export const TEXT_PRESETS = {
  title: {
    label: 'Title',
    description: 'Large centred headline',
    name: 'Title',
    duration: 3,
    text: { content: 'Your title', size: 92, bold: true, y: 0.42, maxWidth: 0.9 }
  },
  subtitle: {
    label: 'Subtitle',
    description: 'Captions near the lower edge',
    name: 'Subtitle',
    duration: 3,
    y: 0.82,
    text: { content: 'Subtitle line', size: 52, bold: false, bgOpacity: 0.55, bgColor: '#000000', maxWidth: 0.86 }
  },
  lower: {
    label: 'Lower third',
    description: 'Name and role at the left',
    name: 'Lower third',
    duration: 4,
    x: 0.3,
    y: 0.76,
    text: {
      content: 'Name\nRole or description',
      size: 44,
      bold: true,
      align: 'left',
      bgOpacity: 0.55,
      bgColor: '#0f172a',
      maxWidth: 0.5,
      lineHeight: 1.2
    }
  },
  caption: {
    label: 'Caption',
    description: 'Small caption without a box',
    name: 'Caption',
    duration: 3,
    y: 0.9,
    text: { content: 'Caption text', size: 40, bold: false, bgOpacity: 0, maxWidth: 0.84 }
  },
  heading: {
    label: 'Heading',
    description: 'Wide spaced heading',
    name: 'Heading',
    duration: 3,
    y: 0.2,
    text: { content: 'HEADING', size: 76, bold: true, letterSpacing: 5, bgOpacity: 0, maxWidth: 0.9 }
  },
  quote: {
    label: 'Quote',
    description: 'Centred quote with a box',
    name: 'Quote',
    duration: 4,
    y: 0.5,
    text: {
      content: '“A short quotation that matters.”',
      size: 54,
      bold: false,
      italic: true,
      bgOpacity: 0.65,
      bgColor: '#111827',
      maxWidth: 0.82
    }
  }
};

export const SHAPE_TYPES = [
  { id: 'rect', label: 'Rectangle', icon: '▭' },
  { id: 'circle', label: 'Circle', icon: '●' },
  { id: 'line', label: 'Line', icon: '─' },
  { id: 'arrow', label: 'Arrow', icon: '➜' }
];

export const STICKERS = ['⭐', '❤️', '✅', '🔥', '✨', '🎉', '👍', '💡', '📌', '🎯', '⚡', '💬'];

export const ANIMATIONS = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-left', label: 'Slide from left' },
  { id: 'slide-right', label: 'Slide from right' },
  { id: 'slide-up', label: 'Slide from bottom' },
  { id: 'slide-down', label: 'Slide from top' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'spin', label: 'Spin' }
];

export const COLOR_PRESETS = [
  {
    id: 'warm',
    label: 'Warm',
    values: { temperature: 38, saturation: 10, brightness: 4 }
  },
  {
    id: 'cool',
    label: 'Cool',
    values: { temperature: -36, tint: -8, saturation: 8 }
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    values: { contrast: 18, saturation: -12, shadows: -18, vignette: 32 }
  },
  {
    id: 'vivid',
    label: 'Vivid',
    values: { saturation: 38, contrast: 10, brightness: 3 }
  },
  {
    id: 'faded',
    label: 'Faded',
    values: { contrast: -16, fade: 26, saturation: -12 }
  },
  {
    id: 'mono',
    label: 'Monochrome',
    values: { saturation: -100, contrast: 12 }
  },
  {
    id: 'bright',
    label: 'Bright',
    values: { brightness: 22, exposure: 8, shadows: 12 }
  },
  {
    id: 'moody',
    label: 'Moody',
    values: { exposure: -14, shadows: -26, highlights: -14, temperature: -10, vignette: 26 }
  }
];

export const PREVIEW_QUALITIES = [
  { id: 'low', label: 'Fast · 540p', edge: 640 },
  { id: 'standard', label: 'Standard · 720p', edge: 960 },
  { id: 'high', label: 'Sharp · 1080p', edge: 1280 }
];

export const EXPORT_QUALITIES = [
  { id: 'high', label: 'High quality', detail: 'Largest file, most detail' },
  { id: 'balanced', label: 'Balanced', detail: 'Recommended for most projects' },
  { id: 'small', label: 'Smaller file', detail: 'Smaller download, softer detail' }
];

export const EXPORT_FORMATS = [
  { id: 'mp4', label: 'MP4 · H.264 + AAC', detail: 'Plays almost everywhere' },
  { id: 'webm', label: 'WebM · VP9 + Opus', detail: 'Efficient for the web' }
];
