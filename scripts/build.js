/* Static page generator for LetitEdit. Run with: node scripts/build.js
 * Every page is derived from data/registry.js and data/content.js. */
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../data/registry');
const content = require('../data/content');
const workspaces = require('./tool-workspaces');
const imageWorkspaces = require('./image-workspaces');

// Engine-backed tools use dedicated processors and workspaces. Writing tools
// keep their faithful reference engines; image tools use the local image
// runtime. Everything else keeps the shared text/developer runtime.
global.workspaceForEngine = tool => {
  if (!tool.engine) return null;
  return workspaces.workspaceFor(tool.engine) || imageWorkspaces.workspaceFor(tool.engine);
};
global.scriptsForEngine = tool => {
  if (!tool.engine) return null;
  if (imageWorkspaces.has(tool.engine)) {
    return ['js/image-core.js'].concat(imageWorkspaces.vendorScripts(tool.engine), ['js/image-runtime.js']);
  }
  return ['js/reference-core.js', 'js/reference-runtime.js'];
};

const root = registry.root;
const site = registry.site;
const categories = registry.CATEGORIES;
const allTools = registry.tools;
const publishedTools = registry.publishedTools;
const bySlug = registry.bySlug;
const writingPath = categories[0].path;
const devPath = categories[1].path;

function write(relativePath, data) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, 'utf8');
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function xml(value) {
  return esc(value).replace(/&#39;/g, '&apos;');
}

const navSections = [
  { key: 'categories', label: 'Categories', href: '/categories/' },
  { key: 'new', label: 'New Tools', href: '/new-tools/' },
  { key: 'news', label: 'News', href: '/news/' },
  { key: 'blog', label: 'Blog', href: '/blog/' },
  { key: 'all', label: 'All Tools', href: '/tools/' },
  { key: 'faq', label: 'FAQ', href: '/faq/' }
];

function nav(active) {
  const links = navSections.map(section =>
    `<a href="${section.href}"${active === section.key ? ' aria-current="page"' : ''}>${esc(section.label)}</a>`
  ).join('\n      ');
  return `<header class="topbar">
  <nav class="nav" aria-label="Primary navigation">
    <a class="brand" href="/" aria-label="LetitEdit home"><span class="brand-mark" aria-hidden="true">L</span><span>LetitEdit</span></a>
    <button class="menu-button" type="button" aria-controls="primary-links" aria-expanded="false">Menu</button>
    <div class="nav-links" id="primary-links">
      ${links}
      <button class="nav-search" id="nav-search" type="button" aria-label="Open tool search" title="Search tools"><span aria-hidden="true">🔍</span></button>
    </div>
  </nav>
</header>`;
}

function searchStrip() {
  return `<div class="site-search-strip" id="search-strip">
  <div class="container">
    <div class="search-wrap">
      <span class="search-icon" aria-hidden="true">🔍</span>
      <input class="search-input" id="site-search" type="search" placeholder="Search ${publishedTools.length} free tools…" aria-label="Search all tools" autocomplete="off">
      <div class="search-results" id="search-results" role="listbox" hidden></div>
    </div>
  </div>
</div>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <h3>LetitEdit</h3>
        <p>Free, focused online tools that run in your browser. No accounts, no uploads, no deceptive downloads.</p>
      </div>
      <div>
        <h3>Explore</h3>
        <ul>
          <li><a href="/categories/">Categories</a></li>
          <li><a href="/new-tools/">New Tools</a></li>
          <li><a href="/tools/">All Tools</a></li>
          <li><a href="/news/">News</a></li>
          <li><a href="/blog/">Blog</a></li>
          <li><a href="/faq/">FAQ</a></li>
        </ul>
      </div>
      <div>
        <h3>Policies</h3>
        <ul>
          <li><a href="/about/">About</a></li>
          <li><a href="/contact/">Contact</a></li>
          <li><a href="/privacy-policy/">Privacy Policy</a></li>
          <li><a href="/terms-of-service/">Terms of Service</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-year>2026</span> LetitEdit.com</span>
      <span>Built for privacy, accuracy and plain-English tooling.</span>
    </div>
  </div>
</footer>`;
}

function page(options) {
  const assets = options.assets || '';
  const structured = options.structured ? `<script type="application/ld+json">\n${jsonForScript(options.structured)}\n</script>` : '';
  const ogImage = options.image ? `<meta property="og:image" content="${esc(site + options.image)}">` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<meta name="theme-color" content="#2563eb">
<link rel="canonical" href="${site}${options.canonical}">
<meta property="og:type" content="${options.ogType || 'website'}">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${site}${options.canonical}">
${ogImage}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%232563eb'/%3E%3Cpath d='M6 17V7h3l3 5 3-5h3v10' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${assets}css/site.css">
${structured}
</head>
<body>
${nav(options.activeNav)}
${searchStrip()}
${options.body}
${footer()}
<script src="${assets}js/search-index.js"></script>
<script src="${assets}js/sidebar-data.js"></script>
<script src="${assets}js/site.js"></script>
<script src="${assets}js/category-sidebar.js"></script>
${options.scripts ? options.scripts.map(src => `<script src="${assets}${src}"></script>`).join('\n') : ''}
</body>
</html>
`;
}

/* Shared category sidebar. Counts come from the registry, never hardcoded. */
function sidebar(assets, activeKey) {
  const items = registry.sidebarItems();
  const links = [
    `<a class="sidebar-link${activeKey === 'all' ? ' is-active' : ''}" href="${assets}tools/" data-sidebar-key="all"${activeKey === 'all' ? ' aria-current="page"' : ''}>
      <span class="sidebar-icon" style="--icon-bg:#dbeafe;--icon-color:#1d4ed8" aria-hidden="true">📚</span>
      <span class="sidebar-name">All Tools</span><span class="sidebar-count">${items.total}</span>
    </a>`
  ].concat(items.categories.map(category =>
    `<a class="sidebar-link${activeKey === category.key ? ' is-active' : ''}" href="${assets}${category.url.replace(/^\//, '')}" data-sidebar-key="${category.key}"${activeKey === category.key ? ' aria-current="page"' : ''}>
      <span class="sidebar-icon" style="--icon-bg:${category.color}1a;--icon-color:${category.color}" aria-hidden="true">${esc(category.icon)}</span>
      <span class="sidebar-name">${esc(category.name)}</span><span class="sidebar-count">${category.count}</span>
    </a>`
  )).join('\n    ');

  return `<aside class="category-sidebar" aria-label="Tool categories" data-base="${assets}">
  <div class="sidebar-search">
    <span class="sidebar-search-icon" aria-hidden="true">🔍</span>
    <input id="sidebar-filter" type="search" placeholder="Filter categories & tools" aria-label="Filter categories and tools" autocomplete="off">
  </div>
  <nav class="sidebar-list" aria-label="Categories">${links}</nav>
  <div class="sidebar-matches" id="sidebar-matches" hidden></div>
  <p class="sidebar-note">Counts update automatically as tools are registered.</p>
</aside>`;
}

function breadcrumbs(assets, trail) {
  const parts = trail.map((item, index) => {
    const isLast = index === trail.length - 1;
    if (isLast) return `<span aria-current="page">${esc(item.label)}</span>`;
    const href = item.href.charAt(0) === '/' ? `${assets}${item.href.replace(/^\//, '')}` : `${assets}${item.href}`;
    return `<a href="${href}">${esc(item.label)}</a><span>/</span>`;
  }).join('\n  ');
  return `<nav class="container breadcrumbs" aria-label="Breadcrumb">\n  ${parts}\n</nav>`;
}

function toolUrl(tool, assets) {
  return tool.url ? `${assets}${tool.url}` : `${assets}${tool.category.path.replace(/^\//, '')}${tool.slug}/`;
}

function toolCard(tool, assets) {
  const badge = tool.isNew ? '<span class="card-new">New</span>' : '';
  return `<a class="card" href="${toolUrl(tool, assets)}">
  <span class="card-icon" style="--icon-bg:${tool.category.color}1a;--icon-color:${tool.category.color}" aria-hidden="true">${esc(tool.icon)}</span>
  <h3>${esc(tool.name)}${badge}</h3>
  <p>${esc(tool.description)}</p>
  <span class="card-tag">${esc(tool.category.shortLabel)}</span>
</a>`;
}

function emptyState(title, message) {
  return `<div class="empty-state">
  <span class="empty-icon" aria-hidden="true">📭</span>
  <h3>${esc(title)}</h3>
  <p>${esc(message)}</p>
</div>`;
}

/* ---------- Tool pages ---------- */

function coreWorkspace(tool) {
  const isDiff = tool.layout === 'diff';
  const isLorem = tool.layout === 'lorem';
  const inputSide = isDiff
    ? `<div class="field"><label for="tool-input-left">Original text</label><textarea id="tool-input-left" placeholder="Paste the original version here…"></textarea></div>
       <div class="field"><label for="tool-input-right">Changed text</label><textarea id="tool-input-right" placeholder="Paste the changed version here…"></textarea></div>
       <div id="controls"></div>`
    : isLorem
      ? `<p style="margin-top:0;color:var(--muted)">Choose your placeholder options, then generate text.</p><div id="controls"></div>
         <div class="output-actions"><button class="btn" id="generate-output" type="button">Generate text</button></div>`
      : `<div class="field"><label for="tool-input">Input text</label><textarea id="tool-input" placeholder="Paste or type your text here…"></textarea></div>
         <div id="controls"></div>
         <div class="output-actions"><button class="btn btn-secondary btn-small" id="clear-input" type="button">Clear input</button></div>`;

  return `<section class="container workspace">
  <div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>
  <div class="panel-grid">
    <div>${inputSide}</div>
    <div>
      <div class="workspace-head">
        <h2>Output</h2>
        <div class="output-actions">
          <button class="btn btn-secondary btn-small" id="copy-output" type="button">Copy output</button>
          <button class="btn btn-secondary btn-small" id="download-output" type="button">Download</button>
          <button class="btn btn-secondary btn-small" id="restore-output" type="button" hidden>Restore original values</button>
        </div>
      </div>
      <div class="${tool.outputType === 'diff' ? 'diff-output' : 'output-box'}" id="tool-output"></div>
      <div class="status" id="tool-status" role="status" aria-live="polite"></div>
    </div>
  </div>
</section>`;
}

function devWorkspace(tool) {
  const controlsFirst = tool.kind === 'regex';
  const inputBlock = `<div class="field"><label for="tool-input" id="tool-input-label">${esc(tool.inputLabel || 'Input')}</label><textarea id="tool-input" placeholder="${esc(tool.placeholder || '')}"></textarea></div>`;
  const controlsBlock = '<div id="controls"></div>';
  const actions = `<div class="output-actions">
          <button class="btn btn-secondary btn-small" id="clear-input" type="button">Clear input</button>
          <button class="btn btn-secondary btn-small" id="load-example" type="button">Load example</button>
          <button class="btn btn-secondary btn-small" id="swap-output" type="button"${tool.kind === 'base64' ? '' : ' hidden'}>Use output as input</button>
        </div>`;
  const left = controlsFirst ? `${controlsBlock}${inputBlock}${actions}` : `${inputBlock}${controlsBlock}${actions}`;
  const outputElement = tool.kind === 'regex' ? '<div class="output-box" id="tool-output"></div>' : '<pre class="output-box" id="tool-output"></pre>';
  return `<section class="container workspace">
  <div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>
  <div class="panel-grid">
    <div>${left}</div>
    <div>
      <div class="workspace-head"><h2>Output</h2><div class="output-actions">
          <button class="btn btn-secondary btn-small" id="copy-output" type="button">Copy output</button>
          <button class="btn btn-secondary btn-small" id="download-output" type="button">Download</button>
        </div></div>
      ${outputElement}
      <div class="status" id="tool-status" role="status" aria-live="polite"></div>
    </div>
  </div>
</section>`;
}

function workspaceFor(tool) {
  if (tool.category.runtime === 'dev') return devWorkspace(tool);
  if (typeof global.workspaceForEngine === 'function') {
    const custom = global.workspaceForEngine(tool);
    if (custom) return custom;
  }
  return coreWorkspace(tool);
}

function exampleSection(tool) {
  if (!tool.example) return '';
  const patternRow = tool.example.pattern
    ? `<div class="example-row"><span class="example-label">Pattern</span><div class="example-box">${esc(tool.example.pattern)}</div></div>`
    : '';
  return `<section class="section section-soft">
  <div class="container info-grid">
    <div class="info-card">
      <h2>How to use ${esc(tool.name)}</h2>
      <ol>${(tool.instructions || []).map(item => `<li>${esc(item)}</li>`).join('')}</ol>
    </div>
    <div class="info-card">
      <h2>Example</h2>
      ${patternRow}
      <div class="example-row"><span class="example-label">Input</span><div class="example-box">${esc(tool.example.input)}</div></div>
      <div class="example-row"><span class="example-label">Output</span><div class="example-box">${esc(tool.example.output)}</div></div>
    </div>
  </div>
</section>`;
}

function articleSection(tool) {
  if (!Array.isArray(tool.article) || !tool.article.length) return '';
  const sections = tool.article.map(section => `<h2>${esc(section.heading)}</h2>
      ${(section.paragraphs || []).map(paragraph => `<p>${esc(paragraph)}</p>`).join('\n      ')}`).join('\n      ');
  return `<section class="section section-soft">
  <div class="container"><article class="article-card">
      <span class="eyebrow">In-depth guide</span>
      ${sections}
  </article></div>
</section>`;
}

function faqItems(faqs) {
  return (faqs || []).map(faq => `<details class="faq-item">
  <summary>${esc(faq.q)}</summary>
  <p>${esc(faq.a)}</p>
</details>`).join('');
}

function faqSection(tool, assets) {
  return `<section class="section">
  <div class="container info-grid">
    <div class="info-card">
      <h2>Frequently asked questions</h2>
      ${faqItems(tool.faqs)}
    </div>
    <div class="info-card">
      <h2>Related tools</h2>
      <div class="grid tool-grid" style="grid-template-columns:1fr;gap:12px">
        ${(tool.related || []).map(slug => {
          const related = bySlug.get(slug);
          return `<a class="card" href="${toolUrl(related, assets)}"><h3>${esc(related.name)}</h3><p>${esc(related.description)}</p></a>`;
        }).join('')}
      </div>
    </div>
  </div>
</section>`;
}

function runtimeConfig(tool) {
  const config = {
    slug: tool.slug,
    engine: tool.engine || null,
    layout: tool.layout,
    outputType: tool.outputType,
    controls: tool.controls,
    example: tool.example,
    live: tool.live
  };
  if (tool.category.runtime === 'dev') {
    config.kind = tool.kind;
    config.inputLabel = tool.inputLabel;
    config.placeholder = tool.placeholder;
  }
  return config;
}

function toolScripts(tool) {
  if (tool.layout === 'existing') return [];
  if (typeof global.scriptsForEngine === 'function') {
    const custom = global.scriptsForEngine(tool);
    if (custom) return custom;
  }
  return tool.category.scripts;
}

function toolPage(tool, assetsOverride) {
  /* Registered short routes live at the site root; category-based tools keep
   * their existing three-level relative asset paths. */
  const assets = assetsOverride || (tool.url ? '/' : '../../../');
  const category = tool.category;
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    name: tool.name,
    mainEntity: (tool.faqs || []).map(faq => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a }
    }))
  };
  const body = `${breadcrumbs(assets, [
    { label: 'Home', href: '/' },
    { label: category.label, href: category.path },
    { label: tool.name, href: tool.pageUrl }
  ])}
<section class="container page-head">
  <span class="eyebrow">${esc(category.label)}</span>
  <h1>${esc(tool.h1)}</h1>
  <p>${esc(tool.intro)}</p>
</section>
${workspaceFor(tool)}
${exampleSection(tool)}
${articleSection(tool)}
${faqSection(tool, assets)}`;

  const scripts = toolScripts(tool);
  const config = tool.layout === 'existing' ? '' : `<script id="tool-config" type="application/json">${jsonForScript(runtimeConfig(tool))}</script>`;
  return page({
    title: tool.title,
    description: tool.description,
    canonical: tool.pageUrl,
    assets,
    body,
    structured,
    scripts
  }).replace('</body>', `${config}\n</body>`);
}

/* ---------- Directory and content pages ---------- */

function directoryLayout(options) {
  const { assets, activeKey, heading, intro, tools, allCount, matchedMessage } = options;
  const cards = tools.length
    ? tools.map(tool => toolCard(tool, assets)).join('')
    : emptyState('No tools here yet', 'This category is ready for future tools. Nothing is published until it has been implemented and tested.');
  return `${breadcrumbs(assets, [
    { label: 'Home', href: '/' },
    { label: options.crumb || 'All Tools', href: options.crumbHref || '/tools/' },
    ...(options.trail || [])
  ])}
<section class="container page-head">
  <span class="eyebrow">${esc(options.eyebrow || 'Tool directory')}</span>
  <h1>${esc(heading)}</h1>
  <p>${esc(intro)}</p>
</section>
<section class="section directory-section">
  <div class="container directory-layout">
    ${sidebar(assets, activeKey)}
    <main class="directory-main">
      <div class="directory-bar">
        <div>
          <h2>${esc(heading)}</h2>
          <p class="directory-count">${allCount} tool${allCount === 1 ? '' : 's'}</p>
        </div>
        <div class="directory-filter">
          <label class="sr-only" for="tool-filter">Filter tools on this page</label>
          <input id="tool-filter" type="search" placeholder="Filter tools by name…" autocomplete="off">
        </div>
      </div>
      <p class="directory-matched" id="directory-matched" hidden></p>
      <div class="grid tool-grid" id="tool-grid">${cards}</div>
    </main>
  </div>
</section>`;
}

function categoryPage(category) {
  const assets = '../../';
  const tools = registry.publishedByCategory(category.key);
  const body = `${directoryLayout({
    assets,
    activeKey: category.key,
    heading: category.label,
    intro: category.intro,
    tools,
    allCount: tools.length,
    crumb: 'Categories',
    crumbHref: '/categories/',
    trail: [{ label: category.name, href: category.path }],
    eyebrow: 'Category directory'
  })}
${tools.length ? `<section class="section section-soft">
  <div class="container info-card">
    <h2>About ${esc(category.name)}</h2>
    <p>${esc(category.description)}</p>
    <p>Every tool on this page is free, runs locally in your browser and links to its own guide with instructions, examples and FAQs.</p>
  </div>
</section>` : ''}`;
  return page({
    title: category.seoTitle,
    description: category.seoDescription,
    canonical: category.path,
    assets,
    body
  });
}

function allToolsPage() {
  const tools = publishedTools.slice().sort((a, b) => a.name.localeCompare(b.name));
  const assets = '../';
  const body = `${directoryLayout({
    assets,
    activeKey: 'all',
    heading: 'All Tools',
    intro: `Every published LetitEdit tool in one place. Use the category sidebar or filter box to find the right utility, then open its page for instructions, examples and FAQs.`,
    tools,
    allCount: tools.length,
    eyebrow: 'Complete directory'
  })}`;
  return page({
    title: 'All Tools — Every Free LetitEdit Utility',
    description: `Browse all ${tools.length} published LetitEdit tools across ${categories.length} categories. Filter by name or category; every tool runs locally in your browser.`,
    canonical: '/tools/',
    activeNav: 'all',
    assets,
    body
  });
}

function categoriesPage() {
  const cards = categories.map(category => {
    const count = registry.publishedByCategory(category.key).length;
    return `<a class="card category-card" href="${category.path}" style="--icon-bg:${category.color}1a;--icon-color:${category.color}">
      <span class="card-icon" aria-hidden="true">${esc(category.icon)}</span>
      <h3>${esc(category.name)}</h3>
      <p>${esc(category.description)}</p>
      <span class="card-tag">${count} tool${count === 1 ? '' : 's'}</span>
    </a>`;
  }).join('');
  const assets = '../';
  const body = `${breadcrumbs(assets, [{ label: 'Home', href: '/' }, { label: 'Categories', href: '/categories/' }])}
<section class="container page-head">
  <span class="eyebrow">Browse by topic</span>
  <h1>Categories</h1>
  <p>Ten stable categories are ready now. Each one has its own page, dynamic tool count and empty state. Tools appear as they are built and tested.</p>
</section>
<section class="section"><div class="container"><div class="grid category-grid">${cards}</div></div></section>`;
  return page({
    title: 'Tool Categories — Browse LetitEdit by Topic',
    description: `Explore ${categories.length} LetitEdit categories, from Text & Writing to Device Testers. Counts are calculated from the live tool registry.`,
    canonical: '/categories/',
    activeNav: 'categories',
    assets,
    body
  });
}

function newToolsPage() {
  const tools = registry.newTools();
  const assets = '../';
  const body = `${breadcrumbs(assets, [{ label: 'Home', href: '/' }, { label: 'New Tools', href: '/new-tools/' }])}
<section class="container page-head">
  <span class="eyebrow">Recently added</span>
  <h1>New Tools</h1>
  <p>Tools marked as new in the registry appear here automatically, newest first. No manual list to maintain.</p>
</section>
<section class="section"><div class="container">
  ${tools.length ? `<div class="grid tool-grid">${tools.map(tool => toolCard(tool, assets)).join('')}</div>`
    : emptyState('No new tools yet', 'Recently added tools will be listed here automatically when they are registered.')}
</div></section>`;
  return page({
    title: 'New Tools — Recently Added Free Utilities',
    description: 'See the newest LetitEdit tools. This page is generated from publication metadata in the central tool registry.',
    canonical: '/new-tools/',
    activeNav: 'new',
    assets,
    body
  });
}

function listingPage(type) {
  const isNews = type === 'news';
  const articles = isNews ? content.news : content.blog;
  const items = articles.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const base = isNews ? '/news/' : '/blog/';
  const assets = '../';
  const cards = items.map(article => `<a class="card article-card-list" href="${base}${article.slug}/">
    ${article.image ? `<img src="${esc(article.image)}" alt="" loading="lazy" width="640" height="360">` : ''}
    <time datetime="${esc(article.date)}">${esc(article.date)}</time>
    <h2>${esc(article.title)}</h2>
    <p>${esc(article.summary)}</p>
    <span class="card-tag">${esc(article.category || (isNews ? 'News' : 'Article'))}</span>
  </a>`).join('');
  const body = `${breadcrumbs(assets, [{ label: 'Home', href: '/' }, { label: isNews ? 'News' : 'Blog', href: base }])}
<section class="container page-head">
  <span class="eyebrow">${isNews ? 'Site updates' : 'Articles and guides'}</span>
  <h1>${isNews ? 'News' : 'Blog'}</h1>
  <p>${isNews
    ? 'Announcements and site updates will appear here. No articles have been published yet.'
    : 'Longer guides and articles about using our tools will appear here. No articles have been published yet.'}</p>
</section>
<section class="section"><div class="container">
  ${items.length ? `<div class="grid article-grid">${cards}</div>`
    : emptyState(isNews ? 'No news yet' : 'No articles yet', isNews
      ? 'When there is a real update to share, it will be published here with a title, date, summary and SEO metadata.'
      : 'When a guide is written, it will be published here with categories, tags, a featured image and SEO metadata.')}
</div></section>`;
  return page({
    title: isNews ? 'News — LetitEdit Updates' : 'Blog — LetitEdit Guides',
    description: isNews
      ? 'LetitEdit news and announcements. No articles have been published yet; this page is ready for future updates.'
      : 'LetitEdit articles and guides. No articles have been published yet; this page is ready for future writing.',
    canonical: base,
    activeNav: type,
    assets,
    body
  });
}

function articleBody(article) {
  return (article.body || []).map(section => `<h2>${esc(section.heading)}</h2>
    ${(section.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('\n    ')}`).join('\n    ');
}

function articlePage(article, type) {
  const isNews = type === 'news';
  const base = isNews ? '/news/' : '/blog/';
  const assets = '../../';
  const body = `${breadcrumbs(assets, [
    { label: 'Home', href: '/' },
    { label: isNews ? 'News' : 'Blog', href: base },
    { label: article.title, href: `${base}${article.slug}/` }
  ])}
<section class="container page-head">
  <span class="eyebrow">${esc(article.category || (isNews ? 'News' : 'Article'))}</span>
  <h1>${esc(article.title)}</h1>
  <p><time datetime="${esc(article.date)}">${esc(article.date)}</time>${article.author ? ` · ${esc(article.author)}` : ''}</p>
</section>
<section class="section"><div class="container"><article class="article-card">
  ${article.image ? `<img src="${esc(article.image)}" alt="" loading="lazy">` : ''}
  ${articleBody(article)}
</article></div></section>`;
  return page({
    title: article.seoTitle || article.title,
    description: article.seoDescription || article.summary,
    canonical: `${base}${article.slug}/`,
    assets,
    activeNav: type,
    image: article.image,
    ogType: 'article',
    body,
    structured: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      datePublished: article.date,
      description: article.summary,
      mainEntityOfPage: `${site}${base}${article.slug}/`
    }
  });
}

function faqPage() {
  const grouped = new Map();
  content.faq.forEach(item => {
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category).push(item);
  });
  const groups = Array.from(grouped, ([name, items]) => `<section class="info-card">
    <h2>${esc(name)}</h2>
    ${faqItems(items)}
  </section>`).join('');
  const assets = '../';
  const body = `${breadcrumbs(assets, [{ label: 'Home', href: '/' }, { label: 'FAQ', href: '/faq/' }])}
<section class="container page-head">
  <span class="eyebrow">Help centre</span>
  <h1>Frequently Asked Questions</h1>
  <p>Short answers about how LetitEdit works, how your data is handled and how the tool registry supports future expansion. Questions expand on click or with the keyboard.</p>
</section>
<section class="section"><div class="container faq-groups">${groups}</div></section>`;
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: content.faq.map(item => ({
      '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a }
    }))
  };
  return page({
    title: 'FAQ — LetitEdit Questions and Answers',
    description: 'Answers about browser-side processing, privacy, accounts, mobile use and how new tools are added to LetitEdit.',
    canonical: '/faq/',
    activeNav: 'faq',
    assets,
    body,
    structured
  });
}

function homepage() {
  const nextTools = registry.newTools(6);
  const cards = publishedTools.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
  const body = `<main>
<section class="hero">
  <div class="container hero-inner">
    <div>
      <span class="eyebrow">Free tools · Private by default</span>
      <h1>Practical tools that get <span class="gradient-text">straight to work</span></h1>
      <p>LetitEdit brings ${publishedTools.length} focused browser-side utilities together under ten stable categories. Everything processes locally, with clear instructions and no uploads.</p>
      <div class="hero-actions">
        <a class="btn" href="/tools/">Browse all tools</a>
        <a class="btn btn-secondary" href="/categories/">Explore categories</a>
        <a class="btn btn-secondary" href="/faq/">Read the FAQ</a>
      </div>
    </div>
    <aside class="hero-card" aria-label="Platform summary">
      <div class="hero-card-title">What makes LetitEdit different</div>
      <div class="hero-stat"><span>Processing</span><strong>On-device</strong></div>
      <div class="hero-stat"><span>Tools ready</span><strong>${publishedTools.length}</strong></div>
      <div class="hero-stat"><span>Categories</span><strong>${categories.length}</strong></div>
      <div class="hero-stat"><span>Accounts needed</span><strong>None</strong></div>
    </aside>
  </div>
</section>

<section class="section directory-section">
  <div class="container directory-layout">
    ${sidebar('', 'all')}
    <main class="directory-main">
      <div class="directory-bar">
        <div><h2>Tool directory</h2><p class="directory-count">${publishedTools.length} published tools</p></div>
        <div class="directory-filter">
          <label class="sr-only" for="tool-filter">Filter tools on this page</label>
          <input id="tool-filter" type="search" placeholder="Filter tools by name…" autocomplete="off">
        </div>
      </div>
      <p class="directory-matched" id="directory-matched" hidden></p>
      <div class="grid tool-grid" id="tool-grid">${cards.map(tool => toolCard(tool, '')).join('')}</div>
      <p class="directory-more"><a class="btn btn-secondary" href="/tools/">See all ${publishedTools.length} tools</a></p>
    </main>
  </div>
</section>

<section class="section section-soft">
  <div class="container">
    <div class="section-head"><h2>New Tools</h2><p>Recently added tools, generated from registry metadata.</p></div>
    ${nextTools.length ? `<div class="grid tool-grid">${nextTools.map(tool => toolCard(tool, '')).join('')}</div>`
      : emptyState('No new tools yet', 'Recently added tools will appear here automatically.')}
    <p class="directory-more"><a class="btn btn-secondary" href="/new-tools/">View all new tools</a></p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head"><h2>Explore by category</h2><p>Every category has a working page now. Empty categories show an honest empty state until tools are added.</p></div>
    <div class="grid category-grid">
      ${categories.map(category => {
        const count = registry.publishedByCategory(category.key).length;
        return `<a class="card category-card" href="${category.path.replace(/^\//, '')}" style="--icon-bg:${category.color}1a;--icon-color:${category.color}">
          <span class="card-icon" aria-hidden="true">${esc(category.icon)}</span>
          <h3>${esc(category.name)}</h3><p>${esc(category.description)}</p><span class="card-tag">${count} tool${count === 1 ? '' : 's'}</span>
        </a>`;
      }).join('')}
    </div>
  </div>
</section>

<section class="section section-soft">
  <div class="container info-grid">
    <div class="info-card"><h2>News</h2><p>Site announcements will be published here with dates and SEO metadata.</p><a class="btn btn-secondary btn-small" href="/news/">Open News</a></div>
    <div class="info-card"><h2>Blog</h2><p>Longer guides will be published here with categories, tags and featured images.</p><a class="btn btn-secondary btn-small" href="/blog/">Open Blog</a></div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head"><h2>Preserved local tools</h2><p>These tools keep their original URLs while they are organised into categories.</p></div>
    <div class="grid tool-grid">
      ${[['Text to Handwriting', 'tools/text-to-handwriting/index.html', 'Handwriting-style pages with PNG and PDF export.'],
         ['Image Editor', 'tools/image-compressor/index.html', 'Crop, resize and export images locally.'],
         ['Video Editor', 'tools/video-editor/index.html', 'Edit a multi-track video timeline with local export.'],
         ['Resume Builder', 'tools/resume-builder/index.html', 'Build a print-ready CV with local templates.'],
         ['PDF Editor', 'tools/pdf-editor/index.html', 'Edit, sign and organise PDF documents locally.']]
        .map(([name, url, desc]) => `<a class="card" href="${url}"><span class="card-icon" aria-hidden="true">🔧</span><h3>${esc(name)}</h3><p>${esc(desc)}</p><span class="card-tag">Preserved tool</span></a>`).join('')}
    </div>
  </div>
</section>
</main>`;
  return page({
    title: 'LetitEdit — Free Online Tools That Run in Your Browser',
    description: `Free browser-side utilities for writing, text cleanup, formatting, developer work and more. ${publishedTools.length} tools across ${categories.length} categories, with no uploads or accounts.`,
    canonical: '/',
    body,
    structured: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'LetitEdit',
      url: site,
      description: 'Free online tools that run in your browser.',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${site}/?q={search_term_string}`,
        'query-input': 'required name=search_term_string'
      }
    }
  });
}

function staticPage(options) {
  return page({
    title: options.title,
    description: options.description,
    canonical: options.canonical,
    assets: '../',
    body: `<main><section class="container page-head"><span class="eyebrow">${esc(options.eyebrow)}</span><h1>${esc(options.h1)}</h1><p>${esc(options.intro)}</p></section><section class="section legal"><div class="container"><div class="info-card">${options.content}</div></div></section></main>`
  });
}

/* ---------- Generate everything ---------- */

write('index.html', homepage());
write('/tools/index.html', allToolsPage());
write('/categories/index.html', categoriesPage());
write('/new-tools/index.html', newToolsPage());
write('/news/index.html', listingPage('news'));
write('/blog/index.html', listingPage('blog'));
write('/faq/index.html', faqPage());

categories.forEach(category => {
  write(`${category.path.replace(/^\//, '')}index.html`, categoryPage(category));
  category.tools.forEach(tool => {
    if (tool.layout === 'existing') return;
    if (tool.url) {
      /* Generated short routes are written at their registered path. Existing
       * standalone pages with a url and layout 'existing' are never touched. */
      write(tool.url, toolPage(tool, '/'));
      return;
    }
    write(`${category.path.replace(/^\//, '')}${tool.slug}/index.html`, toolPage(tool));
  });
});

['news', 'blog'].forEach(type => {
  const articles = type === 'news' ? content.news : content.blog;
  articles.forEach(article => write(`${type}/${article.slug}/index.html`, articlePage(article, type)));
});

write('js/search-index.js', `/* Generated by scripts/build.js */\nwindow.LETITEDIT_SEARCH = ${jsonForScript(registry.searchItems())};\n`);
write('js/sidebar-data.js', `/* Generated by scripts/build.js */\nwindow.LETITEDIT_SIDEBAR = ${jsonForScript(registry.sidebarItems())};\n`);

const staticPages = {
  'about/index.html': staticPage({
    title: 'About LetitEdit — private, practical browser tools',
    description: 'Learn why LetitEdit builds focused browser-side tools with real functionality, transparent instructions and privacy by default.',
    canonical: '/about/',
    eyebrow: 'About the project',
    h1: 'Practical tools. Clear rules. No uploads.',
    intro: 'LetitEdit is a category-based online tools site. We finish one category at a time so every published page has working functionality, documented behaviour and an honest purpose.',
    content: `<h2>Browser-side by design</h2><p>Our text and developer tools process everything in your browser. Input is not sent to a server for counting, cleaning, converting, formatting or matching. This keeps the tools fast and avoids collecting your content.</p><h2>What “complete category” means</h2><p>We do not publish a category until every approved tool has a real processor, an SEO-friendly page, mobile and desktop checks, empty-input handling, Unicode tests and repeated-use checks. Writing &amp; Text and Coding &amp; Developer Tools are complete.</p><h2>Content standards</h2><p>Each tool page explains what it does, how to use it, what its limits are and what related tools can help next. Examples show real input and output. We avoid fake processing, hidden paywalls and deceptive download buttons.</p><h2>Roadmap</h2><p>Future categories have stable pages and routes now, but tools are published only after they are built and tested. No category is announced as ready before testing is executed.</p><h2>Contact</h2><p>Questions, corrections or tool requests are welcome on the <a href="/contact/">Contact page</a>.</p>`
  }),
  'contact/index.html': staticPage({
    title: 'Contact LetitEdit — feedback and tool requests',
    description: 'Contact LetitEdit about a broken tool, a missing text utility or a correction to tool documentation.',
    canonical: '/contact/',
    eyebrow: 'Get in touch',
    h1: 'Contact us',
    intro: 'Tell us what broke, what tool is missing, or where an explanation was unclear. Specific examples help us reproduce and fix problems quickly.',
    content: `<h2>Email</h2><p><a href="mailto:hello@letitedit.com">hello@letitedit.com</a></p><h2>What to include</h2><ul><li>The tool name and page URL.</li><li>Your browser and device type.</li><li>The exact input that caused a problem, if you are comfortable sharing it.</li><li>What you expected and what happened instead.</li></ul><h2>Privacy note</h2><p>Please do not email passwords, API keys or sensitive personal data. Our tools are designed to keep that information in your browser; email is not a secure channel for secrets.</p><h2>Response times</h2><p>We read every message but cannot promise an immediate reply. Bug reports with clear reproduction steps are prioritised.</p>`
  }),
  'privacy-policy/index.html': staticPage({
    title: 'Privacy Policy — LetitEdit',
    description: 'How LetitEdit handles data. Tool processing happens in your browser; no accounts, uploads or analytics are used by our tools.',
    canonical: '/privacy-policy/',
    eyebrow: 'Policies',
    h1: 'Privacy Policy',
    intro: 'This policy explains what information LetitEdit collects and how our browser-side tools handle your content.',
    content: `<h2>Last updated: 18 November 2026</h2><h2>Text and files</h2><p>Our text and developer tools run locally in your browser. Text you type or paste is processed in memory and is not transmitted by our tool code to a LetitEdit server. We do not store your text in a database or account.</p><h2>Logs and analytics</h2><p>We do not use advertising cookies, cross-site trackers or analytics scripts on LetitEdit pages. A hosting provider may keep ordinary server access logs such as IP address, browser user agent and requested URL for security and troubleshooting.</p><h2>Third-party resources</h2><p>Some preserved legacy tools may request fonts or libraries from third-party providers such as Google Fonts. Those providers may receive standard web request data such as your IP address. Our generated tools use local scripts and system fonts and do not require external processing services.</p><h2>Clipboard and downloads</h2><p>Copy and download buttons act only after you click them. Clipboard access is handled by the browser and is used solely to copy your own output.</p><h2>Children’s privacy</h2><p>LetitEdit is a general-audience tool site. We do not knowingly collect personal information from children.</p><h2>Changes</h2><p>We may update this policy when the site changes. The date at the top of this page always shows the latest version.</p><h2>Contact</h2><p>Privacy questions can be sent to <a href="mailto:hello@letitedit.com">hello@letitedit.com</a>.</p>`
  }),
  'terms-of-service/index.html': staticPage({
    title: 'Terms of Service — LetitEdit',
    description: 'The terms for using LetitEdit free online tools, including availability, acceptable use and tool output responsibility.',
    canonical: '/terms-of-service/',
    eyebrow: 'Policies',
    h1: 'Terms of Service',
    intro: 'These terms govern your use of LetitEdit.com. By using the site, you agree to the points below.',
    content: `<h2>Last updated: 18 November 2026</h2><h2>Free use</h2><p>Tools are provided free of charge for personal and business use. We may add, change or retire tools as the site develops.</p><h2>No guarantee of results</h2><p>Tool output depends on the input you provide and your browser’s supported features. Always review generated text, formatted output, diffs, conversions and regular-expression results before relying on them.</p><h2>Sensitive information</h2><p>Although processing happens in your browser, you remain responsible for what you paste into a tool and where you copy the output. Do not share secrets or personal data through unsupported channels.</p><h2>Acceptable use</h2><p>Do not attempt to disrupt the site, reverse-engineer services beyond normal browser use, or use the tools for illegal activity.</p><h2>Third-party links</h2><p>Links to third-party resources are provided for convenience. We are not responsible for their content or practices.</p><h2>Limitation of liability</h2><p>To the maximum extent permitted by law, LetitEdit is not liable for indirect or consequential losses arising from use of the tools or reliance on their output.</p><h2>Contact</h2><p>Questions about these terms can be sent to <a href="mailto:hello@letitedit.com">hello@letitedit.com</a>.</p>`
  })
};
Object.entries(staticPages).forEach(([file, data]) => write(file, data));

write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);

const sitemapUrls = ['/', '/tools/', '/categories/', '/new-tools/', '/news/', '/blog/', '/faq/',
  ...categories.map(category => category.path), '/about/', '/contact/', '/privacy-policy/', '/terms-of-service/'];
publishedTools.forEach(tool => sitemapUrls.push(tool.pageUrl));
['news', 'blog'].forEach(type => {
  const articles = type === 'news' ? content.news : content.blog;
  articles.forEach(article => sitemapUrls.push(`/${type}/${article.slug}/`));
});
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map(url => `  <url><loc>${xml(site + url)}</loc></url>`).join('\n')}\n</urlset>\n`;
write('sitemap.xml', sitemap);

console.log(`Built ${publishedTools.length} published tools across ${categories.length} categories, ${Object.keys(staticPages).length} static pages, 7 directory/content pages, search index, sidebar data and sitemap.`);
