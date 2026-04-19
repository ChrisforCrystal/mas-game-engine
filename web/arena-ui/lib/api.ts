function getApiBase() {
  // SSR: use absolute URL; browser: use relative path
  if (typeof window === "undefined") {
    return `http://localhost:${process.env.PORT || 3000}/api`;
  }
  return "/api";
}

const API = getApiBase();

export type Bot = {
  id: number;
  name: string;
  url: string;
  owner: string;
  created_at: string;
};

export type Match = {
  id: number;
  bot_a_id: number;
  bot_b_id: number;
  bot_a_name: string;
  bot_b_name: string;
  seed: number;
  map_path: string | null;
  status: "pending" | "running" | "done" | "error" | "queued";
  winner: "Alpha" | "Beta" | null;
  score_a: number | null;
  score_b: number | null;
  replay_path: string | null;
  latency_a: number | null;
  latency_b: number | null;
  slow_turns: number | null;
  started_at: string;
  finished_at: string | null;
};

export type Ranking = {
  bot_id: number;
  bot_name: string;
  owner: string;
  wins: number;
  losses: number;
  draws: number;
  total: number;
  win_rate: number;
  avg_score: number;
  rating: number;
};

export type MapInfo = {
  id: number;
  path: string;
  name: string;
  description: string;
};

export async function fetchMaps(): Promise<MapInfo[]> {
  const res = await fetch(`${API}/maps`, { cache: "no-store" });
  return res.json();
}

export type MapDetail = {
  name: string;
  description: string;
  layout: string[];
  cabinets: Record<string, number>;
};

export async function fetchMapDetail(id: number): Promise<MapDetail> {
  const res = await fetch(`${API}/maps/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error("map not found");
  return res.json();
}

export async function createMap(data: { name: string; description: string; layout: string[]; cabinets: Record<string, number> }) {
  const res = await fetch(`${API}/maps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    try { throw new Error(JSON.parse(body).error || body); } catch (e) { if (e instanceof Error && e.message !== body) throw e; throw new Error(body); }
  }
  return res.json();
}

export async function updateMap(id: number, data: { name: string; description: string; layout: string[]; cabinets: Record<string, number> }) {
  const res = await fetch(`${API}/maps/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    try { throw new Error(JSON.parse(body).error || body); } catch (e) { if (e instanceof Error && e.message !== body) throw e; throw new Error(body); }
  }
  return res.json();
}

export async function deleteMap(id: number) {
  const res = await fetch(`${API}/maps/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchBots(): Promise<Bot[]> {
  const res = await fetch(`${API}/bots`, { cache: "no-store" });
  return res.json();
}

export async function fetchMatches(): Promise<Match[]> {
  const res = await fetch(`${API}/matches`, { cache: "no-store" });
  return res.json();
}

export async function fetchRankings(): Promise<Ranking[]> {
  const res = await fetch(`${API}/rankings`, { cache: "no-store" });
  return res.json();
}

export async function updateBot(id: number, data: { name?: string; url?: string; owner?: string }) {
  const res = await fetch(`${API}/bots/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteBot(id: number, token?: string) {
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const res = await fetch(`${API}/bots/${id}${q}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function registerBot(name: string, url: string, owner: string) {
  const res = await fetch(`${API}/bots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, url, owner }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMatch(id: number, token?: string) {
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const res = await fetch(`${API}/matches/${id}${q}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function clearMatches(token?: string) {
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const res = await fetch(`${API}/matches${q}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type BotStats = {
  bot_id: number;
  bot_name: string;
  owner: string;
  recent: { id: number; opponent: string; my_score: number; opp_score: number; won: boolean; draw: boolean; map_path: string | null; seed: number }[];
  map_stats: { map_path: string; wins: number; losses: number; draws: number; total: number; win_rate: number; avg_score: number }[];
  opp_stats: { opponent: string; wins: number; losses: number; draws: number; total: number; win_rate: number }[];
  trend: { match_id: number; score: number; won: boolean }[];
};

export type BotHealth = {
  online: boolean;
  latency_ms: number;
  checked_at: string;
};

export async function fetchBotHealth(): Promise<Record<string, BotHealth>> {
  const res = await fetch(`${API}/bots/health`, { cache: "no-store" });
  return res.json();
}

export async function fetchBotStats(botId: number): Promise<BotStats> {
  const res = await fetch(`${API}/bots/${botId}/stats`, { cache: "no-store" });
  if (!res.ok) throw new Error("bot not found");
  return res.json();
}

export async function startMatch(botAId: number, botBId: number, seed?: number, mapId?: number) {
  const res = await fetch(`${API}/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_a_id: botAId, bot_b_id: botBId, seed: seed ?? 0, map_id: mapId ?? 0 }),
  });
  if (!res.ok) {
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      throw new Error(json.error || body);
    } catch (e) {
      if (e instanceof Error && e.message !== body) throw e;
      throw new Error(body);
    }
  }
  return res.json();
}
