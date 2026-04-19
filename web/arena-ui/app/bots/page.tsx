"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchBots, fetchBotStats, type Bot, type BotStats } from "@/lib/api";

export default function BotsPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stats, setStats] = useState<BotStats | null>(null);
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const qsSuffix = qs ? `?${qs}` : "";

  useEffect(() => { fetchBots().then(setBots); }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetchBotStats(selectedId).then(setStats).catch(() => setStats(null));
  }, [selectedId]);

  const trend = stats?.trend ? [...stats.trend].reverse() : [];
  const maxScore = Math.max(1, ...trend.map(t => t.score));

  return (
    <div className="shell">
      <div className="arena-shell frame" style={{ borderRadius: 28, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p className="eyebrow">Bot Analytics</p>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "2rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              数据面板
            </h1>
          </div>
          <a href={`/arena${qsSuffix}`} className="control-button" style={{ textDecoration: "none", color: "var(--muted)", opacity: 0.6 }}>排行榜</a>
        </div>

        {/* bot selector */}
        <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          {bots.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              className="control-button"
              style={{
                background: selectedId === b.id ? "rgba(25,225,255,0.12)" : undefined,
                borderColor: selectedId === b.id ? "var(--alpha)" : undefined,
                color: selectedId === b.id ? "var(--alpha)" : undefined,
              }}
            >
              {b.name} <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>({b.owner})</span>
            </button>
          ))}
        </div>

        {stats && (
          <div style={{ marginTop: 24 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: "1.3rem", fontFamily: "var(--font-display)" }}>{stats.bot_name}</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.82rem", margin: 0 }}>Owner: {stats.owner}</p>

            {/* score trend chart */}
            {trend.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginBottom: 8 }}>得分趋势（最近 {trend.length} 场）</p>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, padding: "0 4px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid var(--line)" }}>
                  {trend.map((t, i) => (
                    <div
                      key={t.match_id}
                      title={`#${t.match_id}: ${t.score}分 ${t.won ? "胜" : "负"}`}
                      style={{
                        flex: 1,
                        maxWidth: 12,
                        height: `${Math.max(4, (t.score / maxScore) * 72)}px`,
                        background: t.won ? "var(--alpha)" : "var(--beta, #ff4d6a)",
                        borderRadius: "2px 2px 0 0",
                        opacity: 0.8,
                        cursor: "default",
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--alpha)" }}>■ 胜</span>
                  <span style={{ fontSize: "0.7rem", color: "var(--beta, #ff4d6a)" }}>■ 负</span>
                </div>
              </div>
            )}

            {/* map stats */}
            {stats.map_stats && stats.map_stats.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginBottom: 8 }}>各地图表现</p>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {["地图", "胜", "负", "平", "场次", "胜率", "均分"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid var(--line)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map_stats.map(ms => (
                      <tr key={ms.map_path} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 10px" }}>{ms.map_path.replace(/^maps\//, "").replace(/\.json$/, "").replace(/^db:\d+:/, "")}</td>
                        <td style={{ padding: "6px 10px", color: "var(--alpha)" }}>{ms.wins}</td>
                        <td style={{ padding: "6px 10px", color: "var(--beta, #ff4d6a)" }}>{ms.losses}</td>
                        <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{ms.draws}</td>
                        <td style={{ padding: "6px 10px" }}>{ms.total}</td>
                        <td style={{ padding: "6px 10px" }}>{(ms.win_rate * 100).toFixed(0)}%</td>
                        <td style={{ padding: "6px 10px" }}>{ms.avg_score.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* opponent stats */}
            {stats.opp_stats && stats.opp_stats.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginBottom: 8 }}>对手胜率</p>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {["对手", "胜", "负", "平", "场次", "胜率"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid var(--line)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.opp_stats.map(os => (
                      <tr key={os.opponent} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 10px", fontWeight: 600 }}>{os.opponent}</td>
                        <td style={{ padding: "6px 10px", color: "var(--alpha)" }}>{os.wins}</td>
                        <td style={{ padding: "6px 10px", color: "var(--beta, #ff4d6a)" }}>{os.losses}</td>
                        <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{os.draws}</td>
                        <td style={{ padding: "6px 10px" }}>{os.total}</td>
                        <td style={{ padding: "6px 10px", color: os.win_rate >= 0.5 ? "var(--alpha)" : "var(--beta, #ff4d6a)" }}>{(os.win_rate * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* recent matches */}
            {stats.recent && stats.recent.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginBottom: 8 }}>最近比赛</p>
                <div style={{ display: "grid", gap: 8 }}>
                  {stats.recent.map(m => (
                    <div key={m.id} className="event-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ color: "var(--muted)", fontSize: "0.74rem" }}>#{m.id}</span>
                        <span>vs</span>
                        <span style={{ fontWeight: 600 }}>{m.opponent}</span>
                        <span style={{ color: m.won ? "var(--alpha)" : m.draw ? "var(--muted)" : "var(--beta, #ff4d6a)" }}>
                          {m.my_score} : {m.opp_score}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {m.map_path && <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{m.map_path.replace(/^maps\//, "").replace(/\.json$/, "").replace(/^db:\d+:/, "")}</span>}
                        <span style={{ fontSize: "0.74rem", fontWeight: 600, color: m.won ? "var(--alpha)" : m.draw ? "var(--muted)" : "var(--beta, #ff4d6a)" }}>
                          {m.won ? "胜" : m.draw ? "平" : "负"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!selectedId && bots.length > 0 && (
          <p style={{ color: "var(--muted)", marginTop: 24 }}>选择一个 Bot 查看数据分析</p>
        )}
        {bots.length === 0 && (
          <p style={{ color: "var(--muted)", marginTop: 24 }}>暂无 Bot</p>
        )}
      </div>
    </div>
  );
}
