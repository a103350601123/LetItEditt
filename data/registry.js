/* LetitEdit central registry.
 * This is the single source of truth for categories, tool metadata, routes,
 * tool counts, "new" status and search data. Adding a tool never requires
 * editing the homepage, sidebar, sitemap or search code: register the tool in
 * one of the data files referenced by CATEGORIES below and the build
 * regenerates every derived page automatically.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const site = 'https://letitedit.com';

const CATEGORIES = [
  {
    key: 'writing',
    name: 'Text & Writing',
    label: 'Writing & Text Tools',
    shortLabel: 'Writing & Text',
    slug: 'writing-text',
    path: '/tools/writing-text/',
    icon: '✍️',
    color: '#2563eb',
    dataFile: 'tools.json',
    runtime: 'text',
    scripts: ['js/text-core.js', 'js/tool-runtime.js'],
    description: 'Count, clean, convert, format, compare and generate text with private browser-side utilities.',
    seoTitle: 'Text & Writing Tools — Free Browser-Side Writing Utilities',
    seoDescription: 'Browse free text and writing tools for counting words, cleaning text, formatting, bionic reading, redaction and placeholder generation. Everything runs in your browser.',
    intro: 'Focused writing utilities for counting, cleaning, converting, comparing and generating text. Every tool runs in your browser, so your writing stays private.',
    featured: ['word-counter', 'text-cleaner', 'resume-builder', 'find-and-replace']
  },
  {
    key: 'dev',
    name: 'Developer Tools',
    label: 'Coding & Developer Tools',
    shortLabel: 'Coding & Developer',
    slug: 'coding-developer',
    path: '/tools/coding-developer/',
    icon: '</>',
    color: '#0ea5e9',
    dataFile: 'dev-tools.json',
    runtime: 'dev',
    scripts: ['js/dev-core.js', 'js/dev-runtime.js'],
    description: 'Format JSON, encode Base64 and test regular expressions without sending code anywhere.',
    seoTitle: 'Coding & Developer Tools — JSON, Base64 and Regex',
    seoDescription: 'Free browser-side developer utilities for formatting JSON, encoding Base64 and testing JavaScript regular expressions with clear errors and real output.',
    intro: 'Everyday utilities for development work: format and validate JSON, convert UTF-8 text to Base64 and test JavaScript regular expressions locally.',
    featured: ['json-formatter', 'base64-encoder-decoder', 'regex-tester']
  },
  {
    key: 'image',
    name: 'Image & Photo',
    label: 'Image & Photo Tools',
    shortLabel: 'Image & Photo',
    slug: 'image-photo',
    path: '/tools/image-photo/',
    icon: '🖼️',
    color: '#2563eb',
    dataFile: 'image-tools.json',
    runtime: 'image',
    scripts: ['js/image-core.js', 'js/image-runtime.js'],
    description: 'Edit, convert, combine and understand images with local browser processing and no uploads.',
    seoTitle: 'Image & Photo Tools — Free Browser-Side Image Utilities',
    seoDescription: 'Browse 13 free image and photo tools for editing, HEIC viewing, borders, merging, screenshots, resizing, OCR, QR codes and compression. Files stay in your browser.',
    intro: 'Thirteen practical image utilities for editing, converting, combining and reading photos. Every operation runs in your browser, with clear limits and honest previews.',
    featured: ['image-editor', 'heic-viewer', 'photo-merger', 'screenshot-beautifier']
  },
  {
    key: 'video',
    name: 'Video & Audio',
    label: 'Video & Audio Tools',
    shortLabel: 'Video & Audio',
    slug: 'video-audio',
    path: '/tools/video-audio/',
    icon: '🎬',
    color: '#ec4899',
    dataFile: 'video-tools.json',
    runtime: 'video',
    scripts: ['js/video-core.js', 'js/video-runtime.js'],
    description: 'Edit, trim, record, caption and convert video and audio files locally in the browser.',
    seoTitle: 'Video & Audio Tools — Free Browser-Side Media Utilities',
    seoDescription: 'Nine practical video and audio tools that trim, record, caption, convert and obscure media locally in your browser, with clear privacy disclosures.',
    intro: 'Nine practical media utilities for editing, recording, trimming, captioning and exporting. Heavy codecs and optional AI models load only when a tool needs them, and your media is never uploaded.'
  },
  {
    key: 'social',
    name: 'Social Media',
    label: 'Social Media Tools',
    shortLabel: 'Social Media',
    slug: 'social-media',
    path: '/tools/social-media/',
    icon: '📣',
    color: '#f59e0b',
    dataFile: null,
    runtime: null,
    scripts: [],
    description: 'Prepare captions, hashtags and shareable text for social platforms.',
    seoTitle: 'Social Media Tools — Free Caption and Hashtag Utilities',
    seoDescription: 'A directory for free social media utilities. Tools are added as each one is built and tested; no placeholder tools are published.',
    intro: 'A home for future social media utilities. Categories are ready now; tools appear here as they are built and tested.'
  },
  {
    key: 'seo',
    name: 'Website & SEO',
    label: 'Website & SEO Tools',
    shortLabel: 'Website & SEO',
    slug: 'website-seo',
    path: '/tools/website-seo/',
    icon: '📈',
    color: '#10b981',
    dataFile: null,
    runtime: null,
    scripts: [],
    description: 'Create slugs, meta descriptions and structured data for websites.',
    seoTitle: 'Website & SEO Tools — Free Browser-Side SEO Utilities',
    seoDescription: 'A directory for free website and SEO utilities that run locally in your browser. Tools are added as each one is built and tested.',
    intro: 'A home for future website and SEO utilities. Categories are ready now; tools appear here as they are built and tested.'
  },
  {
    key: 'generators',
    name: 'Generators',
    label: 'Generator Tools',
    shortLabel: 'Generators',
    slug: 'generators',
    path: '/tools/generators/',
    icon: '✨',
    color: '#6366f1',
    dataFile: null,
    runtime: null,
    scripts: [],
    description: 'Generate placeholder text, lists, passwords and other structured data.',
    seoTitle: 'Generator Tools — Free Browser-Side Generators',
    seoDescription: 'A directory for free generators such as placeholder text and list builders. Tools are added as each one is built and tested.',
    intro: 'A home for future generator utilities. Categories are ready now; tools appear here as they are built and tested.'
  },
  {
    key: 'counters',
    name: 'Counters & Calculators',
    label: 'Counters & Calculators',
    shortLabel: 'Counters & Calculators',
    slug: 'counters-calculators',
    path: '/tools/counters-calculators/',
    icon: '🧮',
    color: '#14b8a6',
    dataFile: null,
    runtime: null,
    scripts: [],
    description: 'Count characters, words and values, or calculate common everyday results.',
    seoTitle: 'Counters & Calculators — Free Browser-Side Calculators',
    seoDescription: 'A directory for free counters and calculators that run locally in your browser. Tools are added as each one is built and tested.',
    intro: 'A home for future counters and calculators. Categories are ready now; tools appear here as they are built and tested.'
  },
  {
    key: 'games',
    name: 'Games & Fun',
    label: 'Games & Fun Tools',
    shortLabel: 'Games & Fun',
    slug: 'games-fun',
    path: '/tools/games-fun/',
    icon: '🎲',
    color: '#f43f5e',
    dataFile: null,
    runtime: null,
    scripts: [],
    description: 'Lightweight games and fun text utilities that run entirely in the browser.',
    seoTitle: 'Games & Fun Tools — Free Browser Games and Utilities',
    seoDescription: 'A directory for free games and fun utilities that run locally in your browser. Tools are added as each one is built and tested.',
    intro: 'A home for future games and fun utilities. Categories are ready now; tools appear here as they are built and tested.'
  },
  {
    key: 'device',
    name: 'Device Testers',
    label: 'Device Tester Tools',
    shortLabel: 'Device Testers',
    slug: 'device-testers',
    path: '/tools/device-testers/',
    icon: '📱',
    color: '#0284c7',
    dataFile: null,
    runtime: null,
    scripts: [],
    description: 'Check screen size, fonts, network and browser capabilities on any device.',
    seoTitle: 'Device Tester Tools — Free Browser and Screen Tests',
    seoDescription: 'A directory for free device and browser tests that run locally. Tools are added as each one is built and tested.',
    intro: 'A home for future device tester utilities. Categories are ready now; tools appear here as they are built and tested.'
  }
];

const categoryByKey = new Map(CATEGORIES.map(category => [category.key, category]));
const categoryBySlug = new Map(CATEGORIES.map(category => [category.slug, category]));

const tools = [];
CATEGORIES.forEach(category => {
  category.tools = [];
  if (!category.dataFile) return;
  const list = JSON.parse(fs.readFileSync(path.join(root, 'data', category.dataFile), 'utf8'));
  list.forEach(tool => {
    const redirectTo = tool.redirectTo
      ? (String(tool.redirectTo).charAt(0) === '/' ? String(tool.redirectTo) : `/${String(tool.redirectTo).replace(/^\.\//, '')}`)
      : null;
    const item = Object.assign({}, tool, {
      categoryKey: category.key,
      category: category,
      redirectTo: redirectTo,
      /* A redirect stub replaces the published page: it must never be counted,
       * indexed, searched or surfaced as a working tool. */
      published: tool.published !== false && !redirectTo,
      isNew: tool.isNew === true && !redirectTo,
      featured: (tool.featured === true || (category.featured || []).indexOf(tool.slug) !== -1) && !redirectTo,
      added: tool.added || '2026-11-18',
      pageUrl: tool.url ? `/${tool.url.replace(/index\.html$/, '')}` : `${category.path}${tool.slug}/`
    });
    category.tools.push(item);
    tools.push(item);
  });
});

const publishedTools = tools.filter(tool => tool.published);
const redirectTools = tools.filter(tool => tool.redirectTo);
const bySlug = new Map(tools.map(tool => [tool.slug, tool]));

if (bySlug.size !== tools.length) throw new Error('Duplicate tool slugs found in the registry');
tools.forEach(tool => {
  (tool.related || []).forEach(related => {
    if (!bySlug.has(related)) throw new Error(`${tool.slug} links to unknown tool: ${related}`);
  });
});

function publishedByCategory(key) {
  return publishedTools.filter(tool => tool.categoryKey === key);
}

function newTools(limit) {
  const list = publishedTools
    .filter(tool => tool.isNew)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)) || a.name.localeCompare(b.name));
  return typeof limit === 'number' ? list.slice(0, limit) : list;
}

/* Featured picks are declared in tool metadata or a category's featured list.
 * The fallback keeps the section useful when a category has no explicit picks:
 * spread flagged tools across categories first, then fill alphabetically. */
function featuredTools(limit) {
  const chosen = [];
  const seen = new Set();
  function add(tool) {
    if (!tool || seen.has(tool.slug)) return;
    seen.add(tool.slug);
    chosen.push(tool);
  }
  CATEGORIES.forEach(category => {
    publishedTools.filter(tool => tool.categoryKey === category.key && tool.featured)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(add);
  });
  publishedTools.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(add);
  return typeof limit === 'number' ? chosen.slice(0, limit) : chosen;
}

function searchItems() {
  return publishedTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    icon: tool.icon,
    aliases: tool.aliases || [],
    keywords: tool.keywords || [],
    category: tool.category.label,
    categoryKey: tool.categoryKey,
    url: tool.pageUrl
  }));
}

function sidebarItems() {
  return {
    total: publishedTools.length,
    categories: CATEGORIES.map(category => ({
      key: category.key,
      name: category.name,
      icon: category.icon,
      color: category.color,
      count: publishedByCategory(category.key).length,
      url: category.path
    })),
    tools: publishedTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      keywords: tool.keywords || [],
      categoryKey: tool.categoryKey,
      url: tool.pageUrl
    }))
  };
}

module.exports = {
  site,
  root,
  CATEGORIES,
  categoryByKey,
  categoryBySlug,
  tools,
  publishedTools,
  redirectTools,
  publishedByCategory,
  bySlug,
  newTools,
  featuredTools,
  searchItems,
  sidebarItems
};
