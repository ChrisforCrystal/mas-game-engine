use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{
    state::{GameConfig, GameState, RobotState},
    types::{RobotAction, Team, Tile},
};

// ── Tile wire format ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TileDto {
    Empty,
    Wall,
    Conveyor { direction: DirectionDto },
    Energy { value: u32, ttl: Option<u8> },
    Cabinet { id: u8, capacity: u32, occupied_capacity: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DirectionDto {
    Up,
    Down,
    Left,
    Right,
}

impl From<&crate::types::Direction> for DirectionDto {
    fn from(d: &crate::types::Direction) -> Self {
        match d {
            crate::types::Direction::Up => Self::Up,
            crate::types::Direction::Down => Self::Down,
            crate::types::Direction::Left => Self::Left,
            crate::types::Direction::Right => Self::Right,
        }
    }
}

impl From<&Tile> for TileDto {
    fn from(tile: &Tile) -> Self {
        match tile {
            Tile::Empty => Self::Empty,
            Tile::Wall => Self::Wall,
            Tile::Conveyor(d) => Self::Conveyor { direction: d.into() },
            Tile::Energy { value, ttl } => Self::Energy { value: *value, ttl: *ttl },
            Tile::Cabinet { id, config, occupied_capacity } => Self::Cabinet {
                id: *id,
                capacity: config.capacity,
                occupied_capacity: *occupied_capacity,
            },
        }
    }
}

// ── Robot wire format ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotDto {
    pub id: u8,
    pub team: TeamDto,
    pub position: PositionDto,
    pub cargo: u32,
    pub jam_cooldown: u8,
    pub jammed_turns: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TeamDto {
    Alpha,
    Beta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionDto {
    pub x: usize,
    pub y: usize,
}

impl From<&RobotState> for RobotDto {
    fn from(r: &RobotState) -> Self {
        Self {
            id: r.id,
            team: match r.team {
                Team::Alpha => TeamDto::Alpha,
                Team::Beta => TeamDto::Beta,
            },
            position: PositionDto { x: r.position.x, y: r.position.y },
            cargo: r.cargo,
            jam_cooldown: r.jam_cooldown,
            jammed_turns: r.jammed_turns,
        }
    }
}

// ── /init ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDto {
    pub max_turns: u32,
    pub map_width: usize,
    pub map_height: usize,
    pub robot_capacity: u32,
    pub energy_spawn_interval: u32,
    pub energy_spawn_batch: usize,
}

impl From<&GameConfig> for ConfigDto {
    fn from(c: &GameConfig) -> Self {
        Self {
            max_turns: c.max_turns,
            map_width: c.map.width,
            map_height: c.map.height,
            robot_capacity: c.robot_capacity,
            energy_spawn_interval: c.energy_spawn_interval,
            energy_spawn_batch: c.energy_spawn_batch,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitRequest {
    pub match_id: String,
    pub seed: u64,
    pub team: TeamDto,
    pub my_robot_ids: Vec<u8>,
    pub config: ConfigDto,
    pub initial_tiles: Vec<TileDto>,
    pub initial_robots: Vec<RobotDto>,
}

impl InitRequest {
    pub fn from_state(match_id: &str, state: &GameState, team: Team) -> Self {
        let my_robot_ids = state
            .robots
            .iter()
            .filter(|r| r.team == team)
            .map(|r| r.id)
            .collect();
        Self {
            match_id: match_id.to_string(),
            seed: state.seed,
            team: match team {
                Team::Alpha => TeamDto::Alpha,
                Team::Beta => TeamDto::Beta,
            },
            my_robot_ids,
            config: (&state.config).into(),
            initial_tiles: state.map.tiles.iter().map(TileDto::from).collect(),
            initial_robots: state.robots.iter().map(RobotDto::from).collect(),
        }
    }
}

// ── /act ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventDto {
    pub robot_id: u8,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoresDto {
    #[serde(rename = "Alpha")]
    pub alpha: u32,
    #[serde(rename = "Beta")]
    pub beta: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActRequest {
    pub turn: u32,
    pub tiles: Vec<TileDto>,
    pub robots: Vec<RobotDto>,
    pub scores: ScoresDto,
    pub last_events: Vec<EventDto>,
}

impl ActRequest {
    pub fn from_state(state: &GameState, last_events: Vec<EventDto>) -> Self {
        Self {
            turn: state.turn,
            tiles: state.map.tiles.iter().map(TileDto::from).collect(),
            robots: state.robots.iter().map(RobotDto::from).collect(),
            scores: ScoresDto { alpha: state.scores[0], beta: state.scores[1] },
            last_events,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActResponse {
    /// robot_id (as string key) -> action string
    pub actions: HashMap<String, String>,
}

impl ActResponse {
    pub fn parse_actions(&self, team: Team, robots: &[RobotState]) -> Vec<(u8, RobotAction)> {
        robots
            .iter()
            .filter(|r| r.team == team)
            .map(|r| {
                let action = self
                    .actions
                    .get(&r.id.to_string())
                    .and_then(|s| parse_action(s))
                    .unwrap_or(RobotAction::Wait);
                (r.id, action)
            })
            .collect()
    }
}

fn parse_action(s: &str) -> Option<RobotAction> {
    match s {
        "Move(Up)" => Some(RobotAction::Move(crate::types::Direction::Up)),
        "Move(Down)" => Some(RobotAction::Move(crate::types::Direction::Down)),
        "Move(Left)" => Some(RobotAction::Move(crate::types::Direction::Left)),
        "Move(Right)" => Some(RobotAction::Move(crate::types::Direction::Right)),
        "Pick" => Some(RobotAction::Pick),
        "Drop" => Some(RobotAction::Drop),
        "Jam" => Some(RobotAction::Jam),
        "Wait" => Some(RobotAction::Wait),
        _ => None,
    }
}

// ── /finish ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinishRequest {
    pub final_scores: ScoresDto,
    pub winner: Option<TeamDto>,
    pub total_turns: u32,
}
