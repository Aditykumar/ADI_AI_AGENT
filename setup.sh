#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║         AI Testing Agent — One-Time Setup Script                    ║
# ║         Run once: ./setup.sh                                        ║
# ╚══════════════════════════════════════════════════════════════════════╝
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

NODE22="$HOME/.nvm/versions/node/v22.19.0/bin/node"
NPM22_CMD="$HOME/.nvm/versions/node/v22.19.0/bin/node $HOME/.nvm/versions/node/v22.19.0/lib/node_modules/npm/bin/npm-cli.js"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { echo -e "${CYAN}[setup]${RESET} $1"; }
ok()   { echo -e "${GREEN}  ✓${RESET} $1"; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $1"; }
step() { echo -e "\n${BOLD}${CYAN}══ $1 ══${RESET}"; }

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║        🤖  AI Testing Agent Setup                   ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""

cd "$SCRIPT_DIR"

# ── Step 1: Node.js 22 ───────────────────────────────────────────────
step "1. Node.js 22"
if [ -f "$NODE22" ]; then
  ok "Node.js $($NODE22 --version) at $NODE22"
else
  warn "Node.js 22 not found — trying nvm…"
  export NVM_DIR="$HOME/.nvm"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install 22
    NODE22=$(nvm which 22)
    NPM22_CMD="$NODE22 $(dirname $NODE22)/../lib/node_modules/npm/bin/npm-cli.js"
    ok "Installed Node.js 22"
  else
    echo -e "${RED}  nvm not found. Install Node.js 22:${RESET}"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    echo "    source ~/.bashrc && nvm install 22"
    exit 1
  fi
fi

# ── Step 2: npm packages ─────────────────────────────────────────────
step "2. npm packages"
if [ -d "node_modules/@anthropic-ai" ] && [ -d "node_modules/groq-sdk" ] && [ -d "node_modules/playwright" ]; then
  ok "All packages already installed"
else
  log "Installing packages (playwright, axios, lighthouse, @anthropic-ai/sdk, groq-sdk, ollama, openai)…"
  $NPM22_CMD install --legacy-peer-deps 2>&1 | tail -5
  ok "npm packages installed"
fi

# ── Step 3: Playwright Chromium ──────────────────────────────────────
step "3. Playwright Chromium browser"
PLAY_CACHE_MAC="$HOME/Library/Caches/ms-playwright"
PLAY_CACHE_LIN="$HOME/.cache/ms-playwright"
if ls "$PLAY_CACHE_MAC"/chromium* >/dev/null 2>&1 || ls "$PLAY_CACHE_LIN"/chromium* >/dev/null 2>&1; then
  ok "Playwright Chromium already downloaded"
else
  log "Downloading Playwright Chromium (~92 MB)…"
  "$NODE22" ./node_modules/playwright/cli.js install chromium 2>&1 | tail -3
  ok "Playwright Chromium installed"
fi

# ── Step 4: Ollama ───────────────────────────────────────────────────
step "4. Ollama (local LLaMA — FREE option)"

install_ollama() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &>/dev/null; then
      log "Installing Ollama via Homebrew…"
      brew install ollama
    else
      log "Downloading Ollama for macOS…"
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  elif [[ "$OSTYPE" == "linux"* ]]; then
    log "Installing Ollama for Linux…"
    curl -fsSL https://ollama.com/install.sh | sh
  else
    warn "Auto-install not supported on $OSTYPE. Visit https://ollama.com/download"
    return 1
  fi
}

if command -v ollama &>/dev/null; then
  ok "Ollama already installed ($(ollama --version 2>/dev/null | head -1))"
else
  if install_ollama 2>&1; then
    ok "Ollama installed"
  else
    warn "Ollama install skipped — can use Groq (free) or Claude instead"
  fi
fi

# ── Step 5: Pull LLaMA model ─────────────────────────────────────────
step "5. LLaMA model (llama3.2 — ~2 GB)"
MODEL_NAME="llama3.2"

if command -v ollama &>/dev/null; then
  pull_model() {
    if ! curl -sf http://localhost:11434/ >/dev/null 2>&1; then
      log "Starting Ollama server temporarily…"
      ollama serve >/tmp/ollama_setup.log 2>&1 &
      OLLAMA_SETUP_PID=$!
      sleep 3
      STARTED_OLLAMA=true
    fi
    log "Pulling ${MODEL_NAME} (~2 GB)…"
    ollama pull "$MODEL_NAME"
    ok "Model $MODEL_NAME ready"
    if [ "${STARTED_OLLAMA:-false}" = true ]; then
      kill "$OLLAMA_SETUP_PID" 2>/dev/null || true
    fi
  }

  if ollama list 2>/dev/null | grep -q "$MODEL_NAME"; then
    ok "Model $MODEL_NAME already present"
  else
    pull_model || warn "Could not pull $MODEL_NAME — use Groq (free cloud) instead"
  fi
  echo ""
  echo -e "  ${CYAN}Other FREE models you can pull:${RESET}"
  echo -e "    ollama pull llama3.2:1b   # 1.3 GB — fastest"
  echo -e "    ollama pull phi3          # 2 GB   — smart & fast"
  echo -e "    ollama pull mistral       # 4 GB   — good quality"
  echo -e "    ollama pull gemma2:2b     # 1.6 GB — tiny & capable"
fi

# ── Step 6: .env ─────────────────────────────────────────────────────
step "6. .env configuration"
if [ ! -f ".env" ]; then
  cp .env.example .env
  warn ".env created — edit TARGET_URL before running"
else
  ok ".env already exists"
fi

# ── Step 7: Dirs ──────────────────────────────────────────────────────
step "7. Output directories"
mkdir -p reports screenshots
ok "reports/ and screenshots/ ready"

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║   ✅  Setup complete!                                        ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Choose your FREE AI provider in .env:${RESET}"
echo ""
echo -e "  ${GREEN}Option A — Ollama (100% free, local, private)${RESET}"
echo -e "    AI_PROVIDER=ollama"
echo -e "    ollama serve   # keep running in a terminal"
echo ""
echo -e "  ${GREEN}Option B — Groq (free cloud, 6k req/day, no credit card)${RESET}"
echo -e "    AI_PROVIDER=groq"
echo -e "    GROQ_API_KEY=<your key from https://console.groq.com>"
echo ""
echo -e "  ${CYAN}Option C — Claude (best quality, paid)${RESET}"
echo -e "    AI_PROVIDER=claude"
echo -e "    ANTHROPIC_API_KEY=sk-ant-..."
echo ""
echo -e "  ${BOLD}Then run:${RESET}"
echo -e "  ${CYAN}./run.sh --url https://yoursite.com${RESET}"
echo -e "  ${CYAN}open reports/latest.html${RESET}"
echo ""
