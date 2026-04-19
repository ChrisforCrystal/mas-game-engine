"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ReplayData, ReplayEvent, ReplayFrame, RobotState, Tile } from "@/lib/replay";

type MatchInfo = { botA: string; botB: string; id: number; mapPath?: string | null };

type ReplayBoardProps = {
  replay: ReplayData;
  seed: string;
  availableSeeds: string[];
  botAName?: string;
  botBName?: string;
  matchMap?: Record<string, MatchInfo>;
};

const TILE_SIZE = 22;
const CANVAS_SCALE = 2;

type EventCard = {
  turn: number;
  text: string;
  team: "Alpha" | "Beta" | "Neutral";
};

type CabinetStatus = {
  id: number;
  occupied: number;
  remaining: number;
  capacity: number;
};

export function ReplayBoard({ replay, seed, availableSeeds, botAName, botBName, matchMap = {} }: ReplayBoardProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showResult, setShowResult] = useState(false);
  const [showPanels, setShowPanels] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);
  const deferredFrameIndex = useDeferredValue(frameIndex);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const frame = replay.frames[deferredFrameIndex] ?? replay.frames[0];
  const eventCards = buildEventCards(replay);
  const cabinets = summarizeCabinets(frame.tiles);
  const prominentEvents = eventCards.filter(
    (event) => event.turn <= frame.turn && event.turn >= Math.max(1, frame.turn - 18),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const width = replay.width * TILE_SIZE;
    const height = replay.height * TILE_SIZE;
    canvas.width = width * CANVAS_SCALE;
    canvas.height = height * CANVAS_SCALE;
    context.scale(CANVAS_SCALE, CANVAS_SCALE);

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#071320";
    context.fillRect(0, 0, width, height);

    drawTiles(context, frame.tiles, replay.width, replay.height);
    drawGrid(context, replay.width, replay.height);
    drawRobots(context, frame.robots);
    drawEventOverlays(context, frame.robots, frame.events);
  }, [frame, replay.height, replay.width]);

  // fullscreen toggle + ESC listener
  const toggleFullscreen = () => {
    const el = fullscreenRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);


  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const interval = Math.max(70, 280 / playbackSpeed);
    const handle = window.setInterval(() => {
      startTransition(() => {
        setFrameIndex((current) => (current >= replay.frames.length - 1 ? current : current + 1));
      });
    }, interval);

    return () => window.clearInterval(handle);
  }, [isPlaying, playbackSpeed, replay.frames.length]);

  useEffect(() => {
    if (frameIndex >= replay.frames.length - 1) {
      setIsPlaying(false);
      setShowResult(true);
    }
  }, [frameIndex, replay.frames.length]);

  const alphaStats = summarizeTeam(frame.robots, "Alpha");
  const betaStats = summarizeTeam(frame.robots, "Beta");
  const scoreLead = frame.scores[0] - frame.scores[1];

  return (
    <main className="shell" style={{ padding: "56px 16px 16px" }}>
      {showResult && replay.summary && (
        <ResultModal
          summary={replay.summary}
          onClose={() => setShowResult(false)}
          onReplay={() => { setShowResult(false); setIsPlaying(false); setFrameIndex(0); }}
          botAName={botAName}
          botBName={botBName}
        />
      )}
      <div className="replay-focused">
        {/* compact toolbar */}
        <div className="replay-toolbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {availableSeeds.length > 0 && (
              <select
                defaultValue={seed}
                onChange={(e) => { window.location.href = `/?seed=${e.target.value}`; }}
                className="replay-select"
              >
                {availableSeeds.map((s) => {
                  const info = matchMap[s.split("-")[0]];
                  const label = info ? `${info.botA} vs ${info.botB} #${info.id}` : `seed ${s}`;
                  return <option key={s} value={s}>{label}</option>;
                })}
              </select>
            )}
            <span style={{ color: "var(--muted)", fontSize: "0.74rem" }}>种子 {replay.seed}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="replay-btn" onClick={() => { setIsPlaying(false); setFrameIndex(0); }}>⟲</button>
            <button className="replay-btn active" onClick={() => setIsPlaying(p => !p)}>{isPlaying ? "❚❚" : "▶"}</button>
            <select value={playbackSpeed} onChange={e => setPlaybackSpeed(Number(e.target.value))} className="replay-select small">
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
            <button className="replay-btn" onClick={() => setShowPanels(p => !p)} title={showPanels ? "收起面板" : "展开面板"}>
              {showPanels ? "✕" : "☰"}
            </button>
          </div>
        </div>

        <div className={`replay-layout${showPanels ? " with-panels" : ""}`}>
          {/* side panel - only visible when toggled */}
          {showPanels && (
            <aside className="replay-side-panel">
              <div className="rsp-section">
                <div className="rsp-title">战局</div>
                <div className="rsp-row"><span style={{ color: "var(--alpha)" }}>蓝</span> 载荷 {alphaStats.cargo} · 满载 {alphaStats.loaded} · 干扰 {alphaStats.jammed}</div>
                <div className="rsp-row"><span style={{ color: "var(--beta)" }}>红</span> 载荷 {betaStats.cargo} · 满载 {betaStats.loaded} · 干扰 {betaStats.jammed}</div>
              </div>
              <div className="rsp-section">
                <div className="rsp-title">机架 ({cabinets.length})</div>
                {cabinets.map(c => (
                  <div key={c.id} className="rsp-cabinet">
                    <span>R{c.id}</span>
                    <div className="rsp-cab-bar"><span style={{ width: `${c.capacity === 0 ? 0 : (c.occupied / c.capacity) * 100}%`, background: cabinetBatteryColor(c) }} /></div>
                    <span>{Math.round((c.occupied / c.capacity) * 100)}%</span>
                  </div>
                ))}
              </div>
              <div className="rsp-section">
                <div className="rsp-title">事件</div>
                <div className="rsp-events">
                  {prominentEvents.length === 0 ? (
                    <div className="rsp-row" style={{ opacity: 0.5 }}>开局阶段</div>
                  ) : (
                    prominentEvents.slice().reverse().slice(0, 20).map((event, i) => (
                      <div key={`${event.turn}-${i}`} className="rsp-event" style={{ borderLeftColor: event.team === "Alpha" ? "var(--alpha)" : event.team === "Beta" ? "var(--beta)" : "var(--gold)" }}>
                        <span className="rsp-event-turn">T{event.turn}</span> {event.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>
          )}

          {/* main canvas area */}
          <section className="replay-main">

            <div ref={fullscreenRef} style={isFullscreen ? { background: "#040b14", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", width: "100%", height: "100%" } : undefined}>
            <div className="canvas-shell" ref={canvasShellRef} style={{ position: "relative" }}>
              <div style={{ position: "absolute", top: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 12, zIndex: 10, pointerEvents: "none" }}>
                <span style={{ background: "rgba(25,225,255,0.15)", border: "1px solid rgba(25,225,255,0.4)", borderRadius: 8, padding: "4px 14px", fontSize: "0.88rem", fontWeight: 700, color: "#19e1ff", backdropFilter: "blur(6px)" }}>
                  {botAName || "蓝方"} {frame.scores[0]}
                </span>
                <span style={{ color: "var(--muted)", fontSize: "0.78rem", alignSelf: "center" }}>回合 {frame.turn}/500</span>
                <span style={{ background: "rgba(255,79,109,0.15)", border: "1px solid rgba(255,79,109,0.4)", borderRadius: 8, padding: "4px 14px", fontSize: "0.88rem", fontWeight: 700, color: "#ff4f6d", backdropFilter: "blur(6px)" }}>
                  {botBName || "红方"} {frame.scores[1]}
                </span>
              </div>
              {/* fullscreen button */}
              <button
                onClick={toggleFullscreen}
                style={{ position: "absolute", top: 10, right: 14, zIndex: 10, background: "rgba(25,225,255,0.12)", border: "1px solid rgba(25,225,255,0.5)", borderRadius: 8, color: "var(--alpha)", fontSize: "0.78rem", padding: "6px 14px", cursor: "pointer", backdropFilter: "blur(6px)", fontWeight: 600, letterSpacing: "0.06em" }}
              >
                {isFullscreen ? "退出全屏" : "⛶ 全屏观战"}
              </button>
              <canvas
                ref={canvasRef}
                aria-label="Arena replay map"
                style={isFullscreen
                  ? { width: "auto", height: "calc(100vh - 80px)", maxWidth: "100vw" }
                  : { width: "100%", height: "auto" }}
              />
              {/* live commentary bar */}
              {(() => {
                const currentEvents = eventCards.filter(e => e.turn === frame.turn);
                if (currentEvents.length === 0) return null;
                return (
                  <div style={{ position: "absolute", bottom: 6, left: 12, right: 12, zIndex: 10, pointerEvents: "none" }}>
                    <div style={{ background: "rgba(4,11,20,0.85)", backdropFilter: "blur(8px)", borderRadius: 10, padding: "6px 14px", border: "1px solid rgba(255,255,255,0.08)" }}>
                      {currentEvents.slice(0, 3).map((e, i) => (
                        <div key={i} style={{ fontSize: "0.76rem", lineHeight: 1.6, color: e.team === "Alpha" ? "#19e1ff" : e.team === "Beta" ? "#ff4f6d" : "var(--gold)" }}>
                          {e.text}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* fullscreen playback controls */}
            {isFullscreen && (
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12 }}>
                <button onClick={() => setIsPlaying(p => !p)} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", cursor: "pointer" }}>
                  {isPlaying ? "暂停" : "播放"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={replay.frames.length - 1}
                  value={frameIndex}
                  onChange={e => { setFrameIndex(Number(e.target.value)); setIsPlaying(false); }}
                  style={{ width: 300, accentColor: "var(--alpha)" }}
                />
                <select value={playbackSpeed} onChange={e => setPlaybackSpeed(Number(e.target.value))} style={{ background: "#0a1727", border: "1px solid var(--line-strong)", borderRadius: 6, color: "var(--muted)", fontSize: "0.76rem", padding: "2px 8px" }}>
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
            )}
            </div>
          </section>

        </div>

        {/* slim timeline */}
        <div className="replay-timeline">
          <input
            aria-label="Replay progress"
            type="range"
            min={0}
            max={replay.frames.length - 1}
            value={frameIndex}
            onChange={(event) => {
              setIsPlaying(false);
              startTransition(() => setFrameIndex(Number(event.target.value)));
            }}
            style={{ width: "100%", accentColor: "var(--alpha)" }}
          />
          <div className="timeline-scorebar" aria-hidden="true">
            {replay.frames.map((entry, index) => {
              const alphaAhead = entry.scores[0] >= entry.scores[1];
              const isCurrent = index === frameIndex;
              return (
                <span
                  key={entry.turn}
                  className={`score-segment ${alphaAhead ? "alpha" : "beta"} ${isCurrent ? "current" : ""}`}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>
            <span>回合 {frame.turn} / {replay.frames.length}</span>
            <span>{Math.round((frame.turn / replay.frames.length) * 100)}%</span>
          </div>
        </div>
      </div>
    </main>
  );
}

/* StatBlock removed — replaced by inline compact panel */

function buildEventCards(replay: ReplayData): EventCard[] {
  let prevAlpha = 0;
  let prevBeta = 0;
  let alphaLeading = false;
  let betaLeading = false;

  return replay.frames.flatMap((frame) => {
    const cards: EventCard[] = [];

    // opening
    if (frame.turn === 1) {
      cards.push({ turn: 1, text: "比赛开始！双方机器人离开出生区，进入机房通道。", team: "Neutral" });
    }

    // engine events with richer descriptions
    for (const evt of frame.events) {
      const team = inferTeam(frame.robots, evt.robot_id);
      const teamLabel = team === "Alpha" ? "蓝方" : "红方";
      const desc = evt.description;

      if (desc.includes("投递")) {
        const m = desc.match(/(\d+)\s*点/);
        const amt = m ? Number(m[1]) : 0;
        if (amt >= 80) {
          cards.push({ turn: frame.turn, text: `${teamLabel} R${evt.robot_id} 大额投递 ${amt} 点能量！`, team });
        } else {
          cards.push({ turn: frame.turn, text: `${teamLabel} R${evt.robot_id} ${desc}`, team });
        }
      } else if (desc.includes("拾取")) {
        const m = desc.match(/(\d+)\s*点/);
        const amt = m ? Number(m[1]) : 0;
        if (amt >= 60) {
          cards.push({ turn: frame.turn, text: `${teamLabel} R${evt.robot_id} 捡到高价值能量 ${amt} 点！`, team });
        } else {
          cards.push({ turn: frame.turn, text: `${teamLabel} R${evt.robot_id} ${desc}`, team });
        }
      } else {
        cards.push({ turn: frame.turn, text: `${teamLabel} R${evt.robot_id} ${desc}`, team });
      }
    }

    // JAM events from actions
    for (const [rid, act] of frame.actions) {
      if (act === "Jam") {
        const team = inferTeam(frame.robots, rid);
        const teamLabel = team === "Alpha" ? "蓝方" : "红方";
        const robot = frame.robots.find(r => r.id === rid);
        if (robot && robot.jam_cooldown > 0) {
          // jam was just used (cooldown just started)
          cards.push({ turn: frame.turn, text: `${teamLabel} R${rid} 发动干扰！对手被眩晕 1 回合`, team });
        }
      }
    }

    // score changes
    const [sa, sb] = frame.scores;
    const deltaA = sa - prevAlpha;
    const deltaB = sb - prevBeta;

    if (deltaA > 0) {
      cards.push({ turn: frame.turn, text: `蓝方得分 +${deltaA}，累计 ${sa}`, team: "Alpha" });
    }
    if (deltaB > 0) {
      cards.push({ turn: frame.turn, text: `红方得分 +${deltaB}，累计 ${sb}`, team: "Beta" });
    }

    // lead change
    if (sa > sb && !alphaLeading && prevAlpha <= prevBeta && frame.turn > 1) {
      cards.push({ turn: frame.turn, text: `蓝方反超！${sa} : ${sb}`, team: "Alpha" });
    }
    if (sb > sa && !betaLeading && prevBeta <= prevAlpha && frame.turn > 1) {
      cards.push({ turn: frame.turn, text: `红方反超！${sb} : ${sa}`, team: "Beta" });
    }
    alphaLeading = sa > sb;
    betaLeading = sb > sa;

    // full cargo alert
    for (const robot of frame.robots) {
      if (robot.cargo >= 140) {
        const team = robot.team;
        const teamLabel = team === "Alpha" ? "蓝方" : "红方";
        cards.push({ turn: frame.turn, text: `${teamLabel} R${robot.id} 背包接近满载（${robot.cargo}/150），需要尽快回仓`, team });
      }
    }

    // milestone turns
    if (frame.turn === 100) cards.push({ turn: 100, text: `前 100 回合结束，蓝方 ${sa} : 红方 ${sb}`, team: "Neutral" });
    if (frame.turn === 250) cards.push({ turn: 250, text: `半场结束！蓝方 ${sa} : 红方 ${sb}`, team: "Neutral" });
    if (frame.turn === 400) cards.push({ turn: 400, text: `进入最后 100 回合冲刺！蓝方 ${sa} : 红方 ${sb}`, team: "Neutral" });
    if (frame.turn === 450) cards.push({ turn: 450, text: `最后 50 回合！蓝方 ${sa} : 红方 ${sb}，胜负即将揭晓`, team: "Neutral" });

    prevAlpha = sa;
    prevBeta = sb;
    return cards;
  });
}

function inferTeam(robots: RobotState[], robotId: number): "Alpha" | "Beta" | "Neutral" {
  return robots.find((robot) => robot.id === robotId)?.team ?? "Neutral";
}

function summarizeTeam(robots: RobotState[], team: "Alpha" | "Beta") {
  const subset = robots.filter((robot) => robot.team === team);
  return {
    cargo: subset.reduce((sum, robot) => sum + robot.cargo, 0),
    loaded: subset.filter((robot) => robot.cargo > 0).length,
    jammed: subset.filter((robot) => robot.jammed_turns > 0).length,
  };
}

function summarizeCabinets(tiles: Tile[]): CabinetStatus[] {
  return tiles
    .flatMap((tile) => {
      if (typeof tile === "object" && "Cabinet" in tile) {
        const { id, occupied_capacity, config } = tile.Cabinet;
        return [
          {
            id,
            occupied: occupied_capacity,
            remaining: Math.max(0, config.capacity - occupied_capacity),
            capacity: config.capacity,
          },
        ];
      }
      return [];
    })
    .sort((left, right) => left.id - right.id);
}


export function drawTiles(
  context: CanvasRenderingContext2D,
  tiles: Tile[],
  width: number,
  height: number,
) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tiles[y * width + x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      context.fillStyle = y % 2 === 0 ? "#0a1727" : "#0c1c2e";
      context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      context.fillStyle = "rgba(255,255,255,0.025)";
      context.fillRect(px + 1, py + TILE_SIZE - 4, TILE_SIZE - 2, 1);
      context.fillRect(px + 1, py + 3, TILE_SIZE - 2, 1);

      if (tile === "Wall") {
        drawWallTile(context, px, py);
        continue;
      }

      if (typeof tile === "object" && "Conveyor" in tile) {
        drawConveyorTile(context, px, py, tile.Conveyor);
        continue;
      }

      if (typeof tile === "object" && "Energy" in tile) {
        drawEnergyTile(context, px, py, tile.Energy.value, tile.Energy.ttl);
        continue;
      }

      if (typeof tile === "object" && "Cabinet" in tile) {
        drawCabinetTile(
          context,
          px,
          py,
          tile.Cabinet.occupied_capacity,
          tile.Cabinet.config.capacity,
        );
      }
    }
  }
}

function drawWallTile(context: CanvasRenderingContext2D, px: number, py: number) {
  context.fillStyle = "#22364d";
  context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "#1a2a3f";
  context.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  context.fillStyle = "#324a68";
  context.fillRect(px + 3, py + 3, TILE_SIZE - 6, 3);
  context.fillStyle = "rgba(158, 195, 255, 0.08)";
  for (let offset = 6; offset <= TILE_SIZE - 6; offset += 5) {
    context.fillRect(px + 4, py + offset, TILE_SIZE - 8, 1);
  }
}

function drawConveyorTile(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  direction: "Up" | "Down" | "Left" | "Right",
) {
  context.fillStyle = "#0d2034";
  context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "rgba(88, 128, 190, 0.24)";
  context.fillRect(px + 2, py + 3, TILE_SIZE - 4, TILE_SIZE - 6);
  context.fillStyle = "#18304b";
  for (let offset = 4; offset < TILE_SIZE + 4; offset += 4) {
    context.fillRect(px + offset - 2, py + 2, 1.5, TILE_SIZE - 4);
  }
  context.strokeStyle = "rgba(132, 168, 225, 0.28)";
  context.lineWidth = 1;
  context.strokeRect(px + 2.5, py + 3.5, TILE_SIZE - 5, TILE_SIZE - 7);
  context.fillStyle = "rgba(166, 198, 242, 0.46)";
  for (let offset = 5; offset <= TILE_SIZE - 5; offset += 6) {
    context.beginPath();
    context.moveTo(px + offset - 2, py + TILE_SIZE / 2 - 2);
    context.lineTo(px + offset + 1, py + TILE_SIZE / 2);
    context.lineTo(px + offset - 2, py + TILE_SIZE / 2 + 2);
    context.closePath();
    context.fill();
  }
  drawArrow(context, px, py, direction);
}

function drawEnergyTile(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  value: number,
  ttl: number | null,
) {
  const highValue = value >= 70;
  const glow = highValue ? "rgba(255, 166, 77, 0.26)" : "rgba(116, 255, 214, 0.24)";
  const tint = highValue ? "#ffb347" : "#8dff65";
  context.fillStyle = glow;
  context.beginPath();
  context.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 7.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = tint;
  context.beginPath();
  context.moveTo(px + TILE_SIZE / 2 - 1.2, py + 4.5);
  context.lineTo(px + TILE_SIZE / 2 + 3.8, py + 4.5);
  context.lineTo(px + TILE_SIZE / 2 + 0.9, py + 9.4);
  context.lineTo(px + TILE_SIZE / 2 + 4.9, py + 9.4);
  context.lineTo(px + TILE_SIZE / 2 - 3.2, py + 17.2);
  context.lineTo(px + TILE_SIZE / 2 - 0.2, py + 11.8);
  context.lineTo(px + TILE_SIZE / 2 - 3.8, py + 11.8);
  context.closePath();
  context.fill();
  context.strokeStyle = highValue ? "rgba(255, 235, 190, 0.68)" : "rgba(235, 255, 225, 0.66)";
  context.lineWidth = 0.8;
  context.stroke();
  context.fillStyle = "rgba(255,255,255,0.85)";
  context.font = "700 7px var(--font-body)";
  context.textAlign = "center";
  context.fillText(String(value), px + TILE_SIZE / 2, py + TILE_SIZE - 2.2);
  if (ttl !== null) {
    context.fillStyle = "#ff607d";
    context.fillRect(px + 4, py + 2.6, Math.max(3, (ttl / 18) * (TILE_SIZE - 8)), 1.8);
  }
}

function drawCabinetTile(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  occupied: number,
  capacity: number,
) {
  const fillRatio = capacity === 0 ? 0 : occupied / capacity;
  const meterColor = cabinetBatteryColorByRatio(fillRatio);

  // subtle background tint
  context.fillStyle = "rgba(255, 214, 107, 0.08)";
  context.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  // outer border — golden, clean
  context.strokeStyle = "rgba(255, 200, 80, 0.7)";
  context.lineWidth = 1.2;
  roundRect(context, px + 2.5, py + 2.5, TILE_SIZE - 5, TILE_SIZE - 5, 3);
  context.stroke();

  // meter bar — full width inside the border, bottom-up fill
  const barX = px + 4;
  const barY = py + 4;
  const barW = TILE_SIZE - 8;
  const barH = TILE_SIZE - 8;

  // meter background
  context.fillStyle = "rgba(255,255,255,0.06)";
  context.fillRect(barX, barY, barW, barH);

  // meter fill from bottom
  if (fillRatio > 0) {
    context.fillStyle = meterColor;
    const fillH = barH * fillRatio;
    context.fillRect(barX, barY + barH - fillH, barW, fillH);
  }

  // percentage text — only show when > 0
  if (fillRatio > 0) {
    const pct = Math.round(fillRatio * 100);
    context.fillStyle = "#fff";
    context.font = "700 7px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${pct}%`, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    context.textBaseline = "alphabetic";
  } else {
    // empty cabinet — small icon
    context.fillStyle = "rgba(255, 200, 80, 0.5)";
    context.font = "700 8px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("\u26A1", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    context.textBaseline = "alphabetic";
  }
}

function drawArrow(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  direction: "Up" | "Down" | "Left" | "Right",
) {
  context.save();
  context.translate(px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  const rotationMap = {
    Up: -Math.PI / 2,
    Right: 0,
    Down: Math.PI / 2,
    Left: Math.PI,
  };
  context.rotate(rotationMap[direction]);
  context.strokeStyle = "#8fb3e6";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-5, 0);
  context.lineTo(5, 0);
  context.lineTo(2, -3);
  context.moveTo(5, 0);
  context.lineTo(2, 3);
  context.stroke();
  context.restore();
}

export function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.strokeStyle = "rgba(255,255,255,0.05)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 1) {
    context.beginPath();
    context.moveTo(x * TILE_SIZE, 0);
    context.lineTo(x * TILE_SIZE, height * TILE_SIZE);
    context.stroke();
  }
  for (let y = 0; y <= height; y += 1) {
    context.beginPath();
    context.moveTo(0, y * TILE_SIZE);
    context.lineTo(width * TILE_SIZE, y * TILE_SIZE);
    context.stroke();
  }
}

export function drawRobots(context: CanvasRenderingContext2D, robots: RobotState[]) {
  for (const robot of robots) {
    const px = robot.position.x * TILE_SIZE;
    const py = robot.position.y * TILE_SIZE;

    const bodyColor = robot.team === "Alpha" ? "#19e1ff" : "#ff4f6d";
    const bodyShadow = robot.team === "Alpha" ? "rgba(25, 225, 255, 0.24)" : "rgba(255, 79, 109, 0.18)";

    context.fillStyle = bodyShadow;
    context.beginPath();
    context.ellipse(px + TILE_SIZE / 2, py + TILE_SIZE - 4, 7, 3, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#101a28";
    context.fillRect(px + 4, py + 8, TILE_SIZE - 8, 7);
    context.fillStyle = bodyColor;
    context.fillRect(px + 5, py + 6, TILE_SIZE - 10, 8);
    context.fillStyle = "#d8f4ff";
    context.fillRect(px + TILE_SIZE / 2 - 3, py + 4, 6, 4);
    context.fillRect(px + 7, py + 9, 2, 2);
    context.fillRect(px + TILE_SIZE - 9, py + 9, 2, 2);
    context.fillStyle = "#08131d";
    context.fillRect(px + 4, py + 15, 4, 2.5);
    context.fillRect(px + TILE_SIZE - 8, py + 15, 4, 2.5);

    if (robot.cargo > 0) {
      context.fillStyle = "#ffd66b";
      context.fillRect(px + TILE_SIZE - 7, py + 3, 4, 4);
    }

    if (robot.jammed_turns > 0) {
      context.strokeStyle = "#ff607d";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 9.5, 0, Math.PI * 2);
      context.stroke();
    }

    context.fillStyle = "#021119";
    context.font = "700 10px var(--font-body)";
    context.textAlign = "center";
    context.fillText(String(robot.id), px + TILE_SIZE / 2, py + TILE_SIZE / 2 + 6);
  }
}

/** Draw overlays for real events: "拾取了 X 点能量" and "向机架 X 投递了 Y 点能量" */
export function drawEventOverlays(
  context: CanvasRenderingContext2D,
  robots: RobotState[],
  events: ReplayEvent[],
) {
  if (!events || events.length === 0) return;
  const robotMap = new Map<number, RobotState>();
  for (const r of robots) robotMap.set(r.id, r);

  for (const evt of events) {
    const robot = robotMap.get(evt.robot_id);
    if (!robot) continue;

    const isPick = evt.description.includes("拾取");
    const isDrop = evt.description.includes("投递");
    if (!isPick && !isDrop) continue;

    // extract the number from the description
    const numMatch = evt.description.match(/(\d+)\s*点/);
    const amount = numMatch ? numMatch[1] : "";

    const px = robot.position.x * TILE_SIZE;
    const py = robot.position.y * TILE_SIZE;
    const color = isDrop ? "#ffd66b" : "#4dff88";

    // glow on the tile
    context.fillStyle = isDrop ? "rgba(255, 214, 107, 0.3)" : "rgba(77, 255, 136, 0.25)";
    context.fillRect(px - 1, py - 1, TILE_SIZE + 2, TILE_SIZE + 2);

    // border
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.strokeRect(px - 0.5, py - 0.5, TILE_SIZE + 1, TILE_SIZE + 1);

    // floating label above the robot: "+42" or "存69"
    const label = isDrop ? `存${amount}` : `+${amount}`;
    context.fillStyle = color;
    context.font = "700 8px sans-serif";
    context.textAlign = "center";
    context.fillText(label, px + TILE_SIZE / 2, py - 3);
  }
}

function ResultModal({
  summary,
  onClose,
  onReplay,
  botAName,
  botBName,
}: {
  summary: NonNullable<ReplayData["summary"]>;
  onClose: () => void;
  onReplay: () => void;
  botAName?: string;
  botBName?: string;
}) {
  const isAlpha = summary.winner === "Alpha";
  const isBeta = summary.winner === "Beta";
  const isDraw = summary.winner === null;
  const winnerColor = isAlpha ? "var(--alpha)" : isBeta ? "var(--beta)" : "var(--gold)";
  const winnerLabel = isAlpha ? "蓝方胜利" : isBeta ? "红方胜利" : "平局";
  const winnerSub = isAlpha ? "稳健采集策略完胜" : isBeta ? "高值冲刺策略完胜" : "双方势均力敌";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(2,8,16,0.82)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, #071320 60%, #0c1e30)",
          border: `1px solid ${winnerColor}`,
          borderRadius: 24,
          padding: "48px 56px",
          minWidth: 360,
          textAlign: "center",
          boxShadow: `0 0 60px ${winnerColor}33`,
        }}
      >
        <p style={{ color: winnerColor, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.2em", margin: "0 0 12px" }}>
          比赛结束
        </p>
        <h2 style={{ color: winnerColor, fontSize: "2.4rem", margin: "0 0 6px", fontFamily: "var(--font-display)" }}>
          {winnerLabel}
        </h2>
        <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: "0 0 28px" }}>{winnerSub}</p>

        <div style={{ display: "flex", justifyContent: "center", gap: 32, marginBottom: 32 }}>
          <div>
            <p style={{ color: "var(--alpha)", fontSize: "2rem", fontWeight: 700, margin: 0 }}>{summary.final_scores[0]}</p>
            <p style={{ color: "var(--muted)", fontSize: "0.76rem", margin: "4px 0 0" }}>蓝方{botAName ? ` · ${botAName}` : ""}</p>
          </div>
          <div style={{ color: "var(--muted)", fontSize: "1.4rem", alignSelf: "center" }}>:</div>
          <div>
            <p style={{ color: "var(--beta)", fontSize: "2rem", fontWeight: 700, margin: 0 }}>{summary.final_scores[1]}</p>
            <p style={{ color: "var(--muted)", fontSize: "0.76rem", margin: "4px 0 0" }}>红方{botBName ? ` · ${botBName}` : ""}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={onReplay}
            style={{
              background: "rgba(25,225,255,0.08)", border: "1px solid var(--alpha)",
              color: "var(--alpha)", borderRadius: 999, padding: "10px 24px",
              fontSize: "0.88rem", cursor: "pointer",
            }}
          >
            重新播放
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--line-strong)",
              color: "var(--muted)", borderRadius: 999, padding: "10px 24px",
              fontSize: "0.88rem", cursor: "pointer",
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function cabinetBatteryColor(cabinet: CabinetStatus) {
  const ratio = cabinet.capacity === 0 ? 0 : cabinet.occupied / cabinet.capacity;
  return cabinetBatteryColorByRatio(ratio);
}

function cabinetBatteryColorByRatio(ratio: number) {
  if (ratio >= 0.85) return "#ff4466";
  if (ratio >= 0.45) return "#ffcc33";
  return "#55ff77";
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
