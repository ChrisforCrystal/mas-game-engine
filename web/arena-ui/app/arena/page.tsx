"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Match,
  MapInfo,
  Ranking,
  fetchBots,
  fetchMatches,
  fetchRankings,
  fetchMaps,
  registerBot,
  startMatch,
  deleteBot,
} from "@/lib/api";

export default function ArenaPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [tab, setTab] = useState<"rank" | "match" | "bots">("rank");

  // register bot form
  const [regName, setRegName] = useState("");
  const [regUrl, setRegUrl] = useState("");
  const [regOwner, setRegOwner] = useState("");
  const [regMsg, setRegMsg] = useState("");

  // start match form
  const [matchA, setMatchA] = useState("");
  const [matchB, setMatchB] = useState("");
  const [matchSeed, setMatchSeed] = useState("");
  const [matchMap, setMatchMap] = useState("");
  const [matchMsg, setMatchMsg] = useState("");

  async function reload() {
    const [b, m, r, mp] = await Promise.all([fetchBots(), fetchMatches(), fetchRankings(), fetchMaps()]);
    setBots(b);
    setMatches(m);
    setRankings(r);
    setMaps(mp);
  }

  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    try {
      await registerBot(regName, regUrl, regOwner);
      setRegMsg("注册成功");
      setRegName(""); setRegUrl(""); setRegOwner("");
      reload();
    } catch (err: any) {
      setRegMsg("失败: " + err.message);
    }
  }

  async function handleStartMatch(e: React.FormEvent) {
    e.preventDefault();
    const a = bots.find((b) => b.name === matchA);
    const b = bots.find((b) => b.name === matchB);
    if (!a || !b) { setMatchMsg("找不到 bot"); return; }
    try {
      const res = await startMatch(a.id, b.id, matchSeed ? parseInt(matchSeed) : undefined, matchMap || undefined);
      setMatchMsg(`比赛已发起 #${res.id}，seed=${res.seed}`);
      reload();
    } catch (err: any) {
      setMatchMsg("失败: " + err.message);
    }
  }

  return (
    <div className="shell">
      <div className="arena-shell frame" style={{ borderRadius: 28, maxWidth: 1100, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <p className="eyebrow">Agent Arena</p>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "2.4rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              竞技排行榜
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {(["rank", "match", "bots"] as const).map((t) => (
              <button
                key={t}
                className="control-button"
                style={{ background: tab === t ? "rgba(25,225,255,0.12)" : undefined, borderColor: tab === t ? "var(--alpha)" : undefined, color: tab === t ? "var(--alpha)" : undefined }}
                onClick={() => setTab(t)}
              >
                {{ rank: "排行榜", match: "发起对战", bots: "注册 Bot" }[t]}
              </button>
            ))}
            <a
              href="/"
              className="control-button"
              style={{ textDecoration: "none", color: "var(--muted)", opacity: 0.6 }}
            >
              回放
            </a>
          </div>
        </div>

        {/* rank tab */}
        {tab === "rank" && (
          <div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
              <thead>
                <tr style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.72rem" }}>
                  {["#", "Bot", "Owner", "胜", "负", "平", "场次", "胜率", "均分"].map((h) => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", borderBottom: "1px solid var(--line)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankings.map((r, i) => (
                  <tr key={r.bot_id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "12px 14px", color: i === 0 ? "var(--gold)" : "var(--muted)" }}>{i + 1}</td>
                    <td style={{ padding: "12px 14px", fontWeight: 600 }}>{r.bot_name}</td>
                    <td style={{ padding: "12px 14px", color: "var(--muted)" }}>{r.owner}</td>
                    <td style={{ padding: "12px 14px", color: "var(--alpha)" }}>{r.wins}</td>
                    <td style={{ padding: "12px 14px", color: "var(--beta)" }}>{r.losses}</td>
                    <td style={{ padding: "12px 14px", color: "var(--muted)" }}>{r.draws}</td>
                    <td style={{ padding: "12px 14px" }}>{r.total}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <WinBar rate={r.win_rate} />
                    </td>
                    <td style={{ padding: "12px 14px" }}>{r.avg_score.toFixed(0)}</td>
                  </tr>
                ))}
                {rankings.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>暂无数据，先注册 bot 并发起比赛</td></tr>
                )}
              </tbody>
            </table>

            {/* recent matches */}
            <div style={{ marginTop: 28 }}>
              <p className="eyebrow" style={{ marginBottom: 12 }}>最近比赛</p>
              <div style={{ display: "grid", gap: 10 }}>
                {matches.slice(0, 8).map((m) => (
                  <MatchRow key={m.id} match={m} />
                ))}
                {matches.length === 0 && <p style={{ color: "var(--muted)" }}>暂无比赛记录</p>}
              </div>
            </div>
          </div>
        )}

        {/* match tab */}
        {tab === "match" && (
          <div style={{ maxWidth: 480 }}>
            <p className="eyebrow" style={{ marginBottom: 16 }}>发起对战</p>
            <form onSubmit={handleStartMatch} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Alpha Bot</span>
                <select value={matchA} onChange={(e) => setMatchA(e.target.value)} style={selectStyle}>
                  <option value="">选择 bot</option>
                  {bots.map((b) => <option key={b.id} value={b.name}>{b.name} ({b.owner})</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Beta Bot</span>
                <select value={matchB} onChange={(e) => setMatchB(e.target.value)} style={selectStyle}>
                  <option value="">选择 bot</option>
                  {bots.map((b) => <option key={b.id} value={b.name}>{b.name} ({b.owner})</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Seed（留空随机）</span>
                <input value={matchSeed} onChange={(e) => setMatchSeed(e.target.value)} placeholder="42" style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>地图（留空随机生成）</span>
                <select value={matchMap} onChange={(e) => setMatchMap(e.target.value)} style={selectStyle}>
                  <option value="">随机地图</option>
                  {maps.map((m) => (
                    <option key={m.path} value={m.path}>{m.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="control-button" style={{ justifySelf: "start", background: "rgba(25,225,255,0.1)", borderColor: "var(--alpha)", color: "var(--alpha)" }}>
                开始比赛
              </button>
              {matchMsg && <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>{matchMsg}</p>}
            </form>

            <div style={{ marginTop: 32 }}>
              <p className="eyebrow" style={{ marginBottom: 12 }}>比赛历史</p>
              <div style={{ display: "grid", gap: 10 }}>
                {matches.map((m) => <MatchRow key={m.id} match={m} />)}
                {matches.length === 0 && <p style={{ color: "var(--muted)" }}>暂无比赛记录</p>}
              </div>
            </div>
          </div>
        )}

        {/* bots tab */}
        {tab === "bots" && (
          <div style={{ maxWidth: 480 }}>
            <p className="eyebrow" style={{ marginBottom: 16 }}>注册 Bot</p>
            <form onSubmit={handleRegister} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Bot 名称</span>
                <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="my-bot" required style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>服务地址</span>
                <input value={regUrl} onChange={(e) => setRegUrl(e.target.value)} placeholder="http://1.2.3.4:8080" required style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Owner</span>
                <input value={regOwner} onChange={(e) => setRegOwner(e.target.value)} placeholder="张三" style={inputStyle} />
              </label>
              <button type="submit" className="control-button" style={{ justifySelf: "start", background: "rgba(25,225,255,0.1)", borderColor: "var(--alpha)", color: "var(--alpha)" }}>
                注册
              </button>
              {regMsg && <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>{regMsg}</p>}
            </form>

            <div style={{ marginTop: 32 }}>
              <p className="eyebrow" style={{ marginBottom: 12 }}>已注册 Bot</p>
              <div style={{ display: "grid", gap: 10 }}>
                {bots.map((b) => (
                  <div key={b.id} className="event-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong>{b.name}</strong>
                      <span style={{ display: "block", color: "var(--muted)", fontSize: "0.8rem", marginTop: 2 }}>{b.owner} · {b.url}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>#{b.id}</span>
                      <button
                        onClick={async () => {
                          if (!confirm(`确认删除 ${b.name}？`)) return;
                          try { await deleteBot(b.id); reload(); } catch (err: any) { alert("删除失败: " + err.message); }
                        }}
                        style={{ background: "none", border: "1px solid var(--danger, #ff4d6a)", borderRadius: 8, color: "var(--danger, #ff4d6a)", fontSize: "0.76rem", padding: "2px 10px", cursor: "pointer" }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                {bots.length === 0 && <p style={{ color: "var(--muted)" }}>暂无 bot</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WinBar({ rate }: { rate: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 80, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ width: `${rate * 100}%`, height: "100%", background: "linear-gradient(90deg, var(--alpha), #7fe2ff)", borderRadius: "inherit" }} />
      </div>
      <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{(rate * 100).toFixed(0)}%</span>
    </div>
  );
}

function MatchRow({ match: m }: { match: Match }) {
  const statusColor = { done: "var(--alpha)", running: "var(--gold)", error: "var(--danger)", pending: "var(--muted)" }[m.status] ?? "var(--muted)";
  const winnerLabel = m.winner === "Alpha" ? m.bot_a_name : m.winner === "Beta" ? m.bot_b_name : m.status === "done" ? "平局" : "";
  const mapLabel = m.map_path ? m.map_path.replace(/^maps\//, "").replace(/\.json$/, "") : null;
  return (
    <div className="event-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ color: "var(--muted)", fontSize: "0.76rem", minWidth: 28 }}>#{m.id}</span>
        <span style={{ color: "var(--alpha)" }}>{m.bot_a_name}</span>
        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>vs</span>
        <span style={{ color: "var(--beta)" }}>{m.bot_b_name}</span>
        {m.score_a != null && (
          <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{m.score_a} : {m.score_b}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {mapLabel && <span style={{ fontSize: "0.72rem", color: "var(--muted)", opacity: 0.7 }}>{mapLabel}</span>}
        {winnerLabel && <span style={{ fontSize: "0.8rem", color: "var(--gold)" }}>胜: {winnerLabel}</span>}
        <span style={{ fontSize: "0.76rem", color: statusColor, textTransform: "uppercase", letterSpacing: "0.1em" }}>{m.status}</span>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>seed={m.seed}</span>
        {m.status === "done" && (
          <a
            href={`/?seed=${m.seed}`}
            style={{ fontSize: "0.76rem", color: "var(--alpha)", textDecoration: "none", border: "1px solid var(--alpha)", borderRadius: 999, padding: "2px 10px" }}
          >
            回放
          </a>
        )}
      </div>
    </div>
  );
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};
