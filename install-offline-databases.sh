#!/usr/bin/env bash
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
DATA="$BASE/data"
mkdir -p "$DATA"

echo "== JHack Lingua offline database installer =="

VENV="$BASE/.venv"
if [ ! -d "$VENV" ]; then
  echo "[1/4] Creating private Python virtual environment..."
  python3 -m venv "$VENV"
fi

PY="$VENV/bin/python"
PIP="$VENV/bin/pip"

echo "[2/4] Installing isolated downloader dependencies..."
"$PIP" install --upgrade pip >/dev/null
"$PIP" install --upgrade wn >/dev/null

echo "[3/4] Downloading Open English WordNet 2025+..."
"$PY" -m wn download oewn:2025-plus

echo "[4/4] Building local indexes..."
"$PY" "$BASE/build_indexes.py"

echo "DONE. Local indexes:"
echo "  $DATA/oewn-index.json"
echo "  $DATA/persian-index.json"
