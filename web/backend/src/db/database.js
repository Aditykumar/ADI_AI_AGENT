'use strict';
/**
 * Database — pure JSON file storage (zero native deps).
 * Works on any platform. On Render the data dir is a persistent disk.
 *
 * Schema:
 *   users.json        — all users (seeded from config/users.json)
 *   reports.json      — all test reports
 *   runs.json         — active test runs (progress tracking)
 */
const fs     = require('fs');
const path   = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

const DATA_DIR = path.resolve(process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : './data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  users:   path.join(DATA_DIR, 'users.json'),
  reports: path.join(DATA_DIR, 'reports.json'),
  runs:    path.join(DATA_DIR, 'runs.json'),
};

// ── JSON file helpers ──────────────────────────────────────────────────
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Seed users on first run ────────────────────────────────────────────
function seedUsers() {
  const existing = read(FILES.users);
  if (existing.length > 0) return;

  const configFile = path.resolve(__dirname, '../../config/users.json');
  if (!fs.existsSync(configFile)) return;

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const seeded = config.map(u => ({
    id:            u.id || uuid(),
    username:      u.username,
    password_hash: bcrypt.hashSync(u.password, 10),
    name:          u.name || u.username,
    role:          u.role || 'user',
    created_at:    new Date().toISOString(),
  }));
  write(FILES.users, seeded);
}

seedUsers();

// ── User queries ───────────────────────────────────────────────────────
function findUserByUsername(username) {
  return read(FILES.users).find(u => u.username === username) || null;
}

function findUserById(id) {
  const u = read(FILES.users).find(u => u.id === id);
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return safe;
}

// ── Report queries ─────────────────────────────────────────────────────
const MAX_REPORTS = parseInt(process.env.MAX_REPORTS_PER_USER || '10', 10);

function createReport(data) {
  const reports = read(FILES.reports);

  // Enforce max per user — delete oldest
  const userReports = reports
    .filter(r => r.user_id === data.user_id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let pruned = reports;
  if (userReports.length >= MAX_REPORTS) {
    const toDelete = new Set(userReports.slice(0, userReports.length - MAX_REPORTS + 1).map(r => r.id));
    pruned = reports.filter(r => !toDelete.has(r.id));
  }

  pruned.push({
    id:         data.id,
    user_id:    data.user_id,
    target_url: data.target_url,
    api_url:    data.api_url || null,
    mode:       data.mode || 'standard',
    status:     'running',
    score:      null,
    overall_status: null,
    summary_json:   null,
    html_report:    null,
    json_report:    null,
    routes_count:   0,
    created_at:     new Date().toISOString(),
    completed_at:   null,
  });

  write(FILES.reports, pruned);
}

function updateReport(id, fields) {
  const reports = read(FILES.reports);
  const idx = reports.findIndex(r => r.id === id);
  if (idx === -1) return;
  reports[idx] = { ...reports[idx], ...fields };
  write(FILES.reports, reports);
}

function getReportsByUser(userId) {
  return read(FILES.reports)
    .filter(r => r.user_id === userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, MAX_REPORTS)
    .map(r => ({
      id:             r.id,
      target_url:     r.target_url,
      api_url:        r.api_url,
      mode:           r.mode,
      status:         r.status,
      score:          r.score,
      overall_status: r.overall_status,
      summary:        r.summary_json ? JSON.parse(r.summary_json) : null,
      routes_count:   r.routes_count,
      created_at:     r.created_at,
      completed_at:   r.completed_at,
    }));
}

function getReportById(id, userId) {
  const r = read(FILES.reports).find(r => r.id === id && r.user_id === userId);
  if (!r) return null;
  return {
    ...r,
    summary:      r.summary_json  ? JSON.parse(r.summary_json)  : null,
    json_results: r.json_report   ? JSON.parse(r.json_report)   : null,
  };
}

function deleteReport(id, userId) {
  const reports = read(FILES.reports);
  const before  = reports.length;
  const pruned  = reports.filter(r => !(r.id === id && r.user_id === userId));
  write(FILES.reports, pruned);
  return { changes: before - pruned.length };
}

// ── Run queries ────────────────────────────────────────────────────────
function createRun(data) {
  const runs = read(FILES.runs);
  runs.push({
    id:         data.id,
    user_id:    data.user_id,
    report_id:  data.report_id,
    status:     'running',
    phase:      'starting',
    progress:   0,
    created_at: new Date().toISOString(),
  });
  write(FILES.runs, runs);
}

function updateRun(id, fields) {
  const runs = read(FILES.runs);
  const idx  = runs.findIndex(r => r.id === id);
  if (idx === -1) return;
  runs[idx] = { ...runs[idx], ...fields };
  write(FILES.runs, runs);
}

function getRunById(id) {
  return read(FILES.runs).find(r => r.id === id) || null;
}

module.exports = {
  findUserByUsername, findUserById,
  createReport, updateReport, getReportsByUser, getReportById, deleteReport,
  createRun, updateRun, getRunById,
};
