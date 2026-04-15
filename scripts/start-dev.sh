#!/usr/bin/env bash
# 启动完整开发环境：Arena API + 前端
# 用法: ./scripts/start-dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo ""
  echo "==> 关闭服务..."
  kill "$PID_API" 2>/dev/null || true
  wait "$PID_API" 2>/dev/null || true
  echo "    arena-api 已停止（前端请手动 Ctrl+C）"
}
trap cleanup EXIT

# ── 1. 确保 http-match 二进制存在 ──────────────────────────────────────────
if [[ ! -f "$ROOT/apps/arena-api/http-match" ]]; then
  echo "==> 编译 http-match..."
  cargo build -p http-match --release 2>&1 | tail -3
  cp "$ROOT/target/release/http-match" "$ROOT/apps/arena-api/http-match"
  echo "    已复制到 apps/arena-api/http-match"
fi

# ── 2. 启动 Arena API ─────────────────────────────────────────────────────
echo "==> 启动 Arena API (port 9090)..."
cd "$ROOT/apps/arena-api"
go run . &
PID_API=$!

# 等待 API 就绪
for i in $(seq 1 20); do
  if curl -sf http://localhost:9090/bots > /dev/null 2>&1; then
    echo "    Arena API OK"
    break
  fi
  sleep 0.5
  if [[ $i -eq 20 ]]; then
    echo "ERROR: Arena API 启动超时" && exit 1
  fi
done

# ── 3. 启动前端 ───────────────────────────────────────────────────────────
echo ""
echo "==> 启动前端 (port 3000)..."
echo "    排行榜: http://localhost:3000/arena"
echo "    回放:   http://localhost:3000"
echo ""
cd "$ROOT/web/arena-ui"
npm run dev
