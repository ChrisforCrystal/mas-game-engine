#!/usr/bin/env bash
# 本地快速对战测试 — 用内置 bot 跑一场，验证引擎是否正常
# 用法: ./scripts/test-local.sh [seed] [--map <path>] [--list]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED="${1:-42}"

# pass through all args after seed to local-match
EXTRA_ARGS=()
i=2
while [[ $i -le $# ]]; do
  EXTRA_ARGS+=("${!i}")
  ((i++)) || true
done

echo "==> 编译 Rust..."
cargo build -p local-match --release 2>&1 | tail -3

# handle --list: just run and exit
if [[ " ${EXTRA_ARGS[*]:-} " == *" --list "* ]]; then
  "$ROOT/target/release/local-match" --list
  exit 0
fi

echo ""
echo "==> 运行本地对战 seed=$SEED ${EXTRA_ARGS[*]:-}"
"$ROOT/target/release/local-match" "$SEED" "${EXTRA_ARGS[@]:-}"

REPLAY="$ROOT/artifacts/replays/match-${SEED}.json"
if [[ -f "$REPLAY" ]]; then
  echo ""
  echo "==> replay 已生成: $REPLAY"
  echo "    大小: $(du -sh "$REPLAY" | cut -f1)"
  echo "    帧数: $(python3 -c "import json,sys; d=json.load(open('$REPLAY')); print(len(d['frames']))" 2>/dev/null || echo "需要 python3 查看")"
else
  echo "ERROR: replay 文件未生成" && exit 1
fi
