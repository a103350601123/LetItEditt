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

  it('exposes only the live tool registry', () => {
    expect(registry.TOOLS).toHaveLength(1);
    expect(registry.TOOLS[0].key).toBe('image-photo-editor');
    expect(registry.TOOLS[0].path).toBe('/media-and-motion/image-photo-editor/');
    expect(registry.TOOLS[0].status).toBe('live');
    expect(registry.toolByKey.get('image-photo-editor')).toBe(registry.TOOLS[0]);
    expect(registry.publishedTools).toBeUndefined();
    expect(registry.redirectTools).toBeUndefined();
    expect(registry.sidebarItems).toBeUndefined();
    expect(registry.catalogFor).toBeUndefined();
  });

  it('attaches the live tool to a real category and never to a duplicate route', () => {
    const tool = registry.TOOLS[0];
    expect(registry.categoryByKey.has(tool.categoryKey)).toBe(true);
    expect(registry.toolsForCategory(tool.categoryKey)).toEqual([tool]);
    expect(registry.CATEGORIES.some(category => category.path === tool.path)).toBe(false);
    expect(new Set(registry.TOOLS.map(item => item.path)).size).toBe(registry.TOOLS.length);
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

  it('generates the search index for all categories and the live tool', () => {
    const index = read('js/search-index.js');
    expect(index).toContain('window.LETITEDIT_SEARCH');
    registry.CATEGORIES.forEach(category => {
      expect(index).toContain(category.path);
    });
    expect(index).toContain('"tools":[{"name":"Image & Photo Editor"');
    expect(index).toContain('/media-and-motion/image-photo-editor/');
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

  it('keeps legacy tool namespaces out of the sitemap but lists the live tool', () => {
    const sitemap = read('sitemap.xml');
    expect(sitemap).not.toContain('/tools/');
    expect(sitemap).not.toContain('/new-tools/');
    expect(sitemap).toContain('https://letitedit.com/categories/');
    expect(sitemap).toContain('https://letitedit.com/media-and-motion/image-photo-editor/');
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

describe('image and photo editor tool', () => {
  const tool = registry.TOOLS[0];
  const page = read('media-and-motion/image-photo-editor/index.html');

  it('generates the tool page with one H1, canonical URL and structured data', () => {
    expect(fs.existsSync(path.join(root, 'media-and-motion', 'image-photo-editor', 'index.html'))).toBe(true);
    expect(page.match(/<h1[ >]/g)).toHaveLength(1);
    expect(page).toContain('<h1>Image &amp; Photo Editor</h1>');
    expect(page).toContain(`<link rel="canonical" href="${registry.site}${tool.path}">`);
    expect(page).toContain('application/ld+json');
    expect(page).toContain('BreadcrumbList');
    expect(page).toContain('SoftwareApplication');
    expect(page).toContain('FAQPage');
    expect(page).toContain('aria-label="Breadcrumb"');
    expect(page).toContain('href="../../categories/image-photo-editing/"');
  });

  it('loads the real editor shell, styles and scripts with relative paths', () => {
    expect(page).toContain('data-editor');
    expect(page).toContain('data-canvas');
    expect(page).toContain('data-panel');
    expect(page).toContain('data-file-input');
    expect(page).toContain('data-tool="crop"');
    expect(page).toContain('data-tool="export"');
    expect(page).toContain('href="../../css/editor.css"');
    expect(page).toContain('src="../../js/image-processing.js"');
    expect(page).toContain('src="../../js/editor.js"');
    expect(page).not.toContain('src="js/editor.js"');
  });

  it('ships every editor asset and the vendored decoders', () => {
    ['js/editor.js', 'js/image-processing.js', 'js/editor-worker.js', 'css/editor.css',
      'vendor/UTIF.js', 'vendor/UTIF.LICENSE', 'vendor/heic2any.min.js'].forEach(asset => {
      const file = path.join(root, asset);
      expect(fs.existsSync(file), asset).toBe(true);
      expect(fs.statSync(file).size, asset).toBeGreaterThan(0);
    });
    const licence = read('vendor/UTIF.LICENSE');
    expect(licence.toLowerCase()).toContain('mit');
  });

  it('documents real formats and honest limits instead of fake features', () => {
    expect(page).toContain('JPG / JPEG');
    expect(page).toContain('TIFF');
    expect(page).toContain('HEIC / HEIF');
    expect(page).toContain('AVIF export appears only when the browser');
    expect(page).toContain('First frame only; animation is not preserved.');
    expect(page).toContain('No segmentation model is bundled');
    expect(page).not.toContain('background removal works');
    expect(page).not.toContain('AI background removal');
  });

  it('links the tool from the homepage and its category page', () => {
    const home = read('index.html');
    expect(home).toContain(`href="${tool.path}"`);
    expect(home).toContain('Live tool');
    const category = read('categories/image-photo-editing/index.html');
    expect(category).toContain(`href="${tool.path}"`);
    expect(category).toContain('Published tools');
    expect(category).toContain('Image &amp; Photo Editor');
  });
});
