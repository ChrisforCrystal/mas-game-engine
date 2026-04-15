use crate::{
    state::{GameState, MatchSummary, RobotState},
    types::{Position, RobotAction, Tile},
};

#[derive(Debug, Clone, serde::Serialize)]
pub struct Event {
    pub robot_id: u8,
    pub description: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReplayFrame {
    pub turn: u32,
    pub tiles: Vec<Tile>,
    pub robots: Vec<RobotState>,
    pub actions: Vec<(u8, RobotAction)>,
    pub scores: [u32; 2],
    pub events: Vec<Event>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Replay {
    pub seed: u64,
    pub width: usize,
    pub height: usize,
    pub tiles: Vec<Tile>,
    pub cabinets: Vec<Position>,
    pub energy_spawns: Vec<Position>,
    pub initial_robots: Vec<RobotState>,
    pub frames: Vec<ReplayFrame>,
    pub summary: Option<MatchSummary>,
}

impl Replay {
    pub fn new(seed: u64, state: &GameState) -> Self {
        Self {
            seed,
            width: state.map.width,
            height: state.map.height,
            tiles: state.map.tiles.clone(),
            cabinets: state.map.cabinet_positions.clone(),
            energy_spawns: state
                .map
                .energy_spawn_points
                .iter()
                .map(|spawn| spawn.position)
                .collect(),
            initial_robots: state.robots.clone(),
            frames: Vec::new(),
            summary: None,
        }
    }
}
