import { ReplayBoard } from "@/components/replay-board";
import { loadReplay, listReplays } from "@/lib/replay";
import { fetchMatches, Match } from "@/lib/api";

type Props = { searchParams: Promise<{ seed?: string; botA?: string; botB?: string; page?: string; token?: string }> };

export default async function Page({ searchParams }: Props) {
  const { seed, botA, botB, page, token } = await searchParams;
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

    const PAGE_SIZE = 10;
    const currentPage = Math.max(0, parseInt(page || "0", 10) || 0);
    const totalPages = Math.ceil(uniqueReplays.length / PAGE_SIZE);
    const pagedReplays = uniqueReplays.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

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
          {uniqueReplays.length === 0 ? (
            <p style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>暂无回放记录，先发起一场比赛</p>
          ) : (
            <>
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
                  {currentPage > 0 ? (
                    <a href={`/?page=${currentPage - 1}${token ? `&token=${encodeURIComponent(token)}` : ""}`} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", textDecoration: "none" }}>上一页</a>
                  ) : (
                    <span style={{ border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--muted)", fontSize: "0.8rem", padding: "4px 14px", opacity: 0.4 }}>上一页</span>
                  )}
                  <span style={{ color: "var(--muted)", fontSize: "0.8rem", lineHeight: "28px" }}>{currentPage + 1} / {totalPages}</span>
                  {(currentPage + 1) < totalPages ? (
                    <a href={`/?page=${currentPage + 1}${token ? `&token=${encodeURIComponent(token)}` : ""}`} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--alpha)", fontSize: "0.8rem", padding: "4px 14px", textDecoration: "none" }}>下一页</a>
                  ) : (
                    <span style={{ border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--muted)", fontSize: "0.8rem", padding: "4px 14px", opacity: 0.4 }}>下一页</span>
                  )}
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
