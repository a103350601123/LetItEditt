/* LetitEdit editorial content data.
 * News and blog arrays are intentionally empty: nothing is published until a
 * real article is written. To add an article later, append one object with
 * the fields shown in the commented examples below; the build will create the
 * listing entry, article page, SEO metadata and sitemap entry automatically.
 */
'use strict';

module.exports = {
  /*
  news: [{
    slug: 'example-news-item',
    title: 'Example news item',
    summary: 'One or two sentences describing the announcement.',
    image: '/assets/news/example.png',        // optional, local path
    date: '2026-11-19',                        // ISO date
    author: 'LetitEdit',                       // optional
    tags: ['announcement'],                    // optional
    seoTitle: 'Example news item — LetitEdit',
    seoDescription: 'Unique description for search engines.',
    body: [
      { heading: 'What changed', paragraphs: ['Real article text goes here.'] }
    ]
  }],
  */
  news: [],

  /*
  blog: [{
    slug: 'example-guide',
    title: 'Example guide',
    summary: 'Short description shown on the blog listing.',
    image: '/assets/blog/example.png',        // optional, local path
    date: '2026-11-19',
    category: 'Guides',                       // also used as a tag
    tags: ['text', 'guide'],
    seoTitle: 'Example guide — LetitEdit Blog',
    seoDescription: 'Unique description for search engines.',
    body: [
      { heading: 'Introduction', paragraphs: ['Real article text goes here.'] }
    ]
  }],
  */
  blog: [],

  faq: [
    {
      category: 'Using the tools',
      q: 'Do the tools upload my text or files?',
      a: 'No. Every published LetitEdit tool processes input locally in your browser. Text you paste and files you choose are not sent to a LetitEdit server for processing.'
    },
    {
      category: 'Using the tools',
      q: 'Do I need an account?',
      a: 'No account, sign-up or subscription is required. Every tool is free to open and use.'
    },
    {
      category: 'Using the tools',
      q: 'Can I use the tools on a phone?',
      a: 'Yes. The interface is responsive from small 320px screens through large desktops, and the same processing runs on mobile browsers.'
    },
    {
      category: 'Privacy and safety',
      q: 'Is my input stored after I close the page?',
      a: 'Tool input is held in browser memory while the page is open. Copy, download and restoration actions only happen after you click them. Check the Privacy Policy for full details.'
    },
    {
      category: 'Privacy and safety',
      q: 'Are the redaction tools guaranteed to find all sensitive information?',
      a: 'No. Detection uses conservative patterns for common formats. Always review redacted output manually before sharing it, and treat restoration keys as sensitive because they contain the original values.'
    },
    {
      category: 'Adding tools',
      q: 'How are new tools added?',
      a: 'Tools are registered in a central data file with metadata such as name, category, slug, keywords and SEO fields. The navigation, counts, search, sitemap and category pages update automatically from that registry.'
    },
    {
      category: 'Adding tools',
      q: 'Why are some categories empty?',
      a: 'All planned categories exist now so the navigation and routes are stable. Tools appear in a category only after they are implemented and tested; placeholder tools are never published.'
    }
  ]
};
