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
  deleteMatch,
  clearMatches,
} from "@/lib/api";

export default function ArenaPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [tab, setTab] = useState<"rank" | "match" | "bots">("rank");
  const [matchPage, setMatchPage] = useState(0);
  const MATCH_PAGE_SIZE = 8;
  const [rankPage, setRankPage] = useState(0);
  const RANK_PAGE_SIZE = 15;
  const [rankOwnerFilter, setRankOwnerFilter] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAdminToken(params.get("token"));
  }, []);

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

  // live progress for just-started match
  const [liveMatchId, setLiveMatchId] = useState<number | null>(null);
  const [liveProgress, setLiveProgress] = useState<{ turn: number; total: number; score_a: number; score_b: number } | null>(null);
  const [liveDone, setLiveDone] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);

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

  async function handleDeleteMatch(id: number) {
    try { await deleteMatch(id, adminToken || undefined); reload(); } catch (err: any) { alert("删除失败: " + err.message); }
  }

  async function handleClearMatches() {
    if (!confirm("确认清空所有比赛记录？")) return;
    try { await clearMatches(adminToken || undefined); reload(); } catch (err: any) { alert("清空失败: " + err.message); }
  }

  // connect SSE immediately after match starts
  useEffect(() => {
    if (!liveMatchId) return;
    const es = new EventSource(`/api/matches/${liveMatchId}/live`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.done) {
          setLiveDone(true);
          es.close();
          reload();
          return;
        }
        setLiveProgress(data);
      } catch {}
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [liveMatchId]);

  async function handleStartMatch(e: React.FormEvent) {
    e.preventDefault();
    const a = bots.find((b) => b.name === matchA);
    const b = bots.find((b) => b.name === matchB);
    if (!a || !b) { setMatchMsg("找不到 bot"); return; }
    setMatchLoading(true);
    setMatchMsg("");
    try {
      setLiveProgress(null);
      setLiveDone(false);
      const res = await startMatch(a.id, b.id, matchSeed ? parseInt(matchSeed) : undefined, matchMap ? parseInt(matchMap) : undefined);
      setMatchMsg(`比赛已发起 #${res.id}，seed=${res.seed}`);
      setLiveMatchId(res.id);
      reload();
    } catch (err: any) {
      setMatchMsg("失败: " + err.message);
    } finally {
      setMatchLoading(false);
    }
  }

  return (
    <div className="shell">
      <div className="arena-shell frame" style={{ borderRadius: 28, maxWidth: 1100, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <p className="eyebrow" style={{ margin: 0 }}>Agent Arena</p>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.6rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
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
            {/* owner filter */}
            {(() => {
              const owners = [...new Set(rankings.map(r => r.owner))].sort();
              return owners.length > 1 ? (
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>筛选:</span>
                  <button
                    onClick={() => { setRankOwnerFilter(""); setRankPage(0); setMatchPage(0); }}
                    className="control-button"
                    style={{ fontSize: "0.74rem", padding: "3px 10px", background: !rankOwnerFilter ? "rgba(25,225,255,0.12)" : undefined, borderColor: !rankOwnerFilter ? "var(--alpha)" : undefined, color: !rankOwnerFilter ? "var(--alpha)" : undefined }}
                  >
                    全部
                  </button>
                  {owners.map(o => (
                    <button
                      key={o}
                      onClick={() => { setRankOwnerFilter(o); setRankPage(0); setMatchPage(0); }}
                      className="control-button"
                      style={{ fontSize: "0.74rem", padding: "3px 10px", background: rankOwnerFilter === o ? "rgba(25,225,255,0.12)" : undefined, borderColor: rankOwnerFilter === o ? "var(--alpha)" : undefined, color: rankOwnerFilter === o ? "var(--alpha)" : undefined }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
            {(() => {
              const filtered = rankOwnerFilter ? rankings.filter(r => r.owner === rankOwnerFilter) : rankings;
              const paged = filtered.slice(rankPage * RANK_PAGE_SIZE, (rankPage + 1) * RANK_PAGE_SIZE);
              const top3 = !rankOwnerFilter && rankPage === 0 ? filtered.slice(0, 3) : [];
              return (<>
            {/* podium */}
            {top3.length >= 3 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 12, padding: "10px 0" }}>
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: "0.84rem", color: "var(--gold)", fontWeight: 600, letterSpacing: "0.06em" }}>
                    恭喜 <span style={{ fontWeight: 800, color: "#ffd700" }}>{top3[0].owner}</span> 的 <span style={{ fontWeight: 800, color: "#ffd700" }}>{top3[0].bot_name}</span> 强势登顶
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>{top3[0].wins}胜{top3[0].losses}负 · 胜率{(top3[0].win_rate * 100).toFixed(0)}% · {top3[0].total}场</div>
                </div>
                <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 12 }}>
                {/* 2nd place */}
                <div style={{ textAlign: "center", width: 130 }}>
                  <div style={{ fontSize: "1.2rem" }}>🥈</div>
                  <div style={{ background: "linear-gradient(180deg, rgba(192,192,192,0.12), rgba(192,192,192,0.04))", border: "1px solid rgba(192,192,192,0.25)", borderRadius: 12, padding: "8px 8px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "#c0c0c0" }}>{top3[1].bot_name}</div>
                    <div style={{ fontSize: "0.66rem", color: "var(--muted)", marginTop: 2 }}>{top3[1].owner} · {(top3[1].win_rate * 100).toFixed(0)}%</div>
                  </div>
                </div>
                {/* 1st place */}
                <div style={{ textAlign: "center", width: 150 }}>
                  <div style={{ fontSize: "1.6rem" }}>🏆</div>
                  <div style={{ background: "linear-gradient(180deg, rgba(255,215,0,0.15), rgba(255,215,0,0.04))", border: "1px solid rgba(255,215,0,0.35)", borderRadius: 12, padding: "10px 8px", boxShadow: "0 0 16px rgba(255,215,0,0.08)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: "1rem", fontWeight: 800, color: "#ffd700" }}>{top3[0].bot_name}</div>
                    <div style={{ fontSize: "0.68rem", color: "var(--gold)", marginTop: 2 }}>{top3[0].owner} · {(top3[0].win_rate * 100).toFixed(0)}%</div>
                  </div>
                </div>
                {/* 3rd place */}
                <div style={{ textAlign: "center", width: 120 }}>
                  <div style={{ fontSize: "1.1rem" }}>🥉</div>
                  <div style={{ background: "linear-gradient(180deg, rgba(205,127,50,0.12), rgba(205,127,50,0.04))", border: "1px solid rgba(205,127,50,0.22)", borderRadius: 12, padding: "8px 8px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#cd7f32" }}>{top3[2].bot_name}</div>
                    <div style={{ fontSize: "0.66rem", color: "var(--muted)", marginTop: 2 }}>{top3[2].owner} · {(top3[2].win_rate * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
              </div>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
              <thead>
                <tr style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.68rem" }}>
                  {["#", "Bot", "Owner", "评分", "胜", "负", "平", "场次", "胜率", "均分"].map((h) => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid var(--line)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((r, i) => {
                  const rank = rankPage * RANK_PAGE_SIZE + i;
                  return (
                  <tr key={r.bot_id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 10px", color: rank === 0 ? "var(--gold)" : "var(--muted)" }}>{rank + 1}</td>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.bot_name}</td>
                    <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{r.owner}</td>
                    <td style={{ padding: "6px 10px", color: "var(--gold)", fontWeight: 700 }}>{(r.rating ?? 0).toFixed(1)}</td>
                    <td style={{ padding: "6px 10px", color: "var(--alpha)" }}>{r.wins}</td>
                    <td style={{ padding: "6px 10px", color: "var(--beta)" }}>{r.losses}</td>
                    <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{r.draws}</td>
                    <td style={{ padding: "6px 10px" }}>{r.total}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <WinBar rate={r.win_rate} />
                    </td>
                    <td style={{ padding: "6px 10px" }}>{r.avg_score.toFixed(0)}</td>
                  </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={10} style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>暂无数据，先注册 bot 并发起比赛</td></tr>
                )}
              </tbody>
            </table>
            {filtered.length > RANK_PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 14 }}>
                <button
                  disabled={rankPage === 0}
                  onClick={() => setRankPage(p => p - 1)}
                  style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: rankPage === 0 ? "var(--muted)" : "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", cursor: rankPage === 0 ? "default" : "pointer", opacity: rankPage === 0 ? 0.4 : 1 }}
                >
                  上一页
                </button>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem", lineHeight: "28px" }}>
                  {rankPage + 1} / {Math.ceil(filtered.length / RANK_PAGE_SIZE)}
                </span>
                <button
                  disabled={(rankPage + 1) * RANK_PAGE_SIZE >= filtered.length}
                  onClick={() => setRankPage(p => p + 1)}
                  style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: (rankPage + 1) * RANK_PAGE_SIZE >= filtered.length ? "var(--muted)" : "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", cursor: (rankPage + 1) * RANK_PAGE_SIZE >= filtered.length ? "default" : "pointer", opacity: (rankPage + 1) * RANK_PAGE_SIZE >= filtered.length ? 0.4 : 1 }}
                >
                  下一页
                </button>
              </div>
            )}
            </>);
            })()}

            {/* recent matches */}
            <div style={{ marginTop: 28 }}>
              <p className="eyebrow" style={{ marginBottom: 12 }}>最近比赛{rankOwnerFilter ? ` · ${rankOwnerFilter}` : ""}</p>
              {(() => {
                const ownerBotNames = rankOwnerFilter ? new Set(bots.filter(b => b.owner === rankOwnerFilter).map(b => b.name)) : null;
                const filteredMatches = ownerBotNames ? matches.filter(m => ownerBotNames.has(m.bot_a_name) || ownerBotNames.has(m.bot_b_name)) : matches;
                const pagedMatches = filteredMatches.slice(matchPage * MATCH_PAGE_SIZE, (matchPage + 1) * MATCH_PAGE_SIZE);
                return (<>
              <div style={{ display: "grid", gap: 10 }}>
                {pagedMatches.map((m) => (
                  <MatchRow key={m.id} match={m} onDelete={handleDeleteMatch} isAdmin={!!adminToken} />
                ))}
                {filteredMatches.length === 0 && <p style={{ color: "var(--muted)" }}>暂无比赛记录</p>}
              </div>
              {filteredMatches.length > MATCH_PAGE_SIZE && (
                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 14 }}>
                  <button
                    disabled={matchPage === 0}
                    onClick={() => setMatchPage(p => p - 1)}
                    style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: matchPage === 0 ? "var(--muted)" : "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", cursor: matchPage === 0 ? "default" : "pointer", opacity: matchPage === 0 ? 0.4 : 1 }}
                  >
                    上一页
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem", lineHeight: "28px" }}>
                    {matchPage + 1} / {Math.ceil(filteredMatches.length / MATCH_PAGE_SIZE)}
                  </span>
                  <button
                    disabled={(matchPage + 1) * MATCH_PAGE_SIZE >= filteredMatches.length}
                    onClick={() => setMatchPage(p => p + 1)}
                    style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: (matchPage + 1) * MATCH_PAGE_SIZE >= filteredMatches.length ? "var(--muted)" : "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", cursor: (matchPage + 1) * MATCH_PAGE_SIZE >= filteredMatches.length ? "default" : "pointer", opacity: (matchPage + 1) * MATCH_PAGE_SIZE >= filteredMatches.length ? 0.4 : 1 }}
                  >
                    下一页
                  </button>
                </div>
              )}
              </>);
              })()}
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
                    <option key={m.id} value={String(m.id)}>{m.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={matchLoading} className="control-button" style={{ justifySelf: "start", background: "rgba(25,225,255,0.1)", borderColor: "var(--alpha)", color: "var(--alpha)", opacity: matchLoading ? 0.5 : 1, cursor: matchLoading ? "not-allowed" : "pointer" }}>
                {matchLoading ? "检测连接中..." : "开始比赛"}
              </button>
              {matchMsg && <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>{matchMsg}</p>}
            </form>

            {/* live progress panel — shown immediately after starting a match */}
            {liveMatchId && !liveDone && (
              <div className="event-card" style={{ marginTop: 20, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "var(--gold)", fontSize: "0.82rem", fontWeight: 600 }}>
                      比赛 #{liveMatchId} 进行中
                    </span>
                    <span style={{ color: "var(--alpha)" }}>{matchA}</span>
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>vs</span>
                    <span style={{ color: "var(--beta)" }}>{matchB}</span>
                    {liveProgress && (
                      <span style={{ color: "var(--gold)", fontSize: "0.88rem", fontWeight: 600 }}>
                        {liveProgress.score_a} : {liveProgress.score_b}
                      </span>
                    )}
                  </div>
                  {liveProgress && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 120, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div style={{ width: `${(liveProgress.turn / liveProgress.total) * 100}%`, height: "100%", background: "var(--gold)", borderRadius: "inherit", transition: "width 0.15s" }} />
                      </div>
                      <span style={{ fontSize: "0.76rem", color: "var(--gold)" }}>{liveProgress.turn}/{liveProgress.total}</span>
                    </div>
                  )}
                  {!liveProgress && (
                    <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>等待连接...</span>
                  )}
                </div>
              </div>
            )}
            {liveMatchId && liveDone && (
              <div className="event-card" style={{ marginTop: 20, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--alpha)", fontSize: "0.82rem", fontWeight: 600 }}>
                    比赛 #{liveMatchId} 已完成
                  </span>
                  {liveProgress && (
                    <span style={{ fontSize: "0.88rem" }}>
                      最终比分 {liveProgress.score_a} : {liveProgress.score_b}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: 32 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <p className="eyebrow" style={{ margin: 0 }}>比赛历史 · {matches.length}场</p>
                {matches.length > 0 && adminToken && (
                  <button
                    onClick={handleClearMatches}
                    style={{ background: "none", border: "1px solid var(--danger, #ff4d6a)", borderRadius: 8, color: "var(--danger, #ff4d6a)", fontSize: "0.76rem", padding: "2px 10px", cursor: "pointer" }}
                  >
                    清空全部
                  </button>
                )}
              </div>
              {(() => {
                const matchTabPage = matchPage;
                const pagedMatches = matches.slice(matchTabPage * MATCH_PAGE_SIZE, (matchTabPage + 1) * MATCH_PAGE_SIZE);
                const totalPages = Math.ceil(matches.length / MATCH_PAGE_SIZE);
                return (<>
              <div style={{ display: "grid", gap: 10 }}>
                {pagedMatches.map((m) => <MatchRow key={m.id} match={m} onDelete={handleDeleteMatch} isAdmin={!!adminToken} />)}
                {matches.length === 0 && <p style={{ color: "var(--muted)" }}>暂无比赛记录</p>}
              </div>
              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 14 }}>
                  <button
                    disabled={matchTabPage === 0}
                    onClick={() => setMatchPage(p => p - 1)}
                    style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: matchTabPage === 0 ? "var(--muted)" : "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", cursor: matchTabPage === 0 ? "default" : "pointer", opacity: matchTabPage === 0 ? 0.4 : 1 }}
                  >
                    上一页
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem", lineHeight: "28px" }}>
                    {matchTabPage + 1} / {totalPages}
                  </span>
                  <button
                    disabled={(matchTabPage + 1) >= totalPages}
                    onClick={() => setMatchPage(p => p + 1)}
                    style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: (matchTabPage + 1) >= totalPages ? "var(--muted)" : "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", cursor: (matchTabPage + 1) >= totalPages ? "default" : "pointer", opacity: (matchTabPage + 1) >= totalPages ? 0.4 : 1 }}
                  >
                    下一页
                  </button>
                </div>
              )}
              </>);
              })()}
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
                      {adminToken && (
                        <button
                          onClick={async () => {
                            if (!confirm(`确认删除 ${b.name}？`)) return;
                            try { await deleteBot(b.id, adminToken || undefined); reload(); } catch (err: any) { alert("删除失败: " + err.message); }
                          }}
                          style={{ background: "none", border: "1px solid var(--danger, #ff4d6a)", borderRadius: 8, color: "var(--danger, #ff4d6a)", fontSize: "0.76rem", padding: "2px 10px", cursor: "pointer" }}
                        >
                          删除
                        </button>
                      )}
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

function MatchRow({ match: m, onDelete, isAdmin }: { match: Match; onDelete: (id: number) => void; isAdmin: boolean }) {
  const [elapsed, setElapsed] = useState("");
  const [progress, setProgress] = useState<{ turn: number; total: number; score_a: number; score_b: number } | null>(null);

  useEffect(() => {
    if (m.status !== "running") return;
    const start = new Date(m.started_at).getTime();
    const tick = () => {
      const s = Math.floor((Date.now() - start) / 1000);
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [m.status, m.started_at]);

  useEffect(() => {
    if (m.status !== "running") return;
    const es = new EventSource(`/api/matches/${m.id}/live`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.done) { es.close(); return; }
        setProgress(data);
      } catch {}
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [m.status, m.id]);

  const statusColor = { done: "var(--alpha)", running: "var(--gold)", error: "var(--danger)", pending: "var(--muted)" }[m.status] ?? "var(--muted)";
  const winnerLabel = m.winner === "Alpha" ? m.bot_a_name : m.winner === "Beta" ? m.bot_b_name : m.status === "done" ? "平局" : "";
  const mapLabel = m.map_path ? m.map_path.replace(/^maps\//, "").replace(/\.json$/, "") : null;
  const latColor = (ms: number | null | undefined) => !ms ? "var(--muted)" : ms < 50 ? "var(--alpha)" : ms < 150 ? "var(--gold)" : "var(--danger)";
  return (
    <div className="event-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ color: "var(--muted)", fontSize: "0.76rem", minWidth: 28 }}>#{m.id}</span>
        <span style={{ color: "var(--alpha)" }}>{m.bot_a_name}</span>
        {m.latency_a != null && <span style={{ fontSize: "0.64rem", color: latColor(m.latency_a) }}>{m.latency_a}ms</span>}
        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>vs</span>
        <span style={{ color: "var(--beta)" }}>{m.bot_b_name}</span>
        {m.latency_b != null && <span style={{ fontSize: "0.64rem", color: latColor(m.latency_b) }}>{m.latency_b}ms</span>}
        {m.score_a != null && !progress && (
          <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{m.score_a} : {m.score_b}</span>
        )}
        {progress && (
          <span style={{ color: "var(--gold)", fontSize: "0.82rem" }}>{progress.score_a} : {progress.score_b}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {mapLabel && <span style={{ fontSize: "0.72rem", color: "var(--muted)", opacity: 0.7 }}>{mapLabel}</span>}
        {winnerLabel && <span style={{ fontSize: "0.8rem", color: "var(--gold)" }}>胜: {winnerLabel}</span>}
        {progress && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 60, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${(progress.turn / progress.total) * 100}%`, height: "100%", background: "var(--gold)", borderRadius: "inherit", transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: "0.68rem", color: "var(--gold)" }}>{progress.turn}/{progress.total}</span>
          </div>
        )}
        <span style={{ fontSize: "0.76rem", color: statusColor, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {m.status}{m.status === "running" && elapsed ? ` ${elapsed}` : ""}
        </span>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>seed={m.seed}</span>
        {m.status === "done" && (
          <a
            href={`/?seed=${m.seed}&botA=${encodeURIComponent(m.bot_a_name)}&botB=${encodeURIComponent(m.bot_b_name)}`}
            style={{ fontSize: "0.76rem", color: "var(--alpha)", textDecoration: "none", border: "1px solid var(--alpha)", borderRadius: 999, padding: "2px 10px" }}
          >
            回放
          </a>
        )}
        {isAdmin && (
          <button
            onClick={() => { if (confirm(`确认删除比赛 #${m.id}？`)) onDelete(m.id); }}
            style={{ background: "none", border: "1px solid var(--danger, #ff4d6a)", borderRadius: 8, color: "var(--danger, #ff4d6a)", fontSize: "0.72rem", padding: "2px 8px", cursor: "pointer" }}
          >
            删除
          </button>
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
