#!/usr/bin/env bash
# Start Content Hub.
#
# Dependencies live in ./libs rather than a .venv because this drive is exFAT,
# which has no symlinks and therefore cannot host a virtualenv. PYTHONPATH
# points Python at them, which achieves the same isolation.
#
#   ./run.sh          normal
#   ./run.sh --reload auto-restart while editing the code
cd "$(dirname "$0")"
export PYTHONPATH="$PWD/libs"
PORT="${PORT:-8000}"
echo "Content Hub -> http://127.0.0.1:$PORT   (Ctrl+C to stop)"
exec python3 -m uvicorn main:app --host "${HOST:-127.0.0.1}" --port "$PORT" "$@"
