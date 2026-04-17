'use strict';
const express  = require('express');
const { v4: uuid } = require('uuid');
const { requireAuth, requireAuthQuery } = require('../middleware/auth');
const { createReport, createRun } = require('../db/database');
const { runTests, addSSEClient, removeSSEClient } = require('../services/testRunner');

const router = express.Router();

// POST /api/test/start
router.post('/start', requireAuth, (req, res) => {
  const {
    targetUrl, apiUrl,
    selectedPages = [], selectedApiRoutes = [],
    testTypes = { ui: true, api: true, perf: true, security: true },
    skipAI = false,
    auth: authOpts = {},
  } = req.body || {};

  if (!targetUrl) return res.status(400).json({ error: 'targetUrl is required' });

  const reportId = uuid();
  const runId    = uuid();
  const userId   = req.user.id;

  createReport({ id: reportId, user_id: userId, target_url: targetUrl, api_url: apiUrl || null,
    mode: selectedPages.length > 0 ? 'discover' : 'standard' });
  createRun({ id: runId, user_id: userId, report_id: reportId });

  // Fire and forget — do NOT await
  runTests({ runId, reportId, userId, targetUrl, apiUrl, selectedPages,
    selectedApiRoutes, testTypes, skipAI, authOpts }).catch(console.error);

  res.json({ runId, reportId });
});

// GET /api/test/stream/:runId  (SSE)
router.get('/stream/:runId', requireAuthQuery, (req, res) => {
  const { runId }  = req.params;

  res.setHeader('Content-Type',               'text/event-stream');
  res.setHeader('Cache-Control',              'no-cache');
  res.setHeader('Connection',                 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.flushHeaders();

  // Send heartbeat every 15s to prevent proxy timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 15000);

  addSSEClient(runId, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(runId, res);
  });
});

module.exports = router;
