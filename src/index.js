#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { program } = require('commander');
const { run }     = require('./orchestrator');

program
  .name('ai-testing-agent')
  .description('AI-powered testing agent — UI, API, Performance & Security')
  .version('1.0.0')

  // ── Target ────────────────────────────────────────────────────────
  .option('--url <url>',         'Target site URL')
  .option('--api-url <url>',     'API base URL')
  .option('--api-key <key>',     'API key for authenticated requests')

  // ── Auth / SSO ────────────────────────────────────────────────────
  .option('--username <user>',   'Login username for auth/SSO tests')
  .option('--password <pass>',   'Login password for auth/SSO tests')
  .option('--token <jwt>',       'Pre-existing auth/JWT token')
  .option('--login-url <url>',   'Login page URL')

  // ── Mode ──────────────────────────────────────────────────────────
  .option('--discover',          'Crawl site first, pick routes interactively, then test')
  .option('--ui-only',           'Run only UI + SSO tests')
  .option('--api-only',          'Run only API tests')
  .option('--perf-only',         'Run only performance (Lighthouse) tests')
  .option('--security-only',     'Run only security tests')

  // ── AI ────────────────────────────────────────────────────────────
  .option('--skip-ai',           'Skip AI — use built-in default test plan')
  .option('--extra <context>',   'Extra context for AI planner (e.g. "React SPA, e-commerce")')

  .addHelpText('after', `
Examples:
  # Dynamic mode — crawl → pick routes → full test
  $ ./run.sh --url https://yoursite.com --discover

  # Full test, AI-generated plan
  $ ./run.sh --url https://yoursite.com

  # Security scan only (no AI)
  $ ./run.sh --url https://yoursite.com --security-only --skip-ai

  # With API backend + auth
  $ ./run.sh --url https://yoursite.com \\
             --api-url https://api.yoursite.com \\
             --username admin@site.com --password secret

  # View report
  $ open reports/latest.html
  `)

  .parse(process.argv);

const opts = program.opts();

(async () => {
  try {
    await run({
      url:          opts.url,
      apiBaseUrl:   opts.apiUrl,
      apiKey:       opts.apiKey,
      auth: {
        username:  opts.username,
        password:  opts.password,
        token:     opts.token,
        loginUrl:  opts.loginUrl,
      },
      discover:     opts.discover      || false,
      uiOnly:       opts.uiOnly        || false,
      apiOnly:      opts.apiOnly       || false,
      perfOnly:     opts.perfOnly      || false,
      securityOnly: opts.securityOnly  || false,
      skipAI:       opts.skipAi        || false,
      extra:        opts.extra,
    });
    process.exit(0);
  } catch (err) {
    console.error('\n❌  Fatal:', err.message);
    if (process.env.DEBUG === 'true') console.error(err.stack);
    process.exit(1);
  }
})();
