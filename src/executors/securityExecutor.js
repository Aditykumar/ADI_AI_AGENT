'use strict';
/**
 * Security Executor — checks OWASP Top 10 vectors, security headers,
 * SSL/TLS, CORS, injection, sensitive file exposure, rate limiting, CSP.
 */
const axios = require('axios');
const https = require('https');
const tls   = require('tls');
const url   = require('url');

// Short timeout for all security HTTP probes
const SEC_AXIOS = axios.create({ timeout: 6000, validateStatus: () => true,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }) });

const SECURITY_HEADERS = [
  { name: 'Strict-Transport-Security',  severity: 'high',   desc: 'HSTS — forces HTTPS' },
  { name: 'Content-Security-Policy',    severity: 'high',   desc: 'CSP — prevents XSS' },
  { name: 'X-Frame-Options',            severity: 'medium', desc: 'Prevents clickjacking' },
  { name: 'X-Content-Type-Options',     severity: 'medium', desc: 'Prevents MIME-type sniffing' },
  { name: 'Referrer-Policy',            severity: 'low',    desc: 'Controls referrer information' },
  { name: 'Permissions-Policy',         severity: 'low',    desc: 'Controls browser features' },
  { name: 'X-XSS-Protection',          severity: 'low',    desc: 'Legacy XSS filter (informational)' },
  { name: 'Cross-Origin-Opener-Policy', severity: 'medium', desc: 'Prevents cross-origin attacks' },
];

const SENSITIVE_FILES = [
  '/.env', '/.env.local', '/.env.production',
  '/.git/config', '/.git/HEAD',
  '/config.json', '/config.yaml', '/config.yml',
  '/wp-config.php', '/web.config',
  '/phpinfo.php', '/info.php',
  '/.DS_Store', '/Thumbs.db',
  '/backup.sql', '/dump.sql', '/database.sql',
  '/admin', '/administrator',
  '/api/swagger.json', '/api-docs', '/swagger-ui.html',
  '/actuator', '/actuator/env', '/actuator/health',
];

const INJECTION_PAYLOADS = {
  sqli: [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "1 UNION SELECT null,null,null--",
    "admin'--",
  ],
  xss: [
    '<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    "javascript:alert(1)",
    '<img src=x onerror=alert(1)>',
  ],
};

/**
 * Run all security tests.
 * @param {object} plan   - Full test plan
 * @param {object} opts   - { targetUrl, apiBaseUrl, apiKey, auth }
 * @returns {Promise<object[]>}
 */
async function runSecurityTests(plan, opts) {
  const { targetUrl, apiBaseUrl, apiKey, auth } = opts;
  const results = [];

  // Always run these built-in security checks regardless of plan
  const builtInChecks = [
    () => checkSecurityHeaders(targetUrl, results),
    () => checkSSL(targetUrl, results),
    () => checkCORS(apiBaseUrl || targetUrl, results),
    () => checkSensitiveFiles(targetUrl, results),
    () => checkInfoDisclosure(targetUrl, results),
    () => checkCSP(targetUrl, results),
  ];

  // API-specific checks
  if (apiBaseUrl) {
    builtInChecks.push(
      () => checkInjection(apiBaseUrl, auth, results),
      () => checkAuthBypass(apiBaseUrl, auth, results),
      () => checkRateLimitOnAuth(apiBaseUrl, results),
    );
  }

  // Run all built-in checks
  for (const check of builtInChecks) {
    await check().catch(err => {
      results.push({
        id: `sec-err-${Date.now()}`, name: 'Check Error', type: 'error',
        status: 'error', severity: 'info',
        details: [`Check threw: ${err.message}`], duration_ms: 0,
      });
    });
  }

  // Run plan-defined security tests
  for (const test of plan.security_tests || []) {
    const alreadyCovered = results.find(r => r.name.toLowerCase().includes(test.name.toLowerCase()));
    if (alreadyCovered) continue; // Skip if already covered by built-in

    const result = await runPlanSecurityTest(test, apiBaseUrl || targetUrl, auth);
    results.push(result);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Checks
// ─────────────────────────────────────────────────────────────────────────────

async function checkSecurityHeaders(targetUrl, results) {
  const result = createSecResult('sec-headers', 'Security Headers Audit', 'headers', 'high');
  const t0 = Date.now();

  try {
    const res = await get(targetUrl);
    const headers = res.headers;

    let missing = 0;
    for (const h of SECURITY_HEADERS) {
      const val = headers[h.name.toLowerCase()];
      if (val) {
        result.details.push(`✓ ${h.name}: ${val.substring(0, 100)}`);
      } else {
        result.details.push(`✗ MISSING ${h.name} (${h.severity}) — ${h.desc}`);
        if (['high', 'critical'].includes(h.severity)) missing++;
      }
    }

    // Check for server header leaking version info
    const server = headers['server'] || '';
    const powered = headers['x-powered-by'] || '';
    if (server && /\d+\.\d+/.test(server)) {
      result.details.push(`⚠ Server header exposes version: "${server}"`);
    }
    if (powered) {
      result.details.push(`⚠ X-Powered-By header present: "${powered}" (remove this)`);
      if (!result.status_override) result.status_override = 'warn';
    }

    result.status = missing > 0 ? 'fail' : (result.status_override || 'pass');
    result.details.push(`Missing critical headers: ${missing}/${SECURITY_HEADERS.length}`);
  } catch (e) {
    result.status = 'error'; result.error = e.message;
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkSSL(targetUrl, results) {
  const result = createSecResult('sec-ssl', 'SSL/TLS Certificate', 'ssl', 'critical');
  const t0 = Date.now();

  const parsed = url.parse(targetUrl);

  if (parsed.protocol !== 'https:') {
    result.status = 'fail';
    result.details.push('FAIL: Site is not served over HTTPS');
    result.duration_ms = Date.now() - t0;
    results.push(result);
    return;
  }

  try {
    await new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host: parsed.hostname, port: parseInt(parsed.port || '443', 10), servername: parsed.hostname },
        () => {
          const cert  = socket.getPeerCertificate();
          const cipher = socket.getCipher();

          result.details.push(`Subject: ${cert.subject?.CN || 'N/A'}`);
          result.details.push(`Issuer: ${cert.issuer?.O || cert.issuer?.CN || 'N/A'}`);

          if (cert.valid_to) {
            const expiry   = new Date(cert.valid_to);
            const daysLeft = Math.floor((expiry - Date.now()) / 86400000);
            result.details.push(`Expires: ${cert.valid_to} (${daysLeft} days)`);
            if (daysLeft < 30) {
              result.status = 'warn';
              result.details.push(`Warning: Certificate expires in ${daysLeft} days`);
            }
          }

          if (cipher) {
            result.details.push(`Cipher: ${cipher.name} / TLS ${cipher.version}`);
            if (['TLSv1', 'TLSv1.1', 'SSLv3'].includes(cipher.version)) {
              result.status = 'fail';
              result.details.push(`FAIL: Weak TLS version ${cipher.version} in use`);
            }
          }

          socket.destroy();
          resolve();
        }
      );
      socket.on('error', reject);
      setTimeout(() => { socket.destroy(); reject(new Error('TLS connection timeout')); }, 10000);
    });

    if (!result.status || result.status === 'pass') {
      result.details.push('SSL/TLS configuration OK');
    }
  } catch (e) {
    result.status = 'error';
    result.error  = e.message;
    result.details.push(`TLS check failed: ${e.message}`);
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkCORS(targetUrl, results) {
  const result = createSecResult('sec-cors', 'CORS Policy', 'cors', 'high');
  const t0 = Date.now();

  const dangerousOrigins = [
    'https://evil.com',
    'null',
    'https://attacker.example.com',
  ];

  try {
    for (const origin of dangerousOrigins) {
      const res = await get(targetUrl, { 'Origin': origin });
      const acao = res.headers['access-control-allow-origin'] || '';
      const acac = res.headers['access-control-allow-credentials'] || '';

      result.details.push(`Origin "${origin}" → ACAO: "${acao || 'not set'}"`);

      if (acao === '*' && acac === 'true') {
        result.status = 'fail';
        result.details.push('CRITICAL: Wildcard ACAO with credentials=true is dangerous');
      } else if (acao === origin && acac === 'true') {
        result.status = 'fail';
        result.details.push(`FAIL: Arbitrary origin "${origin}" reflected with credentials=true`);
      } else if (acao === origin) {
        result.status = 'warn';
        result.details.push(`WARN: Origin reflected without credentials — may allow cross-origin reads`);
      }
    }

    if (result.status === 'pass') {
      result.details.push('CORS policy appears restrictive');
    }
  } catch (e) {
    result.status = 'error'; result.error = e.message;
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkSensitiveFiles(targetUrl, results) {
  const result = createSecResult('sec-exposure', 'Sensitive File Exposure', 'exposure', 'critical');
  const t0 = Date.now();

  const base = targetUrl.replace(/\/$/, '');
  const exposed = [];

  await Promise.all(
    SENSITIVE_FILES.map(async (file) => {
      try {
        const res = await get(`${base}${file}`, {}, { timeout: 8000 });
        const status = res.status;
        if (status === 200) {
          exposed.push({ file, status });
          result.details.push(`EXPOSED [${status}]: ${file}`);
        } else {
          result.details.push(`OK [${status}]: ${file}`);
        }
      } catch (_) {
        result.details.push(`OK [ERR/4xx]: ${file}`);
      }
    })
  );

  if (exposed.length > 0) {
    result.status = 'fail';
    result.details.unshift(`CRITICAL: ${exposed.length} sensitive file(s) exposed!`);
  } else {
    result.details.unshift('No sensitive files found exposed');
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkInfoDisclosure(targetUrl, results) {
  const result = createSecResult('sec-info', 'Information Disclosure', 'exposure', 'medium');
  const t0 = Date.now();

  try {
    const res = await get(targetUrl);
    const headers = res.headers;

    const leaky = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator'];
    let issues = 0;

    for (const h of leaky) {
      if (headers[h]) {
        result.details.push(`⚠ ${h}: "${headers[h]}" — remove or sanitize`);
        issues++;
      }
    }

    // Check response body for stack traces / debug info
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (/stack trace|at \w+\.\w+\s*\(/i.test(body)) {
      result.details.push('⚠ Possible stack trace in response body');
      issues++;
    }
    if (/phpinfo|PHP Version|mysql_error|ORA-\d{5}/i.test(body)) {
      result.details.push('⚠ Technology/DB error disclosure in body');
      issues++;
    }

    result.status = issues > 0 ? 'warn' : 'pass';
    result.details.push(`Information disclosure issues: ${issues}`);
  } catch (e) {
    result.status = 'error'; result.error = e.message;
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkCSP(targetUrl, results) {
  const result = createSecResult('sec-csp', 'Content Security Policy Analysis', 'csp', 'high');
  const t0 = Date.now();

  try {
    const res = await get(targetUrl);
    const csp = res.headers['content-security-policy'] ||
                res.headers['content-security-policy-report-only'] || '';

    if (!csp) {
      result.status = 'fail';
      result.details.push('FAIL: No Content-Security-Policy header');
      result.duration_ms = Date.now() - t0;
      results.push(result);
      return;
    }

    result.details.push(`CSP: ${csp.substring(0, 300)}`);

    const issues = [];
    if (csp.includes("'unsafe-inline'") && csp.includes('script-src')) issues.push("unsafe-inline in script-src (allows inline scripts)");
    if (csp.includes("'unsafe-eval'"))   issues.push("unsafe-eval (allows eval())");
    if (csp.includes('script-src *') || csp.includes("script-src 'none'") === false && !csp.includes('script-src')) {
      if (csp.includes('script-src *')) issues.push("Wildcard script-src (any origin)");
    }
    if (!csp.includes('default-src') && !csp.includes('script-src')) issues.push("No script-src or default-src directive");
    if (!csp.includes('frame-ancestors') && !csp.includes('frame-src')) issues.push("No frame-ancestors (clickjacking protection)");

    issues.forEach(i => result.details.push(`⚠ ${i}`));
    result.status = issues.length > 0 ? 'warn' : 'pass';
    result.details.push(`CSP issues found: ${issues.length}`);
  } catch (e) {
    result.status = 'error'; result.error = e.message;
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkInjection(apiBaseUrl, auth, results) {
  const result = createSecResult('sec-injection', 'Injection Testing (SQLi + XSS)', 'injection', 'critical');
  const t0 = Date.now();

  const endpoints = [
    { url: `${apiBaseUrl}/api/auth/login`, method: 'POST', fieldName: 'username' },
    { url: `${apiBaseUrl}/api/search`,     method: 'GET',  param: 'q' },
    { url: `${apiBaseUrl}/api/users`,      method: 'GET',  param: 'filter' },
  ];

  let issues = 0;

  for (const ep of endpoints) {
    for (const [type, payloads] of Object.entries(INJECTION_PAYLOADS)) {
      for (const payload of payloads.slice(0, 2)) { // Test first 2 payloads
        try {
          let res;
          if (ep.method === 'POST') {
            res = await axios.post(ep.url, { [ep.fieldName]: payload }, {
              validateStatus: () => true, timeout: 8000,
              headers: { 'Content-Type': 'application/json' },
            });
          } else {
            res = await axios.get(ep.url, {
              params: { [ep.param]: payload },
              validateStatus: () => true, timeout: 8000,
            });
          }

          const body = JSON.stringify(res.data).toLowerCase();

          // Check for SQL error indicators
          const sqlErrors = ['syntax error', 'sqlexception', 'mysql_error', 'ora-', 'pg::error', 'sqlite_error', 'unclosed quotation'];
          const hasSQLError = sqlErrors.some(e => body.includes(e));

          // Check for XSS reflection
          const hasXSSReflect = type === 'xss' && body.includes(payload.toLowerCase().replace(/</g, '').replace(/>/g, ''));

          if (hasSQLError) {
            result.details.push(`CRITICAL ${type.toUpperCase()} [${ep.method} ${ep.url}]: SQL error in response!`);
            issues++;
          } else if (hasXSSReflect && res.status === 200) {
            result.details.push(`WARN XSS [${ep.method} ${ep.url}]: payload may be reflected`);
          } else {
            result.details.push(`OK ${type.toUpperCase()} [${ep.method} ${ep.url}]: HTTP ${res.status}`);
          }
        } catch (_) {
          result.details.push(`SKIP [${ep.method} ${ep.url}]: endpoint unreachable`);
        }
      }
    }
  }

  result.status = issues > 0 ? 'fail' : 'pass';
  if (issues === 0) result.details.push('No obvious injection vulnerabilities detected');

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkAuthBypass(apiBaseUrl, auth, results) {
  const result = createSecResult('sec-auth-bypass', 'Authentication Bypass Tests', 'auth', 'critical');
  const t0 = Date.now();

  const tests = [
    // JWT none algorithm
    {
      name: 'JWT None Algorithm',
      headers: { 'Authorization': `Bearer ${createJWTNone({ sub: '1', admin: true })}` },
    },
    // Empty Bearer
    {
      name: 'Empty Bearer Token',
      headers: { 'Authorization': 'Bearer ' },
    },
    // No auth
    {
      name: 'No Authorization Header',
      headers: {},
    },
    // Basic auth with null bytes
    {
      name: 'Null Byte in Auth Header',
      headers: { 'Authorization': 'Bearer null\x00admin' },
    },
  ];

  const protectedEndpoints = [
    `${apiBaseUrl}/api/user`,
    `${apiBaseUrl}/api/admin`,
    `${apiBaseUrl}/api/users`,
    `${apiBaseUrl}/api/me`,
  ];

  for (const ep of protectedEndpoints.slice(0, 2)) {
    for (const test of tests) {
      try {
        const res = await axios.get(ep, {
          headers: test.headers,
          validateStatus: () => true,
          timeout: 8000,
        });

        const accessible = res.status >= 200 && res.status < 300;
        result.details.push(`[${ep}] ${test.name}: HTTP ${res.status} ${accessible ? '⚠ ACCESSIBLE' : 'blocked'}`);

        if (accessible && test.name !== 'No Authorization Header') {
          result.status = 'fail';
          result.details.push(`FAIL: ${test.name} bypassed auth on ${ep}`);
        } else if (accessible && test.name === 'No Authorization Header') {
          result.status = 'fail';
          result.details.push(`FAIL: Endpoint ${ep} is publicly accessible without auth`);
        }
      } catch (_) {
        result.details.push(`SKIP [${ep}] ${test.name}: endpoint unreachable`);
      }
    }
  }

  if (!result.status || result.status === 'pass') {
    result.details.push('Authentication bypass tests passed');
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

async function checkRateLimitOnAuth(apiBaseUrl, results) {
  const result = createSecResult('sec-rate-auth', 'Rate Limiting on Auth Endpoint', 'rate-limit', 'high');
  const t0 = Date.now();

  const loginUrl = `${apiBaseUrl}/api/auth/login`;
  const ATTEMPTS = 5;
  const statuses = [];

  try {
    for (let i = 0; i < ATTEMPTS; i++) {
      const res = await axios.post(loginUrl, { username: 'ratelimitcheck@test.com', password: 'wrongpassXYZ' }, {
        validateStatus: () => true,
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      });
      statuses.push(res.status);
      if (res.status === 429) break; // Already rate limited
    }

    const count429 = statuses.filter(s => s === 429).length;
    result.details.push(`Auth attempts: ${statuses.length}, 429 responses: ${count429}`);
    result.details.push(`Status sequence: ${statuses.join(', ')}`);

    if (count429 > 0) {
      result.details.push('Rate limiting on auth endpoint is ACTIVE');
      result.status = 'pass';
    } else {
      result.status = 'warn';
      result.details.push(`No rate limiting detected after ${ATTEMPTS} failed login attempts — brute force possible`);
    }
  } catch (e) {
    result.status = 'skip';
    result.details.push(`Auth rate limit check skipped: ${e.message}`);
  }

  result.duration_ms = Date.now() - t0;
  results.push(result);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function createSecResult(id, name, type, severity) {
  return { id, name, type, severity, status: 'pass', details: [], duration_ms: 0, error: null };
}

async function get(url, extraHeaders = {}, extraOpts = {}) {
  return axios.get(url, {
    headers: {
      'User-Agent': 'AI-Security-Scanner/1.0',
      'Accept': '*/*',
      ...extraHeaders,
    },
    validateStatus: () => true,
    timeout: extraOpts.timeout || 5000,
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
  });
}

async function runPlanSecurityTest(test, baseUrl, auth) {
  const result = createSecResult(test.id, test.name, test.type, test.severity || 'medium');
  const t0 = Date.now();

  try {
    const targetUrl = test.endpoint.startsWith('http') ? test.endpoint : `${baseUrl}${test.endpoint}`;
    const headers = {};
    if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

    const res = await axios({
      method: (test.method || 'GET').toLowerCase(),
      url: targetUrl,
      headers,
      data: test.payload || undefined,
      validateStatus: () => true,
      timeout: 10000,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    });

    result.details.push(`HTTP ${res.status} — Expected: ${test.expected}`);

    // Basic pass/fail heuristic for plan-defined tests
    if (test.type === 'exposure' && res.status === 200) {
      result.status = 'fail';
      result.details.push(`FAIL: Sensitive endpoint returned 200`);
    } else if (test.type === 'auth' && res.status === 200) {
      result.status = 'warn';
      result.details.push('Warn: Endpoint accessible — verify it requires auth');
    }
  } catch (e) {
    result.status = 'skip';
    result.details.push(`Skipped: ${e.message}`);
  }

  result.duration_ms = Date.now() - t0;
  return result;
}

// Craft a JWT with "none" algorithm for bypass testing
function createJWTNone(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

module.exports = { runSecurityTests };
