#!/usr/bin/env bash
# 构建并推送所有镜像
# 用法: ./scripts/build-images.sh <registry> [tag]
# 示例: ./scripts/build-images.sh registry.example.com/arena v1.0.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="${1:?用法: $0 <registry> [tag]}"
TAG="${2:-latest}"

echo "==> 编译 Rust (http-match)..."
cargo build -p http-match --release 2>&1 | tail -3

echo ""
echo "==> 构建 arena-api 镜像..."
docker build -t "$REGISTRY/arena-api:$TAG" "$ROOT/apps/arena-api"

echo ""
echo "==> 构建 http-match 镜像..."
docker build -f "$ROOT/Dockerfile.http-match" -t "$REGISTRY/http-match:$TAG" "$ROOT"

echo ""
echo "==> 构建 arena-ui 镜像..."
docker build -t "$REGISTRY/arena-ui:$TAG" "$ROOT/web/arena-ui"

echo ""
echo "==> 推送镜像..."
docker push "$REGISTRY/arena-api:$TAG"
docker push "$REGISTRY/http-match:$TAG"
docker push "$REGISTRY/arena-ui:$TAG"

echo ""
echo "完成。更新 deploy/k8s/*.yaml 中的镜像地址后执行："
echo "  kubectl apply -f deploy/k8s/"
