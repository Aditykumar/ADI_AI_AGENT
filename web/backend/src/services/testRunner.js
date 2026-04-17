'use strict';
/**
 * Web Test Runner — adapts the CLI executors for the web backend.
 * Runs in background, streams progress via SSE, stores result in SQLite.
 */
const { v4: uuid }    = require('uuid');
const path            = require('path');
const fs              = require('fs');

const { runUITests }       = require('../../../../src/executors/uiExecutor');
const { runAPITests }      = require('../../../../src/executors/apiExecutor');
const { runPerfTests }     = require('../../../../src/executors/perfExecutor');
const { runSecurityTests } = require('../../../../src/executors/securityExecutor');
const { processResults }   = require('../../../../src/assertions/engine');
const { generateReport }   = require('../../../../src/reporters/generator');
const { generateTestPlan, defaultTestPlan } = require('../../../../src/agent/testPlanner');
const { discoverRoutes }   = require('../../../../src/crawler/routeDiscovery');

const { updateReport, updateRun } = require('../db/database');

// ── Active SSE clients: runId → Set of res objects ───────────────────
const sseClients = new Map();

function addSSEClient(runId, res) {
  if (!sseClients.has(runId)) sseClients.set(runId, new Set());
  sseClients.get(runId).add(res);
}

function removeSSEClient(runId, res) {
  sseClients.get(runId)?.delete(res);
}

function sendSSE(runId, event, data) {
  const clients = sseClients.get(runId);
  if (!clients) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (_) { clients.delete(res); }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main runner — called from route handler, NOT awaited
// ─────────────────────────────────────────────────────────────────────
async function runTests(params) {
  const {
    runId, reportId, userId,
    targetUrl, apiUrl,
    selectedPages = [], selectedApiRoutes = [],
    testTypes = { ui: true, api: true, perf: true, security: true },
    skipAI = false, authOpts = {},
  } = params;

  const emit = (phase, message, progress) => {
    sendSSE(runId, 'progress', { phase, message, progress });
    updateRun(runId, { phase, progress });
  };

  // Live browser action emitter — sends screenshots + action logs to frontend
  const emitAction = (type, data) => sendSSE(runId, 'action', { type, ...data, ts: Date.now() });

  const reportsDir    = path.resolve(process.env.REPORTS_DIR    || './data/reports');
  const screenshotsDir = path.resolve(process.env.SCREENSHOTS_DIR || './data/screenshots');
  fs.mkdirSync(reportsDir,     { recursive: true });
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // Override config paths for this run
  process.env.REPORTS_DIR     = reportsDir;
  process.env.SCREENSHOTS_DIR = screenshotsDir;

  try {
    emit('plan', 'Generating test plan…', 5);

    // ── Build test plan ──────────────────────────────────────────────
    let plan;
    if (skipAI) {
      plan = defaultTestPlan(targetUrl, apiUrl || targetUrl);
    } else {
      try {
        plan = await generateTestPlan({ url: targetUrl, apiBaseUrl: apiUrl || targetUrl });
      } catch (_) {
        plan = defaultTestPlan(targetUrl, apiUrl || targetUrl);
      }
    }

    // If specific routes were selected, override plan with those routes
    if (selectedPages.length > 0 || selectedApiRoutes.length > 0) {
      plan = buildDynamicPlan(selectedPages, selectedApiRoutes, apiUrl || targetUrl);
    }

    emit('plan', `Test plan ready — ${countPlanTests(plan)} tests`, 10);

    const rawResults = { ui: [], api: [], performance: [], security: [] };

    // ── UI Tests ─────────────────────────────────────────────────────
    if (testTypes.ui) {
      emit('ui', 'Running UI & SSO tests (Playwright)…', 20);
      try {
        const targets = selectedPages.length > 0
          ? selectedPages
          : [{ url: targetUrl, path: '/' }];

        for (let i = 0; i < targets.length; i++) {
          const t   = targets[i];
          const pct = 20 + Math.floor((i / targets.length) * 20);
          emit('ui', `UI test: ${t.path || t.url}`, pct);

          const results = await runUITests(plan, { targetUrl: t.url || targetUrl, auth: authOpts, emitAction });
          rawResults.ui.push(...results);
        }
        emit('ui', `UI done — ${rawResults.ui.filter(r => r.status === 'pass').length} pass`, 40);
      } catch (e) {
        emit('ui', `UI error: ${e.message}`, 40);
        rawResults.ui.push(errResult('ui-err', 'UI Error', e));
      }
    }

    // ── API Tests ─────────────────────────────────────────────────────
    if (testTypes.api) {
      emit('api', 'Running API tests (Axios)…', 45);
      try {
        rawResults.api = await runAPITests(plan, {
          apiBaseUrl: apiUrl || targetUrl,
          apiKey:     authOpts.apiKey || '',
          auth:       authOpts,
          emitAction,
        });
        emit('api', `API done — ${rawResults.api.filter(r => r.status === 'pass').length} pass`, 60);
      } catch (e) {
        emit('api', `API error: ${e.message}`, 60);
        rawResults.api.push(errResult('api-err', 'API Error', e));
      }
    }

    // ── Performance ───────────────────────────────────────────────────
    if (testTypes.perf) {
      const perfTargets = selectedPages.length > 0
        ? selectedPages.slice(0, 5)   // cap at 5 pages for performance
        : [{ url: targetUrl, path: '/' }];

      for (let i = 0; i < perfTargets.length; i++) {
        const t   = perfTargets[i];
        const pct = 60 + Math.floor((i / perfTargets.length) * 15);
        emit('perf', `Lighthouse: ${t.path || t.url}`, pct);
        try {
          const res = await runPerfTests(
            { performance_tests: [{ id: `perf-${i}`, name: `Perf: ${t.path || '/'}`, url: t.url || targetUrl,
                thresholds: { performance: 70, accessibility: 80, best_practices: 75, seo: 75 } }] },
            { targetUrl: t.url || targetUrl }
          );
          rawResults.performance.push(...res);
        } catch (e) {
          rawResults.performance.push(errResult(`perf-err-${i}`, `Lighthouse Error: ${t.path}`, e));
        }
      }
      emit('perf', `Performance done — ${rawResults.performance.length} audits`, 75);
    }

    // ── Security ──────────────────────────────────────────────────────
    if (testTypes.security) {
      emit('security', 'Running security tests…', 78);
      try {
        const SECURITY_TIMEOUT = 90000; // 90s max
        rawResults.security = await Promise.race([
          runSecurityTests(plan, {
            targetUrl,
            apiBaseUrl:  apiUrl || targetUrl,
            apiKey:      authOpts.apiKey || '',
            auth:        authOpts,
            emitAction,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Security phase timed out after 90s')), SECURITY_TIMEOUT)
          ),
        ]);
        const fails = rawResults.security.filter(r => r.status === 'fail').length;
        emit('security', `Security done — ${fails} issue(s) found`, 90);
      } catch (e) {
        emit('security', `Security: ${e.message}`, 90);
        rawResults.security.push(errResult('sec-timeout', 'Security Timeout', e));
      }
    }

    // ── Assertions + Report ───────────────────────────────────────────
    emit('report', 'Processing results & generating report…', 93);

    const processed = processResults(rawResults);
    const { htmlPath, jsonPath } = await generateReport(processed, {
      targetUrl,
      testPlanSource: skipAI ? 'default' : (process.env.AI_PROVIDER || 'ollama'),
      discoveredRoutes: selectedPages.length > 0
        ? { pages: selectedPages, api: selectedApiRoutes }
        : null,
    });

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsonContent = fs.readFileSync(jsonPath, 'utf8');

    // ── Save to DB ────────────────────────────────────────────────────
    updateReport(reportId, {
      status:         'completed',
      score:          processed.score,
      overall_status: processed.overall_status,
      summary_json:   JSON.stringify(processed.summary),
      html_report:    htmlContent,
      json_report:    jsonContent,
      routes_count:   selectedPages.length + selectedApiRoutes.length,
      completed_at:   new Date().toISOString(),
    });

    updateRun(runId, { status: 'completed', phase: 'done', progress: 100 });

    sendSSE(runId, 'complete', {
      reportId,
      score:          processed.score,
      overall_status: processed.overall_status,
      summary:        processed.summary,
    });

    emit('done', 'Testing complete!', 100);

  } catch (err) {
    console.error(`[testRunner] Run ${runId} failed:`, err.message);
    updateReport(reportId, { status: 'failed', completed_at: new Date().toISOString() });
    updateRun(runId,   { status: 'failed', phase: 'error', progress: 100 });
    sendSSE(runId, 'error', { message: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function buildDynamicPlan(pages, apiRoutes, apiBase) {
  return {
    ui_tests: pages.map((p, i) => ({
      id: `ui-dyn-${i}`, name: `Page: ${p.path}`, tags: ['smoke'],
      description: `Load ${p.url}`, steps: ['Navigate', 'Check'], expected: 'Page loads',
    })),
    api_tests: apiRoutes.map((a, i) => ({
      id: `api-dyn-${i}`, name: `${a.method} ${a.path}`,
      method: a.method, endpoint: a.path,
      headers: {}, body: null, expected_status: 200, expected_fields: [], tags: ['discovered'],
    })),
    performance_tests: pages.slice(0, 3).map((p, i) => ({
      id: `perf-dyn-${i}`, name: `Perf: ${p.path}`, url: p.url,
      thresholds: { performance: 70, accessibility: 80, best_practices: 75, seo: 75 },
    })),
    security_tests: [],
    sso_tests: [],
  };
}

function countPlanTests(plan) {
  return ['ui_tests','api_tests','performance_tests','security_tests','sso_tests']
    .reduce((s, k) => s + (plan[k]||[]).length, 0);
}

function errResult(id, name, err) {
  return { id, name, type: 'error', status: 'error', error: err.message, details: [], duration_ms: 0 };
}

module.exports = { runTests, addSSEClient, removeSSEClient, sendSSE };
