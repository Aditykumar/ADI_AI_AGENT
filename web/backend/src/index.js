'use strict';
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const authRoutes     = require('./routes/auth');
const discoverRoutes = require('./routes/discover');
const testRoutes     = require('./routes/test');
const reportRoutes   = require('./routes/reports');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ─────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.FRONTEND_URL || '*',
  credentials: true,
  methods:     ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(express.json({ limit: '2mb' }));

// Rate limits
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many login attempts' } }));

app.use('/api/test/start', rateLimit({ windowMs: 5 * 60 * 1000, max: 10,
  message: { error: 'Too many test requests — wait a few minutes' } }));

app.use('/api/discover', rateLimit({ windowMs: 2 * 60 * 1000, max: 15,
  message: { error: 'Too many discovery requests' } }));

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/discover', discoverRoutes);
app.use('/api/test',     testRoutes);
app.use('/api/reports',  reportRoutes);

// ── Health ─────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status: 'ok',
  ai:     process.env.AI_PROVIDER || 'ollama',
  time:   new Date().toISOString(),
}));

// ── 404 ────────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🤖 AI Testing Agent Backend`);
  console.log(`   Port    : ${PORT}`);
  console.log(`   AI      : ${process.env.AI_PROVIDER || 'ollama'}`);
  console.log(`   Frontend: ${process.env.FRONTEND_URL || 'http://localhost:3000'}\n`);
});

module.exports = app;
