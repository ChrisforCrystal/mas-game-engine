import { ReplayBoard } from "@/components/replay-board";
import { loadReplay, listReplays } from "@/lib/replay";
import { fetchMatches, Match } from "@/lib/api";

type Props = { searchParams: Promise<{ seed?: string }> };

export default async function Page({ searchParams }: Props) {
  const { seed = "42" } = await searchParams;
  const replays = await listReplays();

  let replay;
  try {
    replay = await loadReplay(seed);
  } catch {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16 }}>
        <p style={{ color: "var(--muted)", fontSize: "1.1rem" }}>回放文件不存在（seed={seed}）</p>
        <a href="/arena" style={{ color: "var(--alpha)", fontSize: "0.9rem" }}>← 返回竞技大厅</a>
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
