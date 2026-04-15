use crate::{
    map::{GeneratedMap, MapConfig, generate_map, load_map_from_json},
    replay::Replay,
    rules::{apply_turn, seed_energy_drops},
    types::{Position, Team},
};

#[derive(Debug, Clone)]
pub struct GameConfig {
    pub max_turns: u32,
    pub map: MapConfig,
    pub robot_capacity: u32,
    pub energy_spawn_interval: u32,
    pub energy_spawn_batch: usize,
    pub initial_energy_spawn: usize,
    pub energy_budget_ratio_percent: u32,
}

impl Default for GameConfig {
    fn default() -> Self {
        Self {
            max_turns: 500,
            map: MapConfig::default(),
            robot_capacity: 150,
            energy_spawn_interval: 10,
            energy_spawn_batch: 3,
            initial_energy_spawn: 8,
            energy_budget_ratio_percent: 80,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RobotState {
    pub id: u8,
    pub team: Team,
    pub position: Position,
    pub cargo: u32,
    pub jam_cooldown: u8,
    pub jammed_turns: u8,
}

impl RobotState {
    pub fn total_load(&self) -> u32 {
        self.cargo
    }

    pub fn add_energy(&mut self, amount: u32) {
        self.cargo += amount;
    }

    pub fn clear_load(&mut self) {
        self.cargo = 0;
    }

    pub fn remove_energy(&mut self, amount: u32) {
        self.cargo = self.cargo.saturating_sub(amount);
    }
}

#[derive(Debug, Clone)]
pub struct GameState {
    pub seed: u64,
    pub config: GameConfig,
    pub turn: u32,
    pub map: GeneratedMap,
    pub robots: Vec<RobotState>,
    pub scores: [u32; 2],
    pub energy_budget_remaining: u32,
}

impl GameState {
    pub fn new(seed: u64, config: GameConfig) -> Self {
        let map = generate_map(seed, &config.map);
        Self::new_with_map(seed, config, map)
    }

    pub fn new_from_layout(seed: u64, config: GameConfig, layout_json: &str) -> Self {
        let map = load_map_from_json(layout_json).expect("invalid map layout JSON");
        Self::new_with_map(seed, config, map)
    }

    fn new_with_map(seed: u64, config: GameConfig, map: GeneratedMap) -> Self {
        let mut robots = Vec::new();
        let mut next_id = 0u8;
        for (team_index, team) in [Team::Alpha, Team::Beta].into_iter().enumerate() {
            for spawn in &map.spawns[team_index] {
                robots.push(RobotState {
                    id: next_id,
                    team,
                    position: *spawn,
                    cargo: 0,
                    jam_cooldown: 0,
                    jammed_turns: 0,
                });
                next_id += 1;
            }
        }
        let mut state = Self {
            seed,
            config,
            turn: 0,
            map,
            robots,
            scores: [0, 0],
            energy_budget_remaining: 0,
        };
        let total_capacity = state
            .map
            .tiles
            .iter()
            .filter_map(|tile| match tile {
                crate::types::Tile::Cabinet { config, .. } => Some(config.capacity),
                _ => None,
            })
            .sum::<u32>();
        state.energy_budget_remaining =
            total_capacity.saturating_mul(state.config.energy_budget_ratio_percent) / 100;
        let initial = state.config.initial_energy_spawn;
        seed_energy_drops(&mut state, initial, 0);
        state
    }

    pub fn robots_for_team(&self, team: Team) -> impl Iterator<Item = &RobotState> {
        self.robots.iter().filter(move |robot| robot.team == team)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MatchSummary {
    pub seed: u64,
    pub final_scores: [u32; 2],
    pub winner: Option<Team>,
}

pub fn run_match(
    seed: u64,
    config: GameConfig,
    alpha: &dyn crate::bots::BotStrategy,
    beta: &dyn crate::bots::BotStrategy,
) -> (GameState, Replay, MatchSummary) {
    let mut state = GameState::new(seed, config);
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

    let summary = MatchSummary {
        seed,
        final_scores: state.scores,
        winner,
    };
    replay.summary = Some(summary.clone());

    (state, replay, summary)
}
