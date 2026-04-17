"use client";

import { useEffect, useRef, useState } from "react";
import { fetchMaps, fetchMapDetail, type MapInfo, type MapDetail } from "@/lib/api";
import {
  TILE_SIZE, CANVAS_SCALE,
  layoutToTiles, getSpawns,
  drawTiles, drawGrid, drawSpawns,
} from "@/lib/map-renderer";

export default function MapsPage() {
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetchMaps().then((m) => {
      setMaps(m);
      if (m.length > 0) setSelected(m[0].path);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    const filename = selected.replace(/^maps\//, "");
    fetchMapDetail(filename).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  useEffect(() => {
    if (!detail || !canvasRef.current) return;
    const { tiles, width, height } = layoutToTiles(detail);
    const spawns = getSpawns(detail);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width * TILE_SIZE * CANVAS_SCALE;
    canvas.height = height * TILE_SIZE * CANVAS_SCALE;
    canvas.style.width = `${width * TILE_SIZE}px`;
    canvas.style.height = `${height * TILE_SIZE}px`;
    ctx.scale(CANVAS_SCALE, CANVAS_SCALE);

    ctx.fillStyle = "#071320";
    ctx.fillRect(0, 0, width * TILE_SIZE, height * TILE_SIZE);

    drawTiles(ctx, tiles, width, height);
    drawGrid(ctx, width, height);
    drawSpawns(ctx, spawns);
  }, [detail]);

  const rows = detail?.layout ?? [];
  const mapW = rows[0]?.length ?? 0;
  const mapH = rows.length;
  const cabinetEntries = detail ? Object.entries(detail.cabinets) : [];

  return (
    <div className="shell">
      <div className="arena-shell frame" style={{ borderRadius: 28, maxWidth: 1100, margin: "0 auto" }}>
        <div>
          <p className="eyebrow">Maps</p>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "2.4rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            地图预览
          </h1>
        </div>

        {/* map selector */}
        <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          {maps.map((m) => (
            <button
              key={m.path}
              onClick={() => setSelected(m.path)}
              className="control-button"
              style={{
                background: selected === m.path ? "rgba(25,225,255,0.12)" : undefined,
                borderColor: selected === m.path ? "var(--alpha)" : undefined,
                color: selected === m.path ? "var(--alpha)" : undefined,
              }}
            >
              {m.name}
            </button>
          ))}
        </div>

        {detail && (
          <div style={{ marginTop: 24 }}>
            {/* info */}
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: "1.3rem", fontFamily: "var(--font-display)" }}>{detail.name}</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 4 }}>{detail.description}</p>
              <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 4 }}>
                尺寸: {mapW} x {mapH}
                {cabinetEntries.length > 0 && (
                  <span> &nbsp; 机柜: {cabinetEntries.length} 个</span>
                )}
              </p>
            </div>

            {/* canvas */}
            <div style={{ overflow: "auto", borderRadius: 12, border: "1px solid var(--line)", padding: 8, background: "#071320" }}>
              <canvas ref={canvasRef} />
            </div>

            {/* cabinet table */}
            {cabinetEntries.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginBottom: 8 }}>机柜容量</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {cabinetEntries.map(([id, cap]) => (
                    <div key={id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "4px 12px", fontSize: "0.78rem" }}>
                      <span style={{ color: "var(--alpha)" }}>{id}</span>
                      <span style={{ color: "var(--muted)", marginLeft: 6 }}>{cap}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* legend */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14 }}>
              {[
                ["#22364d", "墙"],
                ["#0d2034", "传送带"],
                ["rgba(25,225,255,0.3)", "Alpha 出生点"],
                ["rgba(255,100,160,0.3)", "Beta 出生点"],
              ].map(([color, label]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: color, border: "1px solid rgba(255,255,255,0.1)" }} />
                  <span style={{ fontSize: "0.74rem", color: "var(--muted)" }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {maps.length === 0 && (
          <p style={{ color: "var(--muted)", marginTop: 24 }}>暂无地图数据</p>
        )}
      </div>
    </div>
  );
}
