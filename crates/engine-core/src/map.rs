use std::collections::HashMap;

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

// ── Legacy procedural generator (kept for compatibility) ──────────────────────

pub fn generate_map(_seed: u64, config: &MapConfig) -> GeneratedMap {
    let layout = builtin_layout_0(config);
    parse_layout(&layout)
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
