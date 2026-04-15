const API = "/api";

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
  status: "pending" | "running" | "done" | "error";
  winner: "Alpha" | "Beta" | null;
  score_a: number | null;
  score_b: number | null;
  replay_path: string | null;
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
};

export type MapInfo = {
  path: string;
  name: string;
  description: string;
};

export async function fetchMaps(): Promise<MapInfo[]> {
  const res = await fetch(`${API}/maps`, { cache: "no-store" });
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

export async function deleteBot(id: number) {
  const res = await fetch(`${API}/bots/${id}`, { method: "DELETE" });
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

export async function deleteMatch(id: number) {
  const res = await fetch(`${API}/matches/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function clearMatches() {
  const res = await fetch(`${API}/matches`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startMatch(botAId: number, botBId: number, seed?: number, mapPath?: string) {
  const res = await fetch(`${API}/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_a_id: botAId, bot_b_id: botBId, seed: seed ?? 0, map_path: mapPath ?? "" }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
