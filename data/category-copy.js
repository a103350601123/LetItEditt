/* Phase 1 canonical category copy. Kept separate from registered tool data so
 * names, breadcrumbs and SEO metadata stay consistent everywhere. */
'use strict';

const CATEGORY_COPY = {
  image: {
    name: 'Image & Photo Editing',
    shortName: 'Image & Photo',
    slug: 'image-photo-editing',
    path: '/tools/image-photo-editing/',
    icon: '🖼️',
    color: '#2563eb',
    description: 'Crop, resize, retouch, restore, annotate and export photos with browser-side editing tools.',
    intro: 'Professional image and photo editing utilities for everyday corrections, social graphics and careful restoration. Work locally in your browser and export the exact format you need.',
    seoTitle: 'Image & Photo Editing Tools — Free Browser-Based Photo Editors',
    seoDescription: 'Explore image and photo editing tools for cropping, resizing, compression, retouching, annotation, restoration and format conversion. Files stay in your browser.',
    related: ['design', 'document', 'utility']
  },
  video: {
    name: 'Video Editing',
    shortName: 'Video',
    slug: 'video-editing',
    path: '/tools/video-editing/',
    icon: '🎬',
    color: '#7c3aed',
    description: 'Trim, crop, compress, subtitle, remix and export video with private browser-side editors.',
    intro: 'A focused workspace for video trimming, reframing, captions, effects and export. Advanced multi-track editing and AI-assisted tools are registered here as they become available.',
    seoTitle: 'Video Editing Tools — Free Browser-Based Video Editors',
    seoDescription: 'Browse video editing tools for trimming, resizing, compression, subtitles, GIFs, screen recording and local export. Processing happens in your browser.',
    related: ['audio', 'design', 'image']
  },
  audio: {
    name: 'Audio & Music Editing',
    shortName: 'Audio & Music',
    slug: 'audio-music-editing',
    path: '/tools/audio-music-editing/',
    icon: '🎧',
    color: '#0891b2',
    description: 'Record, trim, merge, normalise and enhance audio with local editing and analysis tools.',
    intro: 'Audio and music utilities for editing clips, improving voice recordings, extracting tracks and preparing sound for podcasts and video. Modules that need a model are clearly marked.',
    seoTitle: 'Audio & Music Editing Tools — Free Browser-Based Sound Editors',
    seoDescription: 'Find audio and music editing tools for trimming, merging, noise reduction, format conversion, visualisation and local recording. No upload is required.',
    related: ['video', 'writing', 'utility']
  },
  document: {
    name: 'PDF & Document Editing',
    shortName: 'PDF & Documents',
    slug: 'pdf-document-editing',
    path: '/tools/pdf-document-editing/',
    icon: '📄',
    color: '#dc2626',
    description: 'Edit, organise, annotate, compare and sign PDFs and office documents in the browser.',
    intro: 'Document tools for PDF pages, forms, signatures, redaction and office formats. Existing document editors are grouped here while advanced page and table tools remain planned.',
    seoTitle: 'PDF & Document Editing Tools — Free Browser-Based Document Editors',
    seoDescription: 'Explore PDF and document editing tools for page organisation, annotation, signatures, redaction and office file work. Keep documents local to your device.',
    related: ['writing', 'design', 'image']
  },
  writing: {
    name: 'Text & Writing Editing',
    shortName: 'Text & Writing',
    slug: 'text-writing-editing',
    path: '/tools/text-writing-editing/',
    icon: '✍️',
    color: '#2563eb',
    description: 'Count, clean, rewrite, compare, redact and format text with Unicode-aware writing tools.',
    intro: 'Writing utilities for live counts, cleanup, formatting, comparison, grammar and structured text conversion. Planned AI writing tools stay marked as planned until they are actually provided.',
    seoTitle: 'Text & Writing Editing Tools — Free Browser-Based Writing Utilities',
    seoDescription: 'Browse text and writing tools for counts, grammar, cleanup, formatting, comparison, redaction and Unicode-aware conversion. All available tools run locally.',
    related: ['code', 'document', 'design']
  },
  design: {
    name: 'Graphic Design & Creative Editing',
    shortName: 'Graphic Design',
    slug: 'graphic-design-creative-editing',
    path: '/tools/graphic-design-creative-editing/',
    icon: '🎨',
    color: '#db2777',
    description: 'Create thumbnails, logos, posters, cards, banners and original layered designs.',
    intro: 'Creative layout tools for thumbnails, social graphics, cards and original templates. The catalogue records every planned design product without presenting unfinished tools as available.',
    seoTitle: 'Graphic Design & Creative Editing Tools — Free Browser-Based Design Studio',
    seoDescription: 'Discover graphic design and creative editing tools for thumbnails, banners, posters, cards, typography and layered layouts. Design locally in your browser.',
    related: ['image', 'video', 'utility']
  },
  code: {
    name: 'Web & Code Editing',
    shortName: 'Web & Code',
    slug: 'web-code-editing',
    path: '/tools/web-code-editing/',
    icon: '💻',
    color: '#0f766e',
    description: 'Format, validate, preview and edit HTML, JSON, regex, SVG and other web code.',
    intro: 'Developer-facing tools for code formatting, validation, conversion and browser-side previews. New code editors will be added here with their own real implementations.',
    seoTitle: 'Web & Code Editing Tools — Free Browser-Based Developer Utilities',
    seoDescription: 'Find web and code editing tools for JSON, regex, HTML, SVG, formatting and validation. Developer utilities run locally without sending code to a server.',
    related: ['writing', 'diagram', 'utility']
  },
  diagram: {
    name: 'Diagram, Presentation & Productivity Design',
    shortName: 'Diagrams & Planning',
    slug: 'diagram-presentation-productivity-design',
    path: '/tools/diagram-presentation-productivity-design/',
    icon: '🧩',
    color: '#ea580c',
    description: 'Plan flows, diagrams, timelines, slides and structured visual workspaces.',
    intro: 'Planning and presentation tools for diagrams, flowcharts, mind maps, timelines and visual organisation. This category is currently a planned catalogue awaiting individual implementations.',
    seoTitle: 'Diagram, Presentation & Productivity Design Tools',
    seoDescription: 'Review planned diagram, presentation and productivity design tools including flowcharts, mind maps, wireframes, timelines and data visualisation.',
    related: ['design', 'code', 'document']
  },
  utility: {
    name: 'QR, Barcode & Utility Design',
    shortName: 'QR & Utilities',
    slug: 'qr-barcode-utility-design',
    path: '/tools/qr-barcode-utility-design/',
    icon: '🔳',
    color: '#1d4ed8',
    description: 'Generate and design QR codes, barcodes, labels, cards and tickets locally.',
    intro: 'Practical generation and design utilities for QR codes, barcodes, labels, cards and tickets. Available tools generate real output in the browser; planned formats are clearly marked.',
    seoTitle: 'QR, Barcode & Utility Design Tools — Free Browser-Based Generators',
    seoDescription: 'Explore QR and barcode design tools plus label, card and ticket utilities. Generate real local output without uploading private data.',
    related: ['design', 'image', 'code']
  }
};

const CATEGORY_ORDER = ['image', 'video', 'audio', 'document', 'writing', 'design', 'code', 'diagram', 'utility'];

/* Old category paths remain indexed. They redirect to the closest canonical
 * category; tool URLs are not changed. */
const LEGACY_CATEGORY_REDIRECTS = {
  '/tools/image-photo/': '/tools/image-photo-editing/',
  '/tools/video-audio/': '/tools/video-editing/',
  '/tools/writing-text/': '/tools/text-writing-editing/',
  '/tools/coding-developer/': '/tools/web-code-editing/',
  '/tools/social-media/': '/tools/graphic-design-creative-editing/',
  '/tools/website-seo/': '/tools/web-code-editing/',
  '/tools/counters-calculators/': '/tools/qr-barcode-utility-design/',
  '/tools/device-testers/': '/tools/qr-barcode-utility-design/',
  '/tools/games-fun/': '/tools/qr-barcode-utility-design/',
  '/tools/generators/': '/tools/qr-barcode-utility-design/'
};

module.exports = { CATEGORY_COPY, CATEGORY_ORDER, LEGACY_CATEGORY_REDIRECTS };
