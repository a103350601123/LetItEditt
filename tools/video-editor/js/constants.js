/* Constants: aspects, filters, effects, transitions, fonts, text styles, animations, library */
(function () {
  const VE = (window.VE = window.VE || {});

  VE.APP_NAME = 'LetitEdit Video Editor';
  VE.APP_SHORT = 'LetitEdit';
  VE.PROJECT_EXT = '.letitedit.json';
  VE.MAX_TRACKS = 24; /* explicit, documented limit: encoding/decoding many live media elements is device-dependent */

  VE.ASPECTS = [
    { id: '16:9', name: 'Widescreen', short: '16:9', w: 16, h: 9 },
    { id: '9:16', name: 'Vertical', short: '9:16', w: 9, h: 16 },
    { id: '1:1', name: 'Square', short: '1:1', w: 1, h: 1 },
    { id: '4:5', name: 'Portrait', short: '4:5', w: 4, h: 5 },
    { id: '4:3', name: 'Classic', short: '4:3', w: 4, h: 3 },
    { id: '21:9', name: 'Cinematic', short: '21:9', w: 21, h: 9 }
  ];
  VE.ASPECT_MAP = Object.fromEntries(VE.ASPECTS.map(a => [a.id, a]));

  VE.FILTERS = [
    { id: 'none', name: 'Original', css: 'none' },
    { id: 'warm', name: 'Warm', css: 'saturate(1.2) sepia(0.2) brightness(1.05)' },
    { id: 'cool', name: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)' },
    { id: 'vintage', name: 'Vintage', css: 'sepia(0.45) contrast(0.95) saturate(0.8) brightness(1.05)' },
    { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.28) brightness(0.95)' },
    { id: 'mono', name: 'Mono', css: 'grayscale(1) contrast(1.05)' },
    { id: 'vivid', name: 'Vivid', css: 'saturate(1.65) contrast(1.12)' },
    { id: 'faded', name: 'Faded', css: 'contrast(0.85) brightness(1.1) saturate(0.85)' },
    { id: 'dreamy', name: 'Dreamy', css: 'contrast(0.95) brightness(1.08) saturate(1.15) blur(0.6px)' },
    { id: 'cyber', name: 'Cyber', css: 'saturate(1.5) hue-rotate(-25deg) contrast(1.15)' },
    { id: 'sunset', name: 'Sunset', css: 'sepia(0.25) saturate(1.5) hue-rotate(-10deg) brightness(1.05)' },
    { id: 'forest', name: 'Forest', css: 'saturate(1.2) hue-rotate(30deg) brightness(0.98)' },
    { id: 'matte', name: 'Matte', css: 'contrast(0.8) brightness(1.12) saturate(0.9)' },
    { id: 'punch', name: 'Punch', css: 'contrast(1.35) saturate(1.25) brightness(1.02)' }
  ];
  VE.FILTER_MAP = Object.fromEntries(VE.FILTERS.map(f => [f.id, f]));

  /* Real, rendered effects. `kind` tells the compositor how to apply them. */
  VE.EFFECTS = [
    { id: 'none', name: 'Off', kind: 'none', amount: 0 },
    { id: 'cinematic', name: 'Cinematic', kind: 'filter', amount: 0.6, css: 'contrast(1.18) saturate(0.92) brightness(0.96)' },
    { id: 'vintage', name: 'Vintage film', kind: 'filter', amount: 0.6, css: 'sepia(0.4) contrast(0.95) saturate(0.78) brightness(1.06)' },
    { id: 'film', name: 'Film grain', kind: 'grain', amount: 0.45 },
    { id: 'glitch', name: 'Glitch', kind: 'glitch', amount: 0.35 },
    { id: 'vhs', name: 'VHS tape', kind: 'vhs', amount: 0.5 },
    { id: 'grade-warm', name: 'Grade · warm', kind: 'filter', amount: 0.5, css: 'sepia(0.18) saturate(1.25) hue-rotate(-6deg)' },
    { id: 'grade-cool', name: 'Grade · cool', kind: 'filter', amount: 0.5, css: 'saturate(1.1) hue-rotate(14deg) brightness(1.02)' },
    { id: 'grade-matte', name: 'Grade · matte', kind: 'filter', amount: 0.5, css: 'contrast(0.8) brightness(1.1) saturate(0.9)' },
    { id: 'grade-teal-orange', name: 'Grade · teal & orange', kind: 'duotone', amount: 0.45, color1: '#0d6d82', color2: '#ffb056' },
    { id: 'blur', name: 'Soft blur', kind: 'filter', amount: 0.4, css: 'blur(2px)' },
    { id: 'sharpen', name: 'Sharpen', kind: 'sharpen', amount: 0.5 },
    { id: 'vignette', name: 'Vignette', kind: 'vignette', amount: 0.55 },
    { id: 'light-leak', name: 'Light leak', kind: 'leak', amount: 0.4 },
    { id: 'motion-blur', name: 'Motion smear', kind: 'motion', amount: 0.4 },
    { id: 'exposure', name: 'Exposure', kind: 'filter', amount: 0.5, css: 'brightness(1.25)' },
    { id: 'contrast', name: 'Contrast', kind: 'filter', amount: 0.5, css: 'contrast(1.35)' },
    { id: 'saturation', name: 'Saturation', kind: 'filter', amount: 0.5, css: 'saturate(1.5)' },
    { id: 'halation', name: 'Halation', kind: 'composite', amount: 0.4 },
    { id: 'scanlines', name: 'Scanlines', kind: 'scanlines', amount: 0.4 },
    { id: 'chromatic', name: 'Chromatic aberration', kind: 'chromatic', amount: 0.4 },
    { id: 'grain-heavy', name: 'Heavy grain', kind: 'grain', amount: 0.8 },
    { id: 'duotone', name: 'Duotone', kind: 'duotone', amount: 0.6, color1: '#102040', color2: '#ffd76e' },
    { id: 'glow', name: 'Glow', kind: 'composite', amount: 0.5 },
    { id: 'pixelate', name: 'Pixelate', kind: 'pixelate', amount: 0.5 }
  ];
  VE.EFFECT_MAP = Object.fromEntries(VE.EFFECTS.map(e => [e.id, e]));

  VE.TRANSITIONS = [
    { id: 'none', name: 'None' },
    { id: 'fade', name: 'Fade' },
    { id: 'slide-left', name: 'Slide left' },
    { id: 'slide-right', name: 'Slide right' },
    { id: 'slide-up', name: 'Slide up' },
    { id: 'zoom', name: 'Zoom' },
    { id: 'wipe', name: 'Wipe' },
    { id: 'blur', name: 'Blur' }
  ];

  /* 44 font choices. Every stack uses fonts shipped with common operating
     systems or generic CSS families — nothing is downloaded or bundled. */
  VE.FONTS = [
    { id: 'system-ui', name: 'System UI', css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    { id: 'ui-sans-serif', name: 'UI Sans', css: 'ui-sans-serif, system-ui, sans-serif' },
    { id: 'ui-serif', name: 'UI Serif', css: 'ui-serif, Georgia, serif' },
    { id: 'ui-monospace', name: 'UI Mono', css: 'ui-monospace, "Cascadia Mono", Consolas, monospace' },
    { id: 'Arial', name: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { id: 'Arial Black', name: 'Arial Black', css: '"Arial Black", Arial, sans-serif' },
    { id: 'Arial Narrow', name: 'Arial Narrow', css: '"Arial Narrow", Arial, sans-serif' },
    { id: 'Helvetica', name: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
    { id: 'Helvetica Neue', name: 'Helvetica Neue', css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
    { id: 'Segoe UI', name: 'Segoe UI', css: '"Segoe UI", system-ui, sans-serif' },
    { id: 'Segoe UI Variable', name: 'Segoe UI Variable', css: '"Segoe UI Variable", "Segoe UI", sans-serif' },
    { id: 'Aptos', name: 'Aptos', css: 'Aptos, "Segoe UI", sans-serif' },
    { id: 'Calibri', name: 'Calibri', css: 'Calibri, Carlito, sans-serif' },
    { id: 'Cambria', name: 'Cambria', css: 'Cambria, "Times New Roman", serif' },
    { id: 'Candara', name: 'Candara', css: 'Candara, Calibri, sans-serif' },
    { id: 'Consolas', name: 'Consolas', css: 'Consolas, "Courier New", monospace' },
    { id: 'Constantia', name: 'Constantia', css: 'Constantia, Cambria, serif' },
    { id: 'Corbel', name: 'Corbel', css: 'Corbel, Calibri, sans-serif' },
    { id: 'Courier New', name: 'Courier New', css: '"Courier New", Courier, monospace' },
    { id: 'Franklin Gothic Medium', name: 'Franklin Gothic', css: '"Franklin Gothic Medium", Arial, sans-serif' },
    { id: 'Garamond', name: 'Garamond', css: 'Garamond, "Times New Roman", serif' },
    { id: 'Georgia', name: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
    { id: 'Impact', name: 'Impact', css: 'Impact, "Arial Black", sans-serif' },
    { id: 'Lucida Console', name: 'Lucida Console', css: '"Lucida Console", Monaco, monospace' },
    { id: 'Lucida Sans Unicode', name: 'Lucida Sans', css: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
    { id: 'MS Gothic', name: 'MS Gothic', css: '"MS Gothic", "Yu Gothic", monospace' },
    { id: 'Palatino Linotype', name: 'Palatino', css: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
    { id: 'Tahoma', name: 'Tahoma', css: 'Tahoma, Verdana, sans-serif' },
    { id: 'Times New Roman', name: 'Times New Roman', css: '"Times New Roman", Times, serif' },
    { id: 'Trebuchet MS', name: 'Trebuchet MS', css: '"Trebuchet MS", Tahoma, sans-serif' },
    { id: 'Verdana', name: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
    { id: 'Yu Gothic', name: 'Yu Gothic', css: '"Yu Gothic", "MS Gothic", sans-serif' },
    { id: 'Avenir Next', name: 'Avenir Next', css: '"Avenir Next", Avenir, sans-serif' },
    { id: 'Avenir', name: 'Avenir', css: 'Avenir, "Avenir Next", sans-serif' },
    { id: 'Baskerville', name: 'Baskerville', css: 'Baskerville, "Times New Roman", serif' },
    { id: 'Cantarell', name: 'Cantarell', css: 'Cantarell, "Open Sans", sans-serif' },
    { id: 'Futura', name: 'Futura', css: 'Futura, "Trebuchet MS", sans-serif' },
    { id: 'Gill Sans', name: 'Gill Sans', css: '"Gill Sans", "Gill Sans MT", sans-serif' },
    { id: 'Menlo', name: 'Menlo', css: 'Menlo, Monaco, Consolas, monospace' },
    { id: 'Monaco', name: 'Monaco', css: 'Monaco, Menlo, Consolas, monospace' },
    { id: 'Optima', name: 'Optima', css: 'Optima, Candara, sans-serif' },
    { id: 'PingFang SC', name: 'PingFang SC', css: '"PingFang SC", "Microsoft YaHei", sans-serif' },
    { id: 'Rockwell', name: 'Rockwell', css: 'Rockwell, "Courier New", serif' },
    { id: 'SF Mono', name: 'SF Mono', css: '"SF Mono", Menlo, Consolas, monospace' },
    { id: 'Noto Sans', name: 'Noto Sans', css: '"Noto Sans", Arial, sans-serif' },
    { id: 'Noto Serif', name: 'Noto Serif', css: '"Noto Serif", Georgia, serif' },
    { id: 'DejaVu Sans', name: 'DejaVu Sans', css: '"DejaVu Sans", Verdana, sans-serif' },
    { id: 'Liberation Sans', name: 'Liberation Sans', css: '"Liberation Sans", Arial, sans-serif' },
    { id: 'Ubuntu', name: 'Ubuntu', css: 'Ubuntu, "Trebuchet MS", sans-serif' },
    { id: 'cursive', name: 'System cursive', css: 'cursive' },
    { id: 'fantasy', name: 'System fantasy', css: 'fantasy' },
    { id: 'serif', name: 'System serif', css: 'serif' },
    { id: 'sans-serif', name: 'System sans', css: 'sans-serif' },
    { id: 'monospace', name: 'System mono', css: 'monospace' }
  ];
  VE.FONT_MAP = Object.fromEntries(VE.FONTS.map(f => [f.id, f.css]));
  VE.fontCss = function (id) {
    return VE.FONT_MAP[id] || VE.FONT_MAP[String(id || '')] || `"${String(id || 'system-ui').replace(/"/g, '')}", system-ui, sans-serif`;
  };

  VE.TEXT_STYLES = [
    { id: 'plain', name: 'Plain' },
    { id: 'subtitle', name: 'Subtitle' },
    { id: 'boxed', name: 'Boxed' },
    { id: 'karaoke', name: 'Karaoke' },
    { id: 'neon', name: 'Neon' },
    { id: 'comic', name: 'Comic' },
    { id: 'typewriter', name: 'Typewriter' },
    { id: 'lowerthird', name: 'Lower third' },
    { id: 'outline', name: 'Outline' },
    { id: 'gradient', name: 'Gradient' },
    { id: 'chapter', name: 'Chapter' },
    { id: 'quote', name: 'Quote' },
    { id: 'badge', name: 'Badge' },
    { id: 'glitch', name: 'Glitch' }
  ];

  VE.PALETTE = ['#ffffff', '#e9ecf5', '#ffe14d', '#ffb84d', '#ff5d6c', '#ff5cc8', '#7c5cff', '#3ba0ff', '#37d39b', '#111111'];

  VE.TEXT_PRESETS = [
    { id: 'title', label: 'Title', sample: 'Your title', preview: 'Aa', clip: { style: 'plain', fontFamily: 'Impact', fontSize: 112, bold: false, color: '#ffffff', y: 0.44, textWidth: 0.92, animationId: 'zoom-in' } },
    { id: 'subtitle', label: 'Subtitle', sample: 'Subtitle text', preview: 'Subtitle', clip: { style: 'subtitle', fontFamily: 'system-ui', fontSize: 50, bold: true, y: 0.86, color: '#ffffff', bgColor: '#000000', animationId: 'slide-in-up' } },
    { id: 'lowerthird', label: 'Lower third', sample: 'Jordan Lee · Director', preview: 'Name', clip: { style: 'lowerthird', fontFamily: 'system-ui', fontSize: 44, bold: true, x: 0.36, y: 0.79, color: '#ffffff', bgColor: '#12141c', textWidth: 0.62, animationId: 'wipe-left' } },
    { id: 'caption', label: 'Caption', sample: 'Caption', preview: 'Caption', clip: { style: 'boxed', fontFamily: 'system-ui', fontSize: 46, bold: true, y: 0.88, color: '#111111', bgColor: '#ffe14d', animationId: 'fade-in' } },
    { id: 'karaoke', label: 'Karaoke', sample: 'Sing along', preview: 'Karaoke', clip: { style: 'karaoke', fontFamily: 'Trebuchet MS', fontSize: 56, bold: true, y: 0.86, color: '#ffe14d', animationId: 'highlight-sweep' } },
    { id: 'neon', label: 'Neon', sample: 'Neon nights', preview: 'Neon', clip: { style: 'neon', fontFamily: 'Avenir Next', fontSize: 74, bold: true, y: 0.5, color: '#ff5cc8', animationId: 'neon-flicker' } },
    { id: 'comic', label: 'Comic', sample: 'POW!', preview: 'POW!', clip: { style: 'comic', fontFamily: 'Impact', fontSize: 92, bold: false, y: 0.5, color: '#ffe14d', animationId: 'bounce-in' } },
    { id: 'typewriter', label: 'Typewriter', sample: 'Once upon a time…', preview: 'Type…', clip: { style: 'typewriter', fontFamily: 'Courier New', fontSize: 50, bold: true, y: 0.82, color: '#ffffff', animationId: 'typewriter' } },
    { id: 'outline', label: 'Outline', sample: 'OUTLINE', preview: 'OUTLINE', clip: { style: 'outline', fontFamily: 'Impact', fontSize: 116, bold: false, y: 0.5, color: '#ffffff', animationId: 'glitch-in' } },
    { id: 'gradient', label: 'Gradient', sample: 'Make it pop', preview: 'Gradient', clip: { style: 'gradient', fontFamily: 'Trebuchet MS', fontSize: 78, bold: true, y: 0.5, color: '#7c5cff', color2: '#3ba0ff', animationId: 'fade-in' } },
    { id: 'chapter', label: 'Chapter', sample: '01 · The beginning', preview: '01', clip: { style: 'chapter', fontFamily: 'Georgia', fontSize: 64, bold: true, x: 0.28, y: 0.36, color: '#ffffff', animationId: 'slide-in-left' } },
    { id: 'quote', label: 'Quote', sample: '“Make something worth sharing.”', preview: '“ ”', clip: { style: 'quote', fontFamily: 'Georgia', fontSize: 54, bold: false, y: 0.5, textWidth: 0.72, color: '#ffffff', animationId: 'fade-in' } },
    { id: 'badge', label: 'Badge', sample: 'NEW', preview: 'NEW', clip: { style: 'badge', fontFamily: 'system-ui', fontSize: 40, bold: true, x: 0.68, y: 0.24, color: '#0b0d12', bgColor: '#37d39b', animationId: 'zoom-pop' } },
    { id: 'glitch-text', label: 'Glitch', sample: 'SIGNAL LOST', preview: 'GLITCH', clip: { style: 'glitch', fontFamily: 'ui-monospace', fontSize: 72, bold: true, y: 0.5, color: '#3ba0ff', animationId: 'glitch-in' } }
  ];

  /* 48 distinct text animation / transition presets. `motion` is the
     renderer routine; `phase` decides when it runs. Every entry has a
     different motion, direction, or timing combination. */
  const A = (id, name, group, motion, phase, direction, duration) => ({ id, name, group, motion, phase, direction, duration });
  VE.ANIMATIONS = [
    A('none', 'No animation', 'none', 'none', 'in', 'left', 0.4),
    A('fade-in', 'Fade in', 'fade', 'fade', 'in', 'left', 0.5),
    A('fade-out', 'Fade out', 'fade', 'fade', 'out', 'left', 0.5),
    A('fade-pulse', 'Fade pulse', 'fade', 'pulseAlpha', 'loop', 'left', 1.4),
    A('cross-fade', 'Cross fade', 'fade', 'fadeThrough', 'in', 'left', 0.7),
    A('slide-in-left', 'Slide in from left', 'slide', 'slide', 'in', 'left', 0.6),
    A('slide-in-right', 'Slide in from right', 'slide', 'slide', 'in', 'right', 0.6),
    A('slide-in-up', 'Slide in from bottom', 'slide', 'slide', 'in', 'up', 0.6),
    A('slide-in-down', 'Slide in from top', 'slide', 'slide', 'in', 'down', 0.6),
    A('slide-out-left', 'Slide out to left', 'slide', 'slide', 'out', 'left', 0.6),
    A('slide-out-right', 'Slide out to right', 'slide', 'slide', 'out', 'right', 0.6),
    A('slide-out-up', 'Slide out to top', 'slide', 'slide', 'out', 'up', 0.6),
    A('slide-out-down', 'Slide out to bottom', 'slide', 'slide', 'out', 'down', 0.6),
    A('slide-cross', 'Continuous drift', 'motion', 'drift', 'loop', 'left', 2.4),
    A('zoom-in', 'Zoom in', 'zoom', 'zoom', 'in', 'left', 0.6),
    A('zoom-out', 'Zoom out', 'zoom', 'zoom', 'out', 'left', 0.6),
    A('zoom-pop', 'Zoom pop', 'zoom', 'overshoot', 'in', 'left', 0.5),
    A('zoom-punch', 'Zoom punch', 'zoom', 'punch', 'in', 'left', 0.35),
    A('zoom-blur', 'Zoom through blur', 'zoom', 'zoomBlur', 'in', 'left', 0.7),
    A('blur-in', 'Blur in', 'fade', 'blur', 'in', 'left', 0.6),
    A('blur-out', 'Blur out', 'fade', 'blur', 'out', 'left', 0.6),
    A('bounce-in', 'Bounce in', 'bounce', 'bounce', 'in', 'up', 0.8),
    A('bounce-out', 'Bounce out', 'bounce', 'bounce', 'out', 'up', 0.8),
    A('elastic-in', 'Elastic in', 'bounce', 'elastic', 'in', 'left', 0.9),
    A('spring-loop', 'Spring loop', 'bounce', 'spring', 'loop', 'up', 1.2),
    A('typewriter', 'Typewriter', 'typewriter', 'type', 'in', 'left', 1.4),
    A('typewriter-reverse', 'Reverse typewriter', 'typewriter', 'typeReverse', 'in', 'right', 1.4),
    A('backspace', 'Backspace erase', 'typewriter', 'backspace', 'out', 'right', 1.1),
    A('type-cursor', 'Looping type', 'typewriter', 'type', 'loop', 'left', 1.8),
    A('wipe-left', 'Wipe from left', 'reveal', 'wipe', 'in', 'left', 0.7),
    A('wipe-right', 'Wipe from right', 'reveal', 'wipe', 'in', 'right', 0.7),
    A('wipe-up', 'Wipe from bottom', 'reveal', 'wipe', 'in', 'up', 0.7),
    A('wipe-down', 'Wipe from top', 'reveal', 'wipe', 'in', 'down', 0.7),
    A('curtain-open', 'Curtain open', 'reveal', 'curtain', 'in', 'left', 0.8),
    A('iris-in', 'Iris reveal', 'reveal', 'iris', 'in', 'left', 0.8),
    A('blink', 'Blink', 'loop', 'blink', 'loop', 'left', 1.2),
    A('flicker', 'Flicker', 'loop', 'flicker', 'loop', 'left', 0.9),
    A('pulse-glow', 'Pulse glow', 'highlight', 'glow', 'loop', 'left', 1.1),
    A('highlight-sweep', 'Highlight sweep', 'highlight', 'highlight', 'loop', 'left', 1.6),
    A('underline-draw', 'Underline draw', 'highlight', 'underline', 'in', 'left', 0.7),
    A('strike-through', 'Strike through', 'highlight', 'strike', 'loop', 'left', 1.1),
    A('neon-flicker', 'Neon flicker', 'highlight', 'neonFlicker', 'loop', 'left', 1.3),
    A('drift-up', 'Float upward', 'motion', 'drift', 'loop', 'up', 2.2),
    A('drift-down', 'Float downward', 'motion', 'drift', 'loop', 'down', 2.2),
    A('orbit', 'Orbit', 'motion', 'orbit', 'loop', 'left', 2.6),
    A('sway', 'Sway', 'motion', 'sway', 'loop', 'left', 2.0),
    A('shake', 'Shake', 'motion', 'shake', 'loop', 'left', 0.5),
    A('jitter', 'Jitter', 'motion', 'jitter', 'loop', 'left', 0.35),
    A('ripple', 'Ripple', 'motion', 'ripple', 'loop', 'left', 1.8),
    A('wave', 'Wave', 'motion', 'wave', 'loop', 'left', 1.6),
    A('zoom-loop', 'Breathing zoom', 'zoom', 'zoomLoop', 'loop', 'left', 1.8),
    A('rotate-in', 'Rotate in', 'motion', 'rotate', 'in', 'left', 0.7),
    A('flip-x', 'Flip horizontal', 'motion', 'flipX', 'in', 'left', 0.7),
    A('flip-y', 'Flip vertical', 'motion', 'flipY', 'in', 'left', 0.7),
    A('glitch-in', 'Glitch in', 'reveal', 'glitch', 'in', 'left', 0.6),
    A('sparkle', 'Sparkle', 'highlight', 'sparkle', 'loop', 'left', 1.5)
  ];
  VE.ANIM_MAP = Object.fromEntries(VE.ANIMATIONS.map(a => [a.id, a]));

  /* Library categories. Imported files are always user-supplied; built-in
     graphics are generated procedurally in the browser (no bundled media). */
  VE.LIB_CATEGORIES = [
    { id: 'all', name: 'All', icon: 'layers', import: null },
    { id: 'video', name: 'Video', icon: 'film', accept: 'video/*', types: ['video'] },
    { id: 'audio', name: 'Audio', icon: 'music', accept: 'audio/*', types: ['audio'] },
    { id: 'image', name: 'Image', icon: 'image', accept: 'image/*', types: ['image'] },
    { id: 'sticker', name: 'Sticker', icon: 'sparkle', accept: 'image/*', types: ['image'] },
    { id: 'sfx', name: 'Sound FX', icon: 'volume', accept: 'audio/*', types: ['audio'] },
    { id: 'shape', name: 'Shape', icon: 'square', procedural: true },
    { id: 'animated', name: 'Animated', icon: 'repeat', procedural: true },
    { id: 'text', name: 'Text', icon: 'type', text: true },
    { id: 'decorative', name: 'Decorative', icon: 'sparkle', procedural: true }
  ];

  /* Original procedural graphics. Every one is drawn by our canvas renderer. */
  VE.PROCEDURAL = [
    { id: 'rect', label: 'Rectangle', category: 'shape', shape: 'rect' },
    { id: 'round-rect', label: 'Rounded box', category: 'shape', shape: 'roundRect' },
    { id: 'circle', label: 'Circle', category: 'shape', shape: 'circle' },
    { id: 'ellipse', label: 'Ellipse', category: 'shape', shape: 'ellipse' },
    { id: 'triangle', label: 'Triangle', category: 'shape', shape: 'triangle' },
    { id: 'star', label: 'Star', category: 'shape', shape: 'star' },
    { id: 'heart', label: 'Heart', category: 'shape', shape: 'heart' },
    { id: 'arrow', label: 'Arrow', category: 'shape', shape: 'arrow' },
    { id: 'line', label: 'Divider', category: 'shape', shape: 'line' },
    { id: 'gradient-bar', label: 'Gradient bar', category: 'decorative', shape: 'gradientBar' },
    { id: 'bokeh', label: 'Bokeh dots', category: 'decorative', shape: 'bokeh' },
    { id: 'light-leak', label: 'Light wash', category: 'decorative', shape: 'lightWash' },
    { id: 'scanline-frame', label: 'Scanlines', category: 'decorative', shape: 'scanlines' },
    { id: 'grain-field', label: 'Noise field', category: 'decorative', shape: 'grainField' },
    { id: 'pulse-dot', label: 'Pulse dot', category: 'animated', shape: 'pulseDot' },
    { id: 'spinner', label: 'Spinner', category: 'animated', shape: 'spinner' },
    { id: 'progress', label: 'Progress bar', category: 'animated', shape: 'progress' },
    { id: 'bounce-ball', label: 'Bouncing ball', category: 'animated', shape: 'bounceBall' },
    { id: 'waving-lines', label: 'Waving lines', category: 'animated', shape: 'wavingLines' },
    { id: 'orbit-dots', label: 'Orbiting dots', category: 'animated', shape: 'orbitDots' },
    { id: 'sparkle-pop', label: 'Sparkle pop', category: 'animated', shape: 'sparklePop' },
    { id: 'typing-dots', label: 'Typing dots', category: 'animated', shape: 'typingDots' }
  ];
  VE.PROCEDURAL_MAP = Object.fromEntries(VE.PROCEDURAL.map(p => [p.id, p]));

  VE.SHORTCUTS = [
    ['Space', 'Play / pause'],
    ['S', 'Split clip at playhead'],
    ['Del', 'Delete selected clip'],
    ['Ctrl + D', 'Duplicate clip'],
    ['Ctrl + Z', 'Undo'],
    ['Ctrl + Shift + Z', 'Redo'],
    ['← / →', 'Nudge playhead 0.1s'],
    ['Shift + ← / →', 'Nudge playhead 1s'],
    ['Home / End', 'Jump to start / end'],
    ['+ / −', 'Zoom timeline'],
    ['[ / ]', 'Move selected layer down / up'],
    ['M', 'Mute / unmute preview'],
    ['Esc', 'Deselect clip']
  ];

  VE.RESOLUTIONS = [
    { id: 480, name: '480p', short: 480 },
    { id: 720, name: '720p HD', short: 720 },
    { id: 1080, name: '1080p Full HD', short: 1080 },
    { id: 1440, name: '1440p 2K', short: 1440 },
    { id: 2160, name: '2160p 4K', short: 2160 }
  ];
})();
