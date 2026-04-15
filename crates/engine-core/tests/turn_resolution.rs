use engine_core::{
    CabinetConfig, Direction, GameConfig, GameState, MapConfig, Position, RobotAction, Team, Tile,
    apply_turn,
};

#[test]
fn apply_turn_moves_collects_drops_and_conveys() {
    let mut state = GameState::new(
        7,
        GameConfig {
            max_turns: 3,
            map: MapConfig::default(),
            ..GameConfig::default()
        },
    );

    let alpha_id = state.robots_for_team(Team::Alpha).next().unwrap().id;
    let beta_id = state.robots_for_team(Team::Beta).next().unwrap().id;
    let energy_pos = Position { x: 16, y: 16 };
    let cabinet_pos = Position { x: 18, y: 18 };

    *state.map.tile_at_mut(energy_pos) = Tile::Energy {
        value: 80,
        ttl: Some(10),
    };
    *state.map.tile_at_mut(cabinet_pos) = Tile::Cabinet {
        id: 9,
        config: CabinetConfig {
            capacity: 1000,
        },
        occupied_capacity: 0,
    };

    state.robots.iter_mut().find(|r| r.id == alpha_id).unwrap().position = energy_pos;
    state.robots.iter_mut().find(|r| r.id == beta_id).unwrap().position = energy_pos;

    let frame = apply_turn(
        &mut state,
        vec![(alpha_id, RobotAction::Pick)],
        vec![(beta_id, RobotAction::Pick)],
    );

    assert_eq!(frame.turn, 1);
    assert!(frame.events.iter().any(|event| event.robot_id == alpha_id));

    let alpha_robot = state.robots.iter().find(|r| r.id == alpha_id).unwrap();
    assert!(alpha_robot.total_load() > 0);
    assert!(alpha_robot.total_load() <= state.config.robot_capacity);

    state.robots.iter_mut().find(|r| r.id == alpha_id).unwrap().position = cabinet_pos;
    let score_frame = apply_turn(
        &mut state,
        vec![(alpha_id, RobotAction::Drop)],
        vec![(beta_id, RobotAction::Wait)],
    );
    assert!(score_frame.scores[0] > 0);

    let conveyor = state
        .map
        .tiles
        .iter()
        .position(|tile| matches!(tile, Tile::Conveyor(Direction::Down)))
        .unwrap();
    let conveyor_pos = engine_core::Position {
        x: conveyor % state.map.width,
        y: conveyor / state.map.width,
    };
    state.robots.iter_mut().find(|r| r.id == alpha_id).unwrap().position = conveyor_pos;

    let next = apply_turn(
        &mut state,
        vec![(alpha_id, RobotAction::Wait)],
        vec![(beta_id, RobotAction::Wait)],
    );

    assert!(
        next.events
            .iter()
            .any(|event| event.robot_id == alpha_id && event.description.contains("传送带"))
    );
}

#[test]
fn cabinet_blocks_extra_drop_once_capacity_is_full() {
    let mut state = GameState::new(11, GameConfig::default());
    let alpha_id = state.robots_for_team(Team::Alpha).next().unwrap().id;
    let cabinet_pos = Position { x: 18, y: 18 };

    *state.map.tile_at_mut(cabinet_pos) = Tile::Cabinet {
        id: 1,
        config: CabinetConfig {
            capacity: 100,
        },
        occupied_capacity: 90,
    };

    let alpha = state.robots.iter_mut().find(|r| r.id == alpha_id).unwrap();
    alpha.position = cabinet_pos;
    alpha.cargo = 50;

    let frame = apply_turn(
        &mut state,
        vec![(alpha_id, RobotAction::Drop)],
        vec![],
    );

    assert_eq!(frame.scores[0], 10);
    assert_eq!(state.robots.iter().find(|r| r.id == alpha_id).unwrap().cargo, 40);

    let second_drop = apply_turn(&mut state, vec![(alpha_id, RobotAction::Drop)], vec![]);
    assert_eq!(second_drop.scores[0], 10);
    assert_eq!(
        state.robots.iter().find(|r| r.id == alpha_id).unwrap().cargo,
        40,
        "robot should keep all overflow cargo once the cabinet is full"
    );

    match state.map.tile_at(cabinet_pos) {
        Tile::Cabinet {
            occupied_capacity, ..
        } => assert_eq!(
            *occupied_capacity, 100,
            "cabinet should stay capped once full"
        ),
        _ => panic!("expected cabinet tile"),
    }
}

#[test]
fn seeded_energy_respects_global_capacity_budget() {
    let state = GameState::new(19, GameConfig::default());
    let total_capacity = state
        .map
        .tiles
        .iter()
        .filter_map(|tile| match tile {
            Tile::Cabinet { config, .. } => Some(config.capacity),
            _ => None,
        })
        .sum::<u32>();

    assert!(
        state.energy_budget_remaining <= total_capacity,
        "energy budget should never exceed the total map cabinet capacity"
    );
}

#[test]
fn conveyors_advance_a_chain_when_front_robot_vacates() {
    let mut state = GameState::new(23, GameConfig::default());
    let alpha_ids = state
        .robots_for_team(Team::Alpha)
        .map(|robot| robot.id)
        .take(2)
        .collect::<Vec<_>>();

    let tail = Position { x: 10, y: 10 };
    let head = Position { x: 11, y: 10 };
    let exit = Position { x: 12, y: 10 };

    *state.map.tile_at_mut(tail) = Tile::Conveyor(Direction::Right);
    *state.map.tile_at_mut(head) = Tile::Conveyor(Direction::Right);
    *state.map.tile_at_mut(exit) = Tile::Empty;

    state
        .robots
        .iter_mut()
        .find(|robot| robot.id == alpha_ids[0])
        .unwrap()
        .position = tail;
    state
        .robots
        .iter_mut()
        .find(|robot| robot.id == alpha_ids[1])
        .unwrap()
        .position = head;

    apply_turn(
        &mut state,
        vec![
            (alpha_ids[0], RobotAction::Wait),
            (alpha_ids[1], RobotAction::Wait),
        ],
        vec![],
    );

    let tail_robot = state.robots.iter().find(|robot| robot.id == alpha_ids[0]).unwrap();
    let head_robot = state.robots.iter().find(|robot| robot.id == alpha_ids[1]).unwrap();

    assert_eq!(tail_robot.position, head);
    assert_eq!(head_robot.position, exit);
}

#[test]
fn conveyor_blocked_by_wall_leaves_robot_on_belt_until_manual_exit() {
    let mut state = GameState::new(29, GameConfig::default());
    let alpha_id = state.robots_for_team(Team::Alpha).next().unwrap().id;
    let conveyor_pos = Position { x: 8, y: 8 };
    let blocked_ahead = Position { x: 9, y: 8 };
    let manual_exit = Position { x: 8, y: 7 };

    *state.map.tile_at_mut(conveyor_pos) = Tile::Conveyor(Direction::Right);
    *state.map.tile_at_mut(blocked_ahead) = Tile::Wall;
    *state.map.tile_at_mut(manual_exit) = Tile::Empty;
    state
        .robots
        .iter_mut()
        .find(|robot| robot.id == alpha_id)
        .unwrap()
        .position = conveyor_pos;

    apply_turn(&mut state, vec![(alpha_id, RobotAction::Wait)], vec![]);
    assert_eq!(
        state.robots.iter().find(|robot| robot.id == alpha_id).unwrap().position,
        conveyor_pos,
        "wall ahead should block auto push without freezing the robot permanently"
    );

    apply_turn(
        &mut state,
        vec![(alpha_id, RobotAction::Move(Direction::Up))],
        vec![],
    );
    assert_eq!(
        state.robots.iter().find(|robot| robot.id == alpha_id).unwrap().position,
        manual_exit,
        "robot should still be able to step off the conveyor manually"
    );
}

#[test]
fn move_phase_allows_following_into_a_cell_that_is_being_vacated() {
    let mut state = GameState::new(31, GameConfig::default());
    let alpha_ids = state
        .robots_for_team(Team::Alpha)
        .map(|robot| robot.id)
        .take(2)
        .collect::<Vec<_>>();

    let tail = Position { x: 10, y: 15 };
    let head = Position { x: 11, y: 15 };
    let exit = Position { x: 12, y: 15 };

    *state.map.tile_at_mut(tail) = Tile::Empty;
    *state.map.tile_at_mut(head) = Tile::Empty;
    *state.map.tile_at_mut(exit) = Tile::Empty;

    state
        .robots
        .iter_mut()
        .find(|robot| robot.id == alpha_ids[0])
        .unwrap()
        .position = tail;
    state
        .robots
        .iter_mut()
        .find(|robot| robot.id == alpha_ids[1])
        .unwrap()
        .position = head;

    apply_turn(
        &mut state,
        vec![
            (alpha_ids[0], RobotAction::Move(Direction::Right)),
            (alpha_ids[1], RobotAction::Move(Direction::Right)),
        ],
        vec![],
    );

    let tail_robot = state.robots.iter().find(|robot| robot.id == alpha_ids[0]).unwrap();
    let head_robot = state.robots.iter().find(|robot| robot.id == alpha_ids[1]).unwrap();

    assert_eq!(tail_robot.position, head);
    assert_eq!(head_robot.position, exit);
}
