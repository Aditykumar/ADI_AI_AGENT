'use strict';
/**
 * Orchestrator — two modes:
 *
 *  Standard mode:  test a single URL with an AI-generated plan
 *  Discover mode:  crawl → filter routes → test each selected route
 */
const chalk = require('chalk');
const ora   = require('ora');

const { generateTestPlan, defaultTestPlan } = require('./agent/testPlanner');
const { runUITests }       = require('./executors/uiExecutor');
const { runAPITests }      = require('./executors/apiExecutor');
const { runPerfTests }     = require('./executors/perfExecutor');
const { runSecurityTests } = require('./executors/securityExecutor');
const { processResults }   = require('./assertions/engine');
const { generateReport }   = require('./reporters/generator');
const { providerStatus }   = require('./agent/aiClient');
const { discoverRoutes }   = require('./crawler/routeDiscovery');
const { selectRoutes }     = require('./cli/routeFilter');
const cfg = require('../config/config');

// ─────────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────────
async function run(options) {
  const {
    url, apiBaseUrl, apiKey,
    auth = {},
    uiOnly, apiOnly, perfOnly, securityOnly,
    skipAI, extra,
    discover = false,   // NEW: dynamic route-discovery mode
  } = options;

  const targetUrl   = url           || cfg.target.url;
  const apiBase     = apiBaseUrl    || cfg.target.apiBaseUrl || targetUrl;
  const resolvedKey = apiKey        || cfg.target.apiKey;
  const resolvedAuth = {
    username:      auth.username      || cfg.auth.username,
    password:      auth.password      || cfg.auth.password,
    token:         auth.token         || cfg.auth.token,
    loginUrl:      auth.loginUrl      || cfg.auth.loginUrl,
    tokenEndpoint: auth.tokenEndpoint || cfg.auth.tokenEndpoint,
  };

  if (!targetUrl) throw new Error('No target URL. Set TARGET_URL in .env or pass --url.');

  printHeader(targetUrl, apiBase, skipAI);

  // ── Show AI provider status ─────────────────────────────────────
  if (!skipAI) {
    const ps = await providerStatus().catch(e => ({ ok: false, label: e.message }));
    const statusStr = ps.ok
      ? chalk.green(`✓ ${ps.label}`)
      : chalk.yellow(`⚠ ${ps.label}${ps.hint ? '  →  ' + ps.hint : ''}`);
    console.log(chalk.gray('  AI Mode : ') + statusStr);
    console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));
  } else {
    console.log(chalk.gray('  AI Mode : ') + chalk.yellow('disabled — using built-in test plan'));
    console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));
  }

  // ─────────────────────────────────────────────────────────────────
  // DISCOVER MODE
  // ─────────────────────────────────────────────────────────────────
  if (discover) {
    return runDiscoverMode({
      targetUrl, apiBase, resolvedKey, resolvedAuth,
      skipAI, extra, uiOnly, apiOnly, perfOnly, securityOnly,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // STANDARD MODE (single URL)
  // ─────────────────────────────────────────────────────────────────
  const plan = await buildPlan({ skipAI, targetUrl, apiBase, extra });
  logPlanSummary(plan);

  const rawResults = await executeTests(plan, {
    targetUrl, apiBase, resolvedKey, resolvedAuth,
    uiOnly, apiOnly, perfOnly, securityOnly,
  });

  const processed = processResults(rawResults);
  const { htmlPath, jsonPath, latestHtml } = await generateReport(processed, {
    targetUrl, testPlanSource: skipAI ? 'default' : cfg.ai.provider,
  });

  printSummary(processed, htmlPath, jsonPath, latestHtml);
  return { processed, htmlPath, jsonPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discover Mode
// ─────────────────────────────────────────────────────────────────────────────
async function runDiscoverMode(opts) {
  const { targetUrl, apiBase, resolvedKey, resolvedAuth,
          skipAI, extra, uiOnly, apiOnly, perfOnly, securityOnly } = opts;

  // ── Step 1: Crawl site ─────────────────────────────────────────────
  let discovery;
  {
    const s = ora('Discovering routes…').start();
    s.stop(); // let discovery print its own progress
    try {
      discovery = await discoverRoutes(targetUrl, { verbose: false, auth: resolvedAuth });
    } catch (err) {
      console.error(chalk.red(`Route discovery failed: ${err.message}`));
      throw err;
    }
  }

  // ── Step 2: Interactive route selection ────────────────────────────
  const { selectedPages, selectedApiRoutes } = await selectRoutes(discovery);

  if (selectedPages.length === 0 && selectedApiRoutes.length === 0) {
    console.log(chalk.yellow('No routes selected — exiting.'));
    return;
  }

  // ── Step 3: Confirm ────────────────────────────────────────────────
  const totalTests = selectedPages.length + selectedApiRoutes.length;
  console.log(chalk.cyan(`\n  Starting tests on ${totalTests} routes…\n`));

  // ── Step 4: Build per-route test plan ──────────────────────────────
  const allRawResults = { ui: [], api: [], performance: [], security: [] };

  // Run UI + performance + security on each selected page
  const runAll      = !uiOnly && !apiOnly && !perfOnly && !securityOnly;
  const pagesChunk  = chunkArray(selectedPages, 10); // process in batches

  for (const chunk of pagesChunk) {
    // Build a mini test plan for this chunk
    const miniPlan = buildMiniPlan(chunk, selectedApiRoutes, apiBase);

    // UI Tests
    if (runAll || uiOnly) {
      const s = ora(`UI tests (${chunk.length} pages)…`).start();
      try {
        const results = await runUITests(miniPlan, { targetUrl: chunk[0].url, auth: resolvedAuth });
        allRawResults.ui.push(...results);
        s.succeed(chalk.green(`UI (${chunk.map(p=>p.path).join(', ')}) — ${results.filter(r=>r.status==='pass').length} pass`));
      } catch (e) {
        s.fail(chalk.red(`UI failed: ${e.message}`));
      }
    }

    // Lighthouse for each page
    if (runAll || perfOnly) {
      for (const page of chunk) {
        const s = ora(`Lighthouse: ${page.path}`).start();
        try {
          const res = await runPerfTests(
            { performance_tests: [{ id: `perf-${page.path}`, name: `Perf: ${page.path}`, url: page.url,
                thresholds: { performance: 70, accessibility: 80, best_practices: 75, seo: 75 } }] },
            { targetUrl: page.url }
          );
          allRawResults.performance.push(...res);
          const score = res[0]?.scores?.performance ?? '?';
          s.succeed(chalk.green(`Lighthouse ${page.path} — perf score: ${score}`));
        } catch (e) {
          s.fail(chalk.red(`Lighthouse ${page.path}: ${e.message}`));
        }
      }
    }
  }

  // API Tests for selected API routes
  if ((runAll || apiOnly) && selectedApiRoutes.length > 0) {
    const apiPlan = buildApiPlanFromRoutes(selectedApiRoutes);
    const s = ora(`API tests (${selectedApiRoutes.length} routes)…`).start();
    try {
      const results = await runAPITests(apiPlan, { apiBaseUrl: apiBase, apiKey: resolvedKey, auth: resolvedAuth });
      allRawResults.api.push(...results);
      s.succeed(chalk.green(`API — ${results.filter(r=>r.status==='pass').length}/${results.length} pass`));
    } catch (e) {
      s.fail(chalk.red(`API failed: ${e.message}`));
    }
  }

  // Security Tests — run on first 5 selected pages + all API routes
  if (runAll || securityOnly) {
    const secTargets = [...selectedPages.slice(0, 5), ...selectedApiRoutes.slice(0, 5)];
    const s = ora(`Security tests (${secTargets.length} targets)…`).start();
    try {
      const secPlan = buildSecPlanFromRoutes(selectedPages, selectedApiRoutes, apiBase);
      const results = await runSecurityTests(secPlan, {
        targetUrl, apiBaseUrl: apiBase, apiKey: resolvedKey, auth: resolvedAuth,
      });
      allRawResults.security.push(...results);
      s.succeed(chalk.green(`Security — ${results.filter(r=>r.status==='pass').length} pass, ${results.filter(r=>r.status==='fail').length} fail`));
    } catch (e) {
      s.fail(chalk.red(`Security failed: ${e.message}`));
    }
  }

  // ── Step 5: Report ──────────────────────────────────────────────────
  const processed = processResults(allRawResults);
  const s2 = ora('Generating report…').start();
  const { htmlPath, jsonPath, latestHtml } = await generateReport(processed, {
    targetUrl,
    testPlanSource: `discover (${selectedPages.length}p + ${selectedApiRoutes.length}api)`,
    discoveredRoutes: { pages: selectedPages, api: selectedApiRoutes },
  });
  s2.succeed(chalk.green('Report generated'));

  printSummary(processed, htmlPath, jsonPath, latestHtml);
  return { processed, htmlPath, jsonPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan builders
// ─────────────────────────────────────────────────────────────────────────────
async function buildPlan({ skipAI, targetUrl, apiBase, extra }) {
  const spinner = ora('Generating test plan…').start();
  let plan;
  if (skipAI) {
    plan = defaultTestPlan(targetUrl, apiBase);
    spinner.succeed(chalk.green('Using default test plan'));
  } else {
    try {
      const { generateTestPlan } = require('./agent/testPlanner');
      plan = await generateTestPlan({ url: targetUrl, apiBaseUrl: apiBase, extra });
      spinner.succeed(chalk.green(`AI-generated test plan (${Object.values(plan).flat().length} tests)`));
    } catch (err) {
      spinner.warn(chalk.yellow(`AI unavailable (${err.message.substring(0, 80)}). Using default plan.`));
      plan = defaultTestPlan(targetUrl, apiBase);
    }
  }
  return plan;
}

function buildMiniPlan(pages, apiRoutes, apiBase) {
  return {
    ui_tests: pages.map((p, i) => ({
      id: `ui-dyn-${i}`, name: `Page: ${p.path}`, tags: ['smoke'],
      description: `Load and check ${p.url}`,
      steps: ['Navigate to URL', 'Check status', 'Check content'],
      expected: 'Page loads without errors',
    })),
    api_tests: [],
    performance_tests: [],
    security_tests: [],
    sso_tests: [],
  };
}

function buildApiPlanFromRoutes(apiRoutes) {
  return {
    api_tests: apiRoutes.map((r, i) => ({
      id:              `api-dyn-${i}`,
      name:            `${r.method} ${r.path}`,
      method:          r.method,
      endpoint:        r.path,
      headers:         {},
      body:            null,
      expected_status: 200,
      expected_fields: [],
      tags:            ['discovered'],
    })),
    ui_tests: [], performance_tests: [], security_tests: [], sso_tests: [],
  };
}

function buildSecPlanFromRoutes(pages, apiRoutes, apiBase) {
  return {
    security_tests: [
      ...pages.slice(0, 3).map((p, i) => ({
        id: `sec-page-${i}`, name: `Headers: ${p.path}`, type: 'headers',
        endpoint: p.url, method: 'GET', severity: 'high',
      })),
      ...apiRoutes.slice(0, 3).map((a, i) => ({
        id: `sec-api-${i}`, name: `Auth: ${a.method} ${a.path}`, type: 'auth',
        endpoint: `${apiBase}${a.path}`, method: a.method, severity: 'high',
      })),
    ],
    ui_tests: [], api_tests: [], performance_tests: [], sso_tests: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute standard tests
// ─────────────────────────────────────────────────────────────────────────────
async function executeTests(plan, opts) {
  const { targetUrl, apiBase, resolvedKey, resolvedAuth,
          uiOnly, apiOnly, perfOnly, securityOnly } = opts;

  const rawResults = { ui: [], api: [], performance: [], security: [] };
  const runAll     = !uiOnly && !apiOnly && !perfOnly && !securityOnly;

  if (runAll || uiOnly) {
    const s = ora('UI & SSO tests (Playwright)…').start();
    try {
      rawResults.ui = await runUITests(plan, { targetUrl, auth: resolvedAuth });
      const { pass, fail, warn } = countStatus(rawResults.ui);
      s.succeed(chalk.green(`UI — ${pass} pass, ${fail} fail, ${warn} warn`));
    } catch (e) {
      s.fail(chalk.red(`UI failed: ${e.message}`));
      rawResults.ui = [errResult('ui-err', 'UI Error', e)];
    }
  }

  if (runAll || apiOnly) {
    const s = ora('API tests (Axios)…').start();
    try {
      rawResults.api = await runAPITests(plan, { apiBaseUrl: apiBase, apiKey: resolvedKey, auth: resolvedAuth });
      const { pass, fail, warn } = countStatus(rawResults.api);
      s.succeed(chalk.green(`API — ${pass} pass, ${fail} fail, ${warn} warn`));
    } catch (e) {
      s.fail(chalk.red(`API failed: ${e.message}`));
      rawResults.api = [errResult('api-err', 'API Error', e)];
    }
  }

  if (runAll || perfOnly) {
    const s = ora('Performance (Lighthouse)…').start();
    try {
      rawResults.performance = await runPerfTests(plan, { targetUrl });
      const { pass, fail, warn } = countStatus(rawResults.performance);
      s.succeed(chalk.green(`Performance — ${pass} pass, ${fail} fail, ${warn} warn`));
    } catch (e) {
      s.fail(chalk.red(`Performance failed: ${e.message}`));
      rawResults.performance = [errResult('perf-err', 'Performance Error', e)];
    }
  }

  if (runAll || securityOnly) {
    const s = ora('Security tests…').start();
    try {
      rawResults.security = await runSecurityTests(plan, {
        targetUrl, apiBaseUrl: apiBase, apiKey: resolvedKey, auth: resolvedAuth,
      });
      const { pass, fail, warn } = countStatus(rawResults.security);
      s.succeed(chalk.green(`Security — ${pass} pass, ${fail} fail, ${warn} warn`));
    } catch (e) {
      s.fail(chalk.red(`Security failed: ${e.message}`));
      rawResults.security = [errResult('sec-err', 'Security Error', e)];
    }
  }

  return rawResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function printHeader(targetUrl, apiBase, skipAI) {
  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('  🤖  AI Testing Agent'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.gray(`  Target  : ${targetUrl}`));
  console.log(chalk.gray(`  API Base: ${apiBase}`));
}

function logPlanSummary(plan) {
  console.log(chalk.gray('  Plan:'));
  console.log(chalk.gray(`    UI:${(plan.ui_tests||[]).length}  API:${(plan.api_tests||[]).length}  Perf:${(plan.performance_tests||[]).length}  Security:${(plan.security_tests||[]).length}  SSO:${(plan.sso_tests||[]).length}\n`));
}

function printSummary(processed, htmlPath, jsonPath, latestHtml) {
  const { summary, overall_status, score, recommendations } = processed;
  const col = { PASS: chalk.green, FAIL: chalk.red, WARN: chalk.yellow };
  const c   = col[overall_status] || chalk.white;

  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('  RESULTS'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════'));
  console.log(`  Status : ${c.bold(overall_status)}   Score: ${chalk.bold(score)}/100`);
  console.log(`  ${chalk.green('✓')} ${summary.pass} pass  ${chalk.red('✗')} ${summary.fail + (summary.error||0)} fail  ${chalk.yellow('⚠')} ${summary.warn} warn  ${chalk.gray('○')} ${summary.skip} skip`);

  if (recommendations.length > 0) {
    console.log('\n' + chalk.bold.yellow('  RECOMMENDATIONS:'));
    recommendations.slice(0, 3).forEach(r => {
      const sc = { critical: chalk.red, high: chalk.red, medium: chalk.yellow, low: chalk.blue };
      console.log(`  ${(sc[r.severity]||chalk.white)(`[${r.severity.toUpperCase()}]`)} ${r.title}`);
    });
  }

  console.log('\n' + chalk.bold.cyan('  REPORTS:'));
  console.log(`  HTML   : ${chalk.underline(htmlPath)}`);
  console.log(`  JSON   : ${chalk.underline(jsonPath)}`);
  console.log(`  Latest : ${chalk.underline(latestHtml)}`);
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════\n'));
}

function countStatus(results) {
  return results.reduce((a, r) => { a[r.status] = (a[r.status]||0)+1; return a; },
    { pass:0, fail:0, warn:0, skip:0, error:0 });
}

function errResult(id, name, err) {
  return { id, name, type: 'error', status: 'error', error: err.message, details: [], duration_ms: 0 };
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { run };
