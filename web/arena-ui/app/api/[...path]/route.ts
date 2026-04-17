import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const READ_ONLY_COLLECTIONS = new Set(["bots", "maps", "matches", "rankings"]);

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function jsonHeaders(upstream: Response) {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

function unavailableResponse(method: string, path: string[]) {
  const [collection] = path;

  if (
    method === "GET" &&
    path.length === 1 &&
    READ_ONLY_COLLECTIONS.has(collection)
  ) {
    return NextResponse.json([]);
  }

  return NextResponse.json(
    {
      error: "Arena API is not configured",
      detail:
        "Set ARENA_API_URL to the arena-api service address, for example http://arena-api:9090.",
    },
    { status: 503 },
  );
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const key = "ARENA_API_URL";
  const apiBase = process.env[key];

  if (!apiBase) {
    return unavailableResponse(request.method, path);
  }

  const incomingUrl = new URL(request.url);
  const target = `${normalizeBaseUrl(apiBase)}/${path.join("/")}${incomingUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");

  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);

  // SSE endpoints (e.g. /matches/123/live) need long timeout and streaming headers
  const isSSE = path.length >= 3 && path[path.length - 1] === "live";
  // POST /matches needs longer timeout because of pre-match bot ping (up to 2s × 2 bots)
  const isWrite = request.method === "POST" || request.method === "PUT" || request.method === "DELETE";
  const timeout = isSSE ? 600000 : isWrite ? 10000 : 5000;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });

    const responseHeaders = isSSE
      ? new Headers({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        })
      : jsonHeaders(upstream);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return unavailableResponse(request.method, path);
  }
}

export { proxy as DELETE, proxy as GET, proxy as POST, proxy as PUT };
