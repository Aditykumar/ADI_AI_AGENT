#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║         AI Testing Agent — Main Runner                              ║
# ║                                                                     ║
# ║  Usage:                                                             ║
# ║    ./run.sh --url https://example.com                               ║
# ║    ./run.sh --url https://example.com --skip-ai                     ║
# ║    ./run.sh --url https://example.com --security-only               ║
# ║    ./run.sh --url https://example.com --api-url https://api.ex.com  ║
# ╚══════════════════════════════════════════════════════════════════════╝

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE22="$HOME/.nvm/versions/node/v22.19.0/bin/node"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── Locate Node 22 ────────────────────────────────────────────────────
find_node() {
  # 1. Explicit nvm Node 22
  [ -f "$NODE22" ] && { echo "$NODE22"; return; }

  # 2. Any node ≥ 18 on PATH
  if command -v node &>/dev/null; then
    VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo "ok")
    [ "$VER" = "ok" ] && { echo "node"; return; }
  fi

  # 3. Scan common nvm paths
  for v in 24 23 22 20 18; do
    N="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node/" 2>/dev/null | grep "^v${v}\." | sort -V | tail -1)/bin/node"
    [ -f "$N" ] && { echo "$N"; return; }
  done

  echo ""
}

NODE_BIN=$(find_node)

if [ -z "$NODE_BIN" ]; then
  echo -e "${RED}✗ Node.js 18+ not found.${RESET}"
  echo "  Run ./setup.sh first to install everything."
  exit 1
fi

# ── Ensure setup has been done ────────────────────────────────────────
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo -e "${YELLOW}⚠  node_modules missing — running setup first…${RESET}"
  bash "$SCRIPT_DIR/setup.sh"
fi

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo -e "${YELLOW}⚠  .env missing — copying from .env.example…${RESET}"
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo -e "${YELLOW}   Edit .env and set TARGET_URL, then re-run.${RESET}"
  exit 1
fi

# ── Auto-start Ollama if AI_PROVIDER=ollama ───────────────────────────
start_ollama_if_needed() {
  # Read AI_PROVIDER from .env
  local provider
  provider=$(grep -E "^AI_PROVIDER=" "$SCRIPT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" | xargs)

  [ "$provider" != "ollama" ] && return 0

  # Check if Ollama is already answering
  if curl -sf http://localhost:11434/ >/dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Ollama already running${RESET}"
    return 0
  fi

  # Try to start it
  if command -v ollama &>/dev/null; then
    echo -e "${CYAN}  ↻ Starting Ollama server…${RESET}"
    ollama serve > "$SCRIPT_DIR/.ollama.log" 2>&1 &
    OLLAMA_PID=$!
    echo $OLLAMA_PID > "$SCRIPT_DIR/.ollama.pid"

    # Wait up to 10 s for Ollama to be ready
    local i=0
    while [ $i -lt 20 ]; do
      sleep 0.5
      curl -sf http://localhost:11434/ >/dev/null 2>&1 && {
        echo -e "${GREEN}  ✓ Ollama started (pid $OLLAMA_PID)${RESET}"
        return 0
      }
      i=$((i+1))
    done
    echo -e "${YELLOW}  ⚠ Ollama did not respond — will fall back to default test plan${RESET}"
  else
    echo -e "${YELLOW}  ⚠ Ollama not installed — using default test plan (run ./setup.sh to install)${RESET}"
  fi
}

start_ollama_if_needed

# ── Run the agent ─────────────────────────────────────────────────────
cd "$SCRIPT_DIR"
exec "$NODE_BIN" src/index.js "$@"
