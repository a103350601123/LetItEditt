# LetitEdit — Phase 1 SEO audit and corrections

Date: 2026-11-27
Status: Phase 1 implemented and verified locally. No commit, push, deploy or DNS change was made.
Scope: website-wide SEO corrections that preserve URLs, content, design, tools, analytics and performance. The Phase 2 white SaaS tool-page redesign is out of scope.

## 1. Method and evidence

- Read-only source audit of 54 HTML files (53 public pages plus one Playwright fixture).
- Parsed and validated all 45 JSON-LD blocks with Node.
- Compared every page against `sitemap.xml` and checked every internal `href`/`src` against the filesystem.
- Inspected live production response headers on 2026-11-27 for the homepage, a tool page, `home.css` and `home.js`.
- Checked HTTP→HTTPS, `www`, trailing-slash behaviour and whether `llms.txt` existed in production.
- Captured local Lighthouse baselines and post-change runs (mobile and desktop) against the repository through the Playwright static server, plus a controlled `HEAD`-versus-working-tree desktop A/B comparison.
- Re-ran the homepage, navigation/search, video trimmer and image compressor Playwright suites, then the full 342-test suite.

Production was not modified. Local Lighthouse runs use the repository's plain HTTP static server, so local compression results are not representative of production Brotli.

## 2. Changes made

| File / area | Change | Reason |
| --- | --- | --- |
| `assets/og-letitedit.jpg` | Added a 1200×630 branded JPEG share image (73,545 bytes) rendered from the site's own brand colours and type. | Every page was missing `og:image`. |
| All 53 public HTML pages | Added `og:image`, `og:image:type`, `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:image` and `twitter:image:alt`; changed `twitter:card` from `summary` to `summary_large_image`. | Fixes the reported missing Open Graph image and makes large-image cards work on X/Twitter. |
| `index.html` | Shortened the homepage meta description from 158 to 151 characters and matched `og:description`. | The reported ~957 px description was near or over common desktop snippet width. Wording remains unique and accurate. |
| `llms.txt` | Added a plain-text index of the 13 live tools, 28 categories, core pages, sitemap and robots policy, using real canonical URLs only. | SEOptimer reported the file missing; the file is accurate and cheap to serve. |
| `tests/e2e/homepage.spec.js` | Updated the expected Twitter card and added assertions for `og:image` and `twitter:image`. | The old test asserted the previous `summary` card; the new assertions lock in the intended state. |
| `tests/e2e/background-remover.spec.js` | Updated the same stale Twitter-card assertion. | The page now publishes the intended `summary_large_image` card. |
| `scripts/build-pages.js` | Added `docs` to the Cloudflare Pages skip list. | Keeps this internal audit and its proposed DNS values out of the public build output. No model, asset or page behaviour changes. |
| `docs/seo/phase-1-seo-report.md` | Added this report. | Records evidence, proposed external configuration and the link-building/keyword plans. |

No URL, canonical URL, title, navigation item, tool behaviour, analytics tag, stylesheet or layout was changed.

## 3. Baseline measurements

### 3.1 Source and metadata

- 53 public HTML pages; 1 test fixture.
- 45 JSON-LD blocks across 45 pages. All parse as valid JSON, and every schema node has `@type`. The reported "one schema without `@type`" was not reproducible.
- Canonical URLs present on all 53 public pages.
- No duplicate `<title>` and no duplicate meta descriptions.
- `sitemap.xml`: 52 URLs. All public indexable pages are present; only `404.html` is correctly absent. No stale or duplicate sitemap entries.
- Broken internal `href`/`src` references in source: 0.
- All pages use `<html lang="en" dir="ltr">` and `og:locale` `en_US`. No translated or regional variants exist.

### 3.2 Homepage composition

| Metric | SEOptimer | Measured locally |
| --- | --- | --- |
| `<a>` elements | 117 | 118 anchors, 53 unique destinations |
| DOM elements | 898 | 920 in source; 897 in Lighthouse |
| Text-to-HTML ratio | 15.9% | 16.2% (8,782 visible text characters / 54,070 HTML bytes) |
| Meta description | ~957 px | 158 characters before the change, 151 after |

### 3.3 Keyword frequency on the homepage

Visible text: 1,376 words. Counts are whole-word matches, so they differ from a substring-based tool.

| Term | SEOptimer | Local whole-word count | Density |
| --- | --- | --- | --- |
| tools | 4.01% | 47 | 3.42% |
| video | 3.65% | 32 | 2.33% |
| tool | 3.16% | 26 | 1.89% |
| audio | 2.43% | 22 | 1.60% |
| open | 2.19% | 18 | 1.31% |

These terms describe the product and its navigation. There is no fixed density threshold used by Google, and rewriting accurate copy to hit a percentage would reduce quality. Intentionally not changed.

### 3.4 Local Lighthouse before/after

Measured with Lighthouse 12.8.2 against the repository through the Playwright static server. The "before" state is `HEAD` (`7f6a372`), served from a separate copy of the homepage on port 4174; the "after" state is the working tree on port 4173.

| Category | Mobile before | Mobile after | Desktop before | Desktop after |
| --- | --- | --- | --- | --- |
| Performance | 68 | 67–68 | 59 (single run) | 44–47 |
| Accessibility | 96 | 96 | 96 | 96 |
| Best Practices | 100 | 100 | 100 | 100 |
| SEO | 100 | 100 | 100 | 100 |

Mobile after: FCP 1.2–1.4 s, LCP 3.1–3.2 s, TBT 1,390–1,460 ms, CLS 0.
Desktop after: FCP 1.4–1.8 s, LCP 3.0 s, TBT 890–990 ms, CLS 0.

The single-run desktop "59" was not reproducible. A controlled A/B run (three alternating desktop runs per state) produced:

| Desktop, 3 runs | Median Performance | Median LCP | Median TBT |
| --- | --- | --- | --- |
| `HEAD` before | 43 | 3,134 ms | 888 ms |
| Working tree after | 45 | 2,987 ms | 936 ms |

The after state is not slower within measurement noise. Desktop variance is dominated by Google Tag Manager, whose tag adds 600–900 ms of blocking main-thread time in both states. Accessibility, Best Practices and SEO stay at 96/100/100 in every run.

Local performance is depressed by the uncompressed local HTTP server and by GTM. Production already serves Brotli. These numbers are a regression check, not a claim about production Core Web Vitals.

### 3.5 Post-change verification

- All 53 public HTML pages scanned: exactly one `og:image`, one `twitter:image`, one canonical, one `twitter:card` and one early `<meta charset>` per page; 0 problems.
- Schema audit: 54 files, 45 JSON-LD blocks, 0 files with issues.
- Link audit: 0 broken internal references.
- `llms.txt`: 52 URLs, 52 unique, 0 missing targets.
- Local server: `llms.txt` returns `200 text/plain` (7,279 bytes); `assets/og-letitedit.jpg` returns `200 image/jpeg` (73,545 bytes, 1200×630); homepage returns 200.
- Playwright: the full 342-test run returned 339 passed and 3 failed. One failure was a stale Twitter-card assertion in `background-remover.spec.js`; it was updated and the affected homepage and Background Remover tests now pass. The remaining two are the pre-existing analytics assertions at `audio-converter.spec.js:987` and `audio-merger.spec.js:1947`, which also failed before Phase 1 and are unrelated to these changes.
- `npm test` (Vitest) still collects the Playwright spec files and fails at collection. This is a pre-existing script configuration issue; use `npm run test:e2e` for the browser suite.

### 3.6 Production headers (live, 2026-11-27)

Confirmed present:

- `Content-Encoding: br` on HTML, CSS and JS (Brotli works).
- `alt-svc: h3=":443"; ma=86400` (HTTP/3 is advertised).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- HTTP→HTTPS 301 redirect.
- `/about` returns 308 to the trailing-slash URL.

Not present:

- `Strict-Transport-Security`.
- `Content-Security-Policy`.
- `X-Frame-Options`.
- `Permissions-Policy`.
- A `www` → apex redirect: `https://www.letitedit.com/` returns 200 and its canonical points to `https://letitedit.com/`.

The Cloudflare email-decode script is not in the repository. It is injected by Cloudflare at the edge.

## 4. SEOptimer finding classification

| # | Finding | Classification | Evidence / action |
| --- | --- | --- | --- |
| 1 | Missing hreflang | Not applicable | English-only site; every page is `lang="en"` with no translated or regional equivalents. Adding hreflang would create fake alternates. |
| 2 | Missing `llms.txt` | Fixed | Added `llms.txt` with real canonical URLs. |
| 3 | Render-blocking `/css/home.css` | Verified — intentionally not changed | One 33 KB local stylesheet, Brotli-compressed in production. Lighthouse estimated 0–301 ms locally. Inlining critical CSS or deferring the sheet would risk FOUC and layout regressions in Phase 1. |
| 4 | Cloudflare email-decode script | Requires external configuration | Not present in source. It is injected by Cloudflare Email Address Obfuscation. Disable that setting only if the trade-off (email scraping) is acceptable. |
| 5 | Missing DMARC | Requires external configuration | Proposed record in section 5.1. No DNS change made. |
| 6 | Missing HSTS | Requires external configuration | Proposed conservative header in section 5.2. No header change made. |
| 7 | Keyword density | Verified — intentionally not implemented | Natural product vocabulary; no fixed threshold. See section 3.3. |
| 8 | 15.9% text-to-HTML ratio | Verified — intentionally not implemented | Ratio is not a ranking factor; padding text would harm quality. See section 3.2. |
| 9 | Homepage description ~957 px | Fixed | Trimmed from 158 to 151 characters while keeping the unique, accurate claim. |
| 10 | 49.5% link density / 117 links | Verified — intentionally not reduced | 118 anchors, 53 unique. Links are navigation, tool cards, category cards and the category directory. Removing useful links would harm discovery. |
| 11 | 898 DOM elements | Verified — intentionally not reduced | 897 in Lighthouse. The count comes from 13 tool cards, 28 category cards, the footer directory and the inline SVG sprite. No arbitrary threshold was chased. |
| 12 | Missing GTM preconnect | Not applicable | Lighthouse's "Preconnect to required origins" audit passes. GTM is already discovered in the first head bytes and loads asynchronously. |
| 13 | No compression/Brotli | Verified false for production | Production returns `Content-Encoding: br` for HTML, CSS and JS. |
| 14 | No `alt-svc` | Verified false for production | Production returns `alt-svc: h3=":443"; ma=86400`. |
| 15 | Missing security headers | Partially fixed by host / requires external configuration | `nosniff` and `Referrer-Policy` are present. HSTS, CSP, X-Frame-Options and Permissions-Policy are absent; proposals in section 5. |
| 16 | Unnamed `#tool-search` | Verified already correct | The input has `<label class="hp-sr-only" for="tool-search">Search tools and categories</label>`. No change needed. |
| 17 | Schema missing `@type` | Not reproducible | 45 blocks parsed; every node has `@type`; no invalid JSON. |
| 18 | Missing `og:image` | Fixed | Branded 1200×630 JPEG added, with width, height, type, alt and matching Twitter image. |
| 19 | No social signals | Not implemented | No official LetitEdit profiles were verified. No fake accounts, links or heavy widgets were added. |
| 20 | E-E-A-T gaps | Partially addressed / ongoing | About, Contact, Privacy and Terms exist and are linked sitewide. No authors, credentials, reviews or business history were invented. |

Additional findings not in the SEOptimer report:

- `https://letitedit.com/media-and-motion/background-remover/` returns 404 in production even though the page, category card, search-index entry and sitemap entry exist in the repository. This is a deployment gap, not a source bug. The Background Remover work remains frozen and untouched. Before the next deploy, either publish the tool or remove its category card, search-index entry and sitemap entry together; do not leave a live link to a 404.
- `www` serves a 200 duplicate instead of redirecting to the apex. Canonicals point to the apex, which mitigates consolidation, but a 301 redirect rule is preferable (section 5.5).
- Eight tool-page meta descriptions exceed 160 characters (163–223). They are unique and accurate. Google may rewrite them, and shortening them is a Phase 2 content decision rather than a Phase 1 fix.
- `npm test` (Vitest) collects the Playwright `tests/e2e/*.spec.js` files and fails at collection because they use the Playwright test API. This is a pre-existing script configuration issue, not a Phase 1 regression. Use `npm run test:e2e` for the browser suite.

## 5. Proposed external configuration (not applied)

These require Cloudflare/DNS access and explicit approval. Exact values are provided so the change can be reviewed before it is made.

### 5.1 DMARC

- Host: `_dmarc.letitedit.com`
- Type: `TXT`
- Value: `v=DMARC1; p=none; rua=mailto:dmarc@letitedit.com; ruf=mailto:dmarc@letitedit.com; fo=1; adkim=r; aspf=r; pct=100`

Start at `p=none` for monitoring. Confirm SPF and DKIM first, and make sure the reporting mailbox exists (or replace it with `info@letitedit.com`). Move to `p=quarantine` only after report review.

### 5.2 HSTS

- Header: `Strict-Transport-Security: max-age=15552000`

Conservative 180-day max-age. Do not add `includeSubDomains` or `preload` until every subdomain and service is confirmed HTTPS-only. HSTS is difficult to roll back quickly.

### 5.3 Security headers for Cloudflare Pages

Proposed `_headers` content for review. Do not deploy until the CSP report-only output has been checked on every tool page.

```text
/*
  Strict-Transport-Security: max-age=15552000
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com <MODEL_HOST>; worker-src 'self' blob:; child-src 'self' blob:; frame-src https://www.googletagmanager.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

Important:

- `camera`, `microphone` and `display-capture` must stay allowed for the Screen Recorder. A blanket `camera=(), microphone=()` policy would break a live tool.
- The CSP must keep `'wasm-unsafe-eval'`, `blob:` workers and the Background Remover model host (`<MODEL_HOST>`, to be filled with the real R2 public host). Video and audio tools rely on WebAssembly, workers and blob URLs.
- Start with `Content-Security-Policy-Report-Only`; review browser reports on every tool before enforcing.
- `frame-ancestors 'self'` also protects against clickjacking; `X-Frame-Options` is kept for older browsers.

### 5.4 Cloudflare Email Address Obfuscation

To remove the injected `/cdn-cgi/scripts/.../email-decode.min.js` request, disable Email Address Obfuscation in Cloudflare Scrape Shield. This exposes the `info@letitedit.com` address to scrapers. The alternative is to accept the script. No source change can remove it.

### 5.5 `www` → apex redirect

Create a Cloudflare Redirect Rule:

- If hostname equals `www.letitedit.com`
- Then 301 to `https://letitedit.com` preserving path and query

This removes the duplicate 200 response and makes the canonical host unambiguous.

## 6. Hreflang assessment

The site is English-only:

- `<html lang="en">` on every page.
- `og:locale` is `en_US`.
- No translation, region selector, country-specific pricing or localised URL tree exists.
- No page has an equivalent in another language.

Adding `hreflang` now would require inventing alternate URLs, which is worse than omitting it. If translated or regional pages are added later, use self-referencing `en` plus the new language/region codes and one `x-default`, and only for real equivalents.

## 7. Structured data

- 45 blocks validated, including `WebSite`, `Organization`, `FAQPage`, `BreadcrumbList`, `SoftwareApplication`, `Offer`, `Question`, `Answer`, `HowTo`, `HowToStep` and `ListItem`.
- No missing `@type`, no invalid JSON and no duplicate top-level graph IDs found.
- Not added: `Organization.logo` and `Organization.sameAs`. A square logo asset and verified official profiles do not exist yet. Adding either now would mean inventing an asset or an account.
- Not added: review/rating markup. There are no genuine reviews.

## 8. E-E-A-T and social signals

Truthful improvements already present:

- About page explains how the site is organised.
- Contact page exposes a real email address.
- Privacy Policy and Terms of Service are linked sitewide.
- Tool pages document formats, limits and local-processing behaviour.
- FAQ answers match visible content and the FAQ schema.

Not done, because the underlying facts do not exist:

- No named author or credential was invented.
- No business address, company history, review score or customer count was invented.
- No social profile links or share widgets were added. Heavy third-party widgets would also hurt performance.

Recommended when real information exists:

- Add a real author bio and `lastmod`/visible “last updated” date to guides.
- Add official profiles to `Organization.sameAs` only after the accounts are created and verified.
- Add a square brand logo for `Organization.logo` when one is designed.

## 9. Keyword research (evidence-based, no invented metrics)

No search volumes, difficulty scores, traffic estimates or rankings are claimed in this report. Those numbers must come from a real data source.

Seed clusters derived from the live tools and categories:

| Cluster | Example intents | Matching live page |
| --- | --- | --- |
| Video trimming | trim video online, cut mp4, remove middle of video | `/media-and-motion/video-trimmer/` |
| Video merging | merge videos, join clips, combine mp4 | `/media-and-motion/video-merger/` |
| Video conversion | mp4 to webm, mov to mp4, video to mp3 | `/media-and-motion/video-converter/` |
| Video compression | compress video, reduce video size, compress for WhatsApp | `/media-and-motion/video-compressor/` |
| Video cropping/resizing | crop video for TikTok, resize to 1080p | `/media-and-motion/video-cropper/`, `/video-resizer/` |
| Audio trimming/merging/conversion | trim mp3, merge audio, wav to mp3 | `/audio-trimmer/`, `/audio-merger/`, `/audio-converter/` |
| Image compression/editing | compress jpg to 100kb, resize image, add text to photo | `/image-size-compressor/`, `/image-photo-editor/` |
| Screen recording | record screen with audio, record browser tab | `/screen-recorder/` |
| Format-specific long tail | convert m4a to mp3, compress mp4 under 25mb | Existing converters/compressor |
| Category research | best free pdf editor, online colour palette | Category pages — only when a tool exists |

Method:

1. Export the last 3–6 months of queries from Google Search Console and Bing Webmaster Tools.
2. Validate demand in Google Keyword Planner or another licensed source; record volume, country and date.
3. Group queries by intent and map one primary intent per URL to avoid cannibalisation.
4. Prioritise pages that already have impressions but low CTR, then pages for live tools with no supporting guide.
5. Do not create pages for tools that are not live. The Background Remover remains frozen until deployment is approved.
6. Re-measure after 4–8 weeks; do not promise rankings.

## 10. Link-building plan

Ethical, manual and relevance-first. No paid link schemes, private blog networks, automated link building, mass directory submissions, comment spam or misleading outreach.

1. **Make linkable assets.** Publish original, useful resources: format-compression benchmarks, “which format should I use” guides, privacy explanations for browser-side editing, and short tutorials with real screenshots.
2. **Creator partnerships.** Offer genuine access to the trimmers, mergers and recorder to creators who already publish editing tutorials. No payment for links; disclose any relationship.
3. **Community answers.** Answer real questions on Reddit, Stack Exchange and relevant forums only where self-promotion is allowed. Disclose affiliation and link only when it solves the problem.
4. **Broken-link reclamation.** Find genuinely dead tool links on relevant resource pages and suggest the matching LetitEdit tool. One personalised email per real issue.
5. **Digital PR.** Pitch original data or a genuinely useful free resource to journalists and newsletters covering media, design and small-business workflows.
6. **Partner pages.** Co-marketing with complementary tools where a real integration or comparison exists.
7. **Measure.** Track referring domains and referral sessions in analytics and Search Console. Do not invent domain-authority targets.

Explicitly excluded: paid guest posts, link exchanges at scale, PBNs, spun content, directory blasts, forum profile links, comment spam and automated outreach.

## 11. Performance and verification notes

- The Phase 1 changes are metadata and static-file additions. Browsers do not fetch `og:image` while rendering the page, and `llms.txt` is not requested by the page, so the changes add no rendering cost. The controlled desktop A/B run confirmed no slowdown: median Performance 43 before versus 45 after, median LCP 3,134 ms before versus 2,987 ms after, all within GTM-driven noise.
- `home.css` remains the only homepage stylesheet and is still render-blocking. This was measured, not ignored: the local estimate was 0–301 ms, and the production file is Brotli-compressed. Inlining or deferring it was rejected for Phase 1 because it risks a flash of unstyled content and layout changes.
- Production Brotli, HTTP/3 advertisement and the two existing security headers were verified from live responses. Local Lighthouse "enable text compression" failures are a property of the local static server, not production.
- PageSpeed Insights API returned HTTP 429 during the audit, so the production lab baseline could not be captured through PSI. Local Lighthouse results are reported instead, with their limitations stated. Production Core Web Vitals were not measured and are not claimed.

## 12. Rollback

All Phase 1 source changes are additive metadata, one new image, one new text file, two test updates and one build-skip entry. To roll back:

1. Remove the `og:image`/`twitter:image` block from the affected HTML files and restore `twitter:card` to `summary`.
2. Restore the previous homepage description.
3. Delete `llms.txt` and `assets/og-letitedit.jpg`.
4. Restore the previous `tests/e2e/homepage.spec.js` and `tests/e2e/background-remover.spec.js` assertions.
5. Remove `docs` from the skip list in `scripts/build-pages.js`.
6. Delete this report if it is not wanted.

No production state, DNS record, Cloudflare setting or Background Remover file is part of the rollback.

## 13. Phase 2 boundary

Phase 2 (white SaaS tool-page redesign) has not started. It should wait until this Phase 1 report is reviewed and the external header/DNS proposals are approved or rejected.
