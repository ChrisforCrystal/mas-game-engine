#!/usr/bin/env bash
# HTTP bot 对战测试 — 启动两个 demo bot，跑一场完整对战
# 用法: ./scripts/test-http.sh [seed] [--map <path>] [--list]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED="${1:-42}"
BOT_A_PORT=18080
BOT_B_PORT=18081

# pass through all args after seed to http-match
EXTRA_ARGS=()
i=2
while [[ $i -le $# ]]; do
  EXTRA_ARGS+=("${!i}")
  ((i++)) || true
done

cleanup() {
  echo ""
  echo "==> 清理 demo bot 进程..."
  kill "$PID_A" "$PID_B" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> 编译 Rust..."
cargo build -p http-match --release 2>&1 | tail -3

echo ""
echo "==> 启动 demo bot A (port $BOT_A_PORT)..."
ARENA_BOT_PORT=$BOT_A_PORT ARENA_BOT_TEAM=Alpha \
  python3 "$ROOT/scripts/demo_bot.py" &
PID_A=$!

echo "==> 启动 demo bot B (port $BOT_B_PORT)..."
ARENA_BOT_PORT=$BOT_B_PORT ARENA_BOT_TEAM=Beta \
  python3 "$ROOT/scripts/demo_bot.py" &
PID_B=$!

echo "==> 等待 bot 就绪..."
for port in $BOT_A_PORT $BOT_B_PORT; do
  for i in $(seq 1 20); do
    if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
      echo "    port $port OK"
      break
    fi
    sleep 0.3
    if [[ $i -eq 20 ]]; then
      echo "ERROR: bot on port $port 启动超时" && exit 1
    fi
  done
done

echo ""
echo "==> 运行 HTTP 对战 seed=$SEED ${EXTRA_ARGS[*]:-}"
"$ROOT/target/release/http-match" \
  "http://localhost:$BOT_A_PORT" \
  "http://localhost:$BOT_B_PORT" \
  "$SEED" \
  "${EXTRA_ARGS[@]:-}"
