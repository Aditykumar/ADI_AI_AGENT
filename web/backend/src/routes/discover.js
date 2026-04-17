'use strict';
const express        = require('express');
const { requireAuth } = require('../middleware/auth');
const { discoverRoutes } = require('../../../../src/crawler/routeDiscovery');

const router = express.Router();

// POST /api/discover
// Body: { url: string, auth?: { token } }
router.post('/', requireAuth, async (req, res) => {
  const { url, auth = {} } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  // Basic URL validation
  try { new URL(url); } catch (_) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    const discovery = await discoverRoutes(url, {
      verbose: false,
      auth: {
        token:    auth.token    || '',
        username: auth.username || '',
        password: auth.password || '',
        loginUrl: auth.loginUrl || '',
      },
    });

    res.json({
      base:       discovery.base,
      pages:      discovery.pages,
      api_routes: discovery.api_routes,
      stats:      discovery.stats,
    });
  } catch (err) {
    console.error('[discover]', err.message);
    res.status(500).json({ error: `Discovery failed: ${err.message}` });
  }
});

module.exports = router;
