
export type Team = "Alpha" | "Beta";

export type Direction = "Up" | "Down" | "Left" | "Right";

export type Tile =
  | "Empty"
  | "Wall"
  | { Conveyor: Direction }
  | { Energy: { value: number; ttl: number | null } }
  | {
      Cabinet: {
        id: number;
        config: {
          capacity: number;
        };
        occupied_capacity: number;
      };
    };

export type RobotAction =
  | "Pick"
  | "Drop"
  | "Jam"
  | "Wait"
  | { Move: Direction };

export type Position = { x: number; y: number };

export type RobotState = {
  id: number;
  team: Team;
  position: Position;
  cargo: number;
  jam_cooldown: number;
  jammed_turns: number;
};

export type ReplayEvent = {
  robot_id: number;
  description: string;
};

export type ReplayFrame = {
  turn: number;
  tiles: Tile[];
  robots: RobotState[];
  actions: [number, RobotAction][];
  scores: [number, number];
  events: ReplayEvent[];
};

export type ReplayData = {
  seed: number;
  width: number;
  height: number;
  tiles: Tile[];
  cabinets: Position[];
  energy_spawns: Position[];
  initial_robots: RobotState[];
  frames: ReplayFrame[];
  summary: {
    seed: number;
    final_scores: [number, number];
    winner: Team | null;
  } | null;
};

export async function loadReplay(seed: string = "42"): Promise<ReplayData> {
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");

  // NAS path (container) or local dev fallback
  const candidates_dirs = [
    "/app/data/artifacts/replays",
    "/app/nas/artifacts/replays",
    path.resolve(process.cwd(), "..", "..", "artifacts", "replays"),
    path.resolve(process.cwd(), "artifacts", "replays"),
  ];

  for (const replaysDir of candidates_dirs) {
    const candidates = [
      path.join(replaysDir, `match-${seed}.json`),
    ];
    try {
      const files = await readdir(replaysDir);
      const matching = files
        .filter((f) => f.startsWith(`match-${seed}`) && f.endsWith(".json"))
        .sort()
        .reverse();
      if (matching.length > 0) {
        candidates.unshift(path.join(replaysDir, matching[0]));
      }
    } catch { continue; }

    for (const p of candidates) {
      try {
        const raw = await readFile(p, "utf8");
        return JSON.parse(raw) as ReplayData;
      } catch { /* try next */ }
    }
  }
  throw new Error(`replay not found for seed ${seed}`);
}

export async function listReplays(): Promise<string[]> {
  const path = await import("node:path");
  const candidates_dirs = [
    "/app/data/artifacts/replays",
    "/app/nas/artifacts/replays",
    path.resolve(process.cwd(), "..", "..", "artifacts", "replays"),
    path.resolve(process.cwd(), "artifacts", "replays"),
  ];
  for (const dir of candidates_dirs) {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(dir);
      return files
        .filter((f) => f.startsWith("match-") && f.endsWith(".json"))
        .map((f) => f.replace(/^match-/, "").replace(/\.json$/, ""))
        .sort((a, b) => {
          const tsA = a.includes("-") ? Number(a.split("-").pop()) : Number(a);
          const tsB = b.includes("-") ? Number(b.split("-").pop()) : Number(b);
          return tsB - tsA;
        });
    } catch { continue; }
  }
  return [];
}
