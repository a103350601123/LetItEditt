/* LetitEdit content registry.
 * Tool data, tool runtime wiring and generated tool routes were removed. This
 * module now describes only the nine canonical categories and their shared
 * metadata for the content-only site.
 */
'use strict';

const path = require('path');
const {
  CATEGORY_COPY,
  CATEGORY_ORDER
} = require('./category-copy');

const root = path.resolve(__dirname, '..');
const site = 'https://letitedit.com';

const CATEGORIES = CATEGORY_ORDER.map(key => {
  const copy = CATEGORY_COPY[key];
  if (!copy) throw new Error(`Missing category copy: ${key}`);
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
    related: copy.related || []
  };
});

const categoryByKey = new Map(CATEGORIES.map(category => [category.key, category]));
const categoryBySlug = new Map(CATEGORIES.map(category => [category.slug, category]));

module.exports = {
  site,
  root,
  CATEGORIES,
  CATEGORY_COPY,
  CATEGORY_ORDER,
  categoryByKey,
  categoryBySlug
};
