/* LetitEdit editorial content data.
 * Add an article here and the build creates its listing entry, article page,
 * SEO metadata and sitemap entry automatically.
 */
'use strict';

module.exports = {
  news: [],

  blog: [
    {
      slug: 'a-smaller-category-first-letitedit',
      title: 'A smaller, category-first LetitEdit',
      summary: 'The tool library has been removed while the site is rebuilt around nine clear categories.',
      date: '2026-11-21',
      author: 'LetitEdit',
      category: 'Site update',
      tags: ['site update', 'categories'],
      seoTitle: 'A smaller, category-first LetitEdit — Blog',
      seoDescription: 'Why the tool library was removed and what remains on the content-only LetitEdit site.',
      body: [
        {
          heading: 'What changed',
          paragraphs: [
            'The previous tool library has been removed. That includes the tool pages, tool runtimes, generated tool data and the old tool URLs.',
            'The removal is intentional. Keeping half-finished tools online made the site harder to understand and harder to maintain.'
          ]
        },
        {
          heading: 'What remains',
          paragraphs: [
            'The homepage, the nine category pages, this blog, the news listing, the FAQ and the policy pages remain. The category structure is now the main way to explore the site.',
            'Each category page explains what belongs there and links to nearby categories. None of them present an unfinished tool as available.'
          ]
        },
        {
          heading: 'What comes next',
          paragraphs: [
            'Tools will return one at a time. A tool will only be published with a real workspace, documented behaviour, honest limits and checks that match what the page promises.',
            'Until then, the published site is a content site. That is a smaller scope, but it is accurate.'
          ]
        }
      ]
    }
  ],

  faq: [
    {
      category: 'About this site',
      q: 'Are any tools available right now?',
      a: 'No. The tool library was removed so the site can be rebuilt around a smaller category structure. The category pages, blog, news and FAQ are the published content at the moment.'
    },
    {
      category: 'About this site',
      q: 'Do I need an account?',
      a: 'No. The published pages are static content and do not ask for an account, sign-up or subscription.'
    },
    {
      category: 'Privacy and safety',
      q: 'Do these pages upload my text or files?',
      a: 'The published category, blog, news, FAQ and policy pages do not provide an input for text or files, so nothing is uploaded from them. Future tool pages must explain exactly what happens to any input before you use them.'
    },
    {
      category: 'Privacy and safety',
      q: 'Are you tracking visitors?',
      a: 'The content-only site uses local styles and system fonts. It does not load advertising cookies or cross-site tracking scripts. A hosting provider may keep ordinary server access logs for security and troubleshooting.'
    },
    {
      category: 'Site structure',
      q: 'Why are the category pages empty of tools?',
      a: 'The nine categories are the permanent taxonomy. They exist so future guides and tools have stable homes without presenting unfinished or unsupported functionality as available.'
    },
    {
      category: 'Site structure',
      q: 'How will new tools be added later?',
      a: 'A tool will be introduced only with a real page, documented behaviour, honest limits and working checks. The site generator will then add its listing, metadata and sitemap entry; no placeholder tool is published.'
    },
    {
      category: 'Accessibility',
      q: 'Do you support mobile screens and non-English text?',
      a: 'The published pages are responsive and use system font fallbacks with Unicode-aware HTML. Each page declares its language and direction, so left-to-right and right-to-left content can be added without changing the theme.'
    }
  ]
};
