'use strict';
/**
 * AI Client — Ollama (local LLaMA) primary, OpenAI GPT fallback.
 *
 * Resolution order:
 *  1. OLLAMA_BASE_URL (default http://localhost:11434)
 *  2. Docker Ollama at http://host.docker.internal:11434
 *  3. OpenAI if AI_PROVIDER=openai or OPENAI_API_KEY is set
 *  4. Returns null → caller uses defaultTestPlan()
 */
const cfg = require('../../config/config');

let _openai = null;

function getOpenAI() {
  if (!_openai) {
    const OpenAI = require('openai');
    _openai = new OpenAI({ apiKey: cfg.ai.openai.apiKey });
  }
  return _openai;
}

/**
 * Check if Ollama is reachable at the given base URL.
 */
async function isOllamaAlive(baseUrl) {
  const http = require('http');
  const https = require('https');
  return new Promise((resolve) => {
    const url = new URL(baseUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(`${baseUrl}/api/tags`, { timeout: 4000 }, (res) => {
      resolve(res.statusCode < 500);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Build an Ollama client pointing at the given base URL.
 */
function makeOllamaClient(baseUrl) {
  const { Ollama } = require('ollama');
  return new Ollama({ host: baseUrl });
}

/**
 * Send prompt → AI model → response text.
 * Tries Ollama first (localhost then Docker), falls back to OpenAI, then throws.
 */
async function chat(systemPrompt, userPrompt) {
  const provider = cfg.ai.provider;

  // ── OpenAI path ──────────────────────────────────────────────────────
  if (provider === 'openai') {
    if (!cfg.ai.openai.apiKey) throw new Error('OPENAI_API_KEY not set in .env');
    return _chatOpenAI(systemPrompt, userPrompt);
  }

  // ── Ollama path ──────────────────────────────────────────────────────
  const candidateUrls = [
    cfg.ai.ollama.baseUrl,                    // .env OLLAMA_BASE_URL
    'http://localhost:11434',                  // default local
    'http://host.docker.internal:11434',       // Docker Desktop host
    'http://127.0.0.1:11434',                  // loopback fallback
  ].filter((v, i, a) => a.indexOf(v) === i);  // deduplicate

  for (const base of candidateUrls) {
    const alive = await isOllamaAlive(base);
    if (!alive) continue;

    console.log(`  [AI] Ollama reachable at ${base} — using model ${cfg.ai.ollama.model}`);
    try {
      const ollama = makeOllamaClient(base);
      const res = await ollama.chat({
        model:   cfg.ai.ollama.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        stream: false,
        options: { temperature: 0.2 },
      });
      return res.message.content;
    } catch (err) {
      console.warn(`  [AI] Ollama error at ${base}: ${err.message}`);
    }
  }

  // ── Auto-fallback to OpenAI if key is available ──────────────────────
  if (cfg.ai.openai.apiKey) {
    console.warn('  [AI] Ollama unreachable — falling back to OpenAI GPT…');
    return _chatOpenAI(systemPrompt, userPrompt);
  }

  throw new Error(
    'Ollama is not running and no OPENAI_API_KEY is set.\n' +
    '  → Start Ollama:  ollama serve  (then: ollama pull llama3.2)\n' +
    '  → Or Docker:     docker compose up -d  (in the project directory)\n' +
    '  → Or set:        AI_PROVIDER=openai  and  OPENAI_API_KEY=sk-...  in .env\n' +
    '  → Or use:        --skip-ai  flag to use the built-in test plan'
  );
}

async function _chatOpenAI(systemPrompt, userPrompt) {
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

/**
 * List models available in Ollama.
 * Returns [] if Ollama is not reachable.
 */
async function listModels() {
  if (!(await isOllamaAlive(cfg.ai.ollama.baseUrl))) return [];
  try {
    const ollama = makeOllamaClient(cfg.ai.ollama.baseUrl);
    const res = await ollama.list();
    return (res.models || []).map(m => m.name);
  } catch (_) {
    return [];
  }
}

module.exports = { chat, listModels, isOllamaAlive };
