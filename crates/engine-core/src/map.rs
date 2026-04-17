use std::collections::HashMap;

use rand::Rng;
use rand::SeedableRng;
use serde::Deserialize;

use crate::types::{CabinetConfig, Direction, Position, Tile};

// ── Public config types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MapConfig {
    pub width: usize,
    pub height: usize,
    pub robots_per_team: usize,
}

impl Default for MapConfig {
    fn default() -> Self {
        Self { width: 36, height: 36, robots_per_team: 5 }
    }
}

// ── Map layout JSON schema ────────────────────────────────────────────────────

/// Deserializable map definition loaded from a JSON file.
///
/// Symbol legend (one char per cell):
///   `#`  Wall
///   `.`  Empty
///   `>`  Conveyor → Right
///   `<`  Conveyor → Left
///   `^`  Conveyor → Up
///   `v`  Conveyor → Down
///   `A`  Alpha spawn
///   `B`  Beta spawn
///   `0`–`9`  Cabinet with that id
#[derive(Debug, Clone, Deserialize)]
pub struct MapLayout {
    pub name: String,
    /// Each string is one row, top to bottom. All rows must have equal length.
    pub layout: Vec<String>,
    /// Cabinet id (as string key) → capacity
    pub cabinets: HashMap<String, u32>,
    /// Optional explicit zone overrides. If absent, zones are auto-classified.
    #[serde(default)]
    pub energy_zones: EnergyZoneOverride,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct EnergyZoneOverride {
    #[serde(default)]
    pub main: Vec<[usize; 2]>,
    #[serde(default)]
    pub side: Vec<[usize; 2]>,
    #[serde(default)]
    pub deep: Vec<[usize; 2]>,
}

// ── Output types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedMap {
    pub width: usize,
    pub height: usize,
    pub tiles: Vec<Tile>,
    pub spawns: [Vec<Position>; 2],
    pub energy_spawn_points: Vec<EnergySpawnPoint>,
    pub cabinet_positions: Vec<Position>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpawnZone {
    Main,
    Side,
    Deep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnergySpawnPoint {
    pub position: Position,
    pub zone: SpawnZone,
}

impl GeneratedMap {
    pub fn tile_at(&self, position: Position) -> &Tile {
        &self.tiles[position.y * self.width + position.x]
    }

    pub fn tile_at_mut(&mut self, position: Position) -> &mut Tile {
        &mut self.tiles[position.y * self.width + position.x]
    }
}

// ── Layout parser ─────────────────────────────────────────────────────────────

pub fn parse_layout(layout: &MapLayout) -> GeneratedMap {
    let height = layout.layout.len();
    let width = layout.layout.first().map(|r| r.len()).unwrap_or(0);

    let mut tiles = vec![Tile::Wall; width * height];
    let mut alpha_spawns: Vec<Position> = Vec::new();
    let mut beta_spawns: Vec<Position> = Vec::new();
    let mut cabinet_positions: Vec<Position> = Vec::new();

    // Track cabinet order for id assignment (by first appearance, top-left)
    let mut cabinet_id_map: HashMap<char, u8> = HashMap::new();
    let mut next_cabinet_id: u8 = 0;

    for (y, row) in layout.layout.iter().enumerate() {
        for (x, ch) in row.chars().enumerate() {
            let pos = Position { x, y };
            let idx = y * width + x;
            tiles[idx] = match ch {
                '#' => Tile::Wall,
                '.' => Tile::Empty,
                '>' => Tile::Conveyor(Direction::Right),
                '<' => Tile::Conveyor(Direction::Left),
                '^' => Tile::Conveyor(Direction::Up),
                'v' => Tile::Conveyor(Direction::Down),
                'A' => {
                    alpha_spawns.push(pos);
                    Tile::Empty
                }
                'B' => {
                    beta_spawns.push(pos);
                    Tile::Empty
                }
                c if c.is_ascii_digit() => {
                    let id = *cabinet_id_map.entry(c).or_insert_with(|| {
                        let id = next_cabinet_id;
                        next_cabinet_id += 1;
                        id
                    });
                    let capacity = layout
                        .cabinets
                        .get(&c.to_string())
                        .copied()
                        .unwrap_or(800);
                    cabinet_positions.push(pos);
                    Tile::Cabinet { id, config: CabinetConfig { capacity }, occupied_capacity: 0 }
                }
                _ => Tile::Empty,
            };
        }
    }

    // Build explicit zone override lookup
    let mut zone_override: HashMap<(usize, usize), SpawnZone> = HashMap::new();
    for [x, y] in &layout.energy_zones.main {
        zone_override.insert((*x, *y), SpawnZone::Main);
    }
    for [x, y] in &layout.energy_zones.side {
        zone_override.insert((*x, *y), SpawnZone::Side);
    }
    for [x, y] in &layout.energy_zones.deep {
        zone_override.insert((*x, *y), SpawnZone::Deep);
    }

    // Collect energy spawn points (all Empty tiles that aren't spawn positions)
    let spawn_set: std::collections::HashSet<Position> =
        alpha_spawns.iter().chain(beta_spawns.iter()).copied().collect();

    let mut energy_spawn_points: Vec<EnergySpawnPoint> = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let pos = Position { x, y };
            if spawn_set.contains(&pos) {
                continue;
            }
            if !matches!(tiles[y * width + x], Tile::Empty) {
                continue;
            }
            let zone = zone_override
                .get(&(x, y))
                .copied()
                .unwrap_or_else(|| auto_classify_zone(width, height, pos));
            energy_spawn_points.push(EnergySpawnPoint { position: pos, zone });
        }
    }

    GeneratedMap {
        width,
        height,
        tiles,
        spawns: [alpha_spawns, beta_spawns],
        energy_spawn_points,
        cabinet_positions,
    }
}

// ── Seeded procedural generator ─────────────────────────────────────────────

pub fn generate_map(seed: u64, config: &MapConfig) -> GeneratedMap {
    let layout = seeded_layout(seed, config);
    parse_layout(&layout)
}

fn seeded_layout(seed: u64, config: &MapConfig) -> MapLayout {
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let w = config.width;
    let h = config.height;
    let cx = w / 2;
    let cy = h / 2;

    let mut grid: Vec<Vec<char>> = vec![vec!['#'; w]; h];

    // ── helper closures ──
    let carve_rect = |grid: &mut Vec<Vec<char>>, x0: usize, y0: usize, x1: usize, y1: usize| {
        for y in y0..=y1.min(h - 1) {
            for x in x0..=x1.min(w - 1) {
                grid[y][x] = '.';
            }
        }
    };

    // ── 1. Central arena (always present, slightly randomized size) ──
    let arena_hw = 3 + rng.random_range(0..3usize); // half-width 3..5
    let arena_hh = 3 + rng.random_range(0..3usize); // half-height 3..5
    carve_rect(&mut grid, cx.saturating_sub(arena_hw), cy.saturating_sub(arena_hh),
               (cx + arena_hw).min(w - 2), (cy + arena_hh).min(h - 2));

    // ── 2. Main corridors from spawn to center ──
    // horizontal corridor
    let corr_hh = rng.random_range(1..3usize); // corridor half-height
    carve_rect(&mut grid, 1, cy.saturating_sub(corr_hh), w - 2, cy + corr_hh);

    // vertical corridor (randomized width)
    let corr_hw = rng.random_range(1..3usize);
    carve_rect(&mut grid, cx.saturating_sub(corr_hw), 1, cx + corr_hw, h - 2);

    // ── 3. Random rooms (4-8 rooms, left-right symmetric) ──
    let num_rooms = 4 + rng.random_range(0..5usize);
    for _ in 0..num_rooms {
        let rw = 2 + rng.random_range(0..4usize); // room half-width
        let rh = 2 + rng.random_range(0..4usize); // room half-height
        let rx = 3 + rng.random_range(0..(cx.saturating_sub(rw + 3)).max(1));
        let ry = 3 + rng.random_range(0..(h.saturating_sub(rh * 2 + 6)).max(1));
        // left room
        carve_rect(&mut grid, rx.saturating_sub(rw), ry.saturating_sub(rh),
                   (rx + rw).min(w - 2), (ry + rh).min(h - 2));
        // mirror right room
        let mx = w - 1 - rx;
        carve_rect(&mut grid, mx.saturating_sub(rw), ry.saturating_sub(rh),
                   (mx + rw).min(w - 2), (ry + rh).min(h - 2));
    }

    // ── 4. Random corridors connecting rooms ──
    let num_extra = 2 + rng.random_range(0..4usize);
    for _ in 0..num_extra {
        if rng.random_bool(0.5) {
            // horizontal corridor
            let y = 2 + rng.random_range(0..(h - 4).max(1));
            let x0 = 2 + rng.random_range(0..(w / 3).max(1));
            let x1 = w - 2 - rng.random_range(0..(w / 3).max(1));
            for x in x0..=x1.min(w - 2) {
                if grid[y][x] == '#' { grid[y][x] = '.'; }
            }
        } else {
            // vertical corridor
            let x = 2 + rng.random_range(0..(w - 4).max(1));
            let y0 = 2 + rng.random_range(0..(h / 3).max(1));
            let y1 = h - 2 - rng.random_range(0..(h / 3).max(1));
            for y in y0..=y1.min(h - 2) {
                if grid[y][x] == '#' { grid[y][x] = '.'; }
            }
            // mirror
            let mx = w - 1 - x;
            if mx > 1 && mx < w - 1 {
                for y in y0..=y1.min(h - 2) {
                    if grid[y][mx] == '#' { grid[y][mx] = '.'; }
                }
            }
        }
    }

    // ── 5. Spawns (left side Alpha, right side Beta) ──
    let spawn_y_start = cy.saturating_sub(config.robots_per_team / 2);
    for i in 0..config.robots_per_team {
        let sy = (spawn_y_start + i).min(h - 2);
        grid[sy][2] = 'A';
        grid[sy][w - 3] = 'B';
        // ensure spawn area is open
        grid[sy][1] = '.';
        grid[sy][3] = '.';
        grid[sy][w - 2] = '.';
        grid[sy][w - 4] = '.';
    }

    // ── 6. Conveyors (randomized patterns) ──
    let conveyor_style = rng.random_range(0..4u32);
    match conveyor_style {
        0 => {
            // Cross pattern: vertical center + horizontal arms
            let vlen = 3 + rng.random_range(0..4usize);
            for y in cy.saturating_sub(vlen)..=(cy + vlen).min(h - 2) {
                if grid[y][cx.saturating_sub(1)] == '.' { grid[y][cx.saturating_sub(1)] = 'v'; }
                if grid[y][(cx + 1).min(w - 2)] == '.' { grid[y][(cx + 1).min(w - 2)] = '^'; }
            }
            let hlen = 3 + rng.random_range(0..4usize);
            for x in cx.saturating_sub(hlen)..=cx.saturating_sub(2) {
                if grid[cy.saturating_sub(2)][x] == '.' { grid[cy.saturating_sub(2)][x] = '>'; }
            }
            for x in (cx + 2).min(w - 2)..=(cx + hlen).min(w - 2) {
                if grid[cy.saturating_sub(2)][x] == '.' { grid[cy.saturating_sub(2)][x] = '<'; }
            }
        }
        1 => {
            // Loop pattern: clockwise ring around center
            let r = 3 + rng.random_range(0..3usize);
            let top = cy.saturating_sub(r);
            let bot = (cy + r).min(h - 2);
            let left = cx.saturating_sub(r);
            let right = (cx + r).min(w - 2);
            for x in left..right { if grid[top][x] == '.' { grid[top][x] = '>'; } }
            for y in top..bot { if grid[y][right] == '.' { grid[y][right] = 'v'; } }
            for x in (left + 1)..=right { if grid[bot][x] == '.' { grid[bot][x] = '<'; } }
            for y in (top + 1)..=bot { if grid[y][left] == '.' { grid[y][left] = '^'; } }
        }
        2 => {
            // Highway pattern: two horizontal lanes
            let offset = 3 + rng.random_range(0..4usize);
            let lane_top = cy.saturating_sub(offset);
            let lane_bot = (cy + offset).min(h - 2);
            let x0 = 4 + rng.random_range(0..4usize);
            let x1 = w - 4 - rng.random_range(0..4usize);
            for x in x0..=x1 {
                if grid[lane_top][x] == '.' { grid[lane_top][x] = '>'; }
                if grid[lane_bot][x] == '.' { grid[lane_bot][x] = '<'; }
            }
        }
        _ => {
            // Side channels: vertical conveyors on flanks
            let col_l = 4 + rng.random_range(0..5usize);
            let col_r = w - 1 - col_l;
            let y0 = 4 + rng.random_range(0..4usize);
            let y1 = h - 4 - rng.random_range(0..4usize);
            for y in y0..=y1 {
                if grid[y][col_l] == '.' { grid[y][col_l] = if y < cy { '^' } else { 'v' }; }
                if grid[y][col_r] == '.' { grid[y][col_r] = if y < cy { 'v' } else { '^' }; }
            }
        }
    }

    // ── 7. Cabinets (6-10, placed on empty tiles, symmetric) ──
    let num_cabs = 6 + rng.random_range(0..5usize);
    let capacities = [1600u32, 1400, 1200, 1000, 900, 800, 700, 640, 580, 500];
    let mut cab_count = 0u8;
    let mut cabinets = HashMap::new();

    // center cabinet
    if grid[cy][cx] == '.' {
        grid[cy][cx] = (b'0' + cab_count) as char;
        cabinets.insert(cab_count.to_string(), capacities[cab_count as usize]);
        cab_count += 1;
    }

    // place remaining cabinets in random positions
    let mut attempts = 0;
    while (cab_count as usize) < num_cabs && attempts < 200 {
        attempts += 1;
        let rx = 3 + rng.random_range(0..(cx.saturating_sub(3)).max(1));
        let ry = 3 + rng.random_range(0..(h - 6).max(1));
        if grid[ry][rx] != '.' { continue; }
        let mx = w - 1 - rx;
        if mx == rx || grid[ry][mx] != '.' { continue; }

        // left cabinet
        let ch_l = (b'0' + cab_count) as char;
        if ch_l > 'f' { break; }
        grid[ry][rx] = ch_l;
        cabinets.insert(cab_count.to_string(), capacities.get(cab_count as usize).copied().unwrap_or(500));
        cab_count += 1;

        // right cabinet (mirror)
        let ch_r = (b'0' + cab_count) as char;
        if ch_r > 'f' { break; }
        grid[ry][mx] = ch_r;
        cabinets.insert(cab_count.to_string(), capacities.get(cab_count as usize).copied().unwrap_or(500));
        cab_count += 1;
    }

    let layout_rows: Vec<String> = grid.iter().map(|row| row.iter().collect()).collect();

    MapLayout {
        name: format!("随机地图 (seed={})", seed),
        layout: layout_rows,
        cabinets,
        energy_zones: EnergyZoneOverride::default(),
    }
}

// ── Auto zone classification ──────────────────────────────────────────────────

fn auto_classify_zone(width: usize, height: usize, position: Position) -> SpawnZone {
    let center_x = width / 2;
    let center_y = height / 2;
    if position.x.abs_diff(center_x) <= 3 || position.y.abs_diff(center_y) <= 2 {
        return SpawnZone::Main;
    }
    if position.x <= 8
        || position.x >= width - 9
        || position.y <= 8
        || position.y >= height - 9
    {
        return SpawnZone::Deep;
    }
    SpawnZone::Side
}

// ── Builtin layout 0 (original corridor map, expressed as layout) ─────────────

fn builtin_layout_0(config: &MapConfig) -> MapLayout {
    let w = config.width;
    let h = config.height;
    let cx = w / 2;
    let cy = h / 2;

    let mut grid: Vec<Vec<char>> = vec![vec!['#'; w]; h];

    // carve helpers operating on the grid
    let carve_rect = |grid: &mut Vec<Vec<char>>, x0: usize, y0: usize, x1: usize, y1: usize| {
        for y in y0..=y1 {
            for x in x0..=x1 {
                grid[y][x] = '.';
            }
        }
    };
    let carve_v = |grid: &mut Vec<Vec<char>>, x: usize, y0: usize, y1: usize| {
        for y in y0..=y1 {
            grid[y][x] = '.';
        }
    };
    let carve_h = |grid: &mut Vec<Vec<char>>, y: usize, x0: usize, x1: usize| {
        for x in x0..=x1 {
            grid[y][x] = '.';
        }
    };

    carve_rect(&mut grid, 1, cy - 3, 3, cy + 3);
    carve_rect(&mut grid, w - 4, cy - 3, w - 2, cy + 3);
    carve_rect(&mut grid, cx - 4, cy - 5, cx + 4, cy + 5);
    carve_rect(&mut grid, cx - 8, cy - 1, cx + 8, cy + 1);
    carve_rect(&mut grid, cx - 7, cy - 4, cx + 7, cy - 3);
    carve_rect(&mut grid, cx - 7, cy + 3, cx + 7, cy + 4);
    carve_rect(&mut grid, 3, cy - 1, cx - 9, cy + 1);
    carve_rect(&mut grid, cx + 9, cy - 1, w - 4, cy + 1);
    carve_rect(&mut grid, cx - 11, cy - 5, cx - 9, cy - 3);
    carve_rect(&mut grid, cx + 9, cy - 5, cx + 11, cy - 3);
    carve_rect(&mut grid, cx - 11, cy + 3, cx - 9, cy + 5);
    carve_rect(&mut grid, cx + 9, cy + 3, cx + 11, cy + 5);
    carve_rect(&mut grid, 4, 4, 9, 8);
    carve_rect(&mut grid, 4, h - 9, 9, h - 5);
    carve_rect(&mut grid, w - 10, 4, w - 5, 8);
    carve_rect(&mut grid, w - 10, h - 9, w - 5, h - 5);
    carve_v(&mut grid, 8, 9, cy - 4);
    carve_v(&mut grid, w - 1 - 8, 9, cy - 4);
    carve_v(&mut grid, 8, cy + 4, h - 10);
    carve_v(&mut grid, w - 1 - 8, cy + 4, h - 10);
    carve_rect(&mut grid, 4, cy - 1, 6, cy + 1);
    carve_rect(&mut grid, w - 7, cy - 1, w - 5, cy + 1);
    carve_rect(&mut grid, 4, cy - 7, 6, cy - 5);
    carve_rect(&mut grid, w - 7, cy - 7, w - 5, cy - 5);
    carve_rect(&mut grid, 4, cy + 5, 6, cy + 7);
    carve_rect(&mut grid, w - 7, cy + 5, w - 5, cy + 7);
    carve_h(&mut grid, cy - 4, cx - 8, cx + 8);
    carve_h(&mut grid, cy + 4, cx - 8, cx + 8);

    // Spawns
    let spawn_y_start = h / 2 - 2;
    for i in 0..config.robots_per_team {
        grid[spawn_y_start + i][2] = 'A';
        grid[spawn_y_start + i][w - 3] = 'B';
    }

    // Cabinets
    let cab_defs: &[(usize, usize, char)] = &[
        (cx, cy, '0'),
        (cx - 3, cy - 2, '1'),
        (cx + 3, cy + 2, '2'),
        (6, 6, '3'),
        (w - 7, 6, '4'),
        (6, h - 7, '5'),
        (w - 7, h - 7, '6'),
        (5, cy - 6, '7'),
        (w - 6, cy - 6, '8'),
        (5, cy + 6, '9'),
    ];
    for &(x, y, c) in cab_defs {
        grid[y][x] = c;
    }

    // Conveyors
    for y in (cy - 6)..=(cy + 6) {
        grid[y][cx - 1] = 'v';
        grid[y][cx + 1] = '^';
    }
    for x in (cx - 7)..=(cx - 2) {
        grid[cy - 4][x] = '>';
        grid[cy + 4][x] = '>';
    }
    for x in (cx + 2)..=(cx + 7) {
        grid[cy - 4][x] = '<';
        grid[cy + 4][x] = '<';
    }
    for y in 9..(cy - 4) {
        grid[y][8] = '^';
        grid[y][w - 1 - 8] = '^';
    }
    for y in (cy + 5)..=(h - 10) {
        grid[y][8] = 'v';
        grid[y][w - 1 - 8] = 'v';
    }

    let layout_rows: Vec<String> = grid.iter().map(|row| row.iter().collect()).collect();

    let mut cabinets = HashMap::new();
    let capacities = [1600u32, 1180, 920, 760, 700, 640, 600, 540, 500, 440];
    for (i, cap) in capacities.iter().enumerate() {
        cabinets.insert(i.to_string(), *cap);
    }

    MapLayout {
        name: "标准走廊".to_string(),
        layout: layout_rows,
        cabinets,
        energy_zones: EnergyZoneOverride::default(),
    }
}

// ── Carve helpers (kept for builtin_layout_0 closures above) ─────────────────

pub fn load_map_from_json(json: &str) -> Result<GeneratedMap, serde_json::Error> {
    let layout: MapLayout = serde_json::from_str(json)?;
    Ok(parse_layout(&layout))
}
