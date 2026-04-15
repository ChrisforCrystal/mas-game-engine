#!/usr/bin/env bash
# 本地对外暴露服务 — 让同事可以通过局域网 IP 访问
# 用法: ./scripts/start-public.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 获取本机局域网 IP
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")

cleanup() {
  echo ""
  echo "==> 关闭服务..."
  kill "$PID_API" 2>/dev/null || true
  wait "$PID_API" 2>/dev/null || true
}
trap cleanup EXIT

# ── 1. 确保 http-match 二进制存在 ──────────────────────────────────────────
if [[ ! -f "$ROOT/target/release/http-match" ]]; then
  echo "==> 编译 Rust..."
  cargo build -p http-match --release 2>&1 | tail -3
fi
cp -f "$ROOT/target/release/http-match" "$ROOT/apps/arena-api/http-match"

# ── 2. 启动 Arena API ─────────────────────────────────────────────────────
echo "==> 启动 Arena API (0.0.0.0:9090)..."
cd "$ROOT/apps/arena-api"
go run . &
PID_API=$!

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

# ── 3. 启动前端（对外暴露）────────────────────────────────────────────────
echo ""
echo "==> 启动前端 (0.0.0.0:3000)..."
echo ""
echo "  同事访问地址："
echo "    排行榜:  http://$LOCAL_IP:3000/arena"
echo "    回放:    http://$LOCAL_IP:3000"
echo "    API:     http://$LOCAL_IP:9090"
echo ""
echo "  同事注册 bot 示例："
echo "    curl -X POST http://$LOCAL_IP:9090/bots \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"name\":\"my-bot\",\"url\":\"http://<bot-ip>:<port>\",\"owner\":\"姓名\"}'"
echo ""

cd "$ROOT/web/arena-ui"
NEXT_PUBLIC_ARENA_API="http://$LOCAL_IP:9090" npm run dev -- --hostname 0.0.0.0
