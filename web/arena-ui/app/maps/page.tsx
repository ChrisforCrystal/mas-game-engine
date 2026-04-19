"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchMaps, fetchMapDetail, createMap, updateMap, deleteMap, type MapInfo, type MapDetail } from "@/lib/api";
import {
  TILE_SIZE, CANVAS_SCALE,
  layoutToTiles, getSpawns,
  drawTiles, drawGrid, drawSpawns,
} from "@/lib/map-renderer";

type PaintTool = "#" | "." | "A" | "B" | "0" | "^" | "v" | "<" | ">";
type EditorSnapshot = { layout: string; cabinets: string };

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
  const [paintTool, setPaintTool] = useState<PaintTool>(".");
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  // preview from editor input
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const editorHistoryRef = useRef<EditorSnapshot[]>([]);
  const editorHistoryIndexRef = useRef(-1);

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
    const nextLayout = detail.layout.join("\n");
    const nextCabinets = JSON.stringify(detail.cabinets, null, 2);
    setEditName(detail.name);
    setEditDesc(detail.description);
    setEditLayout(nextLayout);
    setEditCabinets(nextCabinets);
    setEditMsg("");
    setEditing(true);
    setCreating(false);
    resetEditorHistory(nextLayout, nextCabinets);
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
    resetEditorHistory("", "{}");
  }

  async function handleSave() {
    const validation = validateEditorMap(editName, editLayout, editCabinets);
    if (!validation.ok) {
      setEditMsg(validation.message);
      return;
    }

    try {
      if (creating) {
        const res = await createMap({ name: editName, description: editDesc, layout: validation.lines, cabinets: validation.cabinets });
        setEditMsg("创建成功");
        setCreating(false);
        await reload();
        setSelectedId(res.id);
      } else if (editing && selectedId) {
        await updateMap(selectedId, { name: editName, description: editDesc, layout: validation.lines, cabinets: validation.cabinets });
        setEditMsg("保存成功");
        setEditing(false);
        fetchMapDetail(selectedId).then(setDetail);
      }
    } catch (err: any) {
      setEditMsg("失败: " + err.message);
    }
  }

  function syncHistoryState() {
    const index = editorHistoryIndexRef.current;
    setHistoryState({
      canUndo: index > 0,
      canRedo: index >= 0 && index < editorHistoryRef.current.length - 1,
    });
  }

  function resetEditorHistory(layout: string, cabinets: string) {
    editorHistoryRef.current = [{ layout, cabinets }];
    editorHistoryIndexRef.current = 0;
    setHistoryState({ canUndo: false, canRedo: false });
  }

  function pushEditorSnapshot(next: EditorSnapshot) {
    const index = editorHistoryIndexRef.current;
    const current = editorHistoryRef.current[index];
    if (current?.layout === next.layout && current?.cabinets === next.cabinets) return;

    const base = index >= 0 ? editorHistoryRef.current.slice(0, index + 1) : [];
    const history = [...base, next].slice(-80);
    editorHistoryRef.current = history;
    editorHistoryIndexRef.current = history.length - 1;
    syncHistoryState();
  }

  function updateEditorLayout(nextLayout: string) {
    if (nextLayout === editLayout) return;
    setEditLayout(nextLayout);
    setEditMsg("");
    pushEditorSnapshot({ layout: nextLayout, cabinets: editCabinets });
  }

  function updateEditorCabinets(nextCabinets: string) {
    if (nextCabinets === editCabinets) return;
    setEditCabinets(nextCabinets);
    setEditMsg("");
    pushEditorSnapshot({ layout: editLayout, cabinets: nextCabinets });
  }

  function restoreEditorSnapshot(index: number) {
    const snapshot = editorHistoryRef.current[index];
    if (!snapshot) return;
    editorHistoryIndexRef.current = index;
    setEditLayout(snapshot.layout);
    setEditCabinets(snapshot.cabinets);
    setEditMsg("");
    syncHistoryState();
  }

  function handleUndo() {
    const index = editorHistoryIndexRef.current;
    if (index <= 0) return;
    restoreEditorSnapshot(index - 1);
  }

  function handleRedo() {
    const index = editorHistoryIndexRef.current;
    if (index < 0 || index >= editorHistoryRef.current.length - 1) return;
    restoreEditorSnapshot(index + 1);
  }

  function handlePreviewPaint(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = previewCanvasRef.current;
    if (!canvas || editWidth <= 0 || editHeight <= 0 || hasUnevenRows) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * editWidth);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * editHeight);
    if (x < 0 || y < 0 || x >= editWidth || y >= editHeight) return;

    const lines = editLines.map(line => line.split(""));
    if (!lines[y] || x >= lines[y].length || lines[y][x] === paintTool) return;
    lines[y][x] = paintTool;
    updateEditorLayout(lines.map(line => line.join("")).join("\n"));
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
                  onChange={e => updateEditorLayout(e.target.value)}
                    spellCheck={false}
                    style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.74rem", minHeight: 390, resize: "vertical", lineHeight: 1.24, whiteSpace: "pre", overflow: "auto" }}
                  placeholder={"###########\n#AAAAA....#\n#.........#\n#....0....#\n#.........#\n#....BBBBB#\n###########"}
                />
              </label>
            <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>机柜容量 JSON</span>
              <input value={editCabinets} onChange={e => updateEditorCabinets(e.target.value)} style={{ ...inputStyle, fontFamily: "monospace" }} placeholder='{"0": 3000}' />
                  <span style={helperTextStyle}>示例：布局里有 0 和 1，就填写 {`{"0": 3000, "1": 3000}`}。</span>
            </label>
              </div>
              <div style={previewPanelStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <span style={{ color: "var(--text)", fontSize: "0.86rem", fontWeight: 700 }}>实时预览</span>
                  <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>完整地图自适应显示</span>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>绘制工具</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={handleUndo} disabled={!historyState.canUndo} className="control-button" style={historyButtonStyle(!historyState.canUndo)}>撤销</button>
                      <button onClick={handleRedo} disabled={!historyState.canRedo} className="control-button" style={historyButtonStyle(!historyState.canRedo)}>重做</button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8 }}>
                    {paintTools.map(tool => (
                      <button
                        key={tool.value}
                        type="button"
                        onClick={() => setPaintTool(tool.value)}
                        className="control-button"
                        style={paintToolButtonStyle(paintTool === tool.value)}
                      >
                        <code style={{ fontFamily: "monospace", color: paintTool === tool.value ? "var(--alpha)" : "var(--text)" }}>{tool.value}</code>
                        <span>{tool.label}</span>
                      </button>
                    ))}
                  </div>
                  {hasUnevenRows && (
                    <span style={{ color: "var(--danger)", fontSize: "0.76rem" }}>行宽不一致时暂不支持点击绘制，请先整理每行长度。</span>
                  )}
                </div>
                <div style={previewFrameStyle}>
                  {editLines.length > 0 ? (
                    <canvas ref={previewCanvasRef} onClick={handlePreviewPaint} style={{ cursor: hasUnevenRows ? "not-allowed" : "crosshair" }} />
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
              {editMsg && <span style={{ color: editMsg.startsWith("失败") || editMsg.includes("请") || editMsg.includes("错误") || editMsg.includes("非法") ? "var(--danger)" : "var(--muted)", fontSize: "0.84rem" }}>{editMsg}</span>}
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

function validateEditorMap(name: string, layout: string, cabinetsText: string): { ok: true; lines: string[]; cabinets: Record<string, number> } | { ok: false; message: string } {
  const lines = layout.split("\n").map(line => line.replace(/\r/g, "")).filter(line => line.length > 0);
  if (!name.trim() || lines.length === 0) {
    return { ok: false, message: "请填写地图名称和地图布局。" };
  }

  const width = lines[0]?.length ?? 0;
  if (width === 0) {
    return { ok: false, message: "地图布局不能为空行。" };
  }

  const unevenRow = lines.findIndex(line => line.length !== width);
  if (unevenRow >= 0) {
    return { ok: false, message: `第 ${unevenRow + 1} 行长度不一致，请保持所有行都是 ${width} 列。` };
  }

  const allowedChars = new Set("#.AB0123456789^v<>".split(""));
  const invalidPositions: string[] = [];
  let alphaSpawns = 0;
  let betaSpawns = 0;
  const cabinetChars = new Set<string>();

  lines.forEach((line, y) => {
    line.split("").forEach((ch, x) => {
      if (!allowedChars.has(ch)) invalidPositions.push(`${x + 1},${y + 1}:${ch}`);
      if (ch === "A") alphaSpawns += 1;
      if (ch === "B") betaSpawns += 1;
      if (/^[0-9]$/.test(ch)) cabinetChars.add(ch);
    });
  });

  if (invalidPositions.length > 0) {
    return { ok: false, message: `发现非法字符 ${invalidPositions.slice(0, 4).join("、")}，只支持 # . A B 0-9 ^ v < >。` };
  }

  if (alphaSpawns < 5 || betaSpawns < 5) {
    return { ok: false, message: `A/B 出生点至少各 5 个；当前 A=${alphaSpawns}，B=${betaSpawns}。` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cabinetsText || "{}");
  } catch {
    return { ok: false, message: "机柜容量 JSON 格式错误，请使用类似 {\"0\": 3000} 的格式。" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "机柜容量 JSON 必须是对象，例如 {\"0\": 3000}。" };
  }

  const cabinets: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[0-9]$/.test(key)) {
      return { ok: false, message: `机柜键 ${key} 无效，请使用 0-9 单个数字。` };
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { ok: false, message: `机柜 ${key} 的容量必须是大于 0 的数字。` };
    }
    cabinets[key] = value;
  }

  const missingCabinets = [...cabinetChars].filter(ch => !(ch in cabinets));
  if (missingCabinets.length > 0) {
    return { ok: false, message: `布局里有机柜 ${missingCabinets.join("、")}，请在机柜容量 JSON 中配置容量。` };
  }

  return { ok: true, lines, cabinets };
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

const paintTools: { value: PaintTool; label: string }[] = [
  { value: ".", label: "空地" },
  { value: "#", label: "墙" },
  { value: "A", label: "Alpha" },
  { value: "B", label: "Beta" },
  { value: "0", label: "机柜" },
  { value: "^", label: "上" },
  { value: "v", label: "下" },
  { value: "<", label: "左" },
  { value: ">", label: "右" },
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

function historyButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: "0.72rem",
    color: disabled ? "rgba(158,180,203,0.42)" : "var(--muted)",
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function paintToolButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    justifyContent: "center",
    gap: 6,
    alignItems: "center",
    padding: "7px 8px",
    fontSize: "0.72rem",
    background: active ? "rgba(25,225,255,0.12)" : "rgba(7,18,31,0.9)",
    borderColor: active ? "var(--alpha)" : "var(--line-strong)",
    color: active ? "var(--alpha)" : "var(--muted)",
  };
}
