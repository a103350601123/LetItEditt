/* Constants: aspect ratios, filters, transitions, fonts, text styles, presets */
(function () {
  const VE = (window.VE = window.VE || {});

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

  VE.FONTS = [
    { id: 'Inter', name: 'Inter' },
    { id: 'Space Grotesk', name: 'Space Grotesk' },
    { id: 'Montserrat', name: 'Montserrat' },
    { id: 'Anton', name: 'Anton' },
    { id: 'Bebas Neue', name: 'Bebas Neue' },
    { id: 'Oswald', name: 'Oswald' },
    { id: 'Playfair Display', name: 'Playfair Display' },
    { id: 'Lobster', name: 'Lobster' },
    { id: 'Caveat', name: 'Caveat' },
    { id: 'Permanent Marker', name: 'Permanent Marker' },
    { id: 'Georgia', name: 'Georgia' },
    { id: 'Impact', name: 'Impact' },
    { id: 'Courier New', name: 'Courier New' },
    { id: 'Trebuchet MS', name: 'Trebuchet MS' },
    { id: 'Arial', name: 'Arial' },
    { id: 'Verdana', name: 'Verdana' }
  ];

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
    { id: 'gradient', name: 'Gradient' }
  ];

  VE.PALETTE = ['#ffffff', '#e9ecf5', '#ffe14d', '#ffb84d', '#ff5d6c', '#ff5cc8', '#7c5cff', '#3ba0ff', '#37d39b', '#111111'];

  VE.TEXT_PRESETS = [
    {
      id: 'title', label: 'Title', sample: 'Your title', preview: 'Aa',
      clip: { style: 'plain', fontFamily: 'Anton', fontSize: 112, bold: false, color: '#ffffff', y: 0.44, textWidth: 0.92 }
    },
    {
      id: 'subtitle', label: 'Subtitle', sample: 'Subtitle text', preview: 'Subtitle',
      clip: { style: 'subtitle', fontFamily: 'Inter', fontSize: 50, bold: true, y: 0.86, color: '#ffffff', bgColor: '#000000' }
    },
    {
      id: 'lowerthird', label: 'Lower third', sample: 'Jordan Lee · Director', preview: 'Name',
      clip: { style: 'lowerthird', fontFamily: 'Inter', fontSize: 44, bold: true, x: 0.36, y: 0.79, color: '#ffffff', bgColor: '#12141c', textWidth: 0.62 }
    },
    {
      id: 'caption', label: 'Caption', sample: 'Caption', preview: 'Caption',
      clip: { style: 'boxed', fontFamily: 'Inter', fontSize: 46, bold: true, y: 0.88, color: '#111111', bgColor: '#ffe14d' }
    },
    {
      id: 'karaoke', label: 'Karaoke', sample: 'Sing along', preview: 'Karaoke',
      clip: { style: 'karaoke', fontFamily: 'Montserrat', fontSize: 56, bold: true, y: 0.86, color: '#ffe14d' }
    },
    {
      id: 'neon', label: 'Neon', sample: 'Neon nights', preview: 'Neon',
      clip: { style: 'neon', fontFamily: 'Space Grotesk', fontSize: 74, bold: true, y: 0.5, color: '#ff5cc8' }
    },
    {
      id: 'comic', label: 'Comic', sample: 'POW!', preview: 'POW!',
      clip: { style: 'comic', fontFamily: 'Permanent Marker', fontSize: 92, bold: false, y: 0.5, color: '#ffe14d' }
    },
    {
      id: 'typewriter', label: 'Typewriter', sample: 'Once upon a time…', preview: 'Type…',
      clip: { style: 'typewriter', fontFamily: 'Courier New', fontSize: 50, bold: true, y: 0.82, color: '#ffffff' }
    },
    {
      id: 'outline', label: 'Outline', sample: 'OUTLINE', preview: 'OUTLINE',
      clip: { style: 'outline', fontFamily: 'Bebas Neue', fontSize: 116, bold: false, y: 0.5, color: '#ffffff' }
    },
    {
      id: 'gradient', label: 'Gradient', sample: 'Make it pop', preview: 'Gradient',
      clip: { style: 'gradient', fontFamily: 'Montserrat', fontSize: 78, bold: true, y: 0.5, color: '#7c5cff', color2: '#3ba0ff' }
    }
  ];

  VE.SHORTCUTS = [
    ['Space', 'Play / pause'],
    ['S', 'Split clip at playhead'],
    ['Del', 'Delete selected clip'],
    ['Ctrl + D', 'Duplicate clip'],
    ['← / →', 'Nudge playhead 0.1s'],
    ['Shift + ← / →', 'Nudge playhead 1s'],
    ['Home / End', 'Jump to start / end'],
    ['+ / −', 'Zoom timeline'],
    ['Ctrl + Z', 'Undo'],
    ['Ctrl + Shift + Z', 'Redo'],
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
