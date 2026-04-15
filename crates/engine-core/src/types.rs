use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Team {
    Alpha,
    Beta,
}

impl Team {
    pub fn index(self) -> usize {
        match self {
            Self::Alpha => 0,
            Self::Beta => 1,
        }
    }

    pub fn opponent(self) -> Self {
        match self {
            Self::Alpha => Self::Beta,
            Self::Beta => Self::Alpha,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Position {
    pub x: usize,
    pub y: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CabinetConfig {
    pub capacity: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Tile {
    Empty,
    Wall,
    Conveyor(Direction),
    Energy {
        value: u32,
        ttl: Option<u8>,
    },
    Cabinet {
        id: u8,
        config: CabinetConfig,
        occupied_capacity: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RobotAction {
    Move(Direction),
    Pick,
    Drop,
    Jam,
    Wait,
}
