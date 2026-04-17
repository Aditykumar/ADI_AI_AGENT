'use strict';
/**
 * Route Discovery — crawls a site and returns all discovered routes.
 *
 * Sources:
 *  1. robots.txt  → Sitemap directives
 *  2. sitemap.xml → All <loc> entries (recursive sitemapindex)
 *  3. Playwright BFS crawl → internal <a href> links
 *  4. Network interception → XHR / fetch API calls (discovers API routes)
 *  5. SPA pushState detection → client-side routes
 */
const { chromium } = require('playwright');
const axios        = require('axios');
const url          = require('url');

const MAX_PAGES   = 120;   // max pages to crawl
const MAX_DEPTH   = 3;     // BFS depth
const NAV_TIMEOUT = 20000;

/**
 * Discover all routes for a given base URL.
 * @param {string} baseUrl
 * @param {object} opts - { verbose: bool, auth: { token } }
 * @returns {Promise<DiscoveryResult>}
 */
async function discoverRoutes(baseUrl, opts = {}) {
  const { verbose = false, auth = {} } = opts;
  const base    = normalizeBase(baseUrl);
  const origin  = new URL(base).origin;

  const log = (...a) => verbose && process.stdout.write('  [crawl] ' + a.join(' ') + '\n');

  const result = {
    base,
    pages:      [],   // { url, path, title, status, depth, source }
    api_routes: [],   // { url, path, method, source }
    assets:     [],   // { url, type }
    errors:     [],   // { url, error }
    stats:      { crawled: 0, skipped: 0, api_found: 0 },
  };

  // ── 1. Sitemap ─────────────────────────────────────────────────────
  process.stdout.write('  ↳ Fetching sitemap…\n');
  const sitemapUrls = await fetchSitemap(base, origin);
  log(`sitemap: ${sitemapUrls.length} URLs`);

  // ── 2. Playwright crawl ────────────────────────────────────────────
  process.stdout.write('  ↳ Crawling pages (BFS, max ' + MAX_PAGES + ')…\n');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    userAgent: 'AI-TestAgent-Crawler/1.0',
  });

  if (auth.token) {
    await context.addInitScript(`
      try { localStorage.setItem('token', "${auth.token}"); } catch(e) {}
    `);
  }

  // ── Login with credentials before crawling ────────────────────────
  if (auth.username && auth.password) {
    const loginPage = await context.newPage();
    const loginTarget = auth.loginUrl || base;
    process.stdout.write(`  ↳ Logging in at ${loginTarget}…\n`);
    try {
      await loginPage.goto(loginTarget, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const userField = await loginPage.$('input[type="email"], input[name="username"], input[name="email"], input[id*="email"], input[id*="user"], input[placeholder*="email" i], input[placeholder*="user" i]');
      const passField = await loginPage.$('input[type="password"]');
      if (userField && passField) {
        await userField.fill(auth.username);
        await passField.fill(auth.password);
        const submitBtn = await loginPage.$('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
        if (submitBtn) {
          await Promise.all([
            loginPage.waitForNavigation({ timeout: 15000 }).catch(() => {}),
            submitBtn.click(),
          ]);
          process.stdout.write(`  ↳ Login submitted — now at: ${loginPage.url()}\n`);
        }
      }
      await loginPage.close();
    } catch (e) {
      process.stdout.write(`  ↳ Login attempt failed: ${e.message}\n`);
      await loginPage.close();
    }
  }

  const visited    = new Set();
  const apiSeen    = new Set();
  const queue      = [];  // { url, depth }

  // Seed queue with base + sitemap URLs
  queue.push({ url: base, depth: 0 });
  for (const u of sitemapUrls.slice(0, 50)) {
    if (isSameDomain(u, origin)) queue.push({ url: u, depth: 1 });
  }

  const page = await context.newPage();

  // Intercept network to find API routes
  await page.route('**/*', async (route) => {
    const req     = route.request();
    const reqUrl  = req.url();
    const reqType = req.resourceType();
    const method  = req.method();

    // Skip assets we don't care about for routing
    if (['image', 'stylesheet', 'font', 'media'].includes(reqType)) {
      await route.continue();
      return;
    }

    // Capture XHR / fetch calls as API routes
    if (['xhr', 'fetch'].includes(reqType) && isSameDomain(reqUrl, origin)) {
      const parsed = new URL(reqUrl);
      const key    = `${method}:${parsed.pathname}`;
      if (!apiSeen.has(key)) {
        apiSeen.add(key);
        result.api_routes.push({
          url:    reqUrl,
          path:   parsed.pathname + (parsed.search || ''),
          method: method.toUpperCase(),
          source: 'network-intercept',
        });
        result.stats.api_found++;
        log(`API: ${method} ${parsed.pathname}`);
      }
    }
    await route.continue();
  });

  // Listen for client-side navigation (SPA pushState)
  await page.exposeFunction('__onPushState', (newPath) => {
    const full = origin + newPath;
    if (!visited.has(full) && visited.size < MAX_PAGES) {
      queue.push({ url: full, depth: 1 });
    }
  });
  await page.addInitScript(() => {
    const orig = history.pushState.bind(history);
    history.pushState = function(state, title, url) {
      orig(state, title, url);
      if (url && typeof window.__onPushState === 'function') window.__onPushState(url);
    };
  });

  while (queue.length > 0 && result.stats.crawled < MAX_PAGES) {
    const { url: nextUrl, depth } = queue.shift();
    const normalized = normalizeUrl(nextUrl);
    if (!normalized || visited.has(normalized) || !isSameDomain(normalized, origin)) continue;

    visited.add(normalized);

    try {
      const res = await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      const status = res?.status() || 0;
      const title  = await page.title().catch(() => '');
      const path   = new URL(normalized).pathname;

      log(`[${status}] ${path}`);
      result.stats.crawled++;

      if (status >= 400) {
        result.errors.push({ url: normalized, error: `HTTP ${status}` });
        continue;
      }

      result.pages.push({ url: normalized, path, title, status, depth, source: 'crawl' });

      // Don't go deeper than MAX_DEPTH
      if (depth < MAX_DEPTH) {
        const links = await extractInternalLinks(page, origin);
        for (const link of links) {
          const norm = normalizeUrl(link);
          if (norm && !visited.has(norm) && isSameDomain(norm, origin)) {
            queue.push({ url: norm, depth: depth + 1 });
          }
        }
      }

      // Small delay to avoid hammering
      await page.waitForTimeout(200);
    } catch (err) {
      result.errors.push({ url: normalized, error: err.message.substring(0, 100) });
      result.stats.skipped++;
    }
  }

  await browser.close();

  // ── 3. Add sitemap-only pages (not found by crawl) ─────────────────
  const crawledUrls = new Set(result.pages.map(p => p.url));
  for (const su of sitemapUrls) {
    if (!crawledUrls.has(su) && isSameDomain(su, origin)) {
      const path = new URL(su).pathname;
      result.pages.push({ url: su, path, title: '', status: 0, depth: 0, source: 'sitemap' });
    }
  }

  // ── 4. Deduplicate & sort ─────────────────────────────────────────
  result.pages      = dedupe(result.pages,      'url');
  result.api_routes = dedupe(result.api_routes, v => `${v.method}:${v.path}`);

  // Sort pages by path
  result.pages.sort((a, b) => a.path.localeCompare(b.path));
  result.api_routes.sort((a, b) => a.path.localeCompare(b.path));

  process.stdout.write(
    `  ↳ Done — ${result.pages.length} pages, ${result.api_routes.length} API routes\n`
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sitemap fetcher (supports sitemap index)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSitemap(base, origin) {
  const candidates = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap/`,
    `${base}/page-sitemap.xml`,
  ];

  // Also check robots.txt for Sitemap: lines
  try {
    const robots = await axios.get(`${base}/robots.txt`, { timeout: 8000, validateStatus: () => true });
    if (robots.status === 200) {
      const sitemapLines = robots.data.split('\n')
        .filter(l => l.toLowerCase().startsWith('sitemap:'))
        .map(l => l.split(':').slice(1).join(':').trim());
      candidates.unshift(...sitemapLines);
    }
  } catch (_) {}

  const urls = new Set();

  for (const candidate of candidates.slice(0, 5)) {
    try {
      const res = await axios.get(candidate, {
        timeout: 10000, validateStatus: () => true,
        headers: { 'User-Agent': 'AI-TestAgent-Crawler/1.0' },
      });
      if (res.status !== 200) continue;

      const xml  = res.data;
      const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());

      // If it's a sitemap index, fetch nested sitemaps
      if (xml.includes('<sitemapindex')) {
        for (const subLoc of locs.slice(0, 5)) {
          try {
            const sub = await axios.get(subLoc, { timeout: 8000, validateStatus: () => true });
            if (sub.status === 200) {
              const subLocs = [...sub.data.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
              subLocs.forEach(u => isSameDomain(u, origin) && urls.add(u));
            }
          } catch (_) {}
        }
      } else {
        locs.forEach(u => isSameDomain(u, origin) && urls.add(u));
      }

      if (urls.size > 0) break; // found valid sitemap
    } catch (_) {}
  }

  return [...urls];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function extractInternalLinks(page, origin) {
  try {
    return await page.$$eval('a[href]', (els, origin) =>
      els
        .map(el => el.href)
        .filter(h => h && h.startsWith(origin) && !h.match(/\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|css|js|woff|ttf|map)(\?|$)/i))
      , origin
    );
  } catch (_) {
    return [];
  }
}

function normalizeBase(u) {
  return u.replace(/\/$/, '');
}

function normalizeUrl(u) {
  try {
    const parsed = new URL(u);
    parsed.hash  = '';
    // Remove common tracking params
    ['utm_source','utm_medium','utm_campaign','ref','fbclid'].forEach(p => parsed.searchParams.delete(p));
    return parsed.toString().replace(/\/$/, '') || null;
  } catch (_) {
    return null;
  }
}

function isSameDomain(u, origin) {
  try { return new URL(u).origin === origin; } catch (_) { return false; }
}

function dedupe(arr, keyFn) {
  const seen = new Set();
  const fn   = typeof keyFn === 'function' ? keyFn : v => v[keyFn];
  return arr.filter(item => {
    const k = fn(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = { discoverRoutes };
