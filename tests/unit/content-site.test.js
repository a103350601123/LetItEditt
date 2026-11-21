import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import registry from '../../data/registry.js';
import content from '../../data/content.js';

const root = registry.root;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('content registry', () => {
  it('keeps exactly the nine canonical categories', () => {
    expect(registry.CATEGORIES).toHaveLength(9);
    expect(new Set(registry.CATEGORIES.map(category => category.key)).size).toBe(9);
  });

  it('uses category routes outside the removed tool namespace', () => {
    registry.CATEGORIES.forEach(category => {
      expect(category.path).toMatch(/^\/categories\/[a-z0-9-]+\/$/);
      expect(category.path).not.toContain('/tools/');
    });
  });

  it('does not expose tool registry data', () => {
    expect(registry.publishedTools).toBeUndefined();
    expect(registry.redirectTools).toBeUndefined();
    expect(registry.sidebarItems).toBeUndefined();
    expect(registry.catalogFor).toBeUndefined();
  });

  it('links every related category to a real category', () => {
    registry.CATEGORIES.forEach(category => {
      category.related.forEach(key => {
        expect(registry.categoryByKey.has(key)).toBe(true);
      });
    });
  });
});

describe('generated content-only site', () => {
  it('generates the home, category index and every category page', () => {
    expect(fs.existsSync(path.join(root, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'categories', 'index.html'))).toBe(true);
    registry.CATEGORIES.forEach(category => {
      const file = path.join(root, category.path.replace(/^\//, ''), 'index.html');
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('generates the blog listing and the published post', () => {
    expect(fs.existsSync(path.join(root, 'blog', 'index.html'))).toBe(true);
    content.blog.forEach(article => {
      expect(fs.existsSync(path.join(root, 'blog', article.slug, 'index.html'))).toBe(true);
    });
  });

  it('does not generate a tools directory or tool listing', () => {
    expect(fs.existsSync(path.join(root, 'tools'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'new-tools'))).toBe(false);
  });

  it('keeps tool routes out of the sitemap', () => {
    const sitemap = read('sitemap.xml');
    expect(sitemap).not.toContain('/tools/');
    expect(sitemap).not.toContain('/new-tools/');
    expect(sitemap).toContain('https://letitedit.com/categories/');
    registry.CATEGORIES.forEach(category => {
      expect(sitemap).toContain(`https://letitedit.com${category.path}`);
    });
  });

  it('does not link to the removed tool namespace from generated HTML', () => {
    const htmlFiles = [];
    function collect(directory) {
      fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
        if (entry.name === 'node_modules' || entry.name === '.git') return;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.name.endsWith('.html')) htmlFiles.push(full);
      });
    }
    collect(root);
    expect(htmlFiles.length).toBeGreaterThan(0);
    htmlFiles.forEach(file => {
      expect(fs.readFileSync(file, 'utf8')).not.toContain('href="/tools/');
    });
  });
});
