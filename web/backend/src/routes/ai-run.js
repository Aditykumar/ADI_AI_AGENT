'use strict';
/**
 * AI Browser Run — runs an autonomous AI agent task in the browser.
 * The AI sees screenshots and decides what to click/type/navigate.
 */
const express  = require('express');
const { v4: uuid } = require('uuid');
const { requireAuth, requireAuthQuery } = require('../middleware/auth');
const { createReport, createRun, updateReport, updateRun } = require('../db/database');
const { addSSEClient, removeSSEClient, sendSSE } = require('../services/testRunner');
const { runAIBrowserTask } = require('../../../../src/executors/aiExecutor');
const { generateReport }  = require('../../../../src/reporters/generator');
const fs   = require('fs');
const path = require('path');

const router = express.Router();

// POST /api/ai-run/start
// Body: { targetUrl, task, auth? }
router.post('/start', requireAuth, async (req, res) => {
  const { targetUrl, task, auth: authOpts = {} } = req.body || {};
  if (!targetUrl) return res.status(400).json({ error: 'targetUrl is required' });
  if (!task)      return res.status(400).json({ error: 'task is required' });

  const reportId = uuid();
  const runId    = uuid();
  const userId   = req.user.id;

  createReport({ id: reportId, user_id: userId, target_url: targetUrl, mode: 'ai-agent' });
  createRun({ id: runId, user_id: userId, report_id: reportId });

  // Fire and forget
  (async () => {
    const emit = (phase, message, progress) => {
      sendSSE(runId, 'progress', { phase, message, progress });
      updateRun(runId, { phase, progress });
    };
    const emitAction = (type, data) => sendSSE(runId, 'action', { type, ...data, ts: Date.now() });

    const reportsDir = path.resolve(process.env.REPORTS_DIR || './data/reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    try {
      emit('ai', 'AI agent starting browser…', 5);

      const result = await runAIBrowserTask(task, {
        targetUrl,
        emitAction,
        maxSteps: 20,
      });

      emit('report', 'Generating report…', 90);

      // Build a simple processed result for the report generator
      const processed = {
        score: result.success ? 80 : 40,
        overall_status: result.success ? 'good' : 'needs_attention',
        summary: {
          total: result.steps.length,
          pass:  result.steps.filter(s => !s.error).length,
          fail:  result.steps.filter(s => s.error).length,
          warn:  0,
          skip:  0,
        },
        ui:          result.steps.map((s, i) => ({
          id: `ai-${i}`, name: `[${s.step}] ${s.action}: ${s.reason}`,
          type: 'ai', status: s.error ? 'fail' : 'pass',
          details: [s.target, s.value, s.reason].filter(Boolean),
          screenshots: s.screenshot ? [s.screenshot] : [],
          duration_ms: 0, error: s.error || null,
        })),
        api:         [],
        performance: [],
        security:    [],
        recommendations: result.success ? [] : [{
          severity: 'medium',
          category: 'AI Agent',
          message:  'AI agent could not fully complete the task',
          detail:   `Completed ${result.steps.length} steps. Final URL: ${result.finalUrl}`,
        }],
      };

      const { htmlPath, jsonPath } = await generateReport(processed, {
        targetUrl,
        testPlanSource: 'ai-agent',
      });

      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const jsonContent = fs.readFileSync(jsonPath, 'utf8');

      updateReport(reportId, {
        status:         'completed',
        score:          processed.score,
        overall_status: processed.overall_status,
        summary_json:   JSON.stringify(processed.summary),
        html_report:    htmlContent,
        json_report:    jsonContent,
        routes_count:   result.steps.length,
        completed_at:   new Date().toISOString(),
      });

      updateRun(runId, { status: 'completed', phase: 'done', progress: 100 });
      sendSSE(runId, 'complete', { reportId, score: processed.score, overall_status: processed.overall_status });

    } catch (err) {
      updateReport(reportId, { status: 'failed', completed_at: new Date().toISOString() });
      updateRun(runId, { status: 'failed', phase: 'error', progress: 100 });
      sendSSE(runId, 'error', { message: err.message });
    }
  })().catch(console.error);

  res.json({ runId, reportId });
});

module.exports = router;
