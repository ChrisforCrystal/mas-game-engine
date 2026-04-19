"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchMaps, fetchMapDetail, createMap, updateMap, deleteMap, type MapInfo, type MapDetail } from "@/lib/api";
import {
  TILE_SIZE, CANVAS_SCALE,
  layoutToTiles, getSpawns,
  drawTiles, drawGrid, drawSpawns,
} from "@/lib/map-renderer";

export default function MapsPage() {
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // editor state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLayout, setEditLayout] = useState("");
  const [editCabinets, setEditCabinets] = useState("");
  const [editMsg, setEditMsg] = useState("");
  const [creating, setCreating] = useState(false);

  // preview from editor input
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const qsSuffix = qs ? `?${qs}` : "";

  async function reload() {
    const m = await fetchMaps();
    setMaps(m);
    if (m.length > 0 && !selectedId) setSelectedId(m[0].id);
  }

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetchMapDetail(selectedId).then(setDetail).catch(() => setDetail(null));
  }, [selectedId]);

  // render selected map
  useEffect(() => {
    if (!detail || !canvasRef.current) return;
    renderMap(canvasRef.current, detail);
  }, [detail]);

  // render editor preview
  useEffect(() => {
    if (!editing && !creating) return;
    if (!previewCanvasRef.current) return;
    try {
      const lines = editLayout.split("\n").filter(l => l.length > 0);
      if (lines.length === 0) return;
      let cabs: Record<string, number> = {};
      try { cabs = JSON.parse(editCabinets || "{}"); } catch { /* ignore */ }
      const preview: MapDetail = { name: editName, description: editDesc, layout: lines, cabinets: cabs };
      renderMap(previewCanvasRef.current, preview, { fitToContainer: true });
    } catch { /* ignore parse errors during typing */ }
  }, [editName, editDesc, editLayout, editCabinets, editing, creating]);

  function startEdit() {
    if (!detail || !selectedId) return;
    setEditName(detail.name);
    setEditDesc(detail.description);
    setEditLayout(detail.layout.join("\n"));
    setEditCabinets(JSON.stringify(detail.cabinets, null, 2));
    setEditMsg("");
    setEditing(true);
    setCreating(false);
  }

  function startCreate() {
    setEditName("");
    setEditDesc("");
    setEditLayout("");
    setEditCabinets("{}");
    setEditMsg("");
    setCreating(true);
    setEditing(false);
    setSelectedId(null);
    setDetail(null);
  }

  async function handleSave() {
    const lines = editLayout.split("\n").filter(l => l.length > 0);
    if (!editName || lines.length === 0) { setEditMsg("名称和布局不能为空"); return; }
    let cabs: Record<string, number> = {};
    try { cabs = JSON.parse(editCabinets || "{}"); } catch { setEditMsg("机柜 JSON 格式错误"); return; }

    try {
      if (creating) {
        const res = await createMap({ name: editName, description: editDesc, layout: lines, cabinets: cabs });
        setEditMsg("创建成功");
        setCreating(false);
        await reload();
        setSelectedId(res.id);
      } else if (editing && selectedId) {
        await updateMap(selectedId, { name: editName, description: editDesc, layout: lines, cabinets: cabs });
        setEditMsg("保存成功");
        setEditing(false);
        fetchMapDetail(selectedId).then(setDetail);
      }
    } catch (err: any) {
      setEditMsg("失败: " + err.message);
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    if (!confirm("确认删除这张地图？")) return;
    try {
      await deleteMap(selectedId);
      setSelectedId(null);
      setDetail(null);
      setEditing(false);
      await reload();
    } catch (err: any) {
      alert("删除失败: " + err.message);
    }
  }

  const rows = detail?.layout ?? [];
  const mapW = rows[0]?.length ?? 0;
  const mapH = rows.length;
  const cabinetEntries = detail ? Object.entries(detail.cabinets) : [];
  const isEditorOpen = editing || creating;
  const editLines = editLayout.split("\n").filter(l => l.length > 0);
  const editWidth = editLines[0]?.length ?? 0;
  const editHeight = editLines.length;
  const hasUnevenRows = editLines.some(line => line.length !== editWidth);

  return (
    <div className="shell">
      <div className="arena-shell frame" style={{ borderRadius: 28, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p className="eyebrow">Maps</p>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "2rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              地图管理
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={`/arena${qsSuffix}`} className="control-button" style={{ textDecoration: "none", color: "var(--muted)", opacity: 0.6 }}>排行榜</a>
            <button onClick={startCreate} className="control-button" style={{ background: "rgba(25,225,255,0.1)", borderColor: "var(--alpha)", color: "var(--alpha)" }}>
              新建地图
            </button>
          </div>
        </div>

        {/* map selector */}
        <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          {maps.map((m) => (
            <button
              key={m.id}
              onClick={() => { setSelectedId(m.id); setEditing(false); setCreating(false); }}
              className="control-button"
              style={{
                background: selectedId === m.id ? "rgba(25,225,255,0.12)" : undefined,
                borderColor: selectedId === m.id ? "var(--alpha)" : undefined,
                color: selectedId === m.id ? "var(--alpha)" : undefined,
              }}
            >
              {m.name}
            </button>
          ))}
        </div>

        {/* editor */}
        {isEditorOpen && (
          <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 14 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>地图名称</span>
                <input value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} placeholder="我的地图" />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>描述</span>
                <input value={editDesc} onChange={e => setEditDesc(e.target.value)} style={inputStyle} placeholder="地图描述" />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 18, alignItems: "start" }}>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={editorHelpStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: "var(--text)", fontSize: "0.86rem", fontWeight: 700 }}>布局字符说明</span>
                    <span style={{ color: hasUnevenRows ? "var(--danger)" : "var(--muted)", fontSize: "0.76rem" }}>
                      {editLines.length > 0 ? `${editWidth} 列 x ${editHeight} 行${hasUnevenRows ? " · 行宽不一致" : ""}` : "输入布局后显示尺寸"}
                    </span>
                  </div>
                  <p style={helperTextStyle}>
                    每一行是一排地图格子，每个字符代表一个格子。建议所有行长度一致；机柜字符需要在下方 JSON 中配置容量。
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))", gap: 8 }}>
                    {layoutLegendItems.map(item => (
                      <div key={item.label} style={legendItemStyle}>
                        <code style={legendCodeStyle}>{item.code}</code>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>地图布局</span>
                <textarea
                  value={editLayout}
                  onChange={e => setEditLayout(e.target.value)}
                    spellCheck={false}
                    style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.74rem", minHeight: 390, resize: "vertical", lineHeight: 1.24, whiteSpace: "pre", overflow: "auto" }}
                  placeholder={"##########\n#AAAA...#\n#........#\n#...0....#\n#........#\n#...BBBB.#\n##########"}
                />
              </label>
            <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>机柜容量 JSON</span>
              <input value={editCabinets} onChange={e => setEditCabinets(e.target.value)} style={{ ...inputStyle, fontFamily: "monospace" }} placeholder='{"0": 3000}' />
                  <span style={helperTextStyle}>示例：布局里有 0 和 1，就填写 {`{"0": 3000, "1": 3000}`}。</span>
            </label>
              </div>
              <div style={previewPanelStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <span style={{ color: "var(--text)", fontSize: "0.86rem", fontWeight: 700 }}>实时预览</span>
                  <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>完整地图自适应显示</span>
                </div>
                <div style={previewFrameStyle}>
                  {editLines.length > 0 ? (
                    <canvas ref={previewCanvasRef} />
                  ) : (
                    <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>输入地图布局后显示预览</div>
                  )}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>常见规则</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["A/B 是出生区", "0-9 是机柜", "^ v < > 是传送带方向", "# 不可通行"].map(rule => (
                      <span key={rule} style={ruleChipStyle}>{rule}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={handleSave} className="control-button" style={{ background: "rgba(25,225,255,0.1)", borderColor: "var(--alpha)", color: "var(--alpha)" }}>
                {creating ? "创建" : "保存"}
              </button>
              <button onClick={() => { setEditing(false); setCreating(false); setEditMsg(""); }} className="control-button" style={{ color: "var(--muted)" }}>
                取消
              </button>
              {editMsg && <span style={{ color: "var(--muted)", fontSize: "0.84rem" }}>{editMsg}</span>}
            </div>
          </div>
        )}

        {/* selected map detail (read-only view) */}
        {detail && !isEditorOpen && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.3rem", fontFamily: "var(--font-display)" }}>{detail.name}</h2>
                <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 4 }}>{detail.description}</p>
                <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 4 }}>
                  尺寸: {mapW} x {mapH}
                  {cabinetEntries.length > 0 && <span> &nbsp; 机柜: {cabinetEntries.length} 个</span>}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={startEdit} className="control-button" style={{ fontSize: "0.78rem", color: "var(--alpha)", borderColor: "var(--alpha)" }}>编辑</button>
                <button onClick={handleDelete} className="control-button" style={{ fontSize: "0.78rem", color: "var(--danger, #ff4d6a)", borderColor: "var(--danger, #ff4d6a)" }}>删除</button>
              </div>
            </div>

            <div style={{ overflow: "auto", borderRadius: 12, border: "1px solid var(--line)", padding: 8, background: "#071320" }}>
              <canvas ref={canvasRef} />
            </div>

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

        {maps.length === 0 && !creating && (
          <p style={{ color: "var(--muted)", marginTop: 24 }}>暂无地图数据</p>
        )}
      </div>
    </div>
  );
}

function renderMap(canvas: HTMLCanvasElement, detail: MapDetail, options?: { fitToContainer?: boolean }) {
  const { tiles, width, height } = layoutToTiles(detail);
  const spawns = getSpawns(detail);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = width * TILE_SIZE * CANVAS_SCALE;
  canvas.height = height * TILE_SIZE * CANVAS_SCALE;
  if (options?.fitToContainer) {
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.maxWidth = `${width * TILE_SIZE}px`;
    canvas.style.display = "block";
  } else {
    canvas.style.width = `${width * TILE_SIZE}px`;
    canvas.style.height = `${height * TILE_SIZE}px`;
    canvas.style.maxWidth = "";
    canvas.style.display = "";
  }
  ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);

  ctx.fillStyle = "#071320";
  ctx.fillRect(0, 0, width * TILE_SIZE, height * TILE_SIZE);

  drawTiles(ctx, tiles, width, height);
  drawGrid(ctx, width, height);
  drawSpawns(ctx, spawns);
}

const inputStyle: React.CSSProperties = {
  background: "rgba(7,18,31,0.9)",
  border: "1px solid var(--line-strong)",
  borderRadius: 12,
  color: "var(--text)",
  padding: "10px 14px",
  outline: "none",
  fontSize: "0.92rem",
};

const layoutLegendItems = [
  { code: "#", label: "墙：不可通行" },
  { code: ".", label: "空地：可通行" },
  { code: "A", label: "Alpha 出生点" },
  { code: "B", label: "Beta 出生点" },
  { code: "0-9", label: "机柜：需配置容量" },
  { code: "^ v < >", label: "传送带方向" },
];

const editorHelpStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 14,
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "rgba(255,255,255,0.035)",
};

const helperTextStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: "0.76rem",
  lineHeight: 1.55,
};

const legendItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 34,
  padding: "6px 8px",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 8,
  background: "rgba(7,18,31,0.56)",
  color: "var(--muted)",
  fontSize: "0.76rem",
};

const legendCodeStyle: React.CSSProperties = {
  minWidth: 46,
  padding: "2px 6px",
  borderRadius: 6,
  background: "rgba(25,225,255,0.1)",
  color: "var(--alpha)",
  textAlign: "center",
  fontFamily: "monospace",
  fontSize: "0.76rem",
};

const previewPanelStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 14,
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "rgba(7,18,31,0.58)",
};

const previewFrameStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  minHeight: 360,
  overflow: "hidden",
  borderRadius: 8,
  border: "1px solid var(--line)",
  padding: 8,
  background: "#071320",
};

const ruleChipStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 999,
  padding: "4px 9px",
  background: "rgba(255,255,255,0.04)",
  color: "var(--muted)",
  fontSize: "0.72rem",
};
