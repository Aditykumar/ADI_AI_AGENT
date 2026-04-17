'use strict';
/**
 * Report Generator — produces an HTML dashboard + JSON report.
 */
const fs   = require('fs');
const path = require('path');
const cfg  = require('../../config/config');

/**
 * Generate HTML + JSON reports.
 * @param {object} processedResults  - Output from assertions engine
 * @param {object} meta              - { targetUrl, generatedAt, testPlanSource }
 * @returns {object} - { htmlPath, jsonPath }
 */
async function generateReport(processedResults, meta) {
  fs.mkdirSync(cfg.output.reportsDir, { recursive: true });

  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
  const htmlPath   = path.join(cfg.output.reportsDir, `report_${timestamp}.html`);
  const jsonPath   = path.join(cfg.output.reportsDir, `report_${timestamp}.json`);
  const latestHtml = path.join(cfg.output.reportsDir, 'latest.html');
  const latestJson = path.join(cfg.output.reportsDir, 'latest.json');

  // JSON report
  const jsonData = {
    meta: { ...meta, generatedAt: new Date().toISOString(), version: '1.0.0' },
    summary:           processedResults.summary,
    overall_status:    processedResults.overall_status,
    score:             processedResults.score,
    ui:                processedResults.ui,
    api:               processedResults.api,
    performance:       processedResults.performance,
    security:          processedResults.security,
    recommendations:   processedResults.recommendations,
    discovered_routes: meta.discoveredRoutes || null,
  };

  fs.writeFileSync(jsonPath,   JSON.stringify(jsonData, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(jsonData, null, 2));

  // HTML report
  const html = buildHTML(jsonData);
  fs.writeFileSync(htmlPath,   html);
  fs.writeFileSync(latestHtml, html);

  return { htmlPath, jsonPath, latestHtml };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML builder
// ─────────────────────────────────────────────────────────────────────────────
function buildHTML(data) {
  const { meta, summary, overall_status, score, ui, api, performance, security, recommendations, discovered_routes } = data;

  const statusColor = { PASS: '#22c55e', FAIL: '#ef4444', WARN: '#f59e0b' };
  const scoreGrade  = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  const scoreColor  = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Testing Agent Report — ${escapeHtml(meta.targetUrl)}</title>
<style>
  :root {
    --bg: #0f172a; --surface: #1e293b; --surface2: #253348;
    --border: #334155; --text: #e2e8f0; --muted: #94a3b8;
    --pass: #22c55e; --fail: #ef4444; --warn: #f59e0b;
    --skip: #64748b; --info: #38bdf8;
    --critical: #ef4444; --high: #f97316; --medium: #eab308; --low: #38bdf8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  a { color: var(--info); text-decoration: none; }

  /* Layout */
  .container { max-width: 1400px; margin: 0 auto; padding: 0 24px; }
  header { background: linear-gradient(135deg, #1e293b 0%, #0f2027 100%); border-bottom: 1px solid var(--border); padding: 24px 0; }
  header .container { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-icon { width: 44px; height: 44px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 12px;
    display: flex; align-items: center; justify-content: center; font-size: 20px; }
  .brand-name { font-size: 20px; font-weight: 700; }
  .brand-sub  { font-size: 13px; color: var(--muted); }
  .header-meta { text-align: right; font-size: 13px; color: var(--muted); }

  /* Score badge */
  .score-badge { display: flex; align-items: center; gap: 16px; background: var(--surface); border-radius: 16px;
    padding: 16px 24px; border: 1px solid var(--border); margin: 32px 0 24px; }
  .score-ring { width: 80px; height: 80px; position: relative; flex-shrink: 0; }
  .score-ring svg { width: 80px; height: 80px; transform: rotate(-90deg); }
  .score-num { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 800; line-height: 1; }
  .score-num small { font-size: 11px; font-weight: 400; color: var(--muted); }
  .score-info h2 { font-size: 22px; font-weight: 700; }
  .score-info p  { color: var(--muted); font-size: 14px; margin-top: 4px; }
  .overall-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-top: 8px; }

  /* Summary cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: var(--surface); border-radius: 12px; padding: 20px; border: 1px solid var(--border); text-align: center; }
  .card .num { font-size: 36px; font-weight: 800; line-height: 1; }
  .card .lbl { font-size: 12px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: .05em; }
  .card.pass-card .num { color: var(--pass); }
  .card.fail-card .num { color: var(--fail); }
  .card.warn-card .num { color: var(--warn); }
  .card.skip-card .num { color: var(--skip); }

  /* Tabs */
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 24px; flex-wrap: wrap; }
  .tab  { padding: 10px 20px; cursor: pointer; border-radius: 8px 8px 0 0; font-size: 14px; font-weight: 500;
    color: var(--muted); border: 1px solid transparent; border-bottom: none; transition: all .15s; }
  .tab:hover  { color: var(--text); background: var(--surface); }
  .tab.active { color: var(--text); background: var(--surface); border-color: var(--border); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Test results table */
  .results-table { width: 100%; border-collapse: collapse; }
  .results-table th { background: var(--surface2); padding: 10px 14px; text-align: left; font-size: 12px;
    text-transform: uppercase; letter-spacing: .05em; color: var(--muted); border-bottom: 1px solid var(--border); }
  .results-table td { padding: 12px 14px; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 14px; }
  .results-table tr:hover td { background: var(--surface2); }
  .results-table tr:last-child td { border-bottom: none; }

  /* Status badges */
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .badge-pass  { background: rgba(34,197,94,.15);  color: var(--pass); }
  .badge-fail  { background: rgba(239,68,68,.15);  color: var(--fail); }
  .badge-warn  { background: rgba(245,158,11,.15); color: var(--warn); }
  .badge-skip  { background: rgba(100,116,139,.15);color: var(--skip); }
  .badge-error { background: rgba(239,68,68,.15);  color: var(--fail); }
  .badge-critical { background: rgba(239,68,68,.2);  color: #ff6b6b; }
  .badge-high     { background: rgba(249,115,22,.2); color: #fb923c; }
  .badge-medium   { background: rgba(234,179,8,.2);  color: #fbbf24; }
  .badge-low      { background: rgba(56,189,248,.2); color: #38bdf8; }

  /* Details accordion */
  .details-toggle { cursor: pointer; color: var(--info); font-size: 12px; user-select: none; }
  .details-list { display: none; margin-top: 8px; }
  .details-list.open { display: block; }
  .details-list li { font-size: 12px; color: var(--muted); padding: 2px 0; list-style: none; }
  .details-list li::before { content: '│ '; color: var(--border); }

  /* Metrics */
  .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 8px; }
  .metric-box  { background: var(--surface2); border-radius: 8px; padding: 12px; text-align: center; }
  .metric-val  { font-size: 22px; font-weight: 700; }
  .metric-lbl  { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .score-bar   { height: 6px; background: var(--border); border-radius: 3px; margin-top: 8px; overflow: hidden; }
  .score-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }

  /* Recommendations */
  .rec-card { background: var(--surface); border-radius: 12px; padding: 18px; margin-bottom: 12px;
    border-left: 4px solid var(--border); }
  .rec-card.critical { border-color: var(--critical); }
  .rec-card.high     { border-color: var(--high); }
  .rec-card.medium   { border-color: var(--medium); }
  .rec-card.low      { border-color: var(--low); }
  .rec-title    { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .rec-desc     { font-size: 13px; color: var(--muted); }
  .rec-guidance { font-size: 13px; color: var(--info); margin-top: 8px; }
  .rec-guidance::before { content: '💡 '; }

  /* Screenshot grid */
  .ss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 8px; }
  .ss-grid img { width: 100%; height: 130px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); }

  /* Footer */
  footer { margin-top: 64px; padding: 24px 0; border-top: 1px solid var(--border); text-align: center;
    font-size: 13px; color: var(--muted); }

  /* Section heading */
  .section-title { font-size: 18px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }

  @media (max-width: 640px) {
    .score-badge { flex-direction: column; }
    .header-meta { text-align: left; }
  }
</style>
</head>
<body>

<header>
  <div class="container">
    <div class="brand">
      <div class="brand-icon">🤖</div>
      <div>
        <div class="brand-name">AI Testing Agent</div>
        <div class="brand-sub">Automated QA · Performance · Security</div>
      </div>
    </div>
    <div class="header-meta">
      <div>${escapeHtml(meta.targetUrl)}</div>
      <div>${new Date(meta.generatedAt).toLocaleString()}</div>
      <div>Plan: ${escapeHtml(meta.testPlanSource || 'auto-generated')}</div>
    </div>
  </div>
</header>

<div class="container" style="padding-top:24px; padding-bottom:48px;">

  <!-- Score + Overall -->
  <div class="score-badge">
    <div class="score-ring">
      ${scoreRingSVG(score, scoreColor)}
      <div class="score-num" style="color:${scoreColor}">${score}<small>/100</small></div>
    </div>
    <div class="score-info">
      <h2>Health Score: ${scoreGrade}</h2>
      <p>${summary.total} tests executed across UI, API, Performance &amp; Security</p>
      <span class="overall-badge" style="background:${statusColor[overall_status]}22; color:${statusColor[overall_status]}">
        ${overall_status}
      </span>
    </div>
  </div>

  <!-- Summary Cards -->
  <div class="cards">
    <div class="card pass-card"><div class="num">${summary.pass}</div><div class="lbl">Passed</div></div>
    <div class="card fail-card"><div class="num">${summary.fail + (summary.error || 0)}</div><div class="lbl">Failed</div></div>
    <div class="card warn-card"><div class="num">${summary.warn}</div><div class="lbl">Warnings</div></div>
    <div class="card skip-card"><div class="num">${summary.skip}</div><div class="lbl">Skipped</div></div>
    <div class="card"><div class="num" style="color:var(--info)">${summary.total}</div><div class="lbl">Total Tests</div></div>
    <div class="card"><div class="num" style="color:var(--info)">${recommendations.length}</div><div class="lbl">Recommendations</div></div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    ${discovered_routes ? `<div class="tab" onclick="switchTab('routes')">🗺 Routes (${(discovered_routes.pages||[]).length}p + ${(discovered_routes.api||[]).length}api)</div>` : ''}
    <div class="tab ${discovered_routes ? '' : 'active'}" onclick="switchTab('ui')">🖥 UI &amp; SSO (${ui.length})</div>
    <div class="tab" onclick="switchTab('api')">🔌 API (${api.length})</div>
    <div class="tab" onclick="switchTab('perf')">⚡ Performance (${performance.length})</div>
    <div class="tab" onclick="switchTab('security')">🔒 Security (${security.length})</div>
    <div class="tab" onclick="switchTab('recs')">💡 Recommendations (${recommendations.length})</div>
  </div>

  <!-- Discovered Routes (discover mode only) -->
  ${discovered_routes ? `
  <div id="tab-routes" class="tab-content">
    <div class="section-title">🗺 Discovered Routes</div>
    ${buildRoutesSection(discovered_routes)}
  </div>` : ''}

  <!-- UI Tests -->
  <div id="tab-ui" class="tab-content ${discovered_routes ? '' : 'active'}">
    <div class="section-title">🖥 UI &amp; SSO Tests</div>
    ${buildTestTable(ui, true)}
  </div>

  <!-- API Tests -->
  <div id="tab-api" class="tab-content">
    <div class="section-title">🔌 API Tests</div>
    ${buildTestTable(api, false, true)}
  </div>

  <!-- Performance -->
  <div id="tab-perf" class="tab-content">
    <div class="section-title">⚡ Performance Tests</div>
    ${buildPerfSection(performance)}
  </div>

  <!-- Security -->
  <div id="tab-security" class="tab-content">
    <div class="section-title">🔒 Security Tests</div>
    ${buildSecurityTable(security)}
  </div>

  <!-- Recommendations -->
  <div id="tab-recs" class="tab-content">
    <div class="section-title">💡 Recommendations</div>
    ${buildRecommendationsSection(recommendations)}
  </div>

</div>

<footer>
  <div>Generated by <strong>AI Testing Agent</strong> &mdash; Powered by LLaMA / GPT via Ollama</div>
  <div style="margin-top:4px;">${new Date(meta.generatedAt).toUTCString()}</div>
</footer>

<script>
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => {
    if (t.getAttribute('onclick') === "switchTab('" + name + "')") t.classList.add('active');
  });
  const el = document.getElementById('tab-' + name);
  if (el) el.classList.add('active');
}
function toggleDetails(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section builders
// ─────────────────────────────────────────────────────────────────────────────
function buildTestTable(results, showScreenshots = false, showMethod = false) {
  if (!results.length) return '<p style="color:var(--muted);padding:16px">No tests in this category.</p>';

  const rows = results.map((r, i) => {
    const details = (r.details || []).map(d => `<li>${escapeHtml(d)}</li>`).join('');
    const detailId = `det-${r.id || i}`;
    const screenshotHtml = showScreenshots && r.screenshots?.length
      ? `<div class="ss-grid">${r.screenshots.map(s =>
          `<a href="${escapeHtml(s)}" target="_blank"><img src="${escapeHtml(s)}" alt="screenshot"></a>`
        ).join('')}</div>` : '';

    return `<tr>
      <td style="font-weight:600;">${escapeHtml(r.name)}</td>
      ${showMethod ? `<td><code style="color:var(--info)">${escapeHtml(r.method || '')}</code></td>` : ''}
      <td>${r.duration_ms ? r.duration_ms + 'ms' : '—'}</td>
      <td><span class="badge badge-${r.status}">${r.status}</span></td>
      <td>
        ${details ? `<span class="details-toggle" onclick="toggleDetails('${detailId}')">▶ details</span>
        <ul id="${detailId}" class="details-list">${details}</ul>` : '—'}
        ${screenshotHtml}
        ${r.error ? `<span style="color:var(--fail);font-size:12px">⚠ ${escapeHtml(r.error)}</span>` : ''}
      </td>
    </tr>`;
  }).join('');

  const methodCol = showMethod ? '<th>Method</th>' : '';
  return `<table class="results-table">
    <thead><tr><th>Test</th>${methodCol}<th>Duration</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildPerfSection(results) {
  if (!results.length) return '<p style="color:var(--muted);padding:16px">No performance tests run.</p>';

  return results.map(r => {
    const s = r.scores || {};
    const m = r.metrics || {};
    const scoreBar = (v) => {
      const color = v >= 90 ? '#22c55e' : v >= 70 ? '#f59e0b' : '#ef4444';
      return `<div class="score-bar"><div class="score-bar-fill" style="width:${v}%;background:${color}"></div></div>`;
    };

    const details = (r.details || []).map(d => `<li>${escapeHtml(d)}</li>`).join('');
    const detailId = `perf-det-${r.id}`;

    return `<div style="background:var(--surface);border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <div>
          <div style="font-weight:700;font-size:16px;">${escapeHtml(r.name)}</div>
          <div style="color:var(--muted);font-size:13px;">${escapeHtml(r.url)}</div>
        </div>
        <span class="badge badge-${r.status}">${r.status}</span>
      </div>

      <div class="metric-grid">
        ${s.performance   != null ? `<div class="metric-box"><div class="metric-val" style="color:${scoreColor(s.performance)}">${s.performance}</div><div class="metric-lbl">Performance</div>${scoreBar(s.performance)}</div>` : ''}
        ${s.accessibility != null ? `<div class="metric-box"><div class="metric-val" style="color:${scoreColor(s.accessibility)}">${s.accessibility}</div><div class="metric-lbl">Accessibility</div>${scoreBar(s.accessibility)}</div>` : ''}
        ${s.best_practices!= null ? `<div class="metric-box"><div class="metric-val" style="color:${scoreColor(s.best_practices)}">${s.best_practices}</div><div class="metric-lbl">Best Practices</div>${scoreBar(s.best_practices)}</div>` : ''}
        ${s.seo           != null ? `<div class="metric-box"><div class="metric-val" style="color:${scoreColor(s.seo)}">${s.seo}</div><div class="metric-lbl">SEO</div>${scoreBar(s.seo)}</div>` : ''}
      </div>

      <div class="metric-grid" style="margin-top:12px;">
        ${m.lcp_ms  != null ? `<div class="metric-box"><div class="metric-val">${Math.round(m.lcp_ms)}ms</div><div class="metric-lbl">LCP</div></div>` : ''}
        ${m.fcp_ms  != null ? `<div class="metric-box"><div class="metric-val">${Math.round(m.fcp_ms)}ms</div><div class="metric-lbl">FCP</div></div>` : ''}
        ${m.tbt_ms  != null ? `<div class="metric-box"><div class="metric-val">${Math.round(m.tbt_ms)}ms</div><div class="metric-lbl">TBT</div></div>` : ''}
        ${m.cls     != null ? `<div class="metric-box"><div class="metric-val">${m.cls.toFixed(3)}</div><div class="metric-lbl">CLS</div></div>` : ''}
        ${m.ttfb_ms != null ? `<div class="metric-box"><div class="metric-val">${Math.round(m.ttfb_ms)}ms</div><div class="metric-lbl">TTFB</div></div>` : ''}
      </div>

      ${details ? `<div style="margin-top:12px"><span class="details-toggle" onclick="toggleDetails('${detailId}')">▶ full details</span>
        <ul id="${detailId}" class="details-list">${details}</ul></div>` : ''}
    </div>`;
  }).join('');
}

function buildSecurityTable(results) {
  if (!results.length) return '<p style="color:var(--muted);padding:16px">No security tests run.</p>';

  const rows = results.map((r, i) => {
    const details = (r.details || []).map(d => `<li>${escapeHtml(d)}</li>`).join('');
    const detailId = `sec-det-${r.id || i}`;
    return `<tr>
      <td style="font-weight:600;">${escapeHtml(r.name)}</td>
      <td><code style="color:var(--muted);font-size:11px">${escapeHtml(r.type || '')}</code></td>
      <td><span class="badge badge-${r.severity}">${r.severity || 'info'}</span></td>
      <td><span class="badge badge-${r.status}">${r.status}</span></td>
      <td>
        ${details ? `<span class="details-toggle" onclick="toggleDetails('${detailId}')">▶ details</span>
        <ul id="${detailId}" class="details-list">${details}</ul>` : '—'}
        ${r.error ? `<span style="color:var(--fail);font-size:12px">⚠ ${escapeHtml(r.error)}</span>` : ''}
      </td>
    </tr>`;
  }).join('');

  return `<table class="results-table">
    <thead><tr><th>Check</th><th>Type</th><th>Severity</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildRecommendationsSection(recs) {
  if (!recs.length) return '<p style="color:var(--muted);padding:16px">No recommendations — great job! 🎉</p>';

  return recs.map(r => `
    <div class="rec-card ${r.severity}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div class="rec-title">${escapeHtml(r.title)}</div>
        <span class="badge badge-${r.severity}">${r.severity}</span>
      </div>
      <div class="rec-desc">${escapeHtml(r.description)}</div>
      <div class="rec-guidance">${escapeHtml(r.guidance)}</div>
    </div>`).join('');
}

// ── SVG score ring ─────────────────────────────────────────────────────────
function scoreRingSVG(score, color) {
  const r = 34, c = 40, dash = 2 * Math.PI * r;
  const offset = dash * (1 - score / 100);
  return `<svg viewBox="0 0 80 80">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#334155" stroke-width="6"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="6"
      stroke-dasharray="${dash.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
      stroke-linecap="round"/>
  </svg>`;
}

function scoreColor(v) {
  return v >= 90 ? '#22c55e' : v >= 70 ? '#f59e0b' : '#ef4444';
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildRoutesSection(discoveredRoutes) {
  const pages  = discoveredRoutes.pages  || [];
  const api    = discoveredRoutes.api    || [];

  const statusBadge = (s) => {
    if (!s) return '';
    if (s >= 200 && s < 300) return `<span class="badge badge-pass">${s}</span>`;
    if (s >= 300 && s < 400) return `<span class="badge badge-warn">${s}</span>`;
    if (s >= 400)             return `<span class="badge badge-fail">${s}</span>`;
    return '';
  };

  const pageRows = pages.map(p => `
    <tr>
      <td>📄</td>
      <td><code>${escapeHtml(p.path)}</code></td>
      <td style="color:var(--muted);font-size:12px">${escapeHtml(p.title || '')}</td>
      <td>${statusBadge(p.status)}</td>
      <td><span style="font-size:11px;color:var(--muted)">${escapeHtml(p.source || '')}</span></td>
    </tr>`).join('');

  const apiRows = api.map(a => `
    <tr>
      <td>🔌</td>
      <td><code>${escapeHtml(a.path)}</code></td>
      <td><span class="badge" style="background:rgba(56,189,248,.15);color:#38bdf8">${escapeHtml(a.method)}</span></td>
      <td></td>
      <td><span style="font-size:11px;color:var(--muted)">${escapeHtml(a.source || '')}</span></td>
    </tr>`).join('');

  return `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
    <div class="card"><div class="num" style="color:var(--info)">${pages.length}</div><div class="lbl">Pages discovered</div></div>
    <div class="card"><div class="num" style="color:var(--info)">${api.length}</div><div class="lbl">API routes intercepted</div></div>
  </div>
  <table class="results-table">
    <thead><tr><th>Type</th><th>Path</th><th>Title / Method</th><th>Status</th><th>Source</th></tr></thead>
    <tbody>${pageRows}${apiRows}</tbody>
  </table>`;
}

module.exports = { generateReport };
