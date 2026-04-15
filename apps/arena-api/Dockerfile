# ── Build Rust http-match ─────────────────────────────────────────────────────
FROM rust:1.91-slim AS rust-builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/
COPY apps/ apps/

RUN cargo build -p http-match --release

# ── Build Go arena-api ────────────────────────────────────────────────────────
FROM golang:1.25-alpine AS go-builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build
COPY apps/arena-api/go.mod apps/arena-api/go.sum ./
RUN go mod download

COPY apps/arena-api/main.go .
RUN CGO_ENABLED=1 GOOS=linux go build -o arena-api .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=go-builder /build/arena-api .
COPY --from=rust-builder /build/target/release/http-match .

# maps/ and artifacts/ are mounted as PVC

EXPOSE 9090
CMD ["./arena-api"]
