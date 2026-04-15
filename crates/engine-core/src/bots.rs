use std::collections::{HashMap, HashSet, VecDeque};

use crate::{
    state::GameState,
    types::{Direction, Position, RobotAction, Team, Tile},
};

pub trait BotStrategy {
    fn select_actions(&self, state: &GameState, team: Team) -> Vec<(u8, RobotAction)>;
}

pub struct GreedyCollectorBot;

pub struct CabinetRushBot;

impl BotStrategy for GreedyCollectorBot {
    fn select_actions(&self, state: &GameState, team: Team) -> Vec<(u8, RobotAction)> {
        plan_actions(state, team, false)
    }
}

impl BotStrategy for CabinetRushBot {
    fn select_actions(&self, state: &GameState, team: Team) -> Vec<(u8, RobotAction)> {
        plan_actions(state, team, true)
    }
}

fn plan_actions(state: &GameState, team: Team, prefer_high_value: bool) -> Vec<(u8, RobotAction)> {
    let cabinet_targets = state
        .map
        .cabinet_positions
        .iter()
        .copied()
        .filter(|position| {
            matches!(
                state.map.tile_at(*position),
                Tile::Cabinet {
                    config,
                    occupied_capacity,
                    ..
                } if *occupied_capacity < config.capacity
            )
        })
        .collect::<Vec<_>>();
    let cabinet_targets = if cabinet_targets.is_empty() {
        state.map.cabinet_positions.iter().copied().collect::<Vec<_>>()
    } else {
        cabinet_targets
    };
    let energy_targets = state
        .map
        .energy_spawn_points
        .iter()
        .map(|spawn| spawn.position)
        .filter(|position| matches!(state.map.tile_at(*position), Tile::Energy { value, .. } if *value > 0))
        .collect::<Vec<_>>();

    let mut actions = Vec::new();
    let occupied = state
        .robots
        .iter()
        .map(|robot| (robot.position, robot.id))
        .collect::<HashMap<_, _>>();

    for robot in state.robots_for_team(team) {
        let tile = state.map.tile_at(robot.position);
        if let Some(exit_action) = escape_blocked_conveyor(state, robot.id, robot.position, &occupied) {
            actions.push((robot.id, exit_action));
            continue;
        }
        let nearest_cabinet = nearest(robot.position, &cabinet_targets);
        let nearest_cabinet_distance = nearest_cabinet
            .map(|target| manhattan(robot.position, target))
            .unwrap_or(usize::MAX);
        let should_return = if prefer_high_value {
            robot.total_load() >= state.config.robot_capacity / 2
        } else {
            robot.total_load() >= state.config.robot_capacity / 3
        };
        let should_bank_now =
            robot.total_load() > 0
                && (should_return
                    || energy_targets.is_empty()
                    || nearest_cabinet_distance <= 6);

        if should_bank_now {
            if matches!(tile, Tile::Cabinet { .. }) {
                actions.push((robot.id, RobotAction::Drop));
                continue;
            }

            let target = if prefer_high_value {
                nearest_cabinet
                    .or_else(|| cabinet_targets.last().copied())
                    .unwrap_or(robot.position)
            } else {
                nearest_cabinet.unwrap_or(robot.position)
            };
            actions.push((robot.id, move_toward(state, robot.id, robot.position, target, &occupied)));
            continue;
        }

        if matches!(tile, Tile::Energy { value, .. } if *value > 0) {
            actions.push((robot.id, RobotAction::Pick));
            continue;
        }

        let target = best_energy_target(state, robot.position, &energy_targets, prefer_high_value)
            .unwrap_or(robot.position);
        let mut action = move_toward(state, robot.id, robot.position, target, &occupied);
        if matches!(action, RobotAction::Wait) && robot.total_load() > 0 {
            if matches!(tile, Tile::Cabinet { .. }) {
                action = RobotAction::Drop;
            } else if let Some(cabinet) = nearest_cabinet {
                action = move_toward(state, robot.id, robot.position, cabinet, &occupied);
            }
        }
        actions.push((robot.id, action));
    }

    actions
}

fn best_energy_target(
    state: &GameState,
    origin: Position,
    targets: &[Position],
    prefer_high_value: bool,
) -> Option<Position> {
    targets.iter().copied().max_by_key(|position| {
        let value = match state.map.tile_at(*position) {
            Tile::Energy { value, .. } => *value as i32,
            _ => 0,
        };
        let distance = manhattan(origin, *position) as i32;
        if prefer_high_value {
            value * 3 - distance * 2
        } else {
            value * 2 - distance * 3
        }
    })
}

fn nearest(origin: Position, targets: &[Position]) -> Option<Position> {
    targets
        .iter()
        .min_by_key(|position| manhattan(origin, **position))
        .copied()
}

fn manhattan(a: Position, b: Position) -> usize {
    a.x.abs_diff(b.x) + a.y.abs_diff(b.y)
}

fn move_toward(
    state: &GameState,
    robot_id: u8,
    from: Position,
    to: Position,
    occupied: &HashMap<Position, u8>,
) -> RobotAction {
    if from == to {
        return RobotAction::Wait;
    }

    if let Some(direction) = bfs_next_step(state, robot_id, from, to, occupied) {
        return RobotAction::Move(direction);
    }

    RobotAction::Wait
}

fn bfs_next_step(
    state: &GameState,
    robot_id: u8,
    start: Position,
    goal: Position,
    occupied: &HashMap<Position, u8>,
) -> Option<Direction> {
    let mut queue = VecDeque::from([start]);
    let mut visited = HashSet::from([start]);
    let mut previous = HashMap::<Position, Position>::new();

    while let Some(current) = queue.pop_front() {
        if current == goal {
            break;
        }

        for next in candidate_neighbors(state, current) {
            if visited.contains(&next) {
                continue;
            }

            if next != goal && occupied.get(&next).is_some_and(|occupant_id| *occupant_id != robot_id) {
                continue;
            }

            visited.insert(next);
            previous.insert(next, current);
            queue.push_back(next);
        }
    }

    if !visited.contains(&goal) {
        return None;
    }

    let mut cursor = goal;
    while let Some(parent) = previous.get(&cursor).copied() {
        if parent == start {
            return Some(direction_from_to(start, cursor));
        }
        cursor = parent;
    }

    None
}

fn candidate_neighbors(state: &GameState, position: Position) -> Vec<Position> {
    let mut candidates = Vec::with_capacity(4);

    if position.y > 0 {
        candidates.push(Position {
            x: position.x,
            y: position.y - 1,
        });
    }
    if position.x + 1 < state.map.width {
        candidates.push(Position {
            x: position.x + 1,
            y: position.y,
        });
    }
    if position.y + 1 < state.map.height {
        candidates.push(Position {
            x: position.x,
            y: position.y + 1,
        });
    }
    if position.x > 0 {
        candidates.push(Position {
            x: position.x - 1,
            y: position.y,
        });
    }

    candidates
        .into_iter()
        .filter(|candidate| !matches!(state.map.tile_at(*candidate), Tile::Wall))
        .collect()
}

fn direction_from_to(from: Position, to: Position) -> Direction {
    if to.x > from.x {
        Direction::Right
    } else if to.x < from.x {
        Direction::Left
    } else if to.y > from.y {
        Direction::Down
    } else {
        Direction::Up
    }
}

fn escape_blocked_conveyor(
    state: &GameState,
    robot_id: u8,
    position: Position,
    occupied: &HashMap<Position, u8>,
) -> Option<RobotAction> {
    let direction = match state.map.tile_at(position) {
        Tile::Conveyor(direction) => *direction,
        _ => return None,
    };

    let forward = step(position, direction);
    let forward_blocked = matches!(state.map.tile_at(forward), Tile::Wall)
        || occupied
            .get(&forward)
            .is_some_and(|occupant_id| *occupant_id != robot_id);

    if !forward_blocked {
        return None;
    }

    let escape_directions = match direction {
        Direction::Up | Direction::Down => [Direction::Left, Direction::Right],
        Direction::Left | Direction::Right => [Direction::Up, Direction::Down],
    };

    for escape_direction in escape_directions {
        let target = step(position, escape_direction);
        if matches!(state.map.tile_at(target), Tile::Wall) {
            continue;
        }
        if occupied
            .get(&target)
            .is_some_and(|occupant_id| *occupant_id != robot_id)
        {
            continue;
        }
        return Some(RobotAction::Move(escape_direction));
    }

    None
}

fn step(position: Position, direction: Direction) -> Position {
    match direction {
        Direction::Up => Position {
            x: position.x,
            y: position.y.saturating_sub(1),
        },
        Direction::Down => Position {
            x: position.x,
            y: position.y + 1,
        },
        Direction::Left => Position {
            x: position.x.saturating_sub(1),
            y: position.y,
        },
        Direction::Right => Position {
            x: position.x + 1,
            y: position.y,
        },
    }
}
