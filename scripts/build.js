/* Static page generator for the content-only LetitEdit site.
 * Run with: node scripts/build.js
 * Generates the homepage, category theme, blog/news pages and core content.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../data/registry');
const content = require('../data/content');

const root = registry.root;
const site = registry.site;
const categories = registry.CATEGORIES;
const groups = registry.GROUPS;
const tools = registry.TOOLS;
const categoryByKey = registry.categoryByKey;
const groupLabel = key => {
  const group = groups.find(item => item.key === key);
  return group ? group.label : '';
};
const plannedToolCount = categories.reduce((total, category) => total + category.plannedTools.length, 0);

function write(relativePath, data) {
  const file = path.join(root, relativePath.replace(/^\/+/, ''));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, 'utf8');
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function xml(value) {
  return esc(value).replace(/&#39;/g, '&apos;');
}

const navSections = [
  { key: 'categories', label: 'Categories', href: '/categories/' },
  { key: 'blog', label: 'Blog', href: '/blog/' },
  { key: 'news', label: 'News', href: '/news/' },
  { key: 'faq', label: 'FAQ', href: '/faq/' }
];

function nav(active) {
  const links = navSections.map(section =>
    `<a href="${section.href}"${active === section.key ? ' aria-current="page"' : ''}>${esc(section.label)}</a>`
  ).join('\n      ');
  return `<header class="topbar">
  <nav class="nav" aria-label="Primary navigation">
    <a class="brand" href="/" aria-label="LetitEdit home"><span class="brand-mark" aria-hidden="true">L</span><span>LetitEdit</span></a>
    <div class="nav-links" id="primary-links">
      ${links}
    </div>
    <div class="nav-actions">
      <button class="search-button" type="button" data-search-open aria-haspopup="dialog" aria-controls="search-dialog">
        <span class="search-button-icon" aria-hidden="true">🔍</span><span class="search-button-label">Search</span>
      </button>
      <button class="menu-button" type="button" aria-controls="mobile-menu" aria-expanded="false">Menu</button>
    </div>
  </nav>
</header>`;
}

function mobileMenu(active) {
  const primary = navSections.map(section =>
    `<a href="${section.href}"${active === section.key ? ' aria-current="page"' : ''}>${esc(section.label)}</a>`
  ).join('\n        ');
  const categoryGroups = groups.map(group => `<details class="mobile-group">
        <summary><span>${esc(group.label)}</span><span class="mobile-group-count">${group.categories.length}</span></summary>
        <ul>
          ${group.categories.map(category =>
            `<li><a href="${category.path}"><span class="mobile-cat-icon" aria-hidden="true">${esc(category.icon)}</span><span>${esc(category.name)}</span></a></li>`
          ).join('\n          ')}
        </ul>
      </details>`).join('\n      ');
  return `<div class="mobile-menu" id="mobile-menu" hidden>
  <div class="mobile-menu-backdrop" data-menu-close></div>
  <div class="mobile-menu-panel" role="dialog" aria-modal="true" aria-label="Site menu">
    <div class="mobile-menu-head">
      <a class="brand" href="/" aria-label="LetitEdit home"><span class="brand-mark" aria-hidden="true">L</span><span>LetitEdit</span></a>
      <button class="icon-button" type="button" data-menu-close aria-label="Close menu">✕</button>
    </div>
    <button class="mobile-search" type="button" data-search-open aria-haspopup="dialog" aria-controls="search-dialog">
      <span aria-hidden="true">🔍</span><span>Search categories and tools</span>
    </button>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      <div class="mobile-primary">
        ${primary}
      </div>
      <p class="mobile-nav-title">All ${categories.length} categories</p>
      ${categoryGroups}
      <div class="mobile-secondary">
        <a href="/about/">About</a>
        <a href="/contact/">Contact</a>
        <a href="/privacy-policy/">Privacy</a>
        <a href="/terms-of-service/">Terms</a>
      </div>
    </nav>
  </div>
</div>`;
}

function searchDialog() {
  return `<div class="search-dialog" id="search-dialog" hidden>
  <div class="search-backdrop" data-search-close></div>
  <div class="search-panel" role="dialog" aria-modal="true" aria-labelledby="search-title">
    <div class="search-head">
      <h2 id="search-title">Search LetitEdit</h2>
      <button class="icon-button" type="button" data-search-close aria-label="Close search">✕</button>
    </div>
    <form class="search-form" role="search" data-search-form>
      <label class="visually-hidden" for="site-search">Search tools and categories</label>
      <input id="site-search" name="q" type="search" placeholder="Try “upscale”, “PDF” or “gradient”" autocomplete="off" enterkeyhint="search">
      <button class="btn btn-hero-primary" type="submit">Search</button>
    </form>
    <p class="search-hint">Search every category and planned tool. Published tools are marked separately once they go live.</p>
    <p class="search-status" role="status" aria-live="polite"></p>
    <div class="search-results" id="search-results"></div>
  </div>
</div>`;
}

function footer() {
  const categoryLinks = categories.map(category =>
    `<li><a href="${category.path}">${esc(category.name)}</a></li>`
  ).join('\n          ');
  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="footer-logo" href="/" aria-label="LetitEdit home"><span class="brand-mark" aria-hidden="true">L</span><span>LetitEdit</span></a>
        <p>A category-led home for guides, updates and carefully built browser-side tools. The tool library is being rebuilt one focused release at a time.</p>
        <a class="footer-contact" href="mailto:info@letitedit.com">info@letitedit.com</a>
      </div>
      <div class="footer-column">
        <h3>Explore</h3>
        <ul>
          <li><a href="/categories/">Categories</a></li>
          <li><a href="/blog/">Blog</a></li>
          <li><a href="/news/">News</a></li>
          <li><a href="/faq/">FAQ</a></li>
        </ul>
      </div>
      <div class="footer-column">
        <h3>Trust &amp; policies</h3>
        <ul>
          <li><a href="/about/">About LetitEdit</a></li>
          <li><a href="/contact/">Contact</a></li>
          <li><a href="/privacy-policy/">Privacy Policy</a></li>
          <li><a href="/terms-of-service/">Terms of Service</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-categories">
      <h3>All categories</h3>
      <ul class="footer-category-list">
        ${categoryLinks}
      </ul>
      <a class="footer-all-categories" href="/categories/">Browse all ${categories.length} categories →</a>
    </div>
    <div class="footer-promise">
      <span aria-hidden="true">🔒</span>
      <p><strong>Privacy by design.</strong> Future tools will keep files in your browser, avoid accounts and explain exactly what each result does.</p>
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
  const bodyClass = options.bodyClass ? ` class="${esc(options.bodyClass)}"` : '';
  const structured = options.structured
    ? `<script type="application/ld+json">\n${jsonForScript(options.structured)}\n</script>`
    : '';
  const ogImage = options.image
    ? `<meta property="og:image" content="${esc(site + options.image)}">`
    : '';
  const extraHead = options.extraHead || '';
  const extraScripts = (options.scripts || [])
    .map(src => `<script src="${esc(src)}"></script>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="${esc(options.lang || 'en')}" dir="${esc(options.dir || 'ltr')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<meta name="theme-color" content="#5C2DDD">
<link rel="canonical" href="${site}${options.canonical}">
<meta property="og:type" content="${options.ogType || 'website'}">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${site}${options.canonical}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary">
${ogImage}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%235c2ddd'/%3E%3Cpath d='M6 17V7h3l3 5 3-5h3v10' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${assets}css/site.css">
${extraHead}
${structured}
</head>
<body${bodyClass}>
<a class="skip-link" href="#main-content">Skip to main content</a>
${nav(options.activeNav)}
${mobileMenu(options.activeNav)}
${searchDialog()}
<div id="main-content">
${options.body}
</div>
${footer()}
<script src="${assets}js/search-index.js"></script>
<script src="${assets}js/site.js"></script>
${extraScripts}
</body>
</html>
`;
}

function breadcrumbs(assets, trail) {
  const parts = trail.map((item, index) => {
    const isLast = index === trail.length - 1;
    if (isLast) return `<span aria-current="page">${esc(item.label)}</span>`;
    const href = item.href.charAt(0) === '/' ? `${assets}${item.href.replace(/^\//, '')}` : `${assets}${item.href}`;
    return `<a href="${href}">${esc(item.label)}</a><span aria-hidden="true">/</span>`;
  }).join('\n  ');
  return `<nav class="container breadcrumbs" aria-label="Breadcrumb">\n  ${parts}\n</nav>`;
}

function breadcrumbStructured(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: item.href.charAt(0) === '/' ? `${site}${item.href}` : `${site}/${item.href}`
    }))
  };
}

function categoryTile(category, compact) {
  const planned = category.plannedTools.length;
  const meta = planned ? `${planned} planned` : 'Category ready';
  const terms = [category.name, category.shortLabel, category.slug, groupLabel(category.group)]
    .concat(category.plannedTools)
    .join(' ');
  return `<a class="category-tile${compact ? ' category-tile-compact' : ''}" href="${category.path}" data-category data-terms="${esc(terms)}" style="--icon-bg:${category.color}1a;--icon-color:${category.color}">
    <span class="tile-icon" aria-hidden="true">${esc(category.icon)}</span>
    <span class="tile-body"><span class="tile-name">${esc(compact ? category.shortLabel : category.name)}</span>${compact ? '' : `<span class="tile-meta">${esc(meta)}</span>`}</span>
    ${compact ? '' : '<span class="tile-arrow" aria-hidden="true">→</span>'}
  </a>`;
}

function categoryGroupBlock(group, compact, headingTag) {
  const tag = headingTag || 'h2';
  const tiles = group.categories.map(category => categoryTile(category, compact)).join('\n');
  return `<section class="category-group" data-category-group id="group-${group.key}">
    <div class="category-group-head">
      <${tag}>${esc(group.label)}</${tag}>
      <span>${group.categories.length} categories</span>
    </div>
    <div class="category-tile-grid${compact ? ' category-tile-grid-compact' : ''}">
      ${tiles}
    </div>
  </section>`;
}

function homepage() {
  const groupBlocks = groups.map(group => categoryGroupBlock(group, true, 'h3')).join('\n    ');
  const body = `<main>
<section class="hero">
  <div class="container hero-inner">
    <div class="hero-copy">
      <span class="eyebrow">${categories.length} categories · Guides · Updates</span>
      <h1>A clean home for<br><span class="gradient-text">browser tools.</span></h1>
      <p>LetitEdit now organises ${categories.length} clear categories, from photo editing to CAD and metadata. Browse the structure, search the planned tools and follow updates while real browser-side tools are published one at a time.</p>
      <form class="hero-search" role="search" data-search-form>
        <label class="visually-hidden" for="hero-search">Search tools and categories</label>
        <span class="hero-search-icon" aria-hidden="true">🔍</span>
        <input id="hero-search" name="q" type="search" placeholder="Search tools and categories" autocomplete="off" enterkeyhint="search">
        <button type="submit">Search</button>
      </form>
      <div class="hero-actions">
        <a class="btn btn-hero-primary" href="#categories">Browse categories</a>
        <a class="btn btn-hero-secondary" href="/blog/">Read the blog</a>
        <a class="btn btn-hero-text" href="/news/">Site updates →</a>
      </div>
      <ul class="hero-proof" aria-label="Site promises"><li>No sign-up</li><li>No uploads</li><li>${categories.length} categories</li></ul>
    </div>
    <aside class="hero-visual" aria-label="Site summary">
      <div class="hero-card">
        <div class="hero-card-head"><span class="hero-card-dot" aria-hidden="true"></span><span class="hero-card-title">Building in public</span><span class="hero-card-live">LIVE</span></div>
        <p class="hero-card-sub">A simpler, category-led site with room for carefully built tools.</p>
        <div class="hero-stat"><span>Categories</span><strong>${categories.length}</strong></div>
        <div class="hero-stat"><span>Tools live</span><strong>${tools.length}</strong></div>
        <div class="hero-stat"><span>Planned tools</span><strong>${plannedToolCount}</strong></div>
        <div class="hero-stat"><span>Accounts needed</span><strong>None</strong></div>
      </div>
    </aside>
  </div>
</section>

<section class="section" id="categories">
  <div class="container">
    <div class="section-head section-head-split">
      <div><span class="eyebrow">${categories.length} clear topics</span><h2>Browse by category</h2><p>Every category has its own page and permanent place in the structure. Grouped to make mobile browsing quicker.</p></div>
      <a class="text-link" href="/categories/">Category directory →</a>
    </div>
    <div class="category-groups">
    ${groupBlocks}
    </div>
  </div>
</section>

<section class="section section-soft">
  <div class="container">
    <div class="section-head"><span class="eyebrow">Tools</span><h2>One real tool is live</h2><p>The first published tool is a browser-side image editor. Planned tools stay labelled on their category pages; no placeholder editor is presented as working.</p></div>
    <div class="info-grid">
      ${tools.map(tool => `<a class="tool-card tool-card-feature" href="${tool.path}">
        <span class="tool-card-icon" aria-hidden="true">${esc(tool.icon)}</span>
        <span class="tool-card-body"><span class="tool-card-kicker">Live tool</span><strong>${esc(tool.name)}</strong><span>${esc(tool.intro)}</span></span>
        <span class="tool-card-arrow" aria-hidden="true">→</span>
      </a>`).join('\n      ')}
      <div class="info-card"><h2>What is planned</h2><p>${plannedToolCount} tools are planned across the categories. Each stays marked Planned until it has a real workspace, documented limits and checks.</p><a class="text-link" href="/categories/">Browse the directory →</a></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container info-grid">
    <div class="info-card"><h2>Blog</h2><p>Notes about browser-side processing, privacy and how each category will grow.</p><a class="btn btn-secondary btn-small" href="/blog/">Open Blog</a></div>
    <div class="info-card"><h2>News</h2><p>Site announcements and rebuild updates will be published here with dates and clear summaries.</p><a class="btn btn-secondary btn-small" href="/news/">Open News</a></div>
  </div>
</section>

<section class="section section-soft">
  <div class="container info-grid">
    <div class="info-card"><h2>What comes next</h2><p>New tools will be introduced one at a time, with a real workspace, documented behaviour and honest limits before each page goes live.</p></div>
    <div class="info-card"><h2>How we handle data</h2><p>Privacy remains the default. Future browser-side tools will keep input on your device unless a page clearly explains an external requirement.</p></div>
  </div>
</section>
</main>`;
  return page({
    title: 'LetitEdit — Categories, Guides and Browser Tool Updates',
    description: `Explore ${categories.length} LetitEdit categories, guides and updates while the next generation of private browser-side tools is prepared.`,
    canonical: '/',
    body,
    structured: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'LetitEdit',
      url: site,
      description: 'A category-led home for browser-side tools, guides and updates.'
    }
  });
}

function categoriesPage() {
  const assets = '../';
  const groupBlocks = groups.map(group => categoryGroupBlock(group, false, 'h2')).join('\n    ');
  const jumpLinks = groups.map(group =>
    `<a href="#group-${group.key}">${esc(group.label)} <span aria-hidden="true">${group.categories.length}</span></a>`
  ).join('\n      ');
  const body = `${breadcrumbs(assets, [{ label: 'Home', href: '/' }, { label: 'Categories', href: '/categories/' }])}
<section class="container page-head">
  <span class="eyebrow">Category directory</span>
  <h1>Categories</h1>
  <p>All ${categories.length} LetitEdit categories, grouped by discipline. Filter the directory below, or search from any page, to find the right editor quickly.</p>
  <form class="directory-search" role="search" data-directory-form>
    <label class="visually-hidden" for="directory-search">Filter categories</label>
    <span class="directory-search-icon" aria-hidden="true">🔍</span>
    <input id="directory-search" type="search" placeholder="Filter categories and planned tools" autocomplete="off" data-directory-search>
  </form>
  <nav class="group-jump" aria-label="Category groups">
      ${jumpLinks}
  </nav>
  <p class="directory-status" role="status" aria-live="polite" data-directory-status>Showing ${categories.length} of ${categories.length} categories</p>
</section>
<section class="section section-tight"><div class="container">
  <div class="category-groups category-groups-full">
    ${groupBlocks}
  </div>
  <div class="empty-state" data-directory-empty hidden>
    <span class="empty-icon" aria-hidden="true">🔍</span>
    <h3>No category matches that filter</h3>
    <p>Try a broader word such as “photo”, “PDF” or “design”, or clear the filter.</p>
  </div>
</div></section>`;
  return page({
    title: `All ${categories.length} Categories — LetitEdit`,
    description: `Browse all ${categories.length} LetitEdit categories for image, video, audio, documents, design, code, 3D, data and publishing tools.`,
    canonical: '/categories/',
    activeNav: 'categories',
    assets,
    body
  });
}

function categoryPage(category) {
  const assets = '../../';
  const trail = [
    { label: 'Home', href: '/' },
    { label: 'Categories', href: '/categories/' },
    { label: category.name, href: category.path }
  ];
  const related = category.related
    .map(key => categoryByKey.get(key))
    .filter(Boolean);
  const relatedList = related.length
    ? `<ul class="related-list">${related.map(item => `<li><a href="${item.path}"><span class="related-icon" aria-hidden="true">${esc(item.icon)}</span><span>${esc(item.name)}</span></a></li>`).join('')}</ul>`
    : '<p>Related categories will be added here as the site grows.</p>';
  const categoryTools = registry.toolsForCategory(category.key);
  const published = categoryTools.length
    ? `<div class="info-card published-card" id="published-tools">
      <div class="info-card-head"><h2>Published tools</h2><span class="badge badge-live">Live</span></div>
      <p>These tools are live and work in your browser. Each one has its own page, documentation and documented limits.</p>
      <div class="tool-card-list">
        ${categoryTools.map(tool => `<a class="tool-card" href="${tool.path}">
          <span class="tool-card-icon" aria-hidden="true">${esc(tool.icon)}</span>
          <span class="tool-card-body"><strong>${esc(tool.name)}</strong><span>${esc(tool.description)}</span></span>
          <span class="tool-card-arrow" aria-hidden="true">→</span>
        </a>`).join('\n        ')}
      </div>
    </div>`
    : '';
  const planned = category.plannedTools.length
    ? `<div class="info-card planned-card" id="planned-tools">
      <div class="info-card-head"><h2>Planned tools</h2><span class="badge">Planned</span></div>
      <p>These tools are planned for this category. They are not published, and no placeholder editor is available yet.</p>
      <label class="filter-label" for="tool-filter">Filter this list</label>
      <input class="filter-input" id="tool-filter" type="search" placeholder="Filter planned tools…" autocomplete="off" data-filter-input>
      <ul class="tool-chip-list" data-filter-list>
        ${category.plannedTools.map(tool => `<li class="tool-chip" data-filter-item><span class="tool-chip-name">${esc(tool)}</span><span class="tool-chip-state">Planned</span></li>`).join('\n        ')}
      </ul>
      <p class="filter-empty" data-filter-empty hidden>No planned tool matches that filter.</p>
    </div>`
    : (categoryTools.length
      ? ''
      : `<div class="info-card"><h2>Tool status</h2><p>No tools are published in this category yet. The page stays structural until a real tool is ready.</p></div>`);
  const body = `${breadcrumbs(assets, trail)}
<section class="container page-head" dir="${esc(category.dir)}">
  <span class="eyebrow" style="color:${esc(category.color)}">${esc(category.shortLabel)}</span>
  <h1>${esc(category.name)}</h1>
  <p>${esc(category.intro)}</p>
</section>
<section class="section"><div class="container category-layout">
  <div class="category-main">
    <div class="info-card">
      <h2>About ${esc(category.name)}</h2>
      <p>${esc(category.description)}</p>
      <p>This category is part of the permanent LetitEdit taxonomy. ${categoryTools.length
        ? 'The published tools below are live; planned tools remain clearly labelled.'
        : 'No tools are published here yet.'}</p>
    </div>
    ${published}
    ${planned}
  </div>
  <aside class="category-side">
    <div class="info-card">
      <h2>Nearby categories</h2>
      ${relatedList}
      <p><a class="text-link" href="/categories/">See all ${categories.length} categories →</a></p>
    </div>
    <div class="info-card">
      <h2>Follow the rebuild</h2>
      <p>Read the blog for notes about privacy, browser-side processing and the next releases.</p>
      <a class="btn btn-secondary btn-small" href="${assets}blog/">Read the blog</a>
    </div>
  </aside>
</div></section>`;
  return page({
    title: category.seoTitle,
    description: category.seoDescription,
    canonical: category.path,
    dir: category.dir,
    activeNav: 'categories',
    assets,
    body,
    structured: {
      '@context': 'https://schema.org',
      '@graph': [breadcrumbStructured(trail)]
    }
  });
}

function toolPage(tool) {
  const assets = '../../';
  const category = categoryByKey.get(tool.categoryKey);
  const trail = [
    { label: 'Home', href: '/' },
    { label: 'Categories', href: '/categories/' },
    { label: category.name, href: category.path },
    { label: tool.name, href: tool.path }
  ];

  const editorTools = [
    { key: 'import', label: 'Import', icon: 'open' },
    { key: 'crop', label: 'Crop', icon: 'crop' },
    { key: 'resize', label: 'Resize', icon: 'resize' },
    { key: 'adjust', label: 'Adjust', icon: 'adjust' },
    { key: 'filters', label: 'Filters', icon: 'filter' },
    { key: 'blur', label: 'Blur', icon: 'blur' },
    { key: 'text', label: 'Text', icon: 'text' },
    { key: 'shapes', label: 'Shapes', icon: 'shapes' },
    { key: 'draw', label: 'Draw', icon: 'draw' },
    { key: 'frame', label: 'Frame', icon: 'frame' },
    { key: 'layers', label: 'Layers', icon: 'layers' },
    { key: 'export', label: 'Export', icon: 'export' }
  ];
  const railButtons = editorTools.map(item => `<button class="editor-tool-button" type="button" data-tool="${item.key}" aria-pressed="false" title="${esc(item.label)}" aria-label="${esc(item.label)}"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-${item.icon}"></use></svg><span>${esc(item.label)}</span></button>`).join('\n          ');
  const mobileButtons = editorTools.filter(item => item.key !== 'export').map(item => `<button class="editor-mobile-tool" type="button" data-tool="${item.key}" aria-pressed="false" aria-label="${esc(item.label)}"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-${item.icon}"></use></svg><span>${esc(item.label)}</span></button>`).join('\n        ');

  const faqs = [
    ['Does the editor upload my image?', 'No. Import, editing and export run in your browser with the Canvas API. Your image is not sent to LetitEdit or a third-party service.'],
    ['Which formats can I open?', 'JPG, PNG, WebP, GIF, BMP and SVG are handled by the browser. AVIF depends on browser support. TIFF uses a bundled decoder. HEIC/HEIF uses a bundled decoder where the browser cannot open it natively.'],
    ['Which formats can I export?', 'JPG, PNG, WebP and BMP are always available. AVIF export appears only when the browser provides a working AVIF encoder.'],
    ['Can I keep transparency?', 'Yes, with PNG or WebP. JPG and BMP do not support transparency, so the editor fills transparent areas with white for those formats.'],
    ['Can I guarantee an exact file size?', 'No. The editor can target a size for JPG and WebP and will report the real output size, but encoders cannot guarantee an exact byte count.'],
    ['Does it correct EXIF rotation?', 'Yes. The editor reads the JPEG EXIF orientation value and applies the correct rotation before editing.'],
    ['Does background removal use AI?', 'No segmentation model is bundled. Background removal is not advertised as working; the editor reports that limitation instead of showing a fake result.'],
    ['Can I edit on a phone?', 'Yes. The mobile workspace uses a large preview, a bottom tool bar and bottom-sheet controls. The editor is tested from 320px wide and in landscape.']
  ];
  const faqHtml = faqs.map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ');
  const faqStructured = {
    '@type': 'FAQPage',
    mainEntity: faqs.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a }
    }))
  };

  const body = `${breadcrumbs(assets, trail)}
<section class="tool-hero">
  <div class="container">
    <span class="eyebrow">Media &amp; Motion · Live tool</span>
    <h1>Image &amp; Photo Editor</h1>
    <p>Edit, crop, resize, compress and convert images in your browser. Add text, shapes and layers, compare before and after, then download the finished file. Nothing is uploaded.</p>
    <ul class="tool-hero-points">
      <li>Browser-side processing</li>
      <li>No account needed</li>
      <li>JPG, PNG, WebP, BMP export</li>
      <li>Undo, redo and layers</li>
    </ul>
  </div>
</section>

<section class="editor-section" aria-label="Image editor workspace">
  <div class="container editor-container">
    <div class="editor-shell" id="photo-editor" data-editor>
      <svg class="editor-sprite" aria-hidden="true" focusable="false">
        <symbol id="ed-icon-open" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></symbol>
        <symbol id="ed-icon-crop" viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></symbol>
        <symbol id="ed-icon-resize" viewBox="0 0 24 24"><path d="M4 20 20 4"/><path d="M4 14v6h6"/><path d="M20 10V4h-6"/></symbol>
        <symbol id="ed-icon-adjust" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></symbol>
        <symbol id="ed-icon-filter" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/><path d="M11 8v6M8 11h6"/></symbol>
        <symbol id="ed-icon-blur" viewBox="0 0 24 24"><path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10Z"/><path d="M9 14a3 3 0 0 0 3 3"/></symbol>
        <symbol id="ed-icon-text" viewBox="0 0 24 24"><path d="M4 5h16M12 5v14M8 19h8"/></symbol>
        <symbol id="ed-icon-shapes" viewBox="0 0 24 24"><rect x="3" y="3" width="10" height="10" rx="2"/><circle cx="16" cy="16" r="5"/></symbol>
        <symbol id="ed-icon-draw" viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="m14 7 3 3"/></symbol>
        <symbol id="ed-icon-frame" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/></symbol>
        <symbol id="ed-icon-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></symbol>
        <symbol id="ed-icon-export" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></symbol>
        <symbol id="ed-icon-undo" viewBox="0 0 24 24"><path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/></symbol>
        <symbol id="ed-icon-redo" viewBox="0 0 24 24"><path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6v1"/></symbol>
        <symbol id="ed-icon-zoom-in" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/><path d="M11 8v6M8 11h6"/></symbol>
        <symbol id="ed-icon-zoom-out" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/><path d="M8 11h6"/></symbol>
        <symbol id="ed-icon-before" viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></symbol>
        <symbol id="ed-icon-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
        <symbol id="ed-icon-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></symbol>
        <symbol id="ed-icon-copy" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol>
        <symbol id="ed-icon-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></symbol>
        <symbol id="ed-icon-eye-off" viewBox="0 0 24 24"><path d="m3 3 18 18"/><path d="M10.6 6.2A11.7 11.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.2 6.7A16.7 16.7 0 0 0 2 12s3.5 6 10 6a11 11 0 0 0 4.1-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>
        <symbol id="ed-icon-lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></symbol>
        <symbol id="ed-icon-unlock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/></symbol>
        <symbol id="ed-icon-up" viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></symbol>
        <symbol id="ed-icon-down" viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"/></symbol>
        <symbol id="ed-icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
        <symbol id="ed-icon-image" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 4 4"/></symbol>
        <symbol id="ed-icon-rotate-left" viewBox="0 0 24 24"><path d="M4 4v6h6"/><path d="M5.5 15a8 8 0 1 0 1.7-8.4L4 10"/></symbol>
        <symbol id="ed-icon-rotate-right" viewBox="0 0 24 24"><path d="M20 4v6h-6"/><path d="M18.5 15a8 8 0 1 1-1.7-8.4L20 10"/></symbol>
        <symbol id="ed-icon-flip-h" viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M9 7 4 12l5 5Z"/><path d="m15 7 5 5-5 5Z"/></symbol>
        <symbol id="ed-icon-flip-v" viewBox="0 0 24 24"><path d="M3 12h18"/><path d="M7 9 12 4l5 5Z"/><path d="m7 15 5 5 5-5Z"/></symbol>
        <symbol id="ed-icon-rail" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></symbol>
        <symbol id="ed-icon-panel" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></symbol>
      </svg>

      <div class="editor-topbar">
        <div class="editor-topbar-group editor-topbar-file">
          <button class="editor-icon-button editor-rail-toggle" type="button" data-toggle-rail aria-label="Toggle tool rail" title="Toggle tool rail"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-rail"></use></svg></button>
          <button class="editor-icon-button" type="button" data-action="browse" aria-label="Open image" title="Open image"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-open"></use></svg></button>
          <span class="editor-file-name" data-file-name>No image open</span>
        </div>
        <div class="editor-topbar-group">
          <button class="editor-icon-button" type="button" data-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-undo"></use></svg></button>
          <button class="editor-icon-button" type="button" data-action="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-redo"></use></svg></button>
        </div>
        <div class="editor-topbar-group editor-zoom-group">
          <button class="editor-icon-button" type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-zoom-out"></use></svg></button>
          <button class="editor-zoom-fit" type="button" data-zoom="fit" title="Fit to screen">Fit</button>
          <span class="editor-zoom-label" data-zoom-label>100%</span>
          <button class="editor-icon-button" type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-zoom-in"></use></svg></button>
        </div>
        <div class="editor-topbar-group">
          <button class="editor-compare-button" type="button" data-action="compare" aria-pressed="false" title="Hold or toggle to compare with the original"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-before"></use></svg><span>Before</span></button>
          <button class="editor-primary-button" type="button" data-action="export">Export</button>
        </div>
      </div>

      <div class="editor-workspace">
        <aside class="editor-rail" data-rail aria-label="Editing tools">
          ${railButtons}
        </aside>
        <main class="editor-stage" data-stage>
          <div class="editor-canvas-scroll" data-canvas-scroll>
            <canvas class="editor-canvas" data-canvas aria-label="Image editing preview" tabindex="0"></canvas>
            <div class="editor-drop-overlay" data-drop-overlay hidden>
              <div><strong>Drop an image to open it</strong><span>JPG, PNG, WebP, GIF, BMP, SVG, TIFF, HEIC or AVIF</span></div>
            </div>
          </div>
          <div class="editor-statusbar">
            <span data-status-left>No image open. Choose a file or drop one here.</span>
            <span data-status-right>Local processing</span>
          </div>
        </main>
        <div class="editor-panel-resizer" data-panel-resizer hidden aria-hidden="true"></div>
        <aside class="editor-panel" data-panel aria-label="Tool settings">
          <div class="editor-panel-head">
            <h2 data-panel-title>Import</h2>
            <button class="editor-icon-button" type="button" data-panel-close aria-label="Close settings panel" title="Close settings panel"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-close"></use></svg></button>
          </div>
          <div class="editor-panel-body" data-panel-body></div>
        </aside>
      </div>

      <nav class="editor-mobilebar" aria-label="Editor tools">
        ${mobileButtons}
        <button class="editor-mobile-tool editor-mobile-export" type="button" data-action="export" aria-label="Export image"><svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-export"></use></svg><span>Export</span></button>
      </nav>
      <div class="editor-sheet-backdrop" data-sheet-backdrop hidden></div>
      <input type="file" hidden data-file-input accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/avif,image/heic,image/heif,image/svg+xml,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.avif,.heic,.heif,.svg">
      <input type="file" hidden data-bg-input accept="image/*">
      <input type="file" hidden data-layer-input accept="image/*">
      <div class="editor-toast" data-toast role="status" aria-live="polite" hidden></div>
      <div class="editor-progress" data-progress hidden><div class="editor-progress-track"><div class="editor-progress-bar" data-progress-bar></div></div><span data-progress-label>Working…</span></div>
    </div>
  </div>
</section>

<section class="section tool-content">
  <div class="container tool-content-layout">
    <article class="article-card tool-article">
      <span class="eyebrow">Guide</span>
      <h2>How to edit an image in your browser</h2>
      <p>Open a file with the Import button or drag it onto the canvas. The editor reads the image locally, shows its dimensions and type, and keeps the original untouched until you export. Choose a tool on the left (desktop) or in the bottom bar (mobile), make the change, and use Undo if you change your mind.</p>
      <ol>
        <li><strong>Open:</strong> choose JPG, PNG, WebP, GIF, BMP, SVG, TIFF, HEIC or AVIF. Support depends on the browser and the bundled decoders.</li>
        <li><strong>Edit:</strong> crop, resize, rotate, adjust colour, apply a filter, add text, shapes or a drawing, or build the image from layers.</li>
        <li><strong>Check:</strong> use Fit, zoom, pan and the Before button to compare the result with the original.</li>
        <li><strong>Export:</strong> pick a format, quality and filename, check the real output size, then download.</li>
      </ol>

      <h2>Crop, resize and export the right dimensions</h2>
      <p>Crop changes what part of the image is kept. Resize changes the pixel dimensions of the cropped result. Frame adds padding, a background, rounded corners, a border or a shadow. The export panel shows the final dimensions after all three stages, so check it before downloading.</p>
      <p>Use the ratio presets for common work: 1:1 for profile images and square posts, 4:5 and 9:16 for social stories, 16:9 for video thumbnails, and 3:2 or 4:3 for photography. The editor keeps the crop rectangle inside the image and lets you reset it at any time.</p>

      <h2>Compress and convert without guessing</h2>
      <p>JPG and WebP use a quality setting. Lower quality makes smaller files but can add visible artifacts. PNG is lossless and ignores the quality slider, so use it when transparency or exact pixels matter. BMP is available for compatibility but produces large files. AVIF export appears only when the browser exposes a working AVIF encoder.</p>
      <p>The size estimate is approximate. If you set a target size, the editor tries several quality levels and reports the closest real result. It never promises an exact byte count that the encoder cannot guarantee.</p>

      <h2>Supported formats and honest limits</h2>
      <table class="tool-table">
        <thead><tr><th>Format</th><th>Open</th><th>Export</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>JPG / JPEG</td><td>Yes</td><td>Yes</td><td>Lossy, no transparency, EXIF orientation corrected.</td></tr>
          <tr><td>PNG</td><td>Yes</td><td>Yes</td><td>Lossless, transparency supported.</td></tr>
          <tr><td>WebP</td><td>Yes</td><td>Yes</td><td>Lossy or lossless, transparency supported.</td></tr>
          <tr><td>GIF</td><td>Yes</td><td>No</td><td>First frame only; animation is not preserved.</td></tr>
          <tr><td>BMP</td><td>Yes</td><td>Yes</td><td>Large uncompressed output.</td></tr>
          <tr><td>SVG</td><td>Yes</td><td>No</td><td>Sanitised and rasterised on import.</td></tr>
          <tr><td>TIFF</td><td>Yes</td><td>No</td><td>Decoded locally with UTIF.js.</td></tr>
          <tr><td>HEIC / HEIF</td><td>Yes*</td><td>No</td><td>*Decoded locally with heic2any when the browser cannot open it.</td></tr>
          <tr><td>AVIF</td><td>Browser dependent</td><td>Browser dependent</td><td>The option is disabled when the browser has no encoder.</td></tr>
        </tbody>
      </table>

      <h2>Layers, text and shapes</h2>
      <p>Text, shapes, drawings and added images are separate layers. Move, resize, rotate, hide, lock, duplicate, rename or reorder them without flattening the original. The export is flattened only at the final step. Text uses the browser’s font shaping, including Unicode, Arabic and other RTL scripts; choose the direction in the Text panel when automatic detection is not enough.</p>

      <h2>Privacy: your image stays on your device</h2>
      <p>All editing and encoding happens in the browser with the Canvas API, Web Workers and local decoders. No image is uploaded to LetitEdit. The page does not require an account. If a future feature needs a server, it will be disclosed before the file leaves your device. No advertising code is placed over the editing canvas.</p>

      <h2>Common problems</h2>
      <h3>A HEIC file will not open</h3>
      <p>The HEIC decoder is loaded on demand. Very large or unusual HEIC files may still fail. Export the image as JPG or PNG from your phone or camera app, then open that file here.</p>
      <h3>AVIF export is missing</h3>
      <p>Your browser does not expose an AVIF encoder. Choose WebP or JPG instead. The editor disables options it cannot genuinely produce.</p>
      <h3>The exported file is larger than expected</h3>
      <p>PNG and BMP are lossless. Use JPG or WebP, lower the quality, or reduce the dimensions. The export panel reports the actual size after encoding.</p>
      <h3>Transparent areas became white</h3>
      <p>JPG and BMP cannot store transparency. Use PNG or WebP to keep it.</p>

      <h2>Frequently asked questions</h2>
      ${faqHtml}
    </article>
    <aside class="tool-side">
      <div class="info-card">
        <h2>Tool facts</h2>
        <ul class="tool-facts">
          <li><strong>Processing</strong><span>In your browser</span></li>
          <li><strong>Uploads</strong><span>None</span></li>
          <li><strong>Account</strong><span>Not required</span></li>
          <li><strong>Export</strong><span>JPG, PNG, WebP, BMP, AVIF*</span></li>
          <li><strong>Mobile</strong><span>320px and up</span></li>
        </ul>
        <p class="tool-side-note">*AVIF only where the browser provides an encoder.</p>
      </div>
      <div class="info-card">
        <h2>Related categories</h2>
        <ul class="related-list">
          <li><a href="/categories/image-photo-editing/"><span class="related-icon" aria-hidden="true">🖼️</span><span>Image &amp; Photo Editing</span></a></li>
          <li><a href="/categories/face-portrait-editing/"><span class="related-icon" aria-hidden="true">🧑</span><span>Face &amp; Portrait Editing</span></a></li>
          <li><a href="/categories/ai-image-enhancement-restoration/"><span class="related-icon" aria-hidden="true">✨</span><span>AI Image Enhancement &amp; Restoration</span></a></li>
          <li><a href="/categories/social-media-design-tools/"><span class="related-icon" aria-hidden="true">📱</span><span>Social Media Design Tools</span></a></li>
          <li><a href="/categories/graphic-design-creative-editing/"><span class="related-icon" aria-hidden="true">🎨</span><span>Graphic Design &amp; Creative Editing</span></a></li>
        </ul>
        <a class="text-link" href="/categories/">All 28 categories →</a>
      </div>
      <div class="info-card">
        <h2>Before you publish</h2>
        <p>Check the exported file on the device and platform where it will be used. Social networks re-compress images, so a sharp local export can still change after upload.</p>
      </div>
    </aside>
  </div>
</section>`;

  return page({
    title: tool.title,
    description: tool.description,
    canonical: tool.path,
    activeNav: 'categories',
    assets,
    bodyClass: 'tool-page',
    extraHead: `<link rel="stylesheet" href="../../css/editor.css">`,
    scripts: ['../../js/image-processing.js', '../../js/editor.js'],
    body,
    structured: {
      '@context': 'https://schema.org',
      '@graph': [
        breadcrumbStructured(trail),
        {
          '@type': 'SoftwareApplication',
          name: tool.name,
          applicationCategory: 'MultimediaApplication',
          operatingSystem: 'Any modern browser',
          url: site + tool.path,
          description: tool.description,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          featureList: [
            'Crop, resize and rotate images',
            'Colour adjustments and filters',
            'Text, shapes, drawings and layers',
            'JPG, PNG, WebP, BMP export',
            'Local browser-side processing'
          ]
        },
        faqStructured
      ]
    }
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
    ? 'Announcements and rebuild updates will appear here. No news has been published yet.'
    : 'Notes about browser-side processing, privacy and the site categories.'}</p>
</section>
<section class="section"><div class="container">
  ${items.length ? `<div class="grid article-grid">${cards}</div>`
    : `<div class="empty-state"><span class="empty-icon" aria-hidden="true">📭</span><h3>${isNews ? 'No news yet' : 'No articles yet'}</h3><p>${isNews
      ? 'When there is a real update to share, it will be published here with a title, date, summary and SEO metadata.'
      : 'When a guide is written, it will be published here with categories, tags and SEO metadata.'}</p></div>`}
</div></section>`;
  return page({
    title: isNews ? 'News — LetitEdit Updates' : 'Blog — LetitEdit Guides',
    description: isNews
      ? 'LetitEdit news and announcements about the site rebuild and future browser-side tools.'
      : 'LetitEdit articles and guides about browser-side processing, privacy and the site categories.',
    canonical: base,
    activeNav: type,
    assets,
    body
  });
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
  <p class="article-meta"><time datetime="${esc(article.date)}">${esc(article.date)}</time>${article.author ? ` · ${esc(article.author)}` : ''}</p>
</section>
<section class="section"><div class="container"><article class="article-card">
  ${article.image ? `<img src="${esc(article.image)}" alt="" loading="lazy">` : ''}
  ${(article.body || []).map(section => `<h2>${esc(section.heading)}</h2>
    ${(section.paragraphs || []).map(paragraph => `<p>${esc(paragraph)}</p>`).join('\n    ')}`).join('\n    ')}
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
    ${items.map(faq => `<details class="faq-item">
      <summary>${esc(faq.q)}</summary>
      <p>${esc(faq.a)}</p>
    </details>`).join('')}
  </section>`).join('');
  const assets = '../';
  const body = `${breadcrumbs(assets, [{ label: 'Home', href: '/' }, { label: 'FAQ', href: '/faq/' }])}
<section class="container page-head">
  <span class="eyebrow">Help centre</span>
  <h1>Frequently Asked Questions</h1>
  <p>Short answers about the category structure, privacy and how future browser-side tools will be added. Questions expand on click or with the keyboard.</p>
</section>
<section class="section"><div class="container faq-groups">${groups}</div></section>`;
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: content.faq.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a }
    }))
  };
  return page({
    title: 'FAQ — LetitEdit Questions and Answers',
    description: 'Answers about browser-side processing, privacy, accounts, mobile use and how new tools will be added to LetitEdit.',
    canonical: '/faq/',
    activeNav: 'faq',
    assets,
    body,
    structured
  });
}

function staticPage(options) {
  const assets = options.assets || '../';
  return page({
    title: options.title,
    description: options.description,
    canonical: options.canonical,
    assets,
    activeNav: options.activeNav,
    body: `${breadcrumbs(assets, options.trail || [{ label: 'Home', href: '/' }, { label: options.h1, href: options.canonical }])}
<section class="container page-head">
  <span class="eyebrow">${esc(options.eyebrow)}</span>
  <h1>${esc(options.h1)}</h1>
  <p>${esc(options.intro)}</p>
</section>
<section class="section"><div class="container"><article class="article-card">${options.content}</article></div></section>`
  });
}

function notFoundPage() {
  const body = `<main>
<section class="container page-head">
  <span class="eyebrow">404</span>
  <h1>Page not found</h1>
  <p>The page you requested is not part of the content-only site. The old tool library has been removed.</p>
  <div class="hero-actions">
    <a class="btn btn-hero-primary" href="/">Go to the homepage</a>
    <a class="btn btn-hero-secondary" href="/categories/">Browse categories</a>
  </div>
</section>
</main>`;
  return page({
    title: 'Page not found — LetitEdit',
    description: 'The requested page is not available on the content-only LetitEdit site.',
    canonical: '/404.html',
    body
  });
}

/* ---------- Generate the content-only site ---------- */

write('index.html', homepage());
write('categories/index.html', categoriesPage());
write('news/index.html', listingPage('news'));
write('blog/index.html', listingPage('blog'));
write('faq/index.html', faqPage());

categories.forEach(category => {
  write(`${category.path.replace(/^\//, '')}index.html`, categoryPage(category));
});

tools.forEach(tool => {
  write(`${tool.path.replace(/^\//, '')}index.html`, toolPage(tool));
});

['news', 'blog'].forEach(type => {
  const articles = type === 'news' ? content.news : content.blog;
  articles.forEach(article => write(`${type}/${article.slug}/index.html`, articlePage(article, type)));
});

const staticPages = {
  'about/index.html': staticPage({
    title: 'About LetitEdit — categories, guides and browser tools',
    description: 'Learn how LetitEdit is organised and why the next generation of tools will stay private, focused and browser-side.',
    canonical: '/about/',
    eyebrow: 'About the project',
    h1: 'A simpler, category-led LetitEdit',
    intro: 'LetitEdit is being rebuilt around nine clear categories. The site keeps its structure while new browser-side tools are prepared and published one at a time.',
    content: `<h2>Categories first</h2><p>The taxonomy is stable: image, video, audio, documents, writing, design, code, diagrams and utilities. Each category has a permanent page and a clear purpose.</p><h2>Private by design</h2><p>Where a tool can run in the browser, input will stay on your device. Every future tool page will explain exactly what happens to your text or files and will document its limits.</p><h2>Honest publishing</h2><p>No empty workspace, placeholder result or invented article will be presented as finished. New tools will appear only after real functionality, documentation and checks are in place.</p><h2>Contact</h2><p>Questions and corrections are welcome on the <a href="/contact/">Contact page</a>.</p>`
  }),
  'contact/index.html': staticPage({
    title: 'Contact LetitEdit — feedback and suggestions',
    description: 'Contact LetitEdit about the site structure, an article, a correction or a suggestion for a future browser-side tool.',
    canonical: '/contact/',
    eyebrow: 'Get in touch',
    h1: 'Contact us',
    intro: 'Tell us what was unclear, what should be improved or which category needs attention first.',
    content: `<h2>Email</h2><p><a href="mailto:info@letitedit.com">info@letitedit.com</a></p><h2>What to include</h2><ul><li>The page URL or category name.</li><li>What you expected to find.</li><li>A short description of the issue or suggestion.</li></ul><h2>Privacy note</h2><p>Please do not email passwords, API keys or sensitive personal data. Email is not a secure channel for secrets.</p>`
  }),
  'privacy-policy/index.html': staticPage({
    title: 'Privacy Policy — LetitEdit',
    description: 'How LetitEdit handles data on its category, guide and content pages.',
    canonical: '/privacy-policy/',
    eyebrow: 'Policies',
    h1: 'Privacy Policy',
    intro: 'This policy explains what information LetitEdit collects while you browse the site.',
    content: `<h2>Last updated: 21 November 2026</h2><h2>Content pages</h2><p>Category, blog, news and FAQ pages are static content. They do not ask you to create an account and they do not collect text or files.</p><h2>Logs and analytics</h2><p>We do not place advertising cookies or cross-site tracking scripts on these pages. A hosting provider may keep ordinary server access logs such as IP address, browser user agent and requested URL for security and troubleshooting.</p><h2>Third-party resources</h2><p>The content-only site uses local styles and system fonts. Future tool pages will disclose any third-party resource before it is used.</p><h2>Contact</h2><p>Privacy questions can be sent to <a href="mailto:info@letitedit.com">info@letitedit.com</a>.</p>`
  }),
  'terms-of-service/index.html': staticPage({
    title: 'Terms of Service — LetitEdit',
    description: 'The terms for using the LetitEdit website and future browser-side tools.',
    canonical: '/terms-of-service/',
    eyebrow: 'Policies',
    h1: 'Terms of Service',
    intro: 'These terms govern your use of LetitEdit.com.',
    content: `<h2>Last updated: 21 November 2026</h2><h2>Site content</h2><p>Categories, guides and updates are provided for general information. We may add, change or remove content as the site develops.</p><h2>Future tools</h2><p>Tools will be introduced with their own documented behaviour and limits. Review those instructions before relying on any output.</p><h2>Acceptable use</h2><p>Do not attempt to disrupt the site or use it for unlawful activity.</p><h2>Third-party links</h2><p>Links to third-party resources are provided for convenience. We are not responsible for their content or practices.</p><h2>Contact</h2><p>Questions about these terms can be sent to <a href="mailto:info@letitedit.com">info@letitedit.com</a>.</p>`
  })
};
Object.entries(staticPages).forEach(([file, data]) => write(file, data));
write('404.html', notFoundPage());

write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);

const searchIndex = {
  generated: new Date().toISOString().slice(0, 10),
  categories: categories.map(category => ({
    name: category.name,
    short: category.shortLabel,
    path: category.path,
    icon: category.icon,
    group: groupLabel(category.group),
    description: category.description,
    planned: category.plannedTools
  })),
  tools: tools.map(tool => ({
    name: tool.name,
    path: tool.path,
    icon: tool.icon,
    category: categoryByKey.get(tool.categoryKey).name,
    description: tool.description,
    keywords: tool.keywords
  }))
};
write('js/search-index.js', `/* Generated by scripts/build.js. Do not edit by hand. */\nwindow.LETITEDIT_SEARCH = ${JSON.stringify(searchIndex)};\n`);

const sitemapUrls = ['/', '/categories/', '/news/', '/blog/', '/faq/',
  ...categories.map(category => category.path),
  ...tools.map(tool => tool.path),
  '/about/', '/contact/', '/privacy-policy/', '/terms-of-service/'];
['news', 'blog'].forEach(type => {
  const articles = type === 'news' ? content.news : content.blog;
  articles.forEach(article => sitemapUrls.push(`/${type}/${article.slug}/`));
});
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map(url => `  <url><loc>${xml(site + url)}</loc></url>`).join('\n')}\n</urlset>\n`;
write('sitemap.xml', sitemap);

console.log(`Built site: ${categories.length} categories, ${tools.length} published tool(s), ${content.blog.length} blog post(s), ${content.news.length} news item(s), ${Object.keys(staticPages).length} content pages, sitemap and robots.txt.`);
