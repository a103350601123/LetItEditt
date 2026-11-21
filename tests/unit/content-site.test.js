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
  it('keeps exactly the 28 canonical categories', () => {
    expect(registry.CATEGORIES).toHaveLength(28);
    expect(new Set(registry.CATEGORIES.map(category => category.key)).size).toBe(28);
  });

  it('keeps the original nine categories first and unchanged', () => {
    expect(registry.CATEGORIES.slice(0, 9).map(category => category.slug)).toEqual([
      'image-photo-editing',
      'video-editing',
      'audio-music-editing',
      'pdf-document-editing',
      'text-writing-editing',
      'graphic-design-creative-editing',
      'web-code-editing',
      'diagram-presentation-productivity-design',
      'qr-barcode-utility-design'
    ]);
  });

  it('uses unique category slugs and paths', () => {
    expect(new Set(registry.CATEGORIES.map(category => category.slug)).size).toBe(28);
    expect(new Set(registry.CATEGORIES.map(category => category.path)).size).toBe(28);
  });

  it('assigns every category to a real group', () => {
    expect(registry.GROUPS).toHaveLength(4);
    const grouped = registry.GROUPS.reduce((total, group) => total + group.categories.length, 0);
    expect(grouped).toBe(28);
    registry.CATEGORIES.forEach(category => {
      expect(registry.GROUPS.some(group => group.key === category.group)).toBe(true);
    });
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

  it('gives the new categories a labelled planned-tool list', () => {
    registry.CATEGORIES.slice(9).forEach(category => {
      expect(category.plannedTools.length).toBeGreaterThanOrEqual(6);
      expect(new Set(category.plannedTools).size).toBe(category.plannedTools.length);
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

  it('generates the search index for all categories', () => {
    const index = read('js/search-index.js');
    expect(index).toContain('window.LETITEDIT_SEARCH');
    registry.CATEGORIES.forEach(category => {
      expect(index).toContain(category.path);
    });
    expect(index).toContain('"tools":[]');
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
