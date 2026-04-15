use std::{env, fs, path::PathBuf, time::Duration};

use engine_core::{
    ActRequest, ActResponse, BotStrategy, GameConfig, GameState, InitRequest,
    RobotAction, Team, run_match,
    state::MatchSummary,
};

// ── HttpBot ───────────────────────────────────────────────────────────────────

struct HttpBot {
    base_url: String,
    match_id: String,
    team: Team,
    timeout_ms: u64,
}

impl HttpBot {
    fn new(base_url: &str, match_id: &str, team: Team) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            match_id: match_id.to_string(),
            team,
            timeout_ms: 200,
        }
    }

    fn post<T: serde::Serialize, R: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<R, String> {
        let url = format!("{}{}", self.base_url, path);
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_millis(self.timeout_ms + 50)) // slight buffer over game timeout
            .build();
        agent
            .post(&url)
            .set("Content-Type", "application/json")
            .send_json(body)
            .map_err(|e| format!("POST {path} failed: {e}"))?
            .into_json::<R>()
            .map_err(|e| format!("deserialize {path} response failed: {e}"))
    }

    fn init(&self, state: &GameState) {
        let req = InitRequest::from_state(&self.match_id, state, self.team);
        if let Err(e) = self.post::<_, serde_json::Value>("/init", &req) {
            eprintln!("[{:?}] /init error: {e}", self.team);
        }
    }

    fn finish(&self, summary: &MatchSummary) {
        use engine_core::dto::{FinishRequest, ScoresDto, TeamDto};
        let req = FinishRequest {
            final_scores: ScoresDto {
                alpha: summary.final_scores[0],
                beta: summary.final_scores[1],
            },
            winner: summary.winner.map(|t| match t {
                Team::Alpha => TeamDto::Alpha,
                Team::Beta => TeamDto::Beta,
            }),
            total_turns: 500,
        };
        if let Err(e) = self.post::<_, serde_json::Value>("/finish", &req) {
            eprintln!("[{:?}] /finish error: {e}", self.team);
        }
    }
}

impl BotStrategy for HttpBot {
    fn select_actions(&self, state: &GameState, team: Team) -> Vec<(u8, RobotAction)> {
        let req = ActRequest::from_state(state, vec![]);
        match self.post::<_, ActResponse>("/act", &req) {
            Ok(resp) => resp.parse_actions(team, &state.robots),
            Err(e) => {
                eprintln!("[{team:?}] /act error (defaulting to Wait): {e}");
                state
                    .robots
                    .iter()
                    .filter(|r| r.team == team)
                    .map(|r| (r.id, RobotAction::Wait))
                    .collect()
            }
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: http-match <bot-a-url> <bot-b-url> [seed] [--map <path>]");
        eprintln!("  --list   show available maps");
        std::process::exit(1);
    }

    if args.iter().any(|a| a == "--list") {
        list_maps();
        return;
    }

    let bot_a_url = &args[1];
    let bot_b_url = &args[2];

    let mut seed = 42u64;
    let mut map_path: Option<String> = None;
    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--map" => { i += 1; map_path = args.get(i).cloned(); }
            s => { if let Ok(n) = s.parse::<u64>() { seed = n; } }
        }
        i += 1;
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let match_id = format!("match-{seed}-{ts}");
    let config = GameConfig::default();

    let layout_json: Option<String> = map_path.as_ref().map(|p| {
        let json = fs::read_to_string(p)
            .unwrap_or_else(|e| { eprintln!("Cannot read map file {p}: {e}"); std::process::exit(1); });
        let name = extract_map_name(&json);
        println!("Map: {name}");
        json
    });

    let init_state = match &layout_json {
        Some(json) => GameState::new_from_layout(seed, config.clone(), json),
        None => GameState::new(seed, config.clone()),
    };

    let bot_a = HttpBot::new(bot_a_url, &match_id, Team::Alpha);
    let bot_b = HttpBot::new(bot_b_url, &match_id, Team::Beta);

    println!("Initialising bots...");
    bot_a.init(&init_state);
    bot_b.init(&init_state);

    println!("Starting match  seed={seed}  alpha={bot_a_url}  beta={bot_b_url}");
    let (_, replay, summary) = match &layout_json {
        Some(json) => run_match_with_layout(seed, config, json, &bot_a, &bot_b),
        None => run_match(seed, config, &bot_a, &bot_b),
    };

    println!("Notifying bots of result...");
    bot_a.finish(&summary);
    bot_b.finish(&summary);

    let artifacts_dir = PathBuf::from("artifacts/replays");
    fs::create_dir_all(&artifacts_dir).expect("create artifacts dir");
    let replay_path = artifacts_dir.join(format!("{match_id}.json"));
    fs::write(&replay_path, serde_json::to_vec_pretty(&replay).expect("serialize replay"))
        .expect("write replay");

    let winner = match summary.winner {
        Some(Team::Alpha) => "Alpha",
        Some(Team::Beta) => "Beta",
        None => "Draw",
    };
    println!(
        "Done  winner={winner}  alpha={}  beta={}  replay={}",
        summary.final_scores[0], summary.final_scores[1], replay_path.display()
    );
}

fn list_maps() {
    let maps_dir = PathBuf::from("maps");
    if !maps_dir.exists() { println!("No maps/ directory found."); return; }
    let mut entries: Vec<_> = fs::read_dir(&maps_dir).expect("read maps dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.path());
    println!("Available maps:");
    for entry in entries {
        let path = entry.path();
        let json = fs::read_to_string(&path).unwrap_or_default();
        let name = extract_map_name(&json);
        let desc = serde_json::from_str::<serde_json::Value>(&json).ok()
            .and_then(|v| v["description"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        println!("  {}  —  {}", path.display(), name);
        if !desc.is_empty() { println!("      {desc}"); }
    }
}

fn extract_map_name(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json).ok()
        .and_then(|v| v["name"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

fn run_match_with_layout(
    seed: u64, config: GameConfig, layout_json: &str,
    alpha: &dyn BotStrategy, beta: &dyn BotStrategy,
) -> (GameState, engine_core::Replay, engine_core::MatchSummary) {
    use engine_core::{Replay, Team};
    use engine_core::rules::apply_turn;
    let mut state = GameState::new_from_layout(seed, config, layout_json);
    let mut replay = Replay::new(seed, &state);
    while state.turn < state.config.max_turns {
        let a = alpha.select_actions(&state, Team::Alpha);
        let b = beta.select_actions(&state, Team::Beta);
        replay.frames.push(apply_turn(&mut state, a, b));
    }
    let winner = match state.scores[0].cmp(&state.scores[1]) {
        std::cmp::Ordering::Greater => Some(Team::Alpha),
        std::cmp::Ordering::Less => Some(Team::Beta),
        std::cmp::Ordering::Equal => None,
    };
    let summary = engine_core::MatchSummary { seed, final_scores: state.scores, winner };
    replay.summary = Some(summary.clone());
    (state, replay, summary)
}
