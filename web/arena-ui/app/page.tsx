import { ReplayBoard } from "@/components/replay-board";
import { loadReplay, listReplays } from "@/lib/replay";
import { fetchMatches, Match } from "@/lib/api";

type Props = { searchParams: Promise<{ seed?: string }> };

export default async function Page({ searchParams }: Props) {
  const { seed } = await searchParams;
  const replays = await listReplays();

  // no seed specified: show replay picker
  if (!seed) {
    let matches: Match[] = [];
    try { matches = await fetchMatches(); } catch { /* ignore */ }
    const matchMap: Record<string, { botA: string; botB: string; id: number }> = {};
    for (const m of matches) {
      matchMap[String(m.seed)] = { botA: m.bot_a_name, botB: m.bot_b_name, id: m.id };
    }

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
            <a href="/arena" className="control-button" style={{ textDecoration: "none", color: "var(--alpha)", borderColor: "var(--alpha)" }}>
              排行榜
            </a>
          </div>
          {replays.length === 0 ? (
            <p style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>暂无回放记录，先发起一场比赛</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {replays.map((r) => {
                const seedNum = r.split("-")[0];
                const info = matchMap[seedNum];
                return (
                  <a
                    key={r}
                    href={`/?seed=${seedNum}`}
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
                        </>
                      ) : (
                        <span>回放 {r}</span>
                      )}
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>seed={seedNum}</span>
                  </a>
                );
              })}
            </div>
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
        <a href="/" style={{ color: "var(--alpha)", fontSize: "0.9rem" }}>← 返回回放列表</a>
      </div>
    );
  }

  // find bot names from match history
  let botAName: string | undefined;
  let botBName: string | undefined;
  let matchMap: Record<string, { botA: string; botB: string; id: number }> = {};
  try {
    const matches = await fetchMatches();
    for (const m of matches) {
      const key = String(m.seed);
      matchMap[key] = { botA: m.bot_a_name, botB: m.bot_b_name, id: m.id };
    }
    const seedNum = Number(seed.split("-")[0]);
    const match = matches.find((m) => m.seed === seedNum);
    if (match) {
      botAName = match.bot_a_name;
      botBName = match.bot_b_name;
    }
  } catch { /* ignore */ }

  return <ReplayBoard replay={replay} seed={seed} availableSeeds={replays} botAName={botAName} botBName={botBName} matchMap={matchMap} />;
}
