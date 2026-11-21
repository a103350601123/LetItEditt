/* LetitEdit content registry.
 * Tool data, tool runtime wiring and generated tool routes were removed. This
 * module now describes only the canonical categories and their shared
 * metadata for the content-only site.
 */
'use strict';

const path = require('path');
const {
  CATEGORY_COPY,
  CATEGORY_ORDER,
  CATEGORY_GROUPS
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
    group: copy.group,
    dir: 'ltr',
    description: copy.description,
    intro: copy.intro,
    seoTitle: copy.seoTitle,
    seoDescription: copy.seoDescription,
    related: copy.related || [],
    plannedTools: copy.plannedTools || []
  };
});

const categoryByKey = new Map(CATEGORIES.map(category => [category.key, category]));
const categoryBySlug = new Map(CATEGORIES.map(category => [category.slug, category]));

// Guard against duplicate routes or overlapping taxonomy entries.
const seenSlugs = new Set();
const seenPaths = new Set();
for (const category of CATEGORIES) {
  if (seenSlugs.has(category.slug)) throw new Error(`Duplicate category slug: ${category.slug}`);
  if (seenPaths.has(category.path)) throw new Error(`Duplicate category path: ${category.path}`);
  seenSlugs.add(category.slug);
  seenPaths.add(category.path);
  for (const related of category.related) {
    if (!categoryByKey.has(related)) {
      throw new Error(`Category ${category.key} links to unknown category: ${related}`);
    }
  }
}

const GROUPS = CATEGORY_GROUPS.map(group => ({
  ...group,
  categories: CATEGORIES.filter(category => category.group === group.key)
}));

module.exports = {
  site,
  root,
  CATEGORIES,
  CATEGORY_COPY,
  CATEGORY_ORDER,
  CATEGORY_GROUPS,
  GROUPS,
  categoryByKey,
  categoryBySlug
};
