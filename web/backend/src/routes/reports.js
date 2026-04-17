'use strict';
const express  = require('express');
const { requireAuth } = require('../middleware/auth');
const { getReportsByUser, getReportById, deleteReport } = require('../db/database');

const router = express.Router();

// GET /api/reports  — user's last 10 reports
router.get('/', requireAuth, (req, res) => {
  const reports = getReportsByUser(req.user.id).map(r => ({
    ...r,
    summary: r.summary_json ? JSON.parse(r.summary_json) : null,
    summary_json: undefined,
  }));
  res.json({ reports });
});

// GET /api/reports/:id  — full report (includes HTML)
router.get('/:id', requireAuth, (req, res) => {
  const report = getReportById(req.params.id, req.user.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  res.json({
    ...report,
    summary:      report.summary_json  ? JSON.parse(report.summary_json)  : null,
    json_results: report.json_report   ? JSON.parse(report.json_report)   : null,
    summary_json: undefined,
  });
});

// GET /api/reports/:id/html  — raw HTML report for iframe
router.get('/:id/html', requireAuth, (req, res) => {
  const report = getReportById(req.params.id, req.user.id);
  if (!report) return res.status(404).send('Not found');
  if (!report.html_report) return res.status(404).send('Report HTML not generated yet');
  res.setHeader('Content-Type', 'text/html');
  res.send(report.html_report);
});

// DELETE /api/reports/:id
router.delete('/:id', requireAuth, (req, res) => {
  const result = deleteReport(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Report not found' });
  res.json({ ok: true });
});

module.exports = router;
