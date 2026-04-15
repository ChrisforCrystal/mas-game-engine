use std::collections::{HashMap, HashSet};

use rand::{Rng, SeedableRng, rngs::StdRng, seq::SliceRandom};

use crate::{
    map::SpawnZone,
    replay::{Event, ReplayFrame},
    state::{GameState, RobotState},
    types::{Direction, Position, RobotAction, Tile},
};

pub fn apply_turn(
    state: &mut GameState,
    alpha_actions: Vec<(u8, RobotAction)>,
    beta_actions: Vec<(u8, RobotAction)>,
) -> ReplayFrame {
    let mut actions = alpha_actions;
    actions.extend(beta_actions);
    let action_map = actions.iter().copied().collect::<HashMap<_, _>>();
    let mut events = Vec::new();

    let robots_before = state
        .robots
        .iter()
        .map(|robot| (robot.id, robot.position))
        .collect::<HashMap<_, _>>();
    let occupied_before = robots_before
        .iter()
        .map(|(id, pos)| (*pos, *id))
        .collect::<HashMap<_, _>>();

    let mut move_targets = HashMap::new();
    for robot in &state.robots {
        let action = action_map
            .get(&robot.id)
            .copied()
            .unwrap_or(RobotAction::Wait);
        if let RobotAction::Move(direction) = action {
            let target = step(robot.position, direction);
            move_targets.insert(robot.id, target);
        }
    }

    let mut duplicate_targets = HashSet::new();
    let mut target_counts = HashMap::new();
    for target in move_targets.values() {
        *target_counts.entry(*target).or_insert(0usize) += 1;
    }
    for (target, count) in target_counts {
        if count > 1 {
            duplicate_targets.insert(target);
        }
    }

    for robot in &mut state.robots {
        if let Some(target) = move_targets.get(&robot.id).copied() {
            let current = robot.position;
            let swap = occupied_before
                .get(&target)
                .and_then(|other_id| move_targets.get(other_id).copied())
                == Some(current);
            let occupied_by_static_robot = occupied_before
                .get(&target)
                .is_some_and(|other_id| !move_targets.contains_key(other_id));

            let blocked = duplicate_targets.contains(&target)
                || swap
                || matches!(state.map.tile_at(target), Tile::Wall)
                || occupied_by_static_robot;

            if !blocked {
                robot.position = target;
            }
        }
    }

    for robot in &mut state.robots {
        if robot.jam_cooldown > 0 {
            robot.jam_cooldown -= 1;
        }
        if robot.jammed_turns > 0 {
            robot.jammed_turns -= 1;
        }
    }

    let robot_ids = state.robots.iter().map(|robot| robot.id).collect::<Vec<_>>();

    for robot_id in &robot_ids {
        let snapshot = state
            .robots
            .iter()
            .find(|candidate| candidate.id == *robot_id)
            .expect("robot snapshot exists")
            .clone();
        let action = action_map
            .get(robot_id)
            .copied()
            .unwrap_or(RobotAction::Wait);

        match action {
            RobotAction::Pick if snapshot.jammed_turns == 0 => {
                if let Tile::Energy { value, ttl: _ } = state.map.tile_at_mut(snapshot.position) {
                    if *value > 0 && snapshot.total_load() < state.config.robot_capacity {
                        let free_capacity = state.config.robot_capacity - snapshot.total_load();
                        let picked = (*value).min(free_capacity);
                        *value -= picked;
                        if let Some(robot) = state
                            .robots
                            .iter_mut()
                            .find(|candidate| candidate.id == *robot_id)
                        {
                            robot.add_energy(picked);
                        }
                        events.push(Event {
                            robot_id: *robot_id,
                            description: format!("拾取了 {} 点能量", picked),
                        });

                        if *value == 0 {
                            *state.map.tile_at_mut(snapshot.position) = Tile::Empty;
                        }
                    }
                }
            }
            RobotAction::Drop if snapshot.jammed_turns == 0 => {
                if let Tile::Cabinet {
                    id,
                    config,
                    occupied_capacity,
                } = state.map.tile_at_mut(snapshot.position)
                {
                    let deposit = snapshot
                        .total_load()
                        .min(config.capacity.saturating_sub(*occupied_capacity));
                    if deposit > 0 {
                        state.scores[snapshot.team.index()] += deposit;
                        *occupied_capacity += deposit;
                        if let Some(robot) = state
                            .robots
                            .iter_mut()
                            .find(|candidate| candidate.id == *robot_id)
                        {
                            robot.remove_energy(deposit);
                        }
                        events.push(Event {
                            robot_id: *robot_id,
                            description: format!("向机架 {} 投递了 {} 点能量", id, deposit),
                        });
                    }
                }
            }
            _ => {}
        }
    }

    let jam_targets = robot_ids
        .iter()
        .filter_map(|robot_id| {
            let snapshot = state
                .robots
                .iter()
                .find(|candidate| candidate.id == *robot_id)
                .expect("robot snapshot exists");
            let action = action_map
                .get(robot_id)
                .copied()
                .unwrap_or(RobotAction::Wait);

            if !matches!(action, RobotAction::Jam)
                || snapshot.jam_cooldown > 0
                || snapshot.total_load() >= state.config.robot_capacity
            {
                return None;
            }

            adjacent_enemy(state, snapshot).map(|enemy| (*robot_id, enemy))
        })
        .collect::<Vec<_>>();

    for (source_id, target_id) in jam_targets {
        if let Some(target) = state
            .robots
            .iter_mut()
            .find(|candidate| candidate.id == target_id)
        {
            target.jammed_turns = 1;
        }
        if let Some(source) = state
            .robots
            .iter_mut()
            .find(|candidate| candidate.id == source_id)
        {
            source.jam_cooldown = 5;
        }
        events.push(Event {
            robot_id: source_id,
            description: format!("干扰了机器人 {}", target_id),
        });
    }

    let conveyor_origins = state
        .robots
        .iter()
        .map(|robot| (robot.id, robot.position))
        .collect::<HashMap<_, _>>();
    let occupied_on_conveyors = conveyor_origins
        .iter()
        .map(|(id, pos)| (*pos, *id))
        .collect::<HashMap<_, _>>();
    let conveyor_targets = state
        .robots
        .iter()
        .filter_map(|robot| match state.map.tile_at(robot.position) {
            Tile::Conveyor(direction) => Some((robot.id, step(robot.position, *direction))),
            _ => None,
        })
        .collect::<HashMap<_, _>>();

    let mut duplicate_conveyor_targets = HashSet::new();
    let mut conveyor_target_counts = HashMap::new();
    for target in conveyor_targets.values() {
        *conveyor_target_counts.entry(*target).or_insert(0usize) += 1;
    }
    for (target, count) in conveyor_target_counts {
        if count > 1 {
            duplicate_conveyor_targets.insert(target);
        }
    }

    let conveyor_moves = conveyor_targets
        .iter()
        .filter_map(|(robot_id, target)| {
            let current = *conveyor_origins.get(robot_id)?;
            if duplicate_conveyor_targets.contains(target) || matches!(state.map.tile_at(*target), Tile::Wall) {
                return None;
            }

            if let Some(occupant_id) = occupied_on_conveyors.get(target) {
                let occupant_target = conveyor_targets.get(occupant_id).copied();
                if occupant_target.is_none() || occupant_target == Some(current) {
                    return None;
                }
            }

            Some((*robot_id, *target))
        })
        .collect::<Vec<_>>();

    for (robot_id, target) in conveyor_moves {
        if let Some(robot) = state
            .robots
            .iter_mut()
            .find(|candidate| candidate.id == robot_id)
        {
            robot.position = target;
            events.push(Event {
                robot_id,
                description: "被传送带推送".to_string(),
            });
        }
    }

    tick_energy_tiles(state);

    if (state.turn + 1) % state.config.energy_spawn_interval == 0 {
        seed_energy_drops(state, state.config.energy_spawn_batch, state.turn + 1);
    }

    state.turn += 1;

    ReplayFrame {
        turn: state.turn,
        tiles: state.map.tiles.clone(),
        robots: state.robots.clone(),
        actions,
        scores: state.scores,
        events,
    }
}

pub fn seed_energy_drops(state: &mut GameState, count: usize, turn_marker: u32) {
    let mut rng = StdRng::seed_from_u64(state.seed ^ ((turn_marker as u64 + 1) * 0x9E37_79B9));
    let occupied = state
        .robots
        .iter()
        .map(|robot| robot.position)
        .collect::<HashSet<_>>();

    let mut candidates = state
        .map
        .energy_spawn_points
        .iter()
        .copied()
        .filter(|spawn| {
            matches!(state.map.tile_at(spawn.position), Tile::Empty) && !occupied.contains(&spawn.position)
        })
        .collect::<Vec<_>>();
    candidates.shuffle(&mut rng);

    for spawn in candidates.into_iter().take(count) {
        if state.energy_budget_remaining == 0 {
            break;
        }

        let value = random_energy_value(&mut rng, spawn.zone).min(state.energy_budget_remaining);
        if value == 0 {
            break;
        }
        let ttl = if value >= 70 {
            Some(rng.random_range(10..=18))
        } else {
            None
        };
        *state.map.tile_at_mut(spawn.position) = Tile::Energy { value, ttl };
        state.energy_budget_remaining = state.energy_budget_remaining.saturating_sub(value);
    }
}

fn random_energy_value(rng: &mut StdRng, zone: SpawnZone) -> u32 {
    let roll = rng.random_range(0..100);
    match zone {
        SpawnZone::Main => {
            if roll < 72 {
                rng.random_range(4..=18)
            } else if roll < 94 {
                rng.random_range(19..=34)
            } else {
                rng.random_range(35..=48)
            }
        }
        SpawnZone::Side => {
            if roll < 48 {
                rng.random_range(8..=24)
            } else if roll < 84 {
                rng.random_range(25..=42)
            } else {
                rng.random_range(43..=62)
            }
        }
        SpawnZone::Deep => {
            if roll < 24 {
                rng.random_range(12..=28)
            } else if roll < 66 {
                rng.random_range(29..=54)
            } else {
                rng.random_range(55..=88)
            }
        }
    }
}

fn tick_energy_tiles(state: &mut GameState) {
    for y in 0..state.map.height {
        for x in 0..state.map.width {
            let position = Position { x, y };
            let mut clear_tile = false;
            if let Tile::Energy { value: _, ttl } = state.map.tile_at_mut(position) {
                if let Some(current_ttl) = ttl.as_mut() {
                    if *current_ttl > 0 {
                        *current_ttl -= 1;
                    }
                    if *current_ttl == 0 {
                        clear_tile = true;
                    }
                }
            }
            if clear_tile {
                *state.map.tile_at_mut(position) = Tile::Empty;
            }
        }
    }
}

fn adjacent_enemy(state: &GameState, robot: &RobotState) -> Option<u8> {
    state
        .robots
        .iter()
        .find(|candidate| {
            candidate.team == robot.team.opponent()
                && candidate.position.x.abs_diff(robot.position.x)
                    + candidate.position.y.abs_diff(robot.position.y)
                    == 1
        })
        .map(|robot| robot.id)
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
