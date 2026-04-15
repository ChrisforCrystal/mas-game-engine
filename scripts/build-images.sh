


docker buildx build --platform linux/amd64 -f apps/arena-api/Dockerfile -t image.midea.com/midea-middleware/agent-arena-api:latest --push .

docker buildx build --platform linux/amd64  -f Dockerfile.arena-ui -t image.midea.com/midea-middleware/agent-arena-ui:latest --push .