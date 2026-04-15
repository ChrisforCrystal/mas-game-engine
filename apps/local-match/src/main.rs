use std::{env, fs, path::PathBuf};

use engine_core::{CabinetRushBot, GameConfig, GreedyCollectorBot, run_match};
use engine_core::state::GameState;

fn main() {
    let args: Vec<String> = env::args().collect();

    // Usage: local-match [seed] [--map <path>]
    let mut seed = 42u64;
    let mut map_path: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--map" => {
                i += 1;
                map_path = args.get(i).cloned();
            }
            "--list" => {
                list_maps();
                return;
            }
            s => {
                if let Ok(n) = s.parse::<u64>() {
                    seed = n;
                }
            }
        }
        i += 1;
    }

    let config = GameConfig::default();

    let (_, replay, summary) = if let Some(ref path) = map_path {
        let json = fs::read_to_string(path)
            .unwrap_or_else(|e| { eprintln!("Cannot read map file {path}: {e}"); std::process::exit(1); });
        let map_name = extract_map_name(&json);
        println!("Map: {map_name}");
        run_match_with_layout(seed, config, &json, &GreedyCollectorBot, &CabinetRushBot)
    } else {
        run_match(seed, config, &GreedyCollectorBot, &CabinetRushBot)
    };

    let artifacts_dir = PathBuf::from("artifacts/replays");
    fs::create_dir_all(&artifacts_dir).expect("create artifacts directory");
    let replay_path = artifacts_dir.join(format!("match-{seed}.json"));
    fs::write(&replay_path, serde_json::to_vec_pretty(&replay).expect("serialize replay"))
        .expect("write replay");

    println!(
        "seed={} alpha_score={} beta_score={} replay={}",
        summary.seed,
        summary.final_scores[0],
        summary.final_scores[1],
        replay_path.display()
    );
}

fn list_maps() {
    let maps_dir = PathBuf::from("maps");
    if !maps_dir.exists() {
        println!("No maps/ directory found.");
        return;
    }
    let mut entries: Vec<_> = fs::read_dir(&maps_dir)
        .expect("read maps dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.path());
    println!("Available maps:");
    for entry in entries {
        let path = entry.path();
        let json = fs::read_to_string(&path).unwrap_or_default();
        let name = extract_map_name(&json);
        let desc = extract_map_desc(&json);
        println!("  {}  —  {}", path.display(), name);
        if !desc.is_empty() {
            println!("      {desc}");
        }
    }
}

fn extract_map_name(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v["name"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

fn extract_map_desc(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v["description"].as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

fn run_match_with_layout(
    seed: u64,
    config: GameConfig,
    layout_json: &str,
    alpha: &dyn engine_core::BotStrategy,
    beta: &dyn engine_core::BotStrategy,
) -> (engine_core::GameState, engine_core::Replay, engine_core::MatchSummary) {
    use engine_core::{Replay, Team};
    use engine_core::rules::apply_turn;

    let mut state = GameState::new_from_layout(seed, config, layout_json);
    let mut replay = Replay::new(seed, &state);

    while state.turn < state.config.max_turns {
        let alpha_actions = alpha.select_actions(&state, Team::Alpha);
        let beta_actions = beta.select_actions(&state, Team::Beta);
        let frame = apply_turn(&mut state, alpha_actions, beta_actions);
        replay.frames.push(frame);
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

