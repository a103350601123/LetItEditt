/* LetitEdit central registry.
 * This is the single source of truth for the nine categories, tool metadata,
 * routes, tool counts, status vocabulary, planned catalog slots, search data
 * and sidebar data. Existing tool URLs are pinned to their historical paths
 * so reorganising categories does not move an indexed page.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  CATEGORY_COPY,
  CATEGORY_ORDER,
  LEGACY_CATEGORY_REDIRECTS
} = require('./category-copy');
const {
  CATALOG,
  CATALOG_TOOL_LINKS,
  TOOL_STATUSES,
  EXTERNAL_MODEL_SLUGS
} = require('./category-catalog');

const root = path.resolve(__dirname, '..');
const site = 'https://letitedit.com';

/* Runtime information is kept separate from public copy so the nine canonical
 * category names can be used verbatim in navigation, breadcrumbs and SEO. */
const CATEGORY_RUNTIME = {
  image: {
    dataFiles: ['image-tools.json'],
    runtime: 'image',
    scripts: ['js/image-core.js', 'js/image-runtime.js'],
    featured: ['image-editor', 'heic-viewer', 'photo-merger', 'screenshot-beautifier']
  },
  video: {
    dataFiles: ['video-tools.json'],
    runtime: 'video',
    scripts: ['js/video-core.js', 'js/video-runtime.js'],
    featured: ['video-editor', 'video-trimmer', 'mp4-to-gif', 'video-background-remover']
  },
  audio: {
    dataFiles: [],
    runtime: 'video',
    scripts: ['js/video-core.js', 'js/video-runtime.js'],
    featured: ['audio-editor']
  },
  document: { dataFiles: ['document-tools.json'], runtime: null, scripts: [], featured: ['pdf-editor'] },
  writing: {
    dataFiles: ['tools.json'],
    runtime: 'text',
    scripts: ['js/text-core.js', 'js/tool-runtime.js'],
    featured: ['word-counter', 'text-cleaner', 'find-and-replace', 'grammar-spell-checker']
  },
  design: { dataFiles: [], runtime: null, scripts: [], featured: ['thumbnail-generator', 'resume-builder'] },
  code: {
    dataFiles: ['dev-tools.json'],
    runtime: 'dev',
    scripts: ['js/dev-core.js', 'js/dev-runtime.js'],
    featured: ['json-formatter', 'base64-encoder-decoder', 'regex-tester']
  },
  diagram: { dataFiles: [], runtime: null, scripts: [], featured: [] },
  utility: { dataFiles: [], runtime: null, scripts: [], featured: ['qr-code-generator'] }
};

/* Each source file has one historical category path. Tools with no explicit
 * URL keep that path even when they move to a different canonical category. */
const DATA_SOURCES = [
  { sourceKey: 'writing', dataFile: 'tools.json', legacyPath: '/tools/writing-text/' },
  { sourceKey: 'dev', dataFile: 'dev-tools.json', legacyPath: '/tools/coding-developer/' },
  { sourceKey: 'image', dataFile: 'image-tools.json', legacyPath: '/tools/image-photo/' },
  { sourceKey: 'video', dataFile: 'video-tools.json', legacyPath: '/tools/video-audio/' },
  { sourceKey: 'document', dataFile: 'document-tools.json', legacyPath: '/tools/pdf-editor/' }
];

const SOURCE_CATEGORY = {
  writing: 'writing',
  dev: 'code',
  image: 'image',
  video: 'video',
  document: 'document'
};

/* One primary category per tool. Related-tool links cover cross-category use. */
const TOOL_CATEGORY_OVERRIDES = {
  'audio-editor': 'audio',
  'qr-code-generator': 'utility',
  'thumbnail-generator': 'design',
  'resume-builder': 'design',
  'pdf-editor': 'document'
};

const CATEGORIES = CATEGORY_ORDER.map(key => {
  const copy = CATEGORY_COPY[key];
  const runtime = CATEGORY_RUNTIME[key] || {};
  return {
    key,
    name: copy.name,
    label: copy.name,
    shortLabel: copy.shortName,
    slug: copy.slug,
    path: copy.path,
    icon: copy.icon,
    color: copy.color,
    dir: 'ltr',
    description: copy.description,
    intro: copy.intro,
    seoTitle: copy.seoTitle,
    seoDescription: copy.seoDescription,
    related: copy.related || [],
    dataFiles: runtime.dataFiles || [],
    runtime: runtime.runtime || null,
    scripts: runtime.scripts || [],
    featured: runtime.featured || [],
    tools: []
  };
});

const categoryByKey = new Map(CATEGORIES.map(category => [category.key, category]));
const categoryBySlug = new Map(CATEGORIES.map(category => [category.slug, category]));

function legacyPageUrl(url) {
  const relative = String(url).replace(/^\/+/, '');
  return `/${relative.replace(/index\.html$/, '')}`;
}

const tools = [];
DATA_SOURCES.forEach(source => {
  const list = JSON.parse(fs.readFileSync(path.join(root, 'data', source.dataFile), 'utf8'));
  list.forEach(raw => {
    const categoryKey = TOOL_CATEGORY_OVERRIDES[raw.slug] || SOURCE_CATEGORY[source.sourceKey];
    const category = categoryByKey.get(categoryKey);
    if (!category) throw new Error(`${raw.slug} assigned to unknown category: ${categoryKey}`);

    const redirectTo = raw.redirectTo
      ? legacyPageUrl(String(raw.redirectTo).replace(/^\.\//, ''))
      : null;
    const url = raw.url ? String(raw.url) : `${source.legacyPath}${raw.slug}/index.html`;
    const item = Object.assign({}, raw, {
      categoryKey,
      category,
      sourceKey: source.sourceKey,
      redirectTo,
      published: raw.published !== false && !redirectTo,
      isNew: raw.isNew === true && !redirectTo,
      featured: (raw.featured === true || category.featured.indexOf(raw.slug) !== -1) && !redirectTo,
      added: raw.added || '2026-11-18',
      status: raw.status || (raw.layout === 'existing'
        ? TOOL_STATUSES.UNVERIFIED
        : TOOL_STATUSES.VERIFIED),
      url: String(url).replace(/^\/+/, ''),
      pageUrl: legacyPageUrl(url),
      catalogSlots: []
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

const catalogItems = new Map();
CATEGORIES.forEach(category => {
  const links = CATALOG_TOOL_LINKS[category.key] || {};
  const entries = (CATALOG[category.key] || []).map((entry, index) => {
    const slotSlug = entry[1];
    const linkedSlug = links[slotSlug] || null;
    const linkedTool = linkedSlug ? bySlug.get(linkedSlug) : null;
    if (linkedSlug && !linkedTool) {
      throw new Error(`${category.key} catalog slot ${slotSlug} links to unknown tool: ${linkedSlug}`);
    }
    const status = linkedTool
      ? linkedTool.status
      : (EXTERNAL_MODEL_SLUGS.has(slotSlug) ? TOOL_STATUSES.EXTERNAL : TOOL_STATUSES.PLANNED);
    const result = {
      key: slotSlug,
      slug: slotSlug,
      name: entry[0],
      categoryKey: category.key,
      categoryName: category.name,
      catalogIndex: index + 1,
      status,
      available: !!linkedTool,
      toolSlug: linkedTool ? linkedTool.slug : null,
      url: linkedTool ? linkedTool.pageUrl : null,
      icon: linkedTool ? linkedTool.icon : category.icon,
      description: linkedTool
        ? linkedTool.description
        : `Planned ${category.name.toLowerCase()} tool. No implementation has been provided yet.`,
      keywords: linkedTool ? (linkedTool.keywords || []) : []
    };
    if (linkedTool) linkedTool.catalogSlots.push(entry[0]);
    return result;
  });
  catalogItems.set(category.key, entries);
});

function publishedByCategory(key) {
  return publishedTools.filter(tool => tool.categoryKey === key);
}

function catalogFor(key) {
  const entries = catalogItems.get(key);
  if (!entries) throw new Error(`Unknown catalog category: ${key}`);
  return entries;
}

function plannedCount(key) {
  return catalogFor(key).filter(entry => !entry.available).length;
}

function mappedCount(key) {
  return catalogFor(key).filter(entry => entry.available).length;
}

function catalogTotals() {
  const planned = CATEGORIES.reduce((sum, category) => sum + CATALOG[category.key].length, 0);
  const mapped = CATEGORIES.reduce((sum, category) => sum + mappedCount(category.key), 0);
  return { planned, mapped, remaining: planned - mapped };
}

function relatedTools(key, limit) {
  const category = categoryByKey.get(key);
  if (!category) return [];
  const chosen = [];
  const seen = new Set();
  function add(list) {
    list.forEach(tool => {
      if (!tool || tool.categoryKey === key || seen.has(tool.slug)) return;
      seen.add(tool.slug);
      chosen.push(tool);
    });
  }
  category.related.forEach(relatedKey => {
    add(publishedTools
      .filter(tool => tool.categoryKey === relatedKey)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 3));
  });
  if (chosen.length < 6) {
    add(publishedTools.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6));
  }
  return typeof limit === 'number' ? chosen.slice(0, limit) : chosen;
}

function newTools(limit) {
  const list = publishedTools
    .filter(tool => tool.isNew)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)) || a.name.localeCompare(b.name));
  return typeof limit === 'number' ? list.slice(0, limit) : list;
}

/* Featured picks are declared in tool metadata or a category's featured list.
 * The fallback spreads featured tools across the nine categories first. */
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
    category: tool.category.name,
    categoryKey: tool.categoryKey,
    categoryPath: tool.category.path,
    status: tool.status,
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
      plannedCount: plannedCount(category.key),
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
  CATEGORY_COPY,
  CATEGORY_ORDER,
  CATALOG,
  TOOL_STATUSES,
  categoryByKey,
  categoryBySlug,
  tools,
  publishedTools,
  redirectTools,
  publishedByCategory,
  catalogFor,
  plannedCount,
  mappedCount,
  catalogTotals,
  relatedTools,
  legacyCategoryRedirects: LEGACY_CATEGORY_REDIRECTS,
  bySlug,
  newTools,
  featuredTools,
  searchItems,
  sidebarItems
};
