import type { Tile, Direction } from "@/lib/replay";
import type { MapDetail } from "@/lib/api";

export const TILE_SIZE = 22;
export const CANVAS_SCALE = 2;

/** Parse ASCII layout + cabinets into engine-compatible Tile[] */
export function layoutToTiles(detail: MapDetail): { tiles: Tile[]; width: number; height: number } {
  const rows = detail.layout;
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const tiles: Tile[] = [];

  // build cabinet id map: char -> index
  let cabinetIndex = 0;
  const cabinetIdMap: Record<string, number> = {};
  for (const ch of Object.keys(detail.cabinets).sort()) {
    cabinetIdMap[ch] = cabinetIndex++;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y]?.[x] ?? ".";
      if (ch === "#") {
        tiles.push("Wall");
      } else if (ch === "^") {
        tiles.push({ Conveyor: "Up" as Direction });
      } else if (ch === "v") {
        tiles.push({ Conveyor: "Down" as Direction });
      } else if (ch === "<") {
        tiles.push({ Conveyor: "Left" as Direction });
      } else if (ch === ">") {
        tiles.push({ Conveyor: "Right" as Direction });
      } else if (ch in detail.cabinets) {
        tiles.push({
          Cabinet: {
            id: cabinetIdMap[ch] ?? 0,
            config: { capacity: detail.cabinets[ch] },
            occupied_capacity: 0,
          },
        });
      } else {
        tiles.push("Empty");
      }
    }
  }

  return { tiles, width, height };
}

/** Get spawn positions from layout */
export function getSpawns(detail: MapDetail): { alpha: { x: number; y: number }[]; beta: { x: number; y: number }[] } {
  const alpha: { x: number; y: number }[] = [];
  const beta: { x: number; y: number }[] = [];
  for (let y = 0; y < detail.layout.length; y++) {
    for (let x = 0; x < (detail.layout[y]?.length ?? 0); x++) {
      const ch = detail.layout[y][x];
      if (ch === "A") alpha.push({ x, y });
      if (ch === "B") beta.push({ x, y });
    }
  }
  return { alpha, beta };
}

export function drawTiles(
  context: CanvasRenderingContext2D,
  tiles: Tile[],
  width: number,
  height: number,
) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tiles[y * width + x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      context.fillStyle = y % 2 === 0 ? "#0a1727" : "#0c1c2e";
      context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      context.fillStyle = "rgba(255,255,255,0.025)";
      context.fillRect(px + 1, py + TILE_SIZE - 4, TILE_SIZE - 2, 1);
      context.fillRect(px + 1, py + 3, TILE_SIZE - 2, 1);

      if (tile === "Wall") {
        drawWallTile(context, px, py);
        continue;
      }

      if (typeof tile === "object" && "Conveyor" in tile) {
        drawConveyorTile(context, px, py, tile.Conveyor);
        continue;
      }

      if (typeof tile === "object" && "Energy" in tile) {
        drawEnergyTile(context, px, py, tile.Energy.value, tile.Energy.ttl);
        continue;
      }

      if (typeof tile === "object" && "Cabinet" in tile) {
        drawCabinetTile(
          context,
          px,
          py,
          tile.Cabinet.occupied_capacity,
          tile.Cabinet.config.capacity,
        );
      }
    }
  }
}

export function drawWallTile(context: CanvasRenderingContext2D, px: number, py: number) {
  context.fillStyle = "#22364d";
  context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "#1a2a3f";
  context.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  context.fillStyle = "#324a68";
  context.fillRect(px + 3, py + 3, TILE_SIZE - 6, 3);
  context.fillStyle = "rgba(158, 195, 255, 0.08)";
  for (let offset = 6; offset <= TILE_SIZE - 6; offset += 5) {
    context.fillRect(px + 4, py + offset, TILE_SIZE - 8, 1);
  }
}

export function drawConveyorTile(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  direction: "Up" | "Down" | "Left" | "Right",
) {
  context.fillStyle = "#0d2034";
  context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "rgba(88, 128, 190, 0.24)";
  context.fillRect(px + 2, py + 3, TILE_SIZE - 4, TILE_SIZE - 6);
  context.fillStyle = "#18304b";
  for (let offset = 4; offset < TILE_SIZE + 4; offset += 4) {
    context.fillRect(px + offset - 2, py + 2, 1.5, TILE_SIZE - 4);
  }
  context.strokeStyle = "rgba(132, 168, 225, 0.28)";
  context.lineWidth = 1;
  context.strokeRect(px + 2.5, py + 3.5, TILE_SIZE - 5, TILE_SIZE - 7);
  context.fillStyle = "rgba(166, 198, 242, 0.46)";
  for (let offset = 5; offset <= TILE_SIZE - 5; offset += 6) {
    context.beginPath();
    context.moveTo(px + offset - 2, py + TILE_SIZE / 2 - 2);
    context.lineTo(px + offset + 1, py + TILE_SIZE / 2);
    context.lineTo(px + offset - 2, py + TILE_SIZE / 2 + 2);
    context.closePath();
    context.fill();
  }
  drawArrow(context, px, py, direction);
}

export function drawEnergyTile(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  value: number,
  ttl: number | null,
) {
  const highValue = value >= 70;
  const glow = highValue ? "rgba(255, 166, 77, 0.26)" : "rgba(116, 255, 214, 0.24)";
  const tint = highValue ? "#ffb347" : "#8dff65";
  context.fillStyle = glow;
  context.beginPath();
  context.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 7.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = tint;
  context.beginPath();
  context.moveTo(px + TILE_SIZE / 2 - 1.2, py + 4.5);
  context.lineTo(px + TILE_SIZE / 2 + 3.8, py + 4.5);
  context.lineTo(px + TILE_SIZE / 2 + 0.9, py + 9.4);
  context.lineTo(px + TILE_SIZE / 2 + 4.9, py + 9.4);
  context.lineTo(px + TILE_SIZE / 2 - 3.2, py + 17.2);
  context.lineTo(px + TILE_SIZE / 2 - 0.2, py + 11.8);
  context.lineTo(px + TILE_SIZE / 2 - 3.8, py + 11.8);
  context.closePath();
  context.fill();
  context.strokeStyle = highValue ? "rgba(255, 235, 190, 0.68)" : "rgba(235, 255, 225, 0.66)";
  context.lineWidth = 0.8;
  context.stroke();
  context.fillStyle = "rgba(255,255,255,0.85)";
  context.font = "700 7px var(--font-body)";
  context.textAlign = "center";
  context.fillText(String(value), px + TILE_SIZE / 2, py + TILE_SIZE - 2.2);
  if (ttl !== null) {
    context.fillStyle = "#ff607d";
    context.fillRect(px + 4, py + 2.6, Math.max(3, (ttl / 18) * (TILE_SIZE - 8)), 1.8);
  }
}

export function drawCabinetTile(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  occupied: number,
  capacity: number,
) {
  const fillRatio = capacity === 0 ? 0 : occupied / capacity;
  const meterColor = cabinetBatteryColorByRatio(fillRatio);

  context.fillStyle = "rgba(255, 214, 107, 0.05)";
  context.fillRect(px + 2, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

  context.fillStyle = "#09111a";
  roundRect(context, px + 4, py + 5, TILE_SIZE - 9, TILE_SIZE - 10, 3);
  context.fill();
  context.strokeStyle = "rgba(196, 210, 228, 0.82)";
  context.lineWidth = 1;
  roundRect(context, px + 4.5, py + 5.5, TILE_SIZE - 10, TILE_SIZE - 11, 3);
  context.stroke();

  context.fillStyle = "rgba(220, 230, 242, 0.72)";
  roundRect(context, px + TILE_SIZE - 4.5, py + 9, 2.5, TILE_SIZE - 18, 1.1);
  context.fill();

  context.fillStyle = "rgba(255,255,255,0.06)";
  context.fillRect(px + 6, py + 7, TILE_SIZE - 15, TILE_SIZE - 14);
  context.fillStyle = meterColor;
  context.fillRect(
    px + 6,
    py + 7 + (TILE_SIZE - 14) * (1 - fillRatio),
    TILE_SIZE - 15,
    (TILE_SIZE - 14) * fillRatio,
  );

  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.lineWidth = 0.7;
  for (let index = 1; index <= 3; index += 1) {
    const y = py + 7 + ((TILE_SIZE - 14) / 4) * index;
    context.beginPath();
    context.moveTo(px + 6.5, y);
    context.lineTo(px + TILE_SIZE - 9.5, y);
    context.stroke();
  }

  context.fillStyle = "rgba(255,255,255,0.28)";
  context.beginPath();
  context.moveTo(px + TILE_SIZE / 2 - 1, py + 9);
  context.lineTo(px + TILE_SIZE / 2 + 1.5, py + 9);
  context.lineTo(px + TILE_SIZE / 2 - 0.7, py + 12);
  context.lineTo(px + TILE_SIZE / 2 + 1.2, py + 12);
  context.lineTo(px + TILE_SIZE / 2 - 2.1, py + 16);
  context.lineTo(px + TILE_SIZE / 2 - 0.5, py + 13.4);
  context.lineTo(px + TILE_SIZE / 2 - 2.2, py + 13.4);
  context.closePath();
  context.fill();
}

export function drawArrow(
  context: CanvasRenderingContext2D,
  px: number,
  py: number,
  direction: "Up" | "Down" | "Left" | "Right",
) {
  context.save();
  context.translate(px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  const rotationMap = {
    Up: -Math.PI / 2,
    Right: 0,
    Down: Math.PI / 2,
    Left: Math.PI,
  };
  context.rotate(rotationMap[direction]);
  context.strokeStyle = "#8fb3e6";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-5, 0);
  context.lineTo(5, 0);
  context.lineTo(2, -3);
  context.moveTo(5, 0);
  context.lineTo(2, 3);
  context.stroke();
  context.restore();
}

export function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.strokeStyle = "rgba(255,255,255,0.05)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 1) {
    context.beginPath();
    context.moveTo(x * TILE_SIZE, 0);
    context.lineTo(x * TILE_SIZE, height * TILE_SIZE);
    context.stroke();
  }
  for (let y = 0; y <= height; y += 1) {
    context.beginPath();
    context.moveTo(0, y * TILE_SIZE);
    context.lineTo(width * TILE_SIZE, y * TILE_SIZE);
    context.stroke();
  }
}

/** Draw spawn zone markers */
export function drawSpawns(
  context: CanvasRenderingContext2D,
  spawns: { alpha: { x: number; y: number }[]; beta: { x: number; y: number }[] },
) {
  for (const pos of spawns.alpha) {
    const px = pos.x * TILE_SIZE;
    const py = pos.y * TILE_SIZE;
    context.fillStyle = "rgba(25, 225, 255, 0.18)";
    context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    context.strokeStyle = "rgba(25, 225, 255, 0.4)";
    context.lineWidth = 1;
    context.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  }
  for (const pos of spawns.beta) {
    const px = pos.x * TILE_SIZE;
    const py = pos.y * TILE_SIZE;
    context.fillStyle = "rgba(255, 100, 160, 0.18)";
    context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    context.strokeStyle = "rgba(255, 100, 160, 0.4)";
    context.lineWidth = 1;
    context.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  }
}

function cabinetBatteryColorByRatio(ratio: number) {
  if (ratio >= 0.85) return "linear-gradient(180deg, #ff2454, #ff6f8d)";
  if (ratio >= 0.45) return "linear-gradient(180deg, #ffe23a, #ff9800)";
  return "linear-gradient(180deg, #7dff5c, #2bff88)";
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
