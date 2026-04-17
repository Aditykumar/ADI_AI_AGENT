'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { findUserByUsername } = require('../db/database');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const user = findUserByUsername(username.trim());
  if (!user)
    return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ id: user.id, username: user.username, role: user.role });

  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/logout  (stateless JWT — client just discards token)
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
