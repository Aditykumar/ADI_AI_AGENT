'use strict';
/**
 * Test Planner — Uses an AI model to generate a structured JSON test plan
 * for UI, API, Performance, and Security testing.
 */
const ai = require('./aiClient');

const SYSTEM_PROMPT = `You are an expert QA engineer and security researcher.
Given a target URL (and optional API base URL), generate a comprehensive JSON test plan.
Output ONLY valid JSON — no markdown, no commentary, no code fences.

JSON schema:
{
  "ui_tests": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "steps": ["string"],
      "expected": "string",
      "tags": ["string"]
    }
  ],
  "api_tests": [
    {
      "id": "string",
      "name": "string",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "endpoint": "string (relative path)",
      "headers": {},
      "body": null,
      "expected_status": 200,
      "expected_fields": ["string"],
      "tags": ["string"]
    }
  ],
  "performance_tests": [
    {
      "id": "string",
      "name": "string",
      "url": "string",
      "thresholds": {
        "performance": 80,
        "accessibility": 90,
        "best_practices": 80,
        "seo": 80,
        "lcp_ms": 2500,
        "fid_ms": 100,
        "cls": 0.1,
        "ttfb_ms": 800,
        "fcp_ms": 1800,
        "tbt_ms": 300
      }
    }
  ],
  "security_tests": [
    {
      "id": "string",
      "name": "string",
      "type": "headers|ssl|cors|injection|auth|exposure|rate-limit|csp",
      "endpoint": "string",
      "method": "GET|POST",
      "payload": null,
      "expected": "string",
      "severity": "critical|high|medium|low|info"
    }
  ],
  "sso_tests": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "steps": ["string"],
      "expected": "string"
    }
  ]
}`;

/**
 * Generate a full test plan for the given target.
 * @param {{ url: string, apiBaseUrl?: string, extra?: string }} opts
 * @returns {Promise<object>} Parsed test plan
 */
async function generateTestPlan(opts) {
  const { url, apiBaseUrl, extra } = opts;
  const userPrompt = `
Target URL: ${url}
${apiBaseUrl ? `API Base URL: ${apiBaseUrl}` : ''}
${extra    ? `Extra context: ${extra}`      : ''}

Generate a comprehensive test plan covering:
1. At least 8 UI test cases (navigation, forms, responsive, SSO/auth, accessibility, error states, interactive elements, page content)
2. At least 6 API test cases (CRUD operations, auth endpoints, error handling, rate limit detection)
3. Performance test for the main URL and any key sub-pages
4. At least 10 security checks (security headers, CORS, SQLi, XSS, sensitive file exposure, auth bypass, SSL, CSP, clickjacking, info disclosure)
5. SSO flow tests if auth endpoints are provided

Be specific and actionable. Use real HTTP methods and realistic paths for the given site.`;

  const raw = await ai.chat(SYSTEM_PROMPT, userPrompt);

  // Extract JSON from the response (handle cases where model adds extra text)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON. Raw response:\n' + raw.substring(0, 500));
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Failed to parse AI JSON: ${e.message}\nRaw: ${jsonMatch[0].substring(0, 500)}`);
  }
}

/**
 * Build a default fallback test plan (used when AI is not available).
 */
function defaultTestPlan(url, apiBaseUrl) {
  const api = apiBaseUrl || url;
  return {
    ui_tests: [
      {
        id: 'ui-001', name: 'Page Load', description: 'Verify the main page loads successfully',
        steps: ['Navigate to target URL', 'Wait for page to load'],
        expected: 'Page loads with status 200 and visible content', tags: ['smoke'],
      },
      {
        id: 'ui-002', name: 'Navigation Links', description: 'Verify all nav links are functional',
        steps: ['Find all <a> tags in <nav>', 'Click each link', 'Verify navigation'],
        expected: 'All links lead to valid pages', tags: ['navigation'],
      },
      {
        id: 'ui-003', name: 'Responsive Design – Mobile',
        description: 'Verify layout at 375px width',
        steps: ['Set viewport to 375x812', 'Navigate to URL', 'Check layout'],
        expected: 'No horizontal scroll, readable text', tags: ['responsive'],
      },
      {
        id: 'ui-004', name: 'Form Submission', description: 'Verify contact/search form works',
        steps: ['Find first form', 'Fill required fields', 'Submit', 'Check response'],
        expected: 'Form submits without errors', tags: ['forms'],
      },
      {
        id: 'ui-005', name: 'Console Error Check',
        description: 'Detect JavaScript errors during page load',
        steps: ['Navigate to URL', 'Monitor console', 'Check for errors'],
        expected: 'No critical console errors', tags: ['quality'],
      },
      {
        id: 'ui-006', name: 'SSO Login Flow',
        description: 'Test single sign-on login',
        steps: ['Navigate to login page', 'Enter credentials', 'Submit', 'Verify authenticated state'],
        expected: 'User is logged in and redirected', tags: ['auth', 'sso'],
      },
      {
        id: 'ui-007', name: 'Accessibility – ARIA & Alt Text',
        description: 'Check basic a11y compliance',
        steps: ['Navigate to URL', 'Check images for alt text', 'Check form labels', 'Check ARIA roles'],
        expected: 'Images have alt text, forms have labels', tags: ['accessibility'],
      },
      {
        id: 'ui-008', name: '404 Error Page',
        description: 'Verify custom 404 page is shown',
        steps: ['Navigate to /nonexistent-page-xyz', 'Check page content'],
        expected: 'Custom 404 page displayed', tags: ['error-handling'],
      },
    ],
    api_tests: [
      {
        id: 'api-001', name: 'Health Check', method: 'GET', endpoint: '/health',
        headers: {}, body: null, expected_status: 200, expected_fields: [], tags: ['smoke'],
      },
      {
        id: 'api-002', name: 'Unauthorized Access', method: 'GET', endpoint: '/api/user',
        headers: {}, body: null, expected_status: 401, expected_fields: ['error'], tags: ['auth'],
      },
      {
        id: 'api-003', name: 'Login Endpoint', method: 'POST', endpoint: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { username: 'test@example.com', password: 'TestPass123!' },
        expected_status: 200, expected_fields: ['token'], tags: ['auth'],
      },
      {
        id: 'api-004', name: 'Invalid Method', method: 'DELETE', endpoint: '/',
        headers: {}, body: null, expected_status: 405, expected_fields: [], tags: ['error-handling'],
      },
      {
        id: 'api-005', name: 'Malformed JSON Body', method: 'POST', endpoint: '/api/data',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid-json}', expected_status: 400, expected_fields: ['error'], tags: ['validation'],
      },
      {
        id: 'api-006', name: 'Rate Limit Detection', method: 'GET', endpoint: '/api/items',
        headers: {}, body: null, expected_status: 200, expected_fields: [], tags: ['rate-limit'],
      },
    ],
    performance_tests: [
      {
        id: 'perf-001', name: 'Main Page Performance', url,
        thresholds: {
          performance: 80, accessibility: 90, best_practices: 80, seo: 80,
          lcp_ms: 2500, fid_ms: 100, cls: 0.1, ttfb_ms: 800, fcp_ms: 1800, tbt_ms: 300,
        },
      },
    ],
    security_tests: [
      { id: 'sec-001', name: 'Security Headers', type: 'headers', endpoint: url, method: 'GET', payload: null, expected: 'All critical security headers present', severity: 'high' },
      { id: 'sec-002', name: 'SSL/TLS Configuration', type: 'ssl', endpoint: url, method: 'GET', payload: null, expected: 'Valid SSL certificate, TLS 1.2+', severity: 'critical' },
      { id: 'sec-003', name: 'CORS Policy', type: 'cors', endpoint: `${api}/api`, method: 'OPTIONS', payload: null, expected: 'Restrictive CORS policy', severity: 'high' },
      { id: 'sec-004', name: 'SQL Injection – Login', type: 'injection', endpoint: `${api}/api/auth/login`, method: 'POST', payload: { username: "' OR '1'='1", password: "' OR '1'='1" }, expected: 'Request rejected, no DB error exposed', severity: 'critical' },
      { id: 'sec-005', name: 'XSS – Search Input', type: 'injection', endpoint: `${api}/api/search?q=<script>alert(1)</script>`, method: 'GET', payload: null, expected: 'Script tag escaped or blocked', severity: 'high' },
      { id: 'sec-006', name: 'Sensitive File Exposure (.env)', type: 'exposure', endpoint: `${url}/.env`, method: 'GET', payload: null, expected: '403 or 404 — not exposed', severity: 'critical' },
      { id: 'sec-007', name: 'Sensitive File Exposure (.git)', type: 'exposure', endpoint: `${url}/.git/config`, method: 'GET', payload: null, expected: '403 or 404 — not exposed', severity: 'critical' },
      { id: 'sec-008', name: 'Clickjacking Protection (X-Frame-Options)', type: 'headers', endpoint: url, method: 'GET', payload: null, expected: 'X-Frame-Options: DENY or SAMEORIGIN', severity: 'medium' },
      { id: 'sec-009', name: 'Content Security Policy', type: 'csp', endpoint: url, method: 'GET', payload: null, expected: 'CSP header present and restrictive', severity: 'medium' },
      { id: 'sec-010', name: 'Server Information Disclosure', type: 'exposure', endpoint: url, method: 'GET', payload: null, expected: 'Server/X-Powered-By headers not exposing version', severity: 'low' },
      { id: 'sec-011', name: 'Auth Bypass – JWT None Algorithm', type: 'auth', endpoint: `${api}/api/user`, method: 'GET', payload: null, expected: 'JWT none algorithm rejected', severity: 'critical' },
      { id: 'sec-012', name: 'Rate Limiting on Auth', type: 'rate-limit', endpoint: `${api}/api/auth/login`, method: 'POST', payload: { username: 'x', password: 'x' }, expected: '429 after multiple failed attempts', severity: 'high' },
    ],
    sso_tests: [
      {
        id: 'sso-001', name: 'SSO Login Redirect',
        description: 'Clicking login redirects to SSO provider',
        steps: ['Navigate to login page', 'Click SSO login button', 'Verify redirect to identity provider'],
        expected: 'Redirected to IdP with correct client_id and redirect_uri',
      },
      {
        id: 'sso-002', name: 'SSO Callback Handling',
        description: 'Valid auth code exchanged for session',
        steps: ['Complete SSO login', 'Verify auth code received', 'Verify token exchanged', 'Verify session created'],
        expected: 'User authenticated and session established',
      },
      {
        id: 'sso-003', name: 'SSO Logout',
        description: 'Logout clears session and redirects',
        steps: ['Login via SSO', 'Click logout', 'Verify session cleared', 'Verify redirect'],
        expected: 'Session destroyed, user redirected to login',
      },
    ],
  };
}

module.exports = { generateTestPlan, defaultTestPlan };
