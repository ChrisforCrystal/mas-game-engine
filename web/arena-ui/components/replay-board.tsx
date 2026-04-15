"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ReplayData, ReplayFrame, RobotState, Tile } from "@/lib/replay";

type ReplayBoardProps = {
  replay: ReplayData;
  seed: string;
  availableSeeds: string[];
  botAName?: string;
  botBName?: string;
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

export function ReplayBoard({ replay, seed, availableSeeds, botAName, botBName }: ReplayBoardProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showResult, setShowResult] = useState(false);
  const [canvasDisplaySize, setCanvasDisplaySize] = useState<number | null>(null);
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
  }, [frame, replay.height, replay.width]);

  useEffect(() => {
    const shell = canvasShellRef.current;
    if (!shell) {
      return;
    }

    let frameHandle = 0;
    const updateCanvasSize = () => {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = window.requestAnimationFrame(() => {
        const style = window.getComputedStyle(shell);
        const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const availableWidth = Math.max(320, shell.clientWidth - horizontalPadding);
        const viewportHeight = window.innerHeight;
        const shellTop = shell.getBoundingClientRect().top;
        const currentViewportBudget = viewportHeight - Math.max(0, shellTop) - 72;
        const comfortableHeightCap = viewportHeight * 0.68;
        const hardCap = 940;
        const minReadable = viewportHeight < 820 ? 500 : 640;

        let nextSize = Math.min(
          availableWidth,
          Math.max(420, currentViewportBudget),
          comfortableHeightCap,
          hardCap,
        );

        if (availableWidth >= minReadable && currentViewportBudget >= minReadable * 0.82) {
          nextSize = Math.max(nextSize, minReadable);
        }

        setCanvasDisplaySize(Math.floor(Math.max(320, nextSize)));
      });
    };

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(shell);
    window.addEventListener("resize", updateCanvasSize);
    window.addEventListener("scroll", updateCanvasSize, { passive: true });
    updateCanvasSize();

    return () => {
      window.cancelAnimationFrame(frameHandle);
      observer.disconnect();
      window.removeEventListener("resize", updateCanvasSize);
      window.removeEventListener("scroll", updateCanvasSize);
    };
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
    <main className="shell">
      {showResult && replay.summary && (
        <ResultModal
          summary={replay.summary}
          onClose={() => setShowResult(false)}
          onReplay={() => { setShowResult(false); setIsPlaying(false); setFrameIndex(0); }}
          botAName={botAName}
          botBName={botBName}
        />
      )}
      <div className="arena-shell frame">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          {availableSeeds.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ color: "var(--muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.12em" }}>回放</span>
              <select
                defaultValue={seed}
                onChange={(e) => { window.location.href = `/?seed=${e.target.value}`; }}
                style={{ background: "rgba(7,18,31,0.9)", border: "1px solid var(--line-strong)", borderRadius: 999, color: "var(--text)", padding: "6px 14px", fontSize: "0.84rem", cursor: "pointer", outline: "none" }}
              >
                {availableSeeds.map((s) => (
                  <option key={s} value={s}>seed {s}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
            <a href="/arena" style={{ textDecoration: "none" }}>
              <button className="control-button" type="button" style={{ color: "var(--muted)", border: "1px solid rgba(118,155,196,0.18)", opacity: 0.6 }}>排行榜</button>
            </a>
            <button
              className="control-button"
              type="button"
              style={{ background: "rgba(25,225,255,0.12)", border: "1px solid var(--alpha)", color: "var(--alpha)" }}
            >
              回放
            </button>
          </div>
        </div>
        <header className="hero-bar">
          <div className="hero-copy">
            <p className="eyebrow">智能体竞技回放台</p>
            <div className="versus-row">
              <section className="team-panel alpha-team">
                <span className="team-tag">蓝方</span>
                {botAName && <span style={{ fontSize: "0.82rem", color: "var(--alpha)", opacity: 0.85 }}>{botAName}</span>}
                <strong>{frame.scores[0]}</strong>
              </section>
              <div className="versus-center">
                <h1>机房调度走廊</h1>
                <p>
                  种子 {replay.seed} · 回合 {frame.turn} / {replay.frames.length}
                </p>
              </div>
              <section className="team-panel beta-team">
                <span className="team-tag">红方</span>
                {botBName && <span style={{ fontSize: "0.82rem", color: "var(--beta)", opacity: 0.85 }}>{botBName}</span>}
                <strong>{frame.scores[1]}</strong>
              </section>
            </div>
          </div>

          <div className="hero-controls">
            <button
              className="control-button"
              type="button"
              onClick={() => setIsPlaying((current) => !current)}
            >
              {isPlaying ? "暂停" : "播放"}
            </button>
            <button
              className="control-button subtle"
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setFrameIndex(0);
              }}
            >
              重播
            </button>
            <label className="speed-chip">
              速度
              <select
                value={playbackSpeed}
                onChange={(event) => setPlaybackSpeed(Number(event.target.value))}
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>
            </label>
          </div>
        </header>

        <section className="headline-strip">
          <div className="headline-card">
            <span className="headline-label">领先差</span>
            <strong>{scoreLead === 0 ? "势均力敌" : `${Math.abs(scoreLead)} 分`}</strong>
            <small>{scoreLead >= 0 ? "蓝方占优" : "红方占优"}</small>
          </div>
          <div className="headline-card">
            <span className="headline-label">在途载荷</span>
            <strong>{alphaStats.cargo + betaStats.cargo}</strong>
            <small>当前机器人携带总能量</small>
          </div>
          <div className="headline-card">
            <span className="headline-label">受干扰数</span>
            <strong>{alphaStats.jammed + betaStats.jammed}</strong>
            <small>当前受控机器人数量</small>
          </div>
          <div className="headline-card">
            <span className="headline-label">即时判断</span>
            <strong>{scoreLead === 0 ? "仍未分胜负" : scoreLead > 0 ? "蓝方" : "红方"}</strong>
            <small>仅按当前比分估计</small>
          </div>
        </section>

        <section className="content-grid">
          <aside className="side-column">
            <div className="side-card frame">
              <h2>战局监控</h2>
              <StatBlock
                title="蓝方"
                tint="alpha"
                rows={[
                  ["载荷", String(alphaStats.cargo)],
                  ["满载机器人", String(alphaStats.loaded)],
                  ["受干扰", String(alphaStats.jammed)],
                ]}
              />
              <StatBlock
                title="红方"
                tint="beta"
                rows={[
                  ["载荷", String(betaStats.cargo)],
                  ["满载机器人", String(betaStats.loaded)],
                  ["受干扰", String(betaStats.jammed)],
                ]}
              />
            </div>

            <div className="side-card frame">
              <h2>地图热点</h2>
              <ul className="legend-list">
                <li>
                  <span className="legend-swatch conveyor" />
                  中央输送带脊柱
                </li>
                <li>
                  <span className="legend-swatch cabinet" />
                  多机架投递网络
                </li>
                <li>
                  <span className="legend-swatch e1" />
                  随机能量闪电
                </li>
                <li>
                  <span className="legend-swatch e2" />
                  深区高值热点
                </li>
              </ul>
            </div>

            <div className="side-card frame">
              <h2>机架状态</h2>
              <div className="cabinet-summary-bar">
                <strong>{cabinets.length} 台机架</strong>
                <small>远端分散投递，面板内滚动查看</small>
              </div>
              <div className="cabinet-grid compact">
                {cabinets.map((cabinet) => (
                  <article className="cabinet-mini" key={cabinet.id}>
                    <div className="cabinet-mini-header">
                      <strong>R{cabinet.id}</strong>
                      <span className={`cabinet-status ${statusClassName(cabinet)}`}>
                        {statusLabel(cabinet)}
                      </span>
                    </div>
                    <div className="cabinet-mini-body">
                      <div className="cabinet-mini-battery" aria-hidden="true">
                        <span className="mini-battery-shell" />
                        <span className="mini-battery-cap" />
                        <span
                          className="mini-battery-fill"
                          style={{
                            height: `${cabinet.capacity === 0 ? 0 : (cabinet.occupied / cabinet.capacity) * 100}%`,
                            background: cabinetBatteryColor(cabinet),
                          }}
                        />
                        <span className="mini-battery-mark mark-1" />
                        <span className="mini-battery-mark mark-2" />
                        <span className="mini-battery-mark mark-3" />
                        <span className="mini-battery-bolt" />
                      </div>
                      <div className="cabinet-mini-stats">
                        <div className="cabinet-mini-row">
                          <span>余量</span>
                          <strong>{cabinet.remaining}</strong>
                        </div>
                        <div className="cabinet-mini-row">
                          <span>占用</span>
                          <strong>{cabinet.occupied}</strong>
                        </div>
                        <div className="cabinet-mini-row">
                          <span>总量</span>
                          <strong>{cabinet.capacity}</strong>
                        </div>
                        <div className="cabinet-mini-row">
                          <span>占比</span>
                          <strong>{Math.round((cabinet.occupied / cabinet.capacity) * 100)}%</strong>
                        </div>
                        <div className="cabinet-mini-track">
                          <span
                            className="cabinet-mini-track-fill"
                            style={{ width: `${cabinet.capacity === 0 ? 0 : (cabinet.occupied / cabinet.capacity) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </aside>

          <section className="map-stage frame">
            <div className="map-stage-header">
              <div>
                <p className="eyebrow">实时战术板</p>
                <h2>机房主控网格</h2>
              </div>
              <div className="map-pill-row">
                <span className="map-pill alpha">蓝方得分 {frame.scores[0]}</span>
                <span className="map-pill beta">红方得分 {frame.scores[1]}</span>
              </div>
            </div>

            <div className="canvas-shell" ref={canvasShellRef}>
              <canvas
                ref={canvasRef}
                aria-label="Arena replay map"
                style={canvasDisplaySize ? { width: canvasDisplaySize, height: "auto" } : undefined}
              />
            </div>
          </section>

          <aside className="side-column">
            <div className="side-card frame">
              <h2>事件流</h2>
              <div className="event-feed">
                {prominentEvents.length === 0 ? (
                  <p className="empty-copy">当前仍处于开局调度阶段。</p>
                ) : (
                  prominentEvents
                    .slice()
                    .reverse()
                    .map((event) => (
                      <article key={`${event.turn}-${event.text}`} className={`event-card ${event.team.toLowerCase()}`}>
                        <span>回合 {event.turn}</span>
                        <strong>{event.text}</strong>
                      </article>
                    ))
                )}
              </div>
            </div>

            <div className="side-card frame">
              <h2>本回合动作</h2>
              <ul className="turn-actions">
                {frame.actions.slice(0, 10).map(([robotId, action]) => (
                  <li key={`${frame.turn}-${robotId}`}>
                    <span>R{robotId}</span>
                    <strong>{formatAction(action)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </section>

        <footer className="timeline-panel frame">
          <div className="timeline-topline">
            <div>
              <p className="eyebrow">时间轴</p>
              <h3>500 回合战局走势</h3>
            </div>
            <strong>
              已完成 {Math.round((frame.turn / replay.frames.length) * 100)}%
            </strong>
          </div>

          <input
            aria-label="Replay progress"
            className="timeline-slider"
            type="range"
            min={0}
            max={replay.frames.length - 1}
            value={frameIndex}
            onChange={(event) => {
              setIsPlaying(false);
              startTransition(() => setFrameIndex(Number(event.target.value)));
            }}
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
        </footer>
      </div>
    </main>
  );
}

function StatBlock({
  title,
  tint,
  rows,
}: {
  title: string;
  tint: "alpha" | "beta";
  rows: [string, string][];
}) {
  return (
    <section className={`stat-block ${tint}`}>
      <header>
        <span>{title}</span>
      </header>
      {rows.map(([label, value]) => (
        <div className="stat-row" key={`${title}-${label}`}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function buildEventCards(replay: ReplayData): EventCard[] {
  return replay.frames.flatMap((frame) => {
    const explicit = frame.events.map<EventCard>((event) => ({
      turn: frame.turn,
      text: `R${event.robot_id} ${event.description}`,
      team: inferTeam(frame.robots, event.robot_id),
    }));

    if (frame.turn === 1) {
      explicit.push({
        turn: frame.turn,
        text: "双方机器人离开出生走廊，开始进入机房通道。",
        team: "Neutral",
      });
    }

    if (frame.scores[0] !== replay.frames[Math.max(0, frame.turn - 2)]?.scores?.[0]) {
      explicit.push({
        turn: frame.turn,
        text: `蓝方累计得分来到 ${frame.scores[0]}。`,
        team: "Alpha",
      });
    }

    if (frame.scores[1] !== replay.frames[Math.max(0, frame.turn - 2)]?.scores?.[1]) {
      explicit.push({
        turn: frame.turn,
        text: `红方累计得分来到 ${frame.scores[1]}。`,
        team: "Beta",
      });
    }

    return explicit;
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

function statusLabel(cabinet: CabinetStatus) {
  const ratio = cabinet.capacity === 0 ? 0 : cabinet.occupied / cabinet.capacity;
  if (ratio >= 0.9) {
    return "已接近满载";
  }
  if (ratio >= 0.55) {
    return "处理中";
  }
  return "空闲";
}

function statusClassName(cabinet: CabinetStatus) {
  const ratio = cabinet.capacity === 0 ? 0 : cabinet.occupied / cabinet.capacity;
  if (ratio >= 0.85) {
    return "hot";
  }
  if (ratio >= 0.45) {
    return "warm";
  }
  return "cool";
}

function drawTiles(
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

  context.fillStyle = "rgba(255, 214, 107, 0.05)";
  context.fillRect(px + 2, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

  context.fillStyle = "#09111a";
  roundRect(context, px + 4, py + 5, TILE_SIZE - 9, TILE_SIZE - 10, 3);
  context.fill();
  context.strokeStyle = "rgba(196, 210, 228, 0.82)";
  context.lineWidth = 1;
  roundRect(context, px + 4.5, py + 5.5, TILE_SIZE - 10, TILE_SIZE - 11, 3);
  context.stroke();

  context.fillStyle = "rgba(220, 230, 242, 0.72)";
  roundRect(context, px + TILE_SIZE - 4.5, py + 9, 2.5, TILE_SIZE - 18, 1.1);
  context.fill();

  context.fillStyle = "rgba(255,255,255,0.06)";
  context.fillRect(px + 6, py + 7, TILE_SIZE - 15, TILE_SIZE - 14);
  context.fillStyle = meterColor;
  context.fillRect(
    px + 6,
    py + 7 + (TILE_SIZE - 14) * (1 - fillRatio),
    TILE_SIZE - 15,
    (TILE_SIZE - 14) * fillRatio,
  );

  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.lineWidth = 0.7;
  for (let index = 1; index <= 3; index += 1) {
    const y = py + 7 + ((TILE_SIZE - 14) / 4) * index;
    context.beginPath();
    context.moveTo(px + 6.5, y);
    context.lineTo(px + TILE_SIZE - 9.5, y);
    context.stroke();
  }

  context.fillStyle = "rgba(255,255,255,0.28)";
  context.beginPath();
  context.moveTo(px + TILE_SIZE / 2 - 1, py + 9);
  context.lineTo(px + TILE_SIZE / 2 + 1.5, py + 9);
  context.lineTo(px + TILE_SIZE / 2 - 0.7, py + 12);
  context.lineTo(px + TILE_SIZE / 2 + 1.2, py + 12);
  context.lineTo(px + TILE_SIZE / 2 - 2.1, py + 16);
  context.lineTo(px + TILE_SIZE / 2 - 0.5, py + 13.4);
  context.lineTo(px + TILE_SIZE / 2 - 2.2, py + 13.4);
  context.closePath();
  context.fill();
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

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
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

function drawRobots(context: CanvasRenderingContext2D, robots: RobotState[]) {
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

function formatAction(action: ReplayFrame["actions"][number][1]) {
  if (typeof action === "string") {
    return ({
      Pick: "拾取",
      Drop: "投递",
      Jam: "干扰",
      Wait: "待机",
    } as const)[action];
  }
  const direction = {
    Up: "上移",
    Down: "下移",
    Left: "左移",
    Right: "右移",
  } as const;
  return direction[action.Move];
}

function cabinetBatteryColor(cabinet: CabinetStatus) {
  const ratio = cabinet.capacity === 0 ? 0 : cabinet.occupied / cabinet.capacity;
  return cabinetBatteryColorByRatio(ratio);
}

function cabinetBatteryColorByRatio(ratio: number) {
  if (ratio >= 0.85) {
    return "linear-gradient(180deg, #ff2454, #ff6f8d)";
  }
  if (ratio >= 0.45) {
    return "linear-gradient(180deg, #ffe23a, #ff9800)";
  }
  return "linear-gradient(180deg, #7dff5c, #2bff88)";
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
