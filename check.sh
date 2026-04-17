#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║   AI Testing Agent — Pre-flight Check                               ║
# ╚══════════════════════════════════════════════════════════════════════╝

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE22="$HOME/.nvm/versions/node/v22.19.0/bin/node"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; ISSUES=$((ISSUES+1)); }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; WARNINGS=$((WARNINGS+1)); }
info() { echo -e "  ${DIM}•  $1${RESET}"; }
ISSUES=0; WARNINGS=0

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   🤖  AI Testing Agent — Pre-flight Check           ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}"

# ── Load .env values ──────────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Z_]+=.*' "$SCRIPT_DIR/.env" | sed 's/#.*//')
  set +o allexport
fi
AI_PROVIDER="${AI_PROVIDER:-ollama}"

# ── Node.js ──────────────────────────────────────────────────────────
echo -e "\n${BOLD}Node.js (requires ≥18)${RESET}"
if [ -f "$NODE22" ]; then
  ok "Node.js 22 at $NODE22"
else
  if command -v node &>/dev/null; then
    MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
    [ "$MAJOR" -ge 18 ] && ok "Node.js v$(node --version | tr -d v) on PATH" || fail "Node.js too old ($(node --version)) — run ./setup.sh"
  else
    fail "Node.js not found — run ./setup.sh"
  fi
fi

# ── npm packages ─────────────────────────────────────────────────────
echo -e "\n${BOLD}npm packages${RESET}"
MISSING_PKGS=()
for pkg in playwright axios lighthouse "@anthropic-ai/sdk" groq-sdk ollama openai; do
  DIR="$SCRIPT_DIR/node_modules/${pkg}"
  [ -d "$DIR" ] || MISSING_PKGS+=("$pkg")
done
if [ ${#MISSING_PKGS[@]} -eq 0 ]; then
  ok "All packages installed (playwright, axios, lighthouse, @anthropic-ai/sdk, groq-sdk, ollama, openai)"
else
  fail "Missing packages: ${MISSING_PKGS[*]} — run ./setup.sh"
fi

# ── Playwright Chromium ──────────────────────────────────────────────
echo -e "\n${BOLD}Playwright Chromium${RESET}"
if ls "$HOME/Library/Caches/ms-playwright"/chromium* >/dev/null 2>&1 || \
   ls "$HOME/.cache/ms-playwright"/chromium* >/dev/null 2>&1; then
  ok "Chromium browser downloaded"
else
  fail "Chromium not downloaded — run: ./setup.sh  (or: node ./node_modules/playwright/cli.js install chromium)"
fi

# ── AI Providers ─────────────────────────────────────────────────────
echo -e "\n${BOLD}AI Providers${RESET}"
echo -e "  Active: ${CYAN}${BOLD}${AI_PROVIDER}${RESET}"
echo ""

# Ollama
echo -e "  ${BOLD}① Ollama (FREE local)${RESET}  AI_PROVIDER=ollama"
if command -v ollama &>/dev/null; then
  OLLAMA_VER=$(ollama --version 2>/dev/null | grep -o '[0-9]*\.[0-9]*\.[0-9]*' | head -1)
  ok "Ollama installed v${OLLAMA_VER:-?}"
  if curl -sf http://localhost:11434/ >/dev/null 2>&1; then
    ok "Ollama server running at http://localhost:11434"
    if ollama list 2>/dev/null | grep -q "llama"; then
      MODELS=$(ollama list 2>/dev/null | grep llama | awk '{print $1}' | tr '\n' ' ')
      ok "LLaMA model(s): ${MODELS}"
    else
      warn "No llama model pulled → run: ollama pull llama3.2"
      info "Other free models: llama3.2:1b  phi3  mistral  gemma2:2b"
    fi
  else
    warn "Ollama installed but NOT running"
    info "Start it: ollama serve   (run.sh does this automatically)"
  fi
else
  warn "Ollama not installed → run: ./setup.sh"
  info "Or via Docker: docker compose up -d"
fi

# Groq
echo ""
echo -e "  ${BOLD}② Groq (FREE cloud — 6k req/day)${RESET}  AI_PROVIDER=groq"
if [ -n "$GROQ_API_KEY" ]; then
  ok "GROQ_API_KEY is set  model=${GROQ_MODEL:-llama-3.3-70b-versatile}"
  info "Free models: llama-3.3-70b-versatile | llama-3.1-8b-instant | mixtral-8x7b-32768"
else
  info "GROQ_API_KEY not set  (get free key: https://console.groq.com)"
fi

# Claude
echo ""
echo -e "  ${BOLD}③ Claude (Anthropic)${RESET}  AI_PROVIDER=claude"
if [ -n "$ANTHROPIC_API_KEY" ]; then
  ok "ANTHROPIC_API_KEY is set  model=${CLAUDE_MODEL:-claude-sonnet-4-6}"
  info "Models: claude-sonnet-4-6 | claude-haiku-4-5-20251001 | claude-opus-4-6"
else
  info "ANTHROPIC_API_KEY not set  (get key: https://console.anthropic.com)"
fi

# OpenAI
echo ""
echo -e "  ${BOLD}④ OpenAI (GPT)${RESET}  AI_PROVIDER=openai"
if [ -n "$OPENAI_API_KEY" ]; then
  ok "OPENAI_API_KEY is set  model=${OPENAI_MODEL:-gpt-4o}"
else
  info "OPENAI_API_KEY not set"
fi

# ── .env config ───────────────────────────────────────────────────────
echo -e "\n${BOLD}.env target config${RESET}"
if [ -f "$SCRIPT_DIR/.env" ]; then
  ok ".env file present"
  TARGET="${TARGET_URL:-}"
  [ -n "$TARGET" ] && ok "TARGET_URL = $TARGET" || warn "TARGET_URL is empty — edit .env"
else
  fail ".env not found — run: cp .env.example .env"
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}"
if [ "$ISSUES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}✅  All checks passed — ready to run!${RESET}"
elif [ "$ISSUES" -eq 0 ]; then
  echo -e "  ${YELLOW}${BOLD}⚠  Ready ($WARNINGS warning(s)) — see above${RESET}"
else
  echo -e "  ${RED}${BOLD}✗  $ISSUES issue(s), $WARNINGS warning(s) — run ./setup.sh${RESET}"
fi
echo ""
echo -e "  ${BOLD}Quick commands:${RESET}"
echo -e "  ${CYAN}# Free local AI (Ollama)${RESET}"
echo -e "  ./run.sh --url https://yoursite.com"
echo ""
echo -e "  ${CYAN}# Free cloud AI (Groq) — set AI_PROVIDER=groq + GROQ_API_KEY in .env${RESET}"
echo -e "  ./run.sh --url https://yoursite.com"
echo ""
echo -e "  ${CYAN}# Claude AI — set AI_PROVIDER=claude + ANTHROPIC_API_KEY in .env${RESET}"
echo -e "  ./run.sh --url https://yoursite.com"
echo ""
echo -e "  ${CYAN}# No AI (fastest, built-in 35-test plan)${RESET}"
echo -e "  ./run.sh --url https://yoursite.com --skip-ai"
echo ""
echo -e "  ${BOLD}Report:${RESET}  open reports/latest.html"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}"
echo ""
