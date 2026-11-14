#!/bin/bash
# Start Cube Coach: serves this folder on http://localhost:8765 and opens it in your browser.
# Double-click in Finder. (First time: right-click > Open, then Open, because macOS
# asks before running downloaded scripts.) Close this Terminal window to stop Cube Coach.

PORT=8765
URL="http://localhost:${PORT}"
LOG="${TMPDIR:-/tmp}/cube-coach-server.log"

cd "$(dirname "$0")" || { echo "Could not open the Cube Coach folder."; exit 1; }

echo ""
echo "  Cube Coach"
echo "  ----------"

is_cube_coach() {
  curl -s --max-time 2 "${URL}/index.html" 2>/dev/null | grep -q "<title>Cube Coach</title>"
}

port_busy() {
  curl -s -o /dev/null --max-time 2 "${URL}/" 2>/dev/null
}

# Already running (e.g. you double-clicked twice)? Just open it.
if is_cube_coach; then
  echo "  Cube Coach is already running at ${URL} - opening it."
  open "${URL}"
  exit 0
fi

if port_busy; then
  echo "  Something else is already using port ${PORT}."
  echo "  Close that program (or the other Terminal window), then try again."
  read -r -p "  Press Return to close. " _
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "  Python 3 is needed to run the small local web server."
  echo "  macOS will offer to install it (Command Line Tools) if you type 'python3' in Terminal."
  read -r -p "  Press Return to close. " _
  exit 1
fi

python3 serve.py "${PORT}" >"${LOG}" 2>&1 &
SERVER_PID=$!

cleanup() {
  local code=$?
  trap - EXIT HUP INT TERM
  if kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null
    wait "${SERVER_PID}" 2>/dev/null
  fi
  echo ""
  echo "  Cube Coach stopped."
  exit "${code}"
}
trap cleanup EXIT HUP INT TERM

# Wait (up to ~10 s) for the server to answer.
for _ in $(seq 1 50); do
  if is_cube_coach; then break; fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "  The local web server could not start:"
    sed 's/^/    /' "${LOG}"
    read -r -p "  Press Return to close. " _
    exit 1
  fi
  sleep 0.2
done

if ! is_cube_coach; then
  echo "  The local web server is slow to start - opening the browser anyway."
fi

open "${URL}"
echo "  Running at ${URL}  (Chrome recommended)"
echo "  Keep this window open while you use Cube Coach."
echo "  To stop: close this window, or press Ctrl+C."

wait "${SERVER_PID}"
