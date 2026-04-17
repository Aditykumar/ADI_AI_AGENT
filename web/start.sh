#!/bin/bash
# Start the AI Testing Agent web app (backend + frontend)
set -e

NODE=~/.nvm/versions/node/v22.19.0/bin/node
BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"

# Kill any existing processes on ports 3000 / 4000
lsof -ti:4000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  AI Testing Agent — Web UI               ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Backend  : http://localhost:4000        ║"
echo "║  Frontend : http://localhost:3000        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Start backend
echo "▶  Starting backend..."
cd "$BACKEND_DIR"
$NODE src/index.js &
BACKEND_PID=$!

sleep 2

# Verify backend
if curl -s http://localhost:4000/health > /dev/null; then
  echo "✓  Backend running (PID $BACKEND_PID)"
else
  echo "✗  Backend failed to start"
  exit 1
fi

# Start frontend
echo "▶  Starting frontend..."
cd "$FRONTEND_DIR"
$NODE node_modules/.bin/next dev -p 3000 &
FRONTEND_PID=$!

echo "✓  Frontend starting (PID $FRONTEND_PID)"
echo ""
echo "Open  http://localhost:3000  in your browser"
echo ""
echo "Demo credentials:"
echo "  admin / admin123"
echo "  tester / tester123"
echo "  dev / dev123"
echo ""
echo "Press Ctrl+C to stop all servers."
echo ""

# Wait and cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" EXIT INT TERM
wait $BACKEND_PID $FRONTEND_PID
