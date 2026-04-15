use std::collections::{HashSet, VecDeque};

use engine_core::{GameConfig, GameState, MapConfig, Position, Team, Tile, generate_map};

#[test]
fn generate_map_is_deterministic_and_symmetric() {
    let config = MapConfig::default();
    let left = generate_map(42, &config);
    let right = generate_map(42, &config);

    assert_eq!(left, right);
    assert_eq!(left.width, 36);
    assert_eq!(left.height, 36);
    assert_eq!(left.spawns[Team::Alpha.index()].len(), 5);
    assert_eq!(left.spawns[Team::Beta.index()].len(), 5);

    for (alpha, beta) in left.spawns[0].iter().zip(left.spawns[1].iter()) {
        assert_eq!(alpha.y, beta.y);
        assert_eq!(alpha.x + beta.x, left.width - 1);
    }
}

#[test]
fn generated_map_has_structured_interior_walls_and_accessible_routes() {
    let map = generate_map(42, &MapConfig::default());

    let interior_wall_count = map
        .tiles
        .iter()
        .enumerate()
        .filter(|(idx, tile)| {
            let x = idx % map.width;
            let y = idx / map.width;
            x > 0 && y > 0 && x < map.width - 1 && y < map.height - 1 && matches!(tile, Tile::Wall)
        })
        .count();

    assert!(
        interior_wall_count >= 420,
        "expected a much tighter machine-room layout with compressed routes"
    );

    assert!(
        map.energy_spawn_points.len() >= 140,
        "expected controlled-random energy candidates to cover many walkable tiles"
    );

    let conveyor_tiles = map
        .tiles
        .iter()
        .filter(|tile| matches!(tile, Tile::Conveyor(_)))
        .count();
    assert!(
        conveyor_tiles >= 28,
        "expected a denser conveyor network, not just a tiny center strip"
    );

    let walkable_tiles = map
        .tiles
        .iter()
        .filter(|tile| !matches!(tile, Tile::Wall))
        .count();
    assert!(
        walkable_tiles <= 460,
        "expected a more compact map with fewer empty border zones"
    );

    for spawn in &map.spawns[0] {
        let can_reach_energy = map
            .energy_spawn_points
            .iter()
            .any(|target| is_reachable(&map, *spawn, target.position));
        let can_reach_cabinet = map
            .cabinet_positions
            .iter()
            .any(|target| is_reachable(&map, *spawn, *target));

        assert!(can_reach_energy, "spawn should reach an energy room");
        assert!(can_reach_cabinet, "spawn should reach a cabinet zone");
    }

    assert!(
        map.cabinet_positions.len() >= 9,
        "expected more cabinet destinations so the game is not over-centered"
    );

    let far_cabinets = map
        .cabinet_positions
        .iter()
        .filter(|position| {
            position.x <= 8
                || position.x >= map.width - 9
                || position.y <= 8
                || position.y >= map.height - 9
        })
        .count();
    assert!(
        far_cabinets >= 4,
        "expected multiple cabinet positions to live in outer remote zones"
    );

    let spawn_x_span = map
        .energy_spawn_points
        .iter()
        .map(|point| point.position.x)
        .max()
        .unwrap()
        - map
            .energy_spawn_points
            .iter()
            .map(|point| point.position.x)
            .min()
            .unwrap();
    let spawn_y_span = map
        .energy_spawn_points
        .iter()
        .map(|point| point.position.y)
        .max()
        .unwrap()
        - map
            .energy_spawn_points
            .iter()
            .map(|point| point.position.y)
            .min()
            .unwrap();

    assert!(spawn_x_span >= 20, "expected energy candidates to spread across the width");
    assert!(spawn_y_span >= 20, "expected energy candidates to spread across the height");

    let deep_slots = map
        .energy_spawn_points
        .iter()
        .filter(|point| matches!(point.zone, engine_core::SpawnZone::Deep))
        .count();
    assert!(
        deep_slots >= 20,
        "expected many deep-zone candidates so risky areas can keep producing energy"
    );

    for candidate in &map.energy_spawn_points {
        assert!(
            matches!(map.tile_at(candidate.position), Tile::Empty),
            "controlled-random energy candidates should only live on plain walkable tiles"
        );
        assert!(
            !map.spawns[0].contains(&candidate.position) && !map.spawns[1].contains(&candidate.position),
            "energy should not generate directly on robot spawn cells"
        );
        assert!(
            !map.cabinet_positions.contains(&candidate.position),
            "energy should not generate directly on cabinet cells"
        );
    }
}

#[test]
fn initial_energy_positions_change_with_seed_but_stay_controlled() {
    let first = GameState::new(42, GameConfig::default());
    let second = GameState::new(99, GameConfig::default());

    let first_positions = first
        .map
        .tiles
        .iter()
        .enumerate()
        .filter_map(|(idx, tile)| match tile {
            Tile::Energy { .. } => Some(Position {
                x: idx % first.map.width,
                y: idx / first.map.width,
            }),
            _ => None,
        })
        .collect::<HashSet<_>>();
    let second_positions = second
        .map
        .tiles
        .iter()
        .enumerate()
        .filter_map(|(idx, tile)| match tile {
            Tile::Energy { .. } => Some(Position {
                x: idx % second.map.width,
                y: idx / second.map.width,
            }),
            _ => None,
        })
        .collect::<HashSet<_>>();

    assert!(
        !first_positions.is_empty() && !second_positions.is_empty(),
        "initial controlled-random spawning should place at least one energy tile"
    );
    assert_ne!(
        first_positions, second_positions,
        "different seeds should not produce identical initial energy positions"
    );
}

fn is_reachable(map: &engine_core::GeneratedMap, start: Position, goal: Position) -> bool {
    let mut queue = VecDeque::from([start]);
    let mut visited = HashSet::from([start]);

    while let Some(position) = queue.pop_front() {
        if position == goal {
            return true;
        }

        for next in neighbors(map, position) {
            if visited.insert(next) {
                queue.push_back(next);
            }
        }
    }

    false
}

fn neighbors(map: &engine_core::GeneratedMap, position: Position) -> Vec<Position> {
    let mut next = Vec::new();

    if position.x > 0 {
        next.push(Position {
            x: position.x - 1,
            y: position.y,
        });
    }
    if position.x + 1 < map.width {
        next.push(Position {
            x: position.x + 1,
            y: position.y,
        });
    }
    if position.y > 0 {
        next.push(Position {
            x: position.x,
            y: position.y - 1,
        });
    }
    if position.y + 1 < map.height {
        next.push(Position {
            x: position.x,
            y: position.y + 1,
        });
    }

    next.into_iter()
        .filter(|candidate| !matches!(map.tile_at(*candidate), Tile::Wall))
        .collect()
}
