import { ReplayBoard } from "@/components/replay-board";
import { loadReplay, listReplays } from "@/lib/replay";
import { fetchMatches, Match } from "@/lib/api";

type Props = { searchParams: Promise<{ seed?: string; botA?: string; botB?: string; page?: string; token?: string; q?: string }> };

export default async function Page({ searchParams }: Props) {
  const { seed, botA, botB, page, token, q } = await searchParams;
  const tokenQs = token ? `?token=${encodeURIComponent(token)}` : "";
  const replays = await listReplays();

  // no seed specified: show replay picker
  if (!seed) {
    let matches: Match[] = [];
    try { matches = await fetchMatches(); } catch { /* ignore */ }
    const matchMap: Record<string, { botA: string; botB: string; id: number; mapPath: string | null }> = {};
    for (const m of matches) {
      matchMap[String(m.seed)] = { botA: m.bot_a_name, botB: m.bot_b_name, id: m.id, mapPath: m.map_path };
    }

    // deduplicate by seed (keep latest replay per seed)
    const seen = new Set<string>();
    const uniqueReplays = replays.filter((r) => {
      const seedNum = r.split("-")[0];
      if (seen.has(seedNum)) return false;
      seen.add(seedNum);
      return true;
    });

    // filter by search query (bot name, map name, seed)
    const query = (q || "").toLowerCase().trim();
    const filteredReplays = query
      ? uniqueReplays.filter((r) => {
          const seedNum = r.split("-")[0];
          const info = matchMap[seedNum];
          if (seedNum.includes(query)) return true;
          if (!info) return false;
          return info.botA.toLowerCase().includes(query)
            || info.botB.toLowerCase().includes(query)
            || (info.mapPath || "").toLowerCase().includes(query);
        })
      : uniqueReplays;

    const PAGE_SIZE = 10;
    const currentPage = Math.max(0, parseInt(page || "0", 10) || 0);
    const totalPages = Math.ceil(filteredReplays.length / PAGE_SIZE);
    const pagedReplays = filteredReplays.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    return (
      <div className="shell">
        <div className="arena-shell frame" style={{ borderRadius: 28, maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <p className="eyebrow">Agent Arena</p>
              <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "2rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                比赛回放
              </h1>
            </div>
            <a href={`/arena${tokenQs}`} className="control-button" style={{ textDecoration: "none", color: "var(--alpha)", borderColor: "var(--alpha)" }}>
              排行榜
            </a>
          </div>
          {/* search box */}
          <form method="GET" action="/" style={{ marginBottom: 16 }}>
            {token && <input type="hidden" name="token" value={token} />}
            <input
              name="q"
              defaultValue={q || ""}
              placeholder="搜索 bot 名称、地图、seed..."
              style={{ width: "100%", background: "rgba(7,18,31,0.9)", border: "1px solid rgba(151,195,255,0.34)", borderRadius: 12, color: "#eff7ff", padding: "10px 14px", outline: "none", fontSize: "0.88rem" }}
            />
          </form>

          {filteredReplays.length === 0 ? (
            <p style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>{query ? `没有匹配「${q}」的回放` : "暂无回放记录，先发起一场比赛"}</p>
          ) : (
            <>
              {query && <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginBottom: 8 }}>找到 {filteredReplays.length} 条匹配结果</p>}
              <div style={{ display: "grid", gap: 10 }}>
                {pagedReplays.map((r) => {
                  const seedNum = r.split("-")[0];
                  const info = matchMap[seedNum];
                  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
                  const href = info
                    ? `/?seed=${seedNum}&botA=${encodeURIComponent(info.botA)}&botB=${encodeURIComponent(info.botB)}${tokenParam}`
                    : `/?seed=${seedNum}${tokenParam}`;
                  return (
                    <a
                      key={r}
                      href={href}
                      className="event-card"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "inherit" }}
                    >
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        {info ? (
                          <>
                            <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>#{info.id}</span>
                            <span style={{ color: "var(--alpha)" }}>{info.botA}</span>
                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>vs</span>
                            <span style={{ color: "var(--beta)" }}>{info.botB}</span>
                            {info.mapPath && (
                              <span style={{ fontSize: "0.72rem", color: "var(--muted)", opacity: 0.7 }}>
                                {info.mapPath.replace(/^maps\//, "").replace(/\.json$/, "")}
                              </span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>seed={seedNum}</span>
                        )}
                      </div>
                      <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>seed={seedNum}</span>
                    </a>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16 }}>
                  {(() => {
                    const extra = [token ? `token=${encodeURIComponent(token)}` : "", q ? `q=${encodeURIComponent(q)}` : ""].filter(Boolean).join("&");
                    const qs = (p: number) => `/?page=${p}${extra ? `&${extra}` : ""}`;
                    return (<>
                      {currentPage > 0 ? (
                        <a href={qs(currentPage - 1)} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", textDecoration: "none" }}>上一页</a>
                      ) : (
                        <span style={{ border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--muted)", fontSize: "0.8rem", padding: "4px 14px", opacity: 0.4 }}>上一页</span>
                      )}
                      <span style={{ color: "var(--muted)", fontSize: "0.8rem", lineHeight: "28px" }}>{currentPage + 1} / {totalPages}</span>
                      {(currentPage + 1) < totalPages ? (
                        <a href={qs(currentPage + 1)} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", textDecoration: "none" }}>下一页</a>
                      ) : (
                        <span style={{ border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--muted)", fontSize: "0.8rem", padding: "4px 14px", opacity: 0.4 }}>下一页</span>
                      )}
                    </>);
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  let replay;
  try {
    replay = await loadReplay(seed);
  } catch {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16 }}>
        <p style={{ color: "var(--muted)", fontSize: "1.1rem" }}>回放文件不存在（seed={seed}）</p>
        <a href={`/${tokenQs}`} style={{ color: "var(--alpha)", fontSize: "0.9rem" }}>← 返回回放列表</a>
      </div>
    );
  }

  // bot names: prefer URL params, fallback to match history
  let botAName: string | undefined = botA;
  let botBName: string | undefined = botB;
  let matchMap: Record<string, { botA: string; botB: string; id: number; mapPath: string | null }> = {};
  try {
    const matches = await fetchMatches();
    for (const m of matches) {
      const key = String(m.seed);
      matchMap[key] = { botA: m.bot_a_name, botB: m.bot_b_name, id: m.id, mapPath: m.map_path };
    }
    if (!botAName || !botBName) {
      const seedNum = Number(seed.split("-")[0]);
      const match = matches.find((m) => m.seed === seedNum);
      if (match) {
        botAName = botAName || match.bot_a_name;
        botBName = botBName || match.bot_b_name;
      }
    }
  } catch { /* ignore */ }

  return <ReplayBoard replay={replay} seed={seed} availableSeeds={replays} botAName={botAName} botBName={botBName} matchMap={matchMap} />;
}
