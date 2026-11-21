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
    <button class="menu-button" type="button" aria-controls="primary-links" aria-expanded="false">Menu</button>
    <div class="nav-links" id="primary-links">
      ${links}
    </div>
  </nav>
</header>`;
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
        <h3>All categories</h3>
        <ul>
          ${categoryLinks}
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
  return `<!DOCTYPE html>
<html lang="${esc(options.lang || 'en')}" dir="${esc(options.dir || 'ltr')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<meta name="theme-color" content="#2563EB">
<link rel="canonical" href="${site}${options.canonical}">
<meta property="og:type" content="${options.ogType || 'website'}">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${site}${options.canonical}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary">
${ogImage}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%232563eb'/%3E%3Cpath d='M6 17V7h3l3 5 3-5h3v10' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${assets}css/site.css">
${structured}
</head>
<body${bodyClass}>
<a class="skip-link" href="#main-content">Skip to main content</a>
${nav(options.activeNav)}
<div id="main-content">
${options.body}
</div>
${footer()}
<script src="${assets}js/site.js"></script>
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

function categoryCard(category) {
  return `<a class="card category-card" href="${category.path}" style="--icon-bg:${category.color}1a;--icon-color:${category.color};--category-accent:${category.color}">
    <span class="card-top">
      <span class="card-icon" aria-hidden="true">${esc(category.icon)}</span>
      <span class="card-arrow" aria-hidden="true">↗</span>
    </span>
    <h3>${esc(category.name)}</h3>
    <p>${esc(category.description)}</p>
    <span class="card-foot"><span class="card-tag">Category</span><span class="card-explore">Explore →</span></span>
  </a>`;
}

function homepage() {
  const cards = categories.map(category => categoryCard(category)).join('');
  const body = `<main>
<section class="hero">
  <div class="hero-atmosphere" aria-hidden="true">
    <span class="hero-glow hero-glow-a"></span>
    <span class="hero-glow hero-glow-b"></span>
    <span class="hero-beam"></span>
  </div>
  <div class="container hero-inner">
    <div class="hero-copy">
      <span class="eyebrow">Categories · Guides · Updates</span>
      <h1>A clean home for<br><span class="gradient-text">browser tools.</span></h1>
      <p>LetitEdit is being rebuilt around nine clear categories. Browse the structure, read the blog and follow updates while the next generation of private browser-side tools is prepared.</p>
      <div class="hero-actions">
        <a class="btn btn-hero-primary" href="/categories/">Explore categories</a>
        <a class="btn btn-hero-secondary" href="/blog/">Read the blog</a>
        <a class="btn btn-hero-text" href="/news/">Site updates →</a>
      </div>
      <ul class="hero-proof" aria-label="Site promises"><li>No sign-up</li><li>No uploads</li><li>Clear categories</li></ul>
    </div>
    <aside class="hero-visual" aria-label="Site summary">
      <div class="hero-card">
        <div class="hero-card-head"><span class="hero-card-dot" aria-hidden="true"></span><span class="hero-card-title">Building in public</span><span class="hero-card-live">LIVE</span></div>
        <p class="hero-card-sub">A simpler, category-led site with room for carefully built tools.</p>
        <div class="hero-stat"><span>Categories</span><strong>${categories.length}</strong></div>
        <div class="hero-stat"><span>Tools live</span><strong>0</strong></div>
        <div class="hero-stat"><span>Accounts needed</span><strong>None</strong></div>
        <div class="hero-stat"><span>Processing</span><strong>On-device when available</strong></div>
      </div>
    </aside>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head section-head-split">
      <div><span class="eyebrow">Nine clear topics</span><h2>Explore by category</h2><p>Each category has its own page and permanent place in the site structure.</p></div>
      <a class="text-link" href="/categories/">All categories →</a>
    </div>
    <div class="grid category-grid">${cards}</div>
  </div>
</section>

<section class="section section-soft">
  <div class="container info-grid">
    <div class="info-card"><h2>Blog</h2><p>Notes about browser-side processing, privacy and how each category will grow.</p><a class="btn btn-secondary btn-small" href="/blog/">Open Blog</a></div>
    <div class="info-card"><h2>News</h2><p>Site announcements and rebuild updates will be published here with dates and clear summaries.</p><a class="btn btn-secondary btn-small" href="/news/">Open News</a></div>
  </div>
</section>

<section class="section">
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
  const body = `${breadcrumbs(assets, [{ label: 'Home', href: '/' }, { label: 'Categories', href: '/categories/' }])}
<section class="container page-head">
  <span class="eyebrow">Browse by topic</span>
  <h1>Categories</h1>
  <p>Nine professional categories organise the LetitEdit site. Each page is ready for new tools while the library is rebuilt.</p>
</section>
<section class="section"><div class="container"><div class="grid category-grid">${categories.map(category => categoryCard(category)).join('')}</div></div></section>`;
  return page({
    title: 'Categories — Browse LetitEdit by Topic',
    description: `Explore ${categories.length} LetitEdit categories for browser-side tools, guides and future releases.`,
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
    .map(key => registry.categoryByKey.get(key))
    .filter(Boolean)
    .map(item => `<a href="${item.path}">${esc(item.name)}</a>`)
    .join(', ');
  const body = `${breadcrumbs(assets, trail)}
<section class="container page-head" dir="${esc(category.dir)}">
  <span class="eyebrow" style="color:${esc(category.color)}">${esc(category.shortLabel)}</span>
  <h1>${esc(category.name)}</h1>
  <p>${esc(category.intro)}</p>
</section>
<section class="section"><div class="container info-grid">
  <div class="info-card">
    <h2>About ${esc(category.name)}</h2>
    <p>${esc(category.description)}</p>
    <p>This category is part of the permanent LetitEdit taxonomy. No tools are published here yet.</p>
  </div>
  <div class="info-card">
    <h2>Nearby categories</h2>
    <p>${related || 'Related categories will be added here as the site grows.'}</p>
    <p><a class="text-link" href="/categories/">See all categories →</a></p>
  </div>
</div></section>
<section class="section section-soft"><div class="container info-card">
  <h2>Follow the rebuild</h2>
  <p>Read the blog for notes about privacy, browser-side processing and the next releases.</p>
  <a class="btn btn-secondary btn-small" href="${assets}blog/">Read the blog</a>
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

const sitemapUrls = ['/', '/categories/', '/news/', '/blog/', '/faq/',
  ...categories.map(category => category.path), '/about/', '/contact/', '/privacy-policy/', '/terms-of-service/'];
['news', 'blog'].forEach(type => {
  const articles = type === 'news' ? content.news : content.blog;
  articles.forEach(article => sitemapUrls.push(`/${type}/${article.slug}/`));
});
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map(url => `  <url><loc>${xml(site + url)}</loc></url>`).join('\n')}\n</urlset>\n`;
write('sitemap.xml', sitemap);

console.log(`Built content-only site: ${categories.length} categories, ${content.blog.length} blog post(s), ${content.news.length} news item(s), ${Object.keys(staticPages).length} content pages, sitemap and robots.txt.`);
