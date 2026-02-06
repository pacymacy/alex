import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_WAYPOINTS_PATH = "data/waypoints.json";

export async function loadWaypoints(customPath) {
  const filePath = resolvePath(customPath);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    return sanitizeWaypoints(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw new Error(`Failed to load waypoints from ${filePath}: ${error.message}`);
  }
}

export async function saveWaypoints(waypoints, customPath) {
  const filePath = resolvePath(customPath);
  const directory = path.dirname(filePath);
  const safeWaypoints = sanitizeWaypoints(waypoints);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(safeWaypoints, null, 2)}\n`, "utf8");
}

function resolvePath(customPath) {
  const cwd = process.cwd();
  return customPath
    ? path.resolve(cwd, customPath)
    : path.resolve(cwd, DEFAULT_WAYPOINTS_PATH);
}

function sanitizeWaypoints(value) {
  if (!isRecord(value)) {
    return {};
  }

  const result = {};
  for (const [name, waypoint] of Object.entries(value)) {
    const safeName = normalizeWaypointName(name);
    if (!safeName || !isRecord(waypoint)) {
      continue;
    }

    const x = toFiniteNumber(waypoint.x);
    const y = toFiniteNumber(waypoint.y);
    const z = toFiniteNumber(waypoint.z);
    if (x === null || y === null || z === null) {
      continue;
    }

    result[safeName] = {
      x: round(x),
      y: round(y),
      z: round(z),
      dimension:
        typeof waypoint.dimension === "string" && waypoint.dimension.trim()
          ? waypoint.dimension.trim()
          : "unknown",
      updatedAt:
        typeof waypoint.updatedAt === "string" && waypoint.updatedAt.trim()
          ? waypoint.updatedAt
          : new Date().toISOString()
    };
  }

  return result;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeWaypointName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
