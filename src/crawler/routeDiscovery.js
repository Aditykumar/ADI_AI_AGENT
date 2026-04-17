'use strict';
/**
 * Route Discovery — lightweight HTTP crawler (no browser required).
 * Uses axios + cheerio to crawl pages and discover routes.
 *
 * Sources:
 *  1. robots.txt  → Sitemap directives
 *  2. sitemap.xml → All <loc> entries (recursive sitemapindex)
 *  3. BFS HTTP crawl → internal <a href> links via cheerio
 *  4. Script tag analysis → API route hints
 */
const axios   = require('axios');
const cheerio = require('cheerio');
const url     = require('url');

const MAX_PAGES   = 80;
const MAX_DEPTH   = 3;
const TIMEOUT_MS  = 10000;

const HTTP = axios.create({
  timeout: TIMEOUT_MS,
  maxRedirects: 5,
  validateStatus: s => s < 500,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AI-TestAgent/1.0)',
    'Accept': 'text/html,application/xhtml+xml,*/*',
  },
});

async function discoverRoutes(baseUrl, opts = {}) {
  const { verbose = false, auth = {} } = opts;
  const base   = normalizeBase(baseUrl);
  const origin = new URL(base).origin;

  const log = (...a) => verbose && process.stdout.write('  [crawl] ' + a.join(' ') + '\n');

  const result = {
    base,
    pages:      [],
    api_routes: [],
    assets:     [],
    errors:     [],
    stats:      { crawled: 0, skipped: 0, api_found: 0 },
  };

  // Auth headers
  const authHeaders = {};
  if (auth.token) authHeaders['Authorization'] = `Bearer ${auth.token}`;

  // ── 1. Login to get session cookie / token ────────────────────────
  let sessionCookie = '';
  if (auth.username && auth.password && auth.loginUrl) {
    process.stdout.write('  ↳ Attempting login…\n');
    try {
      const loginRes = await axios.post(auth.loginUrl, {
        username: auth.username, email: auth.username, password: auth.password,
      }, { timeout: TIMEOUT_MS, maxRedirects: 3, validateStatus: () => true,
           headers: { 'Content-Type': 'application/json' } });
      const setCookie = loginRes.headers['set-cookie'];
      if (setCookie) sessionCookie = setCookie.map(c => c.split(';')[0]).join('; ');
      const token = loginRes.data?.token || loginRes.data?.access_token;
      if (token) authHeaders['Authorization'] = `Bearer ${token}`;
      process.stdout.write(`  ↳ Login ${loginRes.status < 400 ? 'OK' : 'failed'} (${loginRes.status})\n`);
    } catch (e) {
      process.stdout.write(`  ↳ Login error: ${e.message}\n`);
    }
  }
  if (sessionCookie) authHeaders['Cookie'] = sessionCookie;

  // ── 2. Sitemap ────────────────────────────────────────────────────
  process.stdout.write('  ↳ Fetching sitemap…\n');
  const sitemapUrls = await fetchSitemap(base, origin, authHeaders);
  log(`sitemap: ${sitemapUrls.length} URLs`);

  // ── 3. BFS HTTP crawl ─────────────────────────────────────────────
  process.stdout.write(`  ↳ Crawling pages (BFS, max ${MAX_PAGES})…\n`);

  const visited = new Set();
  const apiSeen = new Set();
  const queue   = [{ url: base, depth: 0 }];

  for (const u of sitemapUrls.slice(0, 40)) {
    if (isSameDomain(u, origin)) queue.push({ url: u, depth: 1 });
  }

  while (queue.length > 0 && result.stats.crawled < MAX_PAGES) {
    const { url: pageUrl, depth } = queue.shift();
    const normalized = normalizeUrl(pageUrl);
    if (!normalized || visited.has(normalized)) { result.stats.skipped++; continue; }
    if (!isSameDomain(normalized, origin)) { result.stats.skipped++; continue; }
    if (isAsset(normalized)) { result.stats.skipped++; continue; }

    visited.add(normalized);

    let html = '';
    let status = 0;
    let title = '';

    try {
      const res = await HTTP.get(normalized, { headers: authHeaders });
      status = res.status;
      html   = typeof res.data === 'string' ? res.data : '';
    } catch (e) {
      result.errors.push({ url: normalized, error: e.message });
      continue;
    }

    const parsedPath = new URL(normalized).pathname;

    // Parse HTML
    if (html) {
      const $ = cheerio.load(html);
      title = $('title').first().text().trim();

      // Collect internal links
      if (depth < MAX_DEPTH) {
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const abs = new URL(href, normalized).href.split('#')[0].split('?')[0];
            if (isSameDomain(abs, origin) && !visited.has(abs) && !isAsset(abs)) {
              queue.push({ url: abs, depth: depth + 1 });
            }
          } catch (_) {}
        });
      }

      // Find API route hints in scripts
      const scriptText = $('script:not([src])').map((_, el) => $(el).html()).get().join('\n');
      const apiPatterns = [
        /['"`](\/api\/[^\s'"`?#]{2,60})['"`]/g,
        /fetch\(['"`](\/[^\s'"`?#]{2,60})['"`]/g,
        /axios\.\w+\(['"`](\/[^\s'"`?#]{2,60})['"`]/g,
      ];
      for (const pat of apiPatterns) {
        let m;
        while ((m = pat.exec(scriptText)) !== null) {
          const apiPath = m[1];
          if (!apiSeen.has(apiPath)) {
            apiSeen.add(apiPath);
            result.api_routes.push({ url: origin + apiPath, path: apiPath, method: 'GET', source: 'script' });
            result.stats.api_found++;
          }
        }
      }
    }

    result.pages.push({
      url:    normalized,
      path:   parsedPath,
      title,
      status,
      depth,
      source: depth === 0 ? 'base' : depth === 1 && sitemapUrls.includes(normalized) ? 'sitemap' : 'crawl',
    });
    result.stats.crawled++;

    log(`[${result.stats.crawled}] ${parsedPath}`);
  }

  process.stdout.write(`  ↳ Done: ${result.stats.crawled} pages, ${result.api_routes.length} API routes\n`);
  return result;
}

// ── Sitemap fetcher ───────────────────────────────────────────────────────
async function fetchSitemap(base, origin, headers = {}) {
  const urls = [];
  const candidates = [
    base.replace(/\/$/, '') + '/sitemap.xml',
    base.replace(/\/$/, '') + '/sitemap_index.xml',
  ];

  // Check robots.txt first
  try {
    const r = await HTTP.get(base.replace(/\/$/, '') + '/robots.txt', { headers });
    const sitemapLines = r.data?.split?.('\n')?.filter(l => l.toLowerCase().startsWith('sitemap:')) || [];
    for (const line of sitemapLines) {
      const u = line.split(':').slice(1).join(':').trim();
      if (u) candidates.unshift(u);
    }
  } catch (_) {}

  for (const candidate of candidates.slice(0, 3)) {
    try {
      const r = await HTTP.get(candidate, { headers });
      if (typeof r.data !== 'string') continue;
      const $ = cheerio.load(r.data, { xmlMode: true });
      $('loc').each((_, el) => {
        const u = $(el).text().trim();
        if (u && isSameDomain(u, origin)) urls.push(u);
      });
      if (urls.length > 0) break;
    } catch (_) {}
  }

  return [...new Set(urls)];
}

// ── Helpers ───────────────────────────────────────────────────────────────
function normalizeBase(u) {
  const parsed = new URL(u.startsWith('http') ? u : 'https://' + u);
  return parsed.origin + parsed.pathname.replace(/\/$/, '') + '/';
}

function normalizeUrl(u) {
  try {
    const p = new URL(u);
    return p.origin + p.pathname;
  } catch (_) { return null; }
}

function isSameDomain(u, origin) {
  try { return new URL(u).origin === origin; } catch (_) { return false; }
}

function isAsset(u) {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot|pdf|zip|mp4|mp3)(\?|$)/i.test(u);
}

module.exports = { discoverRoutes };
