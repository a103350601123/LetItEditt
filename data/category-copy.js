/* Canonical category copy for the content-only LetitEdit site.
 * These nine pages are the permanent taxonomy. Tool pages are no longer part
 * of the site; future tools must be introduced with their own real pages.
 */
'use strict';

const CATEGORY_COPY = {
  image: {
    name: 'Image & Photo Editing',
    shortName: 'Image & Photo',
    slug: 'image-photo-editing',
    path: '/categories/image-photo-editing/',
    icon: '🖼️',
    color: '#2563eb',
    description: 'A home for future guides and releases about cropping, resizing, retouching, restoring and exporting photos.',
    intro: 'This category collects the site structure and editorial notes for image and photo work. It is ready for future browser-side editing tools, but no tool is published here yet.',
    seoTitle: 'Image & Photo Editing Category — LetitEdit',
    seoDescription: 'Browse the LetitEdit category for image and photo editing guides and future browser-side releases. No tool is presented before it is actually available.',
    related: ['design', 'document', 'utility']
  },
  video: {
    name: 'Video Editing',
    shortName: 'Video',
    slug: 'video-editing',
    path: '/categories/video-editing/',
    icon: '🎬',
    color: '#7c3aed',
    description: 'A home for future guides about trimming, cropping, subtitling and exporting video.',
    intro: 'Video editing has a dedicated place in the taxonomy for upcoming guides and carefully built releases. The category is structural only until real functionality is published.',
    seoTitle: 'Video Editing Category — LetitEdit',
    seoDescription: 'Read about the LetitEdit video editing category and follow future browser-side video releases. No placeholder editor is presented as available.',
    related: ['audio', 'design', 'image']
  },
  audio: {
    name: 'Audio & Music Editing',
    shortName: 'Audio & Music',
    slug: 'audio-music-editing',
    path: '/categories/audio-music-editing/',
    icon: '🎧',
    color: '#0891b2',
    description: 'A home for future guides about recording, trimming, merging and enhancing audio.',
    intro: 'Audio and music work has its own category so future guides and tools can be added without changing the site structure. Nothing is published here yet.',
    seoTitle: 'Audio & Music Editing Category — LetitEdit',
    seoDescription: 'Explore the LetitEdit audio and music editing category, reserved for future guides and browser-side releases.',
    related: ['video', 'writing', 'utility']
  },
  document: {
    name: 'PDF & Document Editing',
    shortName: 'PDF & Documents',
    slug: 'pdf-document-editing',
    path: '/categories/pdf-document-editing/',
    icon: '📄',
    color: '#dc2626',
    description: 'A home for future guides about editing, annotating and organising PDFs and office documents.',
    intro: 'Document work has a clear category ready for future articles and tools. No PDF or office editor is currently published on this site.',
    seoTitle: 'PDF & Document Editing Category — LetitEdit',
    seoDescription: 'Browse the LetitEdit PDF and document editing category for future guides and browser-side releases. No editor is currently published.',
    related: ['writing', 'design', 'image']
  },
  writing: {
    name: 'Text & Writing Editing',
    shortName: 'Text & Writing',
    slug: 'text-writing-editing',
    path: '/categories/text-writing-editing/',
    icon: '✍️',
    color: '#2563eb',
    description: 'A home for future Unicode-aware guides about counting, cleaning, comparing and formatting text.',
    intro: 'Writing and text work belongs here. The category page is ready for future guides and tools, with Unicode and mixed-direction content kept in mind, but no tool is live yet.',
    seoTitle: 'Text & Writing Editing Category — LetitEdit',
    seoDescription: 'Read about the LetitEdit text and writing category, reserved for future Unicode-aware guides and browser-side releases.',
    related: ['code', 'document', 'design']
  },
  design: {
    name: 'Graphic Design & Creative Editing',
    shortName: 'Graphic Design',
    slug: 'graphic-design-creative-editing',
    path: '/categories/graphic-design-creative-editing/',
    icon: '🎨',
    color: '#db2777',
    description: 'A home for future guides about thumbnails, logos, posters, cards and layered design.',
    intro: 'Creative design work has a dedicated category for future guides and releases. It does not list unfinished products as available tools.',
    seoTitle: 'Graphic Design & Creative Editing Category — LetitEdit',
    seoDescription: 'Explore the LetitEdit graphic design category, prepared for future guides and browser-side creative releases.',
    related: ['image', 'video', 'utility']
  },
  code: {
    name: 'Web & Code Editing',
    shortName: 'Web & Code',
    slug: 'web-code-editing',
    path: '/categories/web-code-editing/',
    icon: '💻',
    color: '#0f766e',
    description: 'A home for future guides about HTML, JSON, regex, SVG and other web code.',
    intro: 'Developer-facing content will live in this category when it is written. No formatter, validator or preview is currently published.',
    seoTitle: 'Web & Code Editing Category — LetitEdit',
    seoDescription: 'Browse the LetitEdit web and code category, reserved for future guides and browser-side developer releases.',
    related: ['writing', 'diagram', 'utility']
  },
  diagram: {
    name: 'Diagram, Presentation & Productivity Design',
    shortName: 'Diagrams & Planning',
    slug: 'diagram-presentation-productivity-design',
    path: '/categories/diagram-presentation-productivity-design/',
    icon: '🧩',
    color: '#ea580c',
    description: 'A home for future guides about diagrams, flowcharts, timelines and visual planning.',
    intro: 'Planning and presentation content belongs here. The category is part of the permanent structure, with no planner or editor published yet.',
    seoTitle: 'Diagram, Presentation & Productivity Category — LetitEdit',
    seoDescription: 'Read about the LetitEdit diagram and planning category, prepared for future guides and releases.',
    related: ['design', 'code', 'document']
  },
  utility: {
    name: 'QR, Barcode & Utility Design',
    shortName: 'QR & Utilities',
    slug: 'qr-barcode-utility-design',
    path: '/categories/qr-barcode-utility-design/',
    icon: '🔳',
    color: '#1d4ed8',
    description: 'A home for future guides about QR codes, barcodes, labels, cards and tickets.',
    intro: 'Practical generation and design work has a permanent category here. No generator is live yet, and no placeholder output is shown.',
    seoTitle: 'QR, Barcode & Utility Category — LetitEdit',
    seoDescription: 'Explore the LetitEdit QR, barcode and utility category, reserved for future guides and browser-side releases.',
    related: ['design', 'image', 'code']
  }
};

const CATEGORY_ORDER = ['image', 'video', 'audio', 'document', 'writing', 'design', 'code', 'diagram', 'utility'];

module.exports = { CATEGORY_COPY, CATEGORY_ORDER };
