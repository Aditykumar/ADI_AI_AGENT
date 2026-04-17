'use strict';
/**
 * AI Client — supports 4 providers, auto-fallback chain:
 *
 *  AI_PROVIDER=ollama  → Ollama local LLaMA (FREE, local)
 *  AI_PROVIDER=groq    → Groq cloud API    (FREE tier, 6k req/day)
 *  AI_PROVIDER=claude  → Anthropic Claude  (paid, best quality)
 *  AI_PROVIDER=openai  → OpenAI GPT        (paid)
 *
 * Fallback chain (if primary fails):
 *   ollama → groq (if key set) → claude (if key set) → openai (if key set) → throw
 */
const cfg = require('../../config/config');

// ── Lazy SDK instances ────────────────────────────────────────────────────
let _anthropic = null;
let _groq       = null;
let _openai     = null;

function getAnthropic() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: cfg.ai.claude.apiKey });
  }
  return _anthropic;
}

function getGroq() {
  if (!_groq) {
    const Groq = require('groq-sdk');
    _groq = new Groq({ apiKey: cfg.ai.groq.apiKey });
  }
  return _groq;
}

function getOpenAI() {
  if (!_openai) {
    const OpenAI = require('openai');
    _openai = new OpenAI({ apiKey: cfg.ai.openai.apiKey });
  }
  return _openai;
}

// ── Ollama reachability ───────────────────────────────────────────────────
async function isOllamaAlive(baseUrl) {
  const http  = require('http');
  const https = require('https');
  return new Promise((resolve) => {
    try {
      const u   = new URL(baseUrl);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(`${baseUrl}/api/tags`, { timeout: 4000 }, (res) => {
        resolve(res.statusCode < 500);
        res.resume();
      });
      req.on('error',   () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch (_) { resolve(false); }
  });
}

function makeOllamaClient(baseUrl) {
  const { Ollama } = require('ollama');
  return new Ollama({ host: baseUrl });
}

// ── Provider implementations ──────────────────────────────────────────────

async function chatOllama(systemPrompt, userPrompt) {
  const candidateUrls = [
    cfg.ai.ollama.baseUrl,
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://host.docker.internal:11434',
  ].filter((v, i, a) => a.indexOf(v) === i);

  for (const base of candidateUrls) {
    if (!(await isOllamaAlive(base))) continue;
    console.log(`  [AI] Ollama @ ${base}  model=${cfg.ai.ollama.model}`);
    const ollama = makeOllamaClient(base);
    const res = await ollama.chat({
      model:    cfg.ai.ollama.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      stream:  false,
      options: { temperature: 0.2 },
    });
    return res.message.content;
  }
  throw new Error('Ollama not reachable on any candidate URL');
}

async function chatGroq(systemPrompt, userPrompt) {
  if (!cfg.ai.groq.apiKey) throw new Error('GROQ_API_KEY not set in .env');
  console.log(`  [AI] Groq cloud  model=${cfg.ai.groq.model}`);
  const groq = getGroq();
  const res  = await groq.chat.completions.create({
    model:    cfg.ai.groq.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ],
    temperature: 0.2,
  });
  return res.choices[0].message.content;
}

async function chatClaude(systemPrompt, userPrompt) {
  if (!cfg.ai.claude.apiKey) throw new Error('ANTHROPIC_API_KEY not set in .env');
  console.log(`  [AI] Claude  model=${cfg.ai.claude.model}`);
  const client = getAnthropic();
  const res    = await client.messages.create({
    model:      cfg.ai.claude.model,
    max_tokens: 4096,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  return res.content[0].text;
}

async function chatOpenAI(systemPrompt, userPrompt) {
  if (!cfg.ai.openai.apiKey) throw new Error('OPENAI_API_KEY not set in .env');
  console.log(`  [AI] OpenAI  model=${cfg.ai.openai.model}`);
  const oai = getOpenAI();
  const res = await oai.chat.completions.create({
    model:    cfg.ai.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ],
    temperature: 0.2,
  });
  return res.choices[0].message.content;
}

// ── Provider dispatch map ─────────────────────────────────────────────────
const PROVIDERS = {
  ollama: chatOllama,
  groq:   chatGroq,
  claude: chatClaude,
  openai: chatOpenAI,
};

/**
 * Send a prompt to the configured AI provider.
 * Falls back through available providers if primary fails.
 */
async function chat(systemPrompt, userPrompt) {
  const primary  = cfg.ai.provider;
  const fn       = PROVIDERS[primary];

  if (!fn) {
    throw new Error(`Unknown AI_PROVIDER="${primary}". Valid: ollama, groq, claude, openai`);
  }

  // Try primary
  try {
    return await fn(systemPrompt, userPrompt);
  } catch (primaryErr) {
    console.warn(`  [AI] ${primary} failed: ${primaryErr.message.substring(0, 120)}`);
  }

  // Auto-fallback chain (skip primary, skip providers with no credentials)
  const fallbackOrder = ['ollama', 'groq', 'claude', 'openai'].filter(p => p !== primary);
  for (const fb of fallbackOrder) {
    // Only try providers that have credentials configured
    const hasCredential =
      fb === 'ollama' ? true :                  // ollama has no API key requirement
      fb === 'groq'   ? !!cfg.ai.groq.apiKey  :
      fb === 'claude' ? !!cfg.ai.claude.apiKey :
      fb === 'openai' ? !!cfg.ai.openai.apiKey : false;

    if (!hasCredential) continue;

    try {
      console.warn(`  [AI] Falling back to ${fb}…`);
      return await PROVIDERS[fb](systemPrompt, userPrompt);
    } catch (fbErr) {
      console.warn(`  [AI] ${fb} also failed: ${fbErr.message.substring(0, 100)}`);
    }
  }

  throw new Error(
    `All AI providers failed. Options:\n` +
    `  FREE local  : AI_PROVIDER=ollama  (run: ollama serve)\n` +
    `  FREE cloud  : AI_PROVIDER=groq    (get free key: https://console.groq.com)\n` +
    `  Claude      : AI_PROVIDER=claude  ANTHROPIC_API_KEY=sk-ant-...\n` +
    `  Skip AI     : ./run.sh --skip-ai  (uses built-in test plan)\n`
  );
}

/**
 * Return a human-readable status string for the current provider.
 */
async function providerStatus() {
  const p = cfg.ai.provider;

  if (p === 'ollama') {
    const alive = await isOllamaAlive(cfg.ai.ollama.baseUrl);
    if (!alive) return { ok: false, label: `Ollama — NOT running (start: ollama serve)` };
    // Check model
    try {
      const ollama = makeOllamaClient(cfg.ai.ollama.baseUrl);
      const res    = await ollama.list();
      const models = (res.models || []).map(m => m.name);
      const found  = models.some(m => m.startsWith(cfg.ai.ollama.model.split(':')[0]));
      if (!found) return {
        ok: false,
        label: `Ollama running but model "${cfg.ai.ollama.model}" not pulled`,
        hint:  `run: ollama pull ${cfg.ai.ollama.model}`,
        models,
      };
      return { ok: true, label: `Ollama (FREE local)  model=${cfg.ai.ollama.model}`, models };
    } catch (e) {
      return { ok: false, label: `Ollama error: ${e.message}` };
    }
  }

  if (p === 'groq') {
    if (!cfg.ai.groq.apiKey) return { ok: false, label: 'Groq — GROQ_API_KEY not set in .env', hint: 'Get free key: https://console.groq.com' };
    return { ok: true, label: `Groq (FREE cloud)  model=${cfg.ai.groq.model}` };
  }

  if (p === 'claude') {
    if (!cfg.ai.claude.apiKey) return { ok: false, label: 'Claude — ANTHROPIC_API_KEY not set in .env', hint: 'Get key: https://console.anthropic.com' };
    return { ok: true, label: `Claude (Anthropic)  model=${cfg.ai.claude.model}` };
  }

  if (p === 'openai') {
    if (!cfg.ai.openai.apiKey) return { ok: false, label: 'OpenAI — OPENAI_API_KEY not set in .env' };
    return { ok: true, label: `OpenAI  model=${cfg.ai.openai.model}` };
  }

  return { ok: false, label: `Unknown provider: ${p}` };
}

module.exports = { chat, providerStatus, isOllamaAlive };
