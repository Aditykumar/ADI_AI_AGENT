'use strict';
/**
 * Performance Executor — runs Lighthouse audits for Core Web Vitals,
 * accessibility, SEO, best practices.
 */
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

/**
 * Run performance tests for all URLs in the plan.
 * @param {object}   plan  - Full test plan
 * @param {object}   opts  - { targetUrl }
 * @returns {Promise<object[]>}
 */
async function runPerfTests(plan, opts) {
  const { targetUrl } = opts;
  const results = [];

  const perfTests = plan.performance_tests || [];
  if (perfTests.length === 0) {
    // Always test the main URL
    perfTests.push({
      id: 'perf-001', name: 'Main Page Performance', url: targetUrl,
      thresholds: { performance: 80, accessibility: 90, best_practices: 80, seo: 80 },
    });
  }

  for (const test of perfTests) {
    const result = {
      id:          test.id,
      name:        test.name,
      type:        'performance',
      url:         test.url || targetUrl,
      status:      'pass',
      details:     [],
      scores:      {},
      metrics:     {},
      thresholds:  test.thresholds || {},
      duration_ms: 0,
      error:       null,
    };

    const t0 = Date.now();

    try {
      await runLighthouse(result);
    } catch (err) {
      result.status = 'fail';
      result.error  = err.message;
    }

    result.duration_ms = Date.now() - t0;
    results.push(result);
  }

  return results;
}

async function runLighthouse(result) {
  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    const options = {
      logLevel:   'silent',
      output:     'json',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      port:       chrome.port,
      settings: {
        throttlingMethod: 'simulate',
        throttling: {
          rttMs:              40,
          throughputKbps:     10240,
          cpuSlowdownMultiplier: 1,
        },
      },
    };

    const { lhr } = await lighthouse(result.url, options);

    // ── Category scores ─────────────────────────────────────────────────────
    result.scores = {
      performance:    Math.round((lhr.categories.performance?.score    || 0) * 100),
      accessibility:  Math.round((lhr.categories.accessibility?.score  || 0) * 100),
      best_practices: Math.round((lhr.categories['best-practices']?.score || 0) * 100),
      seo:            Math.round((lhr.categories.seo?.score            || 0) * 100),
    };

    // ── Core Web Vitals ──────────────────────────────────────────────────────
    const audits = lhr.audits;
    result.metrics = {
      lcp_ms:     audits['largest-contentful-paint']?.numericValue      || null,
      fcp_ms:     audits['first-contentful-paint']?.numericValue        || null,
      tbt_ms:     audits['total-blocking-time']?.numericValue           || null,
      cls:        audits['cumulative-layout-shift']?.numericValue       || null,
      ttfb_ms:    audits['server-response-time']?.numericValue          || null,
      speed_index:audits['speed-index']?.numericValue                   || null,
      interactive: audits['interactive']?.numericValue                  || null,
    };

    // ── Opportunity audits ───────────────────────────────────────────────────
    const opportunities = Object.values(audits)
      .filter(a => a.details?.type === 'opportunity' && a.numericValue > 0)
      .sort((a, b) => b.numericValue - a.numericValue)
      .slice(0, 5)
      .map(a => `${a.title}: save ~${Math.round(a.numericValue)}ms`);

    result.details.push(`Performance score: ${result.scores.performance}`);
    result.details.push(`Accessibility score: ${result.scores.accessibility}`);
    result.details.push(`Best Practices score: ${result.scores.best_practices}`);
    result.details.push(`SEO score: ${result.scores.seo}`);
    result.details.push(`LCP: ${_fmt(result.metrics.lcp_ms)}ms`);
    result.details.push(`FCP: ${_fmt(result.metrics.fcp_ms)}ms`);
    result.details.push(`TBT: ${_fmt(result.metrics.tbt_ms)}ms`);
    result.details.push(`CLS: ${result.metrics.cls?.toFixed(3) || 'N/A'}`);
    result.details.push(`TTFB: ${_fmt(result.metrics.ttfb_ms)}ms`);

    if (opportunities.length > 0) {
      result.details.push('Top opportunities:');
      opportunities.forEach(o => result.details.push(`  • ${o}`));
    }

    // ── Threshold assertions ─────────────────────────────────────────────────
    const t = result.thresholds;
    const failures = [];

    if (t.performance  && result.scores.performance    < t.performance)  failures.push(`Performance ${result.scores.performance} < ${t.performance}`);
    if (t.accessibility && result.scores.accessibility < t.accessibility) failures.push(`Accessibility ${result.scores.accessibility} < ${t.accessibility}`);
    if (t.best_practices && result.scores.best_practices < t.best_practices) failures.push(`Best Practices ${result.scores.best_practices} < ${t.best_practices}`);
    if (t.seo           && result.scores.seo            < t.seo)           failures.push(`SEO ${result.scores.seo} < ${t.seo}`);
    if (t.lcp_ms        && result.metrics.lcp_ms        > t.lcp_ms)        failures.push(`LCP ${_fmt(result.metrics.lcp_ms)}ms > ${t.lcp_ms}ms`);
    if (t.fcp_ms        && result.metrics.fcp_ms        > t.fcp_ms)        failures.push(`FCP ${_fmt(result.metrics.fcp_ms)}ms > ${t.fcp_ms}ms`);
    if (t.tbt_ms        && result.metrics.tbt_ms        > t.tbt_ms)        failures.push(`TBT ${_fmt(result.metrics.tbt_ms)}ms > ${t.tbt_ms}ms`);
    if (t.cls           && result.metrics.cls           > t.cls)           failures.push(`CLS ${result.metrics.cls?.toFixed(3)} > ${t.cls}`);
    if (t.ttfb_ms       && result.metrics.ttfb_ms       > t.ttfb_ms)       failures.push(`TTFB ${_fmt(result.metrics.ttfb_ms)}ms > ${t.ttfb_ms}ms`);

    if (failures.length > 0) {
      result.status = 'fail';
      failures.forEach(f => result.details.push(`THRESHOLD FAILED: ${f}`));
    } else {
      result.details.push('All thresholds passed');
    }

  } finally {
    if (chrome) await chrome.kill().catch(() => {});
  }
}

function _fmt(v) {
  return v != null ? Math.round(v) : 'N/A';
}

module.exports = { runPerfTests };
