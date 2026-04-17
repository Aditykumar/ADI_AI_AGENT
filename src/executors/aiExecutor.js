'use strict';
/**
 * AI Browser Executor — uses AI vision + Playwright to autonomously
 * browse, click, fill forms and test any site like a human.
 *
 * Flow:
 *  1. Take screenshot
 *  2. Send to AI vision model with task description
 *  3. AI returns next action (click/type/scroll/navigate/done)
 *  4. Execute action in Playwright
 *  5. Repeat until AI says "done" or max steps reached
 */
const { chromium } = require('playwright');
const path         = require('path');
const fs           = require('fs');
const cfg          = require('../../config/config');
const { chat }     = require('../agent/aiClient');

const MAX_STEPS    = 25;
const SCREENSHOT_Q = 80; // jpeg quality

// ── System prompt for AI browser agent ──────────────────────────────────
const BROWSER_AGENT_SYSTEM = `You are an AI browser automation agent. You see screenshots of a web browser and decide what action to take next to complete the given task.

You MUST respond with ONLY a JSON object in this exact format:
{
  "action": "click" | "type" | "scroll" | "navigate" | "wait" | "done" | "fail",
  "target": "CSS selector or description of element to interact with",
  "value": "text to type, URL to navigate to, or scroll direction (up/down)",
  "reason": "brief explanation of why you're doing this",
  "found": ["list of important elements you see on screen"],
  "task_complete": false
}

Rules:
- Use "click" to click buttons, links, checkboxes
- Use "type" to fill text inputs (include selector in target)
- Use "navigate" to go to a URL
- Use "scroll" with value "down" or "up" to scroll the page
- Use "wait" if page is loading
- Use "done" when the task is complete (set task_complete: true)
- Use "fail" if the task cannot be completed
- Be precise with CSS selectors: prefer [type="submit"], button:contains("Login"), input[name="email"]
- Never click on obviously dangerous elements
`;

/**
 * Run an AI-driven browser automation task.
 * @param {string} taskDescription - What the AI should do (e.g. "Log in with admin/pass123 and navigate to dashboard")
 * @param {object} opts - { targetUrl, emitAction, maxSteps }
 * @returns {Promise<object>} { steps, success, finalUrl, screenshots }
 */
async function runAIBrowserTask(taskDescription, opts = {}) {
  const { targetUrl, emitAction, maxSteps = MAX_STEPS } = opts;
  const emit = emitAction || (() => {});

  const steps      = [];
  const screenshots = [];
  let   success    = false;
  let   finalUrl   = targetUrl;

  emit('test_start', { id: 'ai-browser', name: `AI Task: ${taskDescription}`, type: 'ai' });
  emit('navigate',   { url: targetUrl });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Track network calls
  page.on('request',  req => {
    if (['xhr','fetch'].includes(req.resourceType())) {
      emit('network', { method: req.method(), url: req.url(), type: 'request' });
    }
  });
  page.on('response', res => {
    if (['xhr','fetch'].includes(res.request().resourceType())) {
      emit('network', { method: res.request().method(), url: res.url(), status: res.status(), type: 'response' });
    }
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) emit('navigate', { url: frame.url() });
  });

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    let stepNum = 0;

    while (stepNum < maxSteps) {
      stepNum++;

      // ── Take screenshot ───────────────────────────────────────────
      const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: SCREENSHOT_Q, fullPage: false });
      const screenshotB64 = screenshotBuf.toString('base64');
      const currentUrl    = page.url();
      finalUrl = currentUrl;

      // Emit live screenshot
      emit('screenshot', { label: `Step ${stepNum}: ${currentUrl}`, url: currentUrl, img: screenshotB64 });

      // Save screenshot
      const shotPath = path.join(cfg.output.screenshotsDir, `ai_step_${stepNum}.jpg`);
      fs.writeFileSync(shotPath, screenshotBuf);
      screenshots.push(shotPath);

      // ── Ask AI what to do next ─────────────────────────────────────
      const userPrompt = `Task: ${taskDescription}

Current URL: ${currentUrl}
Step: ${stepNum}/${maxSteps}

Here is the current screenshot of the browser. What is the next action to take?`;

      let aiResponse;
      try {
        aiResponse = await chatWithVision(BROWSER_AGENT_SYSTEM, userPrompt, screenshotB64);
      } catch (e) {
        emit('action', { type: 'fail', text: `AI vision failed: ${e.message}` });
        break;
      }

      // ── Parse AI response ─────────────────────────────────────────
      let action;
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        action = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
      } catch (_) {
        emit('action', { type: 'fail', text: `Could not parse AI response` });
        break;
      }

      const step = {
        step:   stepNum,
        url:    currentUrl,
        action: action.action,
        target: action.target,
        value:  action.value,
        reason: action.reason,
        found:  action.found || [],
        screenshot: shotPath,
      };
      steps.push(step);

      emit('test_start', { id: `step-${stepNum}`, name: `[${stepNum}] ${action.action}: ${action.reason}`, type: 'ai' });

      // ── Execute action ─────────────────────────────────────────────
      try {
        if (action.action === 'done' || action.task_complete) {
          success = true;
          emit('test_done', { id: `step-${stepNum}`, name: `✓ Task complete`, status: 'pass', duration_ms: 0 });
          break;
        }

        if (action.action === 'fail') {
          emit('test_done', { id: `step-${stepNum}`, name: `✗ AI gave up: ${action.reason}`, status: 'fail', duration_ms: 0 });
          break;
        }

        if (action.action === 'navigate') {
          await page.goto(action.value, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(1000);
        }

        else if (action.action === 'click') {
          await clickElement(page, action.target);
          await page.waitForTimeout(800);
        }

        else if (action.action === 'type') {
          await typeInElement(page, action.target, action.value || '');
          await page.waitForTimeout(300);
        }

        else if (action.action === 'scroll') {
          const dir = (action.value || 'down') === 'up' ? -500 : 500;
          await page.evaluate(d => window.scrollBy(0, d), dir);
          await page.waitForTimeout(300);
        }

        else if (action.action === 'wait') {
          await page.waitForTimeout(2000);
        }

        emit('test_done', { id: `step-${stepNum}`, name: `${action.action}: ${action.target || action.value || ''}`, status: 'pass', duration_ms: 0 });

      } catch (execErr) {
        step.error = execErr.message;
        emit('test_done', { id: `step-${stepNum}`, name: `✗ Failed: ${execErr.message}`, status: 'fail', duration_ms: 0 });
      }
    }

  } catch (err) {
    emit('action', { type: 'error', text: `AI Browser error: ${err.message}` });
  } finally {
    await browser.close();
  }

  return { steps, success, finalUrl, screenshots };
}

// ── Click helper — tries multiple strategies ─────────────────────────────
async function clickElement(page, target) {
  if (!target) return;

  // Try CSS selector first
  try {
    await page.waitForSelector(target, { timeout: 3000 });
    await page.click(target);
    return;
  } catch (_) {}

  // Try text-based selector
  try {
    await page.click(`text="${target}"`);
    return;
  } catch (_) {}

  // Try partial text
  try {
    const el = await page.locator(`text=${target}`).first();
    await el.click({ timeout: 3000 });
    return;
  } catch (_) {}

  // Try by role
  try {
    await page.getByRole('button', { name: target }).click({ timeout: 2000 });
  } catch (_) {}
}

// ── Type helper ──────────────────────────────────────────────────────────
async function typeInElement(page, target, value) {
  if (!target) return;
  try {
    await page.waitForSelector(target, { timeout: 3000 });
    await page.fill(target, value);
    return;
  } catch (_) {}
  try {
    await page.locator(target).fill(value);
  } catch (_) {}
}

// ── Chat with vision — sends screenshot to AI ─────────────────────────────
async function chatWithVision(systemPrompt, userPrompt, imageBase64) {
  const provider = process.env.AI_PROVIDER || 'groq';

  // Claude supports vision natively
  if (provider === 'claude') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response  = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: userPrompt },
        ],
      }],
    });
    return response.content[0].text;
  }

  // Groq vision (llama-3.2-90b-vision)
  if (provider === 'groq') {
    const Groq    = require('groq-sdk');
    const client  = new Groq.default({ apiKey: process.env.GROQ_API_KEY });
    const response = await client.chat.completions.create({
      model:    'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
    });
    return response.choices[0].message.content;
  }

  // OpenAI vision fallback
  const OpenAI = require('openai');
  const client = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  });
  return response.choices[0].message.content;
}

module.exports = { runAIBrowserTask };
