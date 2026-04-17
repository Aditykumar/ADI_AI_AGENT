'use strict';
require('dotenv').config();
const path = require('path');

module.exports = {
  ai: {
    // ollama | groq | claude | openai
    provider: process.env.AI_PROVIDER || 'ollama',

    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model:   process.env.OLLAMA_MODEL   || 'llama3.2',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY || '',
      model:  process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile',
    },
    claude: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model:  process.env.CLAUDE_MODEL      || 'claude-sonnet-4-6',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model:  process.env.OPENAI_MODEL   || 'gpt-4o',
    },
  },
  target: {
    url:        process.env.TARGET_URL    || '',
    apiBaseUrl: process.env.API_BASE_URL  || '',
    apiKey:     process.env.API_KEY       || '',
  },
  auth: {
    username:      process.env.AUTH_USERNAME       || '',
    password:      process.env.AUTH_PASSWORD       || '',
    token:         process.env.AUTH_TOKEN          || '',
    loginUrl:      process.env.AUTH_LOGIN_URL      || '',
    tokenEndpoint: process.env.AUTH_TOKEN_ENDPOINT || '',
  },
  lighthouse: {
    timeout: parseInt(process.env.LIGHTHOUSE_TIMEOUT || '60000', 10),
  },
  output: {
    reportsDir:     path.resolve(process.env.REPORTS_DIR     || './reports'),
    screenshotsDir: path.resolve(process.env.SCREENSHOTS_DIR || './screenshots'),
  },
};
