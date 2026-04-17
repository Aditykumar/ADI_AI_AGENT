'use strict';
/**
 * UI Executor — runs Playwright tests from a test plan.
 * Handles navigation, form interaction, SSO flows, responsive checks,
 * accessibility checks, and screenshot capture.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const cfg  = require('../../config/config');

fs.mkdirSync(cfg.output.screenshotsDir, { recursive: true });

/**
 * Run all UI + SSO tests in the plan.
 * @param {object} plan  - Full test plan (ui_tests + sso_tests)
 * @param {object} opts  - { targetUrl, auth }
 * @returns {Promise<object[]>} Array of test results
 */
async function runUITests(plan, opts) {
  const { targetUrl, auth } = opts;
  const results = [];

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport:          { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  // ── Inject auth token / cookies if available ──────────────────────────────
  if (auth.token) {
    await context.addInitScript(`
      window.__AUTH_TOKEN__ = "${auth.token}";
      try { localStorage.setItem('token', "${auth.token}"); } catch(e){}
    `);
  }

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // ── Run each UI test ───────────────────────────────────────────────────────
  const allTests = [...(plan.ui_tests || []), ...(plan.sso_tests || [])];

  for (const test of allTests) {
    const result = {
      id:          test.id,
      name:        test.name,
      type:        test.tags?.includes('sso') ? 'sso' : 'ui',
      status:      'pass',
      details:     [],
      screenshots: [],
      duration_ms: 0,
      error:       null,
    };

    const t0 = Date.now();

    try {
      await runSingleUITest(page, test, targetUrl, auth, result, context);
    } catch (err) {
      result.status = 'fail';
      result.error  = err.message;
      // Screenshot on failure
      const shot = path.join(cfg.output.screenshotsDir, `${test.id}_fail.png`);
      try { await page.screenshot({ path: shot, fullPage: true }); result.screenshots.push(shot); } catch (_) {}
    }

    result.duration_ms = Date.now() - t0;
    results.push(result);
  }

  await browser.close();
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual test handlers
// ─────────────────────────────────────────────────────────────────────────────
async function runSingleUITest(page, test, targetUrl, auth, result, context) {
  const tags = test.tags || [];
  const name = test.name.toLowerCase();

  // Page load / smoke
  if (tags.includes('smoke') || name.includes('load') || name.includes('home')) {
    await testPageLoad(page, targetUrl, result);
    return;
  }

  // Responsive
  if (tags.includes('responsive') || name.includes('responsive') || name.includes('mobile')) {
    await testResponsive(page, targetUrl, result, context);
    return;
  }

  // Console errors
  if (name.includes('console') || name.includes('error')) {
    await testConsoleErrors(page, targetUrl, result);
    return;
  }

  // Forms
  if (tags.includes('forms') || name.includes('form')) {
    await testForms(page, targetUrl, result);
    return;
  }

  // Navigation links
  if (tags.includes('navigation') || name.includes('nav') || name.includes('link')) {
    await testNavigation(page, targetUrl, result);
    return;
  }

  // Accessibility
  if (tags.includes('accessibility') || name.includes('access') || name.includes('aria')) {
    await testAccessibility(page, targetUrl, result);
    return;
  }

  // 404 / error page
  if (name.includes('404') || name.includes('error page') || name.includes('not found')) {
    await test404Page(page, targetUrl, result);
    return;
  }

  // Auth / SSO login
  if (tags.includes('auth') || tags.includes('sso') || name.includes('login') || name.includes('sso')) {
    await testAuthFlow(page, targetUrl, auth, result);
    return;
  }

  // Logout
  if (name.includes('logout')) {
    await testLogout(page, targetUrl, auth, result);
    return;
  }

  // Generic — run page load as default
  await testPageLoad(page, targetUrl, result);
}

// ── Page load ──────────────────────────────────────────────────────────────
async function testPageLoad(page, url, result) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const status = res?.status() || 0;

  result.details.push(`HTTP status: ${status}`);

  if (status < 200 || status >= 400) {
    throw new Error(`Page returned HTTP ${status}`);
  }

  // Check title
  const title = await page.title();
  result.details.push(`Title: "${title}"`);
  if (!title) result.details.push('Warning: Empty page title');

  // Check body has content
  const bodyText = await page.$eval('body', el => el.innerText.length);
  result.details.push(`Body text length: ${bodyText} chars`);
  if (bodyText < 10) throw new Error('Page body appears empty');

  const shot = path.join(cfg.output.screenshotsDir, 'page_load.png');
  await page.screenshot({ path: shot, fullPage: false });
  result.screenshots.push(shot);
}

// ── Responsive ─────────────────────────────────────────────────────────────
async function testResponsive(page, url, result, context) {
  const viewports = [
    { name: 'Mobile',  width: 375,  height: 812  },
    { name: 'Tablet',  width: 768,  height: 1024 },
    { name: 'Desktop', width: 1440, height: 900  },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const hasHorzScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );

    result.details.push(`${vp.name} (${vp.width}px): horizontal scroll = ${hasHorzScroll}`);
    if (hasHorzScroll) result.status = 'warn';

    const shot = path.join(cfg.output.screenshotsDir, `responsive_${vp.name.toLowerCase()}.png`);
    await page.screenshot({ path: shot });
    result.screenshots.push(shot);
  }
}

// ── Console errors ─────────────────────────────────────────────────────────
async function testConsoleErrors(page, url, result) {
  const errors = [];
  const listener = msg => { if (msg.type() === 'error') errors.push(msg.text()); };
  page.on('console', listener);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  page.off('console', listener);

  result.details.push(`Console errors found: ${errors.length}`);
  errors.forEach(e => result.details.push(`  ERROR: ${e.substring(0, 200)}`));

  if (errors.length > 0) {
    const critical = errors.filter(e => !e.includes('favicon') && !e.includes('analytics'));
    if (critical.length > 0) {
      result.status = 'warn';
      result.details.push(`Critical errors (non-analytics): ${critical.length}`);
    }
  }
}

// ── Navigation links ────────────────────────────────────────────────────────
async function testNavigation(page, url, result) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const links = await page.$$eval(
    'nav a, header a, [role="navigation"] a',
    els => els.slice(0, 10).map(el => ({ text: el.innerText.trim(), href: el.href }))
  );

  result.details.push(`Nav links found: ${links.length}`);

  let broken = 0;
  for (const link of links) {
    if (!link.href || link.href.startsWith('javascript') || link.href === '#') continue;
    try {
      const res = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const s = res?.status() || 0;
      result.details.push(`  [${s}] ${link.text || link.href}`);
      if (s >= 400) broken++;
    } catch (e) {
      result.details.push(`  [ERR] ${link.href}: ${e.message}`);
      broken++;
    }
  }

  if (broken > 0) {
    result.status = 'warn';
    result.details.push(`Broken links: ${broken}`);
  }
}

// ── Forms ──────────────────────────────────────────────────────────────────
async function testForms(page, url, result) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const forms = await page.$$('form');
  result.details.push(`Forms found: ${forms.length}`);

  if (forms.length === 0) {
    result.details.push('No forms found on page');
    return;
  }

  // Check first form
  const form = forms[0];
  const inputs = await form.$$('input:not([type="hidden"]), textarea, select');
  result.details.push(`Form inputs: ${inputs.length}`);

  for (const input of inputs.slice(0, 5)) {
    const type = await input.getAttribute('type') || 'text';
    const name = await input.getAttribute('name') || await input.getAttribute('id') || 'unknown';
    if (['text', 'email', 'search', 'tel'].includes(type)) {
      await input.fill('test_value');
      result.details.push(`  Filled input[${type}][name=${name}]`);
    }
  }

  // Check form has labels
  const labels = await page.$$('label[for], label input, label textarea');
  result.details.push(`Labeled inputs: ${labels.length}`);
  if (labels.length < inputs.length) {
    result.status = 'warn';
    result.details.push('Warning: Some inputs may lack accessible labels');
  }
}

// ── Accessibility ──────────────────────────────────────────────────────────
async function testAccessibility(page, url, result) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Images without alt text
  const imgsWithoutAlt = await page.$$eval(
    'img:not([alt])',
    els => els.length
  );
  result.details.push(`Images without alt text: ${imgsWithoutAlt}`);

  // Inputs without labels
  const inputsWithoutLabel = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])')];
    return inputs.filter(inp => {
      const id = inp.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAria  = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');
      const inLabel  = inp.closest('label');
      return !hasLabel && !hasAria && !inLabel;
    }).length;
  });
  result.details.push(`Inputs without labels: ${inputsWithoutLabel}`);

  // Heading hierarchy
  const headings = await page.$$eval('h1,h2,h3,h4,h5,h6', els =>
    els.map(el => ({ tag: el.tagName, text: el.innerText.substring(0, 60) }))
  );
  const h1Count = headings.filter(h => h.tag === 'H1').length;
  result.details.push(`H1 count: ${h1Count} (should be 1)`);
  if (h1Count !== 1) result.status = 'warn';

  // Buttons with no accessible text
  const badButtons = await page.$$eval(
    'button:not([aria-label]):not([aria-labelledby])',
    els => els.filter(b => !b.innerText.trim()).length
  );
  result.details.push(`Icon-only buttons missing aria-label: ${badButtons}`);

  if (imgsWithoutAlt > 0 || inputsWithoutLabel > 0 || badButtons > 0) {
    result.status = 'warn';
  }
}

// ── 404 page ────────────────────────────────────────────────────────────────
async function test404Page(page, url, result) {
  const testUrl = url.replace(/\/$/, '') + '/nonexistent-page-xyz-404-test';
  const res = await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const status = res?.status() || 0;
  result.details.push(`404 page HTTP status: ${status}`);

  const bodyText = await page.$eval('body', el => el.innerText.toLowerCase());
  const has404Content = bodyText.includes('not found') || bodyText.includes('404') || bodyText.includes('page not found');
  result.details.push(`404 content detected: ${has404Content}`);

  if (status !== 404) {
    result.status = 'warn';
    result.details.push(`Warning: Server returned ${status} instead of 404`);
  }

  const shot = path.join(cfg.output.screenshotsDir, 'page_404.png');
  await page.screenshot({ path: shot });
  result.screenshots.push(shot);
}

// ── Auth / SSO login flow ───────────────────────────────────────────────────
async function testAuthFlow(page, url, auth, result) {
  const loginUrl = auth.loginUrl || url + '/login';
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  result.details.push(`Login URL: ${loginUrl}`);

  // Check for SSO button
  const ssoBtn = await page.$('[data-provider], [href*="oauth"], [href*="sso"], button:has-text("Sign in with"), a:has-text("SSO")');
  if (ssoBtn) {
    result.details.push('SSO button/link detected on login page');
    result.status = 'pass';
    result.details.push('Note: SSO redirect not followed in automated test (requires IdP interaction)');
  }

  // Try standard login form
  const usernameField = await page.$('input[type="email"], input[name="username"], input[name="email"], input[id*="email"], input[id*="user"]');
  const passwordField = await page.$('input[type="password"]');

  if (usernameField && passwordField && auth.username && auth.password) {
    await usernameField.fill(auth.username);
    await passwordField.fill(auth.password);

    const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
        submitBtn.click(),
      ]);
      const currentUrl = page.url();
      result.details.push(`After login URL: ${currentUrl}`);
      const isLoggedIn = !currentUrl.includes('/login') && !currentUrl.includes('/auth');
      result.details.push(`Authenticated: ${isLoggedIn}`);
      if (!isLoggedIn) {
        result.status = 'warn';
        result.details.push('Warning: Still on login/auth page after submission');
      }
    } else {
      result.details.push('No submit button found in login form');
      result.status = 'warn';
    }
  } else if (!auth.username) {
    result.details.push('No auth credentials configured — skipping login test');
    result.status = 'skip';
  } else {
    result.details.push('Login form inputs not found');
    result.status = 'warn';
  }

  const shot = path.join(cfg.output.screenshotsDir, 'auth_flow.png');
  await page.screenshot({ path: shot });
  result.screenshots.push(shot);
}

// ── Logout ──────────────────────────────────────────────────────────────────
async function testLogout(page, url, auth, result) {
  // Try to find logout button
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const logoutEl = await page.$('a:has-text("Logout"), a:has-text("Sign out"), button:has-text("Logout"), [href*="logout"]');

  if (logoutEl) {
    await logoutEl.click();
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    result.details.push(`After logout URL: ${currentUrl}`);
    const isLoggedOut = currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl === url || currentUrl === url + '/';
    result.details.push(`Session cleared (redirected to login/home): ${isLoggedOut}`);
    if (!isLoggedOut) result.status = 'warn';
  } else {
    result.details.push('Logout element not found on page');
    result.status = 'skip';
  }
}

module.exports = { runUITests };
