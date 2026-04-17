'use strict';
/**
 * Assertions Engine — post-processes all executor results,
 * computes summary statistics, and classifies overall test health.
 */

/**
 * Process raw results from all executors.
 * Returns enriched summary with pass/fail/warn/skip counts,
 * severity-weighted score, and actionable recommendations.
 *
 * @param {object} rawResults  - { ui, api, performance, security }
 * @returns {object}           - Processed assertion report
 */
function processResults(rawResults) {
  const { ui = [], api = [], performance = [], security = [] } = rawResults;

  const allResults = [
    ...tag(ui,          'UI'),
    ...tag(api,         'API'),
    ...tag(performance, 'Performance'),
    ...tag(security,    'Security'),
  ];

  const summary = computeSummary(allResults);
  const recommendations = buildRecommendations(rawResults);

  return {
    summary,
    ui:          applyAssertions(ui),
    api:         applyAssertions(api),
    performance: applyAssertions(performance),
    security:    applyAssertions(security),
    all:         allResults,
    recommendations,
    overall_status: deriveOverallStatus(summary),
    score: computeScore(summary, security),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function tag(results, category) {
  return results.map(r => ({ ...r, category }));
}

function applyAssertions(results) {
  return results.map(r => {
    const enriched = { ...r };

    // Normalize status
    if (!['pass', 'fail', 'warn', 'skip', 'error'].includes(r.status)) {
      enriched.status = 'pass';
    }

    // Add severity tag to security results
    if (r.severity) {
      enriched.severity_label = severityLabel(r.severity);
    }

    return enriched;
  });
}

function computeSummary(results) {
  const counts = { pass: 0, fail: 0, warn: 0, skip: 0, error: 0 };
  const byCategory = {};

  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;

    if (!byCategory[r.category]) {
      byCategory[r.category] = { pass: 0, fail: 0, warn: 0, skip: 0, error: 0, total: 0 };
    }
    byCategory[r.category][r.status]++;
    byCategory[r.category].total++;
  }

  return {
    total:       results.length,
    ...counts,
    by_category: byCategory,
  };
}

function deriveOverallStatus(summary) {
  if (summary.fail > 0 || summary.error > 0) return 'FAIL';
  if (summary.warn > 0)                       return 'WARN';
  return 'PASS';
}

/**
 * Compute a 0–100 health score.
 * Security critical/high failures are weighted more heavily.
 */
function computeScore(summary, securityResults) {
  if (summary.total === 0) return 0;

  const active = summary.total - summary.skip;
  if (active === 0) return 100;

  // Base score from pass ratio
  let base = ((summary.pass + summary.warn * 0.5) / active) * 100;

  // Penalize critical/high security failures
  const criticalFails = securityResults.filter(
    r => r.status === 'fail' && ['critical', 'high'].includes(r.severity)
  ).length;
  base = Math.max(0, base - criticalFails * 10);

  return Math.round(base);
}

function buildRecommendations(rawResults) {
  const recs = [];
  const { ui = [], api = [], performance = [], security = [] } = rawResults;

  // ── Security recommendations ─────────────────────────────────────────────
  const missingHeaders = security
    .filter(r => r.name === 'Security Headers Audit' && r.status !== 'pass')
    .flatMap(r => r.details.filter(d => d.startsWith('✗ MISSING')).map(d => d.replace('✗ MISSING ', '').split(' ')[0]));

  if (missingHeaders.length > 0) {
    recs.push({
      category: 'Security',
      severity: 'high',
      title: 'Add missing HTTP security headers',
      description: `Missing headers: ${missingHeaders.join(', ')}`,
      guidance: 'Configure your web server / CDN to add these headers on all responses.',
    });
  }

  const hasExposure = security.some(r => r.name?.includes('Sensitive File') && r.status === 'fail');
  if (hasExposure) {
    recs.push({
      category: 'Security',
      severity: 'critical',
      title: 'Sensitive files are publicly accessible',
      description: 'Files like .env, .git/config, or database dumps are served by the web server.',
      guidance: 'Add server-level deny rules (nginx: location ~ /\\.  { deny all; }) and move secrets out of the web root.',
    });
  }

  const corsIssue = security.find(r => r.name === 'CORS Policy' && r.status !== 'pass');
  if (corsIssue) {
    recs.push({
      category: 'Security',
      severity: 'high',
      title: 'Review CORS configuration',
      description: 'CORS policy may be overly permissive.',
      guidance: 'Use an explicit allowlist of trusted origins. Never combine Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true.',
    });
  }

  const noRateLimit = security.some(r => r.name?.includes('Rate Limit') && r.status === 'warn');
  if (noRateLimit) {
    recs.push({
      category: 'Security',
      severity: 'high',
      title: 'Implement rate limiting on authentication endpoints',
      description: 'No rate limiting detected on login — brute-force attacks are possible.',
      guidance: 'Use tools like express-rate-limit, nginx limit_req_zone, or an API gateway with rate limiting.',
    });
  }

  // ── Performance recommendations ──────────────────────────────────────────
  for (const p of performance) {
    if (p.scores?.performance < 50) {
      recs.push({
        category: 'Performance',
        severity: 'high',
        title: `Low performance score (${p.scores.performance}) on ${p.name}`,
        description: 'Page performance is significantly below the recommended 80 threshold.',
        guidance: 'Optimize images, reduce JavaScript bundle size, enable caching, use a CDN.',
      });
    }
    if (p.metrics?.lcp_ms > 4000) {
      recs.push({
        category: 'Performance',
        severity: 'medium',
        title: `High LCP (${Math.round(p.metrics.lcp_ms)}ms) on ${p.name}`,
        description: 'Largest Contentful Paint is very slow (>4s).',
        guidance: 'Optimize server response time, preload critical assets, optimize hero images, reduce render-blocking resources.',
      });
    }
    if (p.metrics?.cls > 0.25) {
      recs.push({
        category: 'Performance',
        severity: 'medium',
        title: `High Cumulative Layout Shift (${p.metrics.cls?.toFixed(3)})`,
        description: 'Significant layout shifts degrade user experience.',
        guidance: 'Set explicit dimensions on images/videos, avoid inserting content above existing content.',
      });
    }
  }

  // ── Accessibility recommendations ────────────────────────────────────────
  const a11yWarnings = ui.filter(r => r.tags?.includes?.('accessibility') && r.status === 'warn');
  if (a11yWarnings.length > 0) {
    recs.push({
      category: 'Accessibility',
      severity: 'medium',
      title: 'Accessibility issues detected',
      description: 'Images missing alt text, inputs without labels, or heading hierarchy issues found.',
      guidance: 'Add descriptive alt text, associate labels with form inputs, ensure one H1 per page.',
    });
  }

  // ── API recommendations ──────────────────────────────────────────────────
  const unprotected = api.filter(r => r.status === 'fail' && r.details?.some(d => d.includes('not protected')));
  if (unprotected.length > 0) {
    recs.push({
      category: 'API Security',
      severity: 'critical',
      title: 'Unprotected API endpoints found',
      description: `${unprotected.length} endpoint(s) accessible without authentication.`,
      guidance: 'Apply authentication middleware to all sensitive API routes.',
    });
  }

  // Sort by severity
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  recs.sort((a, b) => (order[a.severity] || 4) - (order[b.severity] || 4));

  return recs;
}

function severityLabel(severity) {
  const map = { critical: '🔴 CRITICAL', high: '🟠 HIGH', medium: '🟡 MEDIUM', low: '🔵 LOW', info: 'ℹ INFO' };
  return map[severity] || severity.toUpperCase();
}

module.exports = { processResults };
