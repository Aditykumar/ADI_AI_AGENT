'use strict';
/**
 * API Executor — runs HTTP API tests using Axios.
 * Supports auth tokens, JSON validation, status assertion, and rate-limit detection.
 */
const axios = require('axios');

/**
 * Run all API tests from the plan.
 * @param {object}   plan       - Full test plan
 * @param {object}   opts       - { apiBaseUrl, apiKey, auth }
 * @returns {Promise<object[]>}
 */
async function runAPITests(plan, opts) {
  const { apiBaseUrl, apiKey, auth, emitAction } = opts;
  const emit = emitAction || (() => {});
  const results = [];

  const apiTests = plan.api_tests || [];

  // Build default headers
  const defaultHeaders = {};
  if (apiKey)     defaultHeaders['X-API-Key']     = apiKey;
  if (auth.token) defaultHeaders['Authorization'] = `Bearer ${auth.token}`;

  for (const test of apiTests) {
    const result = {
      id:          test.id,
      name:        test.name,
      type:        'api',
      method:      test.method,
      url:         `${apiBaseUrl}${test.endpoint}`,
      status:      'pass',
      details:     [],
      duration_ms: 0,
      http_status: null,
      error:       null,
    };

    const t0 = Date.now();
    emit('api_call', { method: test.method, url: `${apiBaseUrl}${test.endpoint}`, name: test.name });

    try {
      await runSingleAPITest(test, apiBaseUrl, defaultHeaders, auth, result);
      emit('api_result', { method: test.method, url: `${apiBaseUrl}${test.endpoint}`, status: result.http_status, result: result.status });
    } catch (err) {
      result.status = 'fail';
      result.error  = err.message;
      emit('api_result', { method: test.method, url: `${apiBaseUrl}${test.endpoint}`, error: err.message, result: 'fail' });
    }

    result.duration_ms = Date.now() - t0;
    results.push(result);
  }

  return results;
}

async function runSingleAPITest(test, baseUrl, defaultHeaders, auth, result) {
  const url     = `${baseUrl}${test.endpoint}`;
  const headers = { ...defaultHeaders, ...(test.headers || {}) };
  const method  = (test.method || 'GET').toLowerCase();
  const tags    = test.tags || [];

  // Rate-limit test: fire 20 rapid requests
  if (tags.includes('rate-limit') || test.name.toLowerCase().includes('rate limit')) {
    await testRateLimit(url, method, headers, result);
    return;
  }

  let body = test.body;

  // Handle intentionally malformed JSON for validation tests
  const isMalformedTest = test.name.toLowerCase().includes('malformed') || test.name.toLowerCase().includes('invalid json');

  let response;
  try {
    const requestCfg = {
      method,
      url,
      headers: isMalformedTest ? { ...headers, 'Content-Type': 'application/json' } : headers,
      data:    isMalformedTest ? 'INTENTIONALLY MALFORMED JSON {{{' : body,
      validateStatus: () => true,    // Never throw on HTTP error codes
      timeout: 20000,
    };

    if (method === 'get' || method === 'head' || method === 'delete') {
      delete requestCfg.data;
    }

    response = await axios(requestCfg);
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      result.status  = 'skip';
      result.details.push(`Skipped: Cannot connect to ${url} (${err.code})`);
      return;
    }
    throw err;
  }

  result.http_status = response.status;
  result.details.push(`HTTP ${response.status} ${response.statusText || ''}`);

  // Response time
  result.details.push(`Response size: ${JSON.stringify(response.data).length} bytes`);

  // ── Assertions ──────────────────────────────────────────────────────────
  // Status code check
  if (test.expected_status && response.status !== test.expected_status) {
    // Allow 2xx when expected is 200
    const expected = test.expected_status;
    const actual   = response.status;
    if (!(expected === 200 && actual >= 200 && actual < 300)) {
      result.status = 'fail';
      result.details.push(`Expected status ${expected}, got ${actual}`);
    } else {
      result.details.push(`Status ${actual} (expected ${expected} — 2xx accepted)`);
    }
  }

  // Expected fields in JSON body
  if (test.expected_fields?.length > 0 && typeof response.data === 'object') {
    for (const field of test.expected_fields) {
      const found = hasNestedKey(response.data, field);
      result.details.push(`Field "${field}": ${found ? 'present' : 'MISSING'}`);
      if (!found) result.status = 'fail';
    }
  }

  // Auth test: expect 401 for unauthenticated requests
  if (tags.includes('auth') && !auth.token && test.expected_status === 401) {
    if (response.status === 401) {
      result.details.push('Correctly requires authentication (401)');
    } else if (response.status === 200) {
      result.status = 'fail';
      result.details.push('FAIL: Unauthenticated request returned 200 — endpoint is not protected!');
    }
  }

  // Check for leaked stack traces / internal errors
  const bodyStr = JSON.stringify(response.data).toLowerCase();
  if (bodyStr.includes('stack trace') || bodyStr.includes('at object.<anonymous>') || bodyStr.includes('sqlexception')) {
    result.status = 'warn';
    result.details.push('Warning: Response may contain stack trace or internal error info');
  }

  // Check content-type header
  const ct = response.headers['content-type'] || '';
  result.details.push(`Content-Type: ${ct}`);

  // Check for CORS headers
  const acao = response.headers['access-control-allow-origin'];
  if (acao) result.details.push(`CORS Allow-Origin: ${acao}`);
}

// ── Rate Limit Test ──────────────────────────────────────────────────────────
async function testRateLimit(url, method, headers, result) {
  const REQUESTS = 25;
  const statuses = [];

  result.details.push(`Firing ${REQUESTS} rapid requests to detect rate limiting…`);

  await Promise.all(
    Array.from({ length: REQUESTS }, async (_, i) => {
      try {
        const res = await axios({
          method,
          url,
          headers,
          data: method !== 'get' ? { username: 'ratetest', password: 'ratetest' } : undefined,
          validateStatus: () => true,
          timeout: 10000,
        });
        statuses.push(res.status);
      } catch (_) {
        statuses.push(0);
      }
    })
  );

  const count429 = statuses.filter(s => s === 429).length;
  const count200 = statuses.filter(s => s === 200).length;

  result.details.push(`Responses — 200: ${count200}, 429: ${count429}, other: ${REQUESTS - count200 - count429}`);

  if (count429 > 0) {
    result.details.push('Rate limiting ACTIVE (429 responses detected)');
    result.status = 'pass';
  } else {
    result.status = 'warn';
    result.details.push(`Warning: No 429 responses — rate limiting may NOT be configured (${REQUESTS} requests sent)`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function hasNestedKey(obj, key) {
  if (typeof obj !== 'object' || obj === null) return false;
  if (key in obj) return true;
  return Object.values(obj).some(v => hasNestedKey(v, key));
}

module.exports = { runAPITests };
