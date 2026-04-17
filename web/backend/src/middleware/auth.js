'use strict';
const jwt         = require('jsonwebtoken');
const { findUserById } = require('../db/database');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// Express middleware — attaches req.user or returns 401
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = verifyToken(token);
    const user    = findUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// For SSE — token passed as query param ?token=...
function requireAuthQuery(req, res, next) {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = verifyToken(token);
    const user    = findUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { signToken, verifyToken, requireAuth, requireAuthQuery };
