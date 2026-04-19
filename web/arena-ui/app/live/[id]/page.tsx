"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { ReplayFrame, Tile, RobotState, ReplayEvent } from "@/lib/replay";
import { drawTiles, drawGrid, drawRobots, drawEventOverlays } from "@/components/replay-board";

const TILE_SIZE = 22;
const CANVAS_SCALE = 2;

type LiveMeta = { bot_a: string; bot_b: string; seed: number; width: number; height: number };

export default function LivePage() {
  const { id } = useParams<{ id: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [meta, setMeta] = useState<LiveMeta | null>(null);
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [done, setDone] = useState(false);
  const [connected, setConnected] = useState(false);
  const [mapSize, setMapSize] = useState<{ w: number; h: number } | null>(null);

  // SSE connection — connect directly to Go API to avoid Next.js proxy buffering
  useEffect(() => {
    if (!id) return;
    // determine Go API base: same host, port 9090
    const apiBase = `${window.location.protocol}//${window.location.hostname}:9090`;
    const es = new EventSource(`${apiBase}/matches/${id}/live-frames`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "init") {
          setMeta({ bot_a: data.bot_a, bot_b: data.bot_b, seed: data.seed, width: data.width, height: data.height });
          setMapSize({ w: data.width || 36, h: data.height || 36 });
        } else if (data.type === "frame") {
          const f = data.frame as ReplayFrame;
          setFrame(f);
        } else if (data.type === "done") {
          setDone(true);
          es.close();
        }
      } catch {}
    };
    es.onerror = () => { setConnected(false); };
    return () => es.close();
  }, [id]);

  // canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame || !mapSize) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = mapSize.w;
    const h = mapSize.h;
    canvas.width = w * TILE_SIZE * CANVAS_SCALE;
    canvas.height = h * TILE_SIZE * CANVAS_SCALE;
    ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);

    ctx.fillStyle = "#071320";
    ctx.fillRect(0, 0, w * TILE_SIZE, h * TILE_SIZE);

    drawTiles(ctx, frame.tiles, w, h);
    drawGrid(ctx, w, h);
    drawRobots(ctx, frame.robots);
    drawEventOverlays(ctx, frame.robots, frame.events);
  }, [frame, mapSize]);

  return (
    <div className="shell" style={{ padding: "56px 16px 16px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderRadius: 14, border: "1px solid rgba(118,155,196,0.18)", background: "rgba(7,18,32,0.82)", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: done ? "var(--muted)" : connected ? "#4ade80" : "#f87171", boxShadow: connected && !done ? "0 0 6px #4ade80" : "none" }} />
            <span style={{ color: done ? "var(--muted)" : "var(--alpha)", fontSize: "0.82rem", fontWeight: 600 }}>
              {done ? "比赛已结束" : connected ? "直播中" : "连接中..."}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.74rem" }}>比赛 #{id}</span>
          </div>
          {meta && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--alpha)", fontSize: "0.82rem" }}>{meta.bot_a}</span>
              <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>vs</span>
              <span style={{ color: "var(--beta, #ff4f6d)", fontSize: "0.82rem" }}>{meta.bot_b}</span>
            </div>
          )}
        </div>

        {/* canvas */}
        <div style={{ position: "relative", borderRadius: 14, border: "1px solid rgba(118,155,196,0.18)", background: "radial-gradient(circle at top, rgba(158,195,255,0.06), transparent 30%), linear-gradient(180deg, rgba(4,11,20,0.9), rgba(6,15,26,0.98))", padding: 10 }}>
          {/* score overlay */}
          {frame && (
            <div style={{ position: "absolute", top: 18, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 12, zIndex: 10, pointerEvents: "none" }}>
              <span style={{ background: "rgba(25,225,255,0.15)", border: "1px solid rgba(25,225,255,0.4)", borderRadius: 8, padding: "4px 14px", fontSize: "0.88rem", fontWeight: 700, color: "#19e1ff", backdropFilter: "blur(6px)" }}>
                {meta?.bot_a || "蓝方"} {frame.scores[0]}
              </span>
              <span style={{ color: "var(--muted)", fontSize: "0.78rem", alignSelf: "center" }}>回合 {frame.turn}/500</span>
              <span style={{ background: "rgba(255,79,109,0.15)", border: "1px solid rgba(255,79,109,0.4)", borderRadius: 8, padding: "4px 14px", fontSize: "0.88rem", fontWeight: 700, color: "#ff4f6d", backdropFilter: "blur(6px)" }}>
                {meta?.bot_b || "红方"} {frame.scores[1]}
              </span>
            </div>
          )}
          <canvas ref={canvasRef} style={{ width: "100%", height: "auto", borderRadius: 10, display: "block" }} />
          {!frame && !done && (
            <div style={{ padding: 80, textAlign: "center", color: "var(--muted)" }}>
              等待比赛数据...
            </div>
          )}
          {done && frame && (
            <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 10 }}>
              <a
                href={`/?seed=${meta?.seed}&botA=${encodeURIComponent(meta?.bot_a || "")}&botB=${encodeURIComponent(meta?.bot_b || "")}`}
                style={{ background: "rgba(25,225,255,0.15)", border: "1px solid rgba(25,225,255,0.5)", borderRadius: 10, padding: "8px 20px", color: "var(--alpha)", textDecoration: "none", fontSize: "0.84rem", fontWeight: 600, backdropFilter: "blur(6px)" }}
              >
                查看完整回放
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
