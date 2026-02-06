import pathfinderPkg from "mineflayer-pathfinder";

const { goals } = pathfinderPkg;

const { GoalNear, GoalFollow } = goals;
const HOSTILE_MOB_NAMES = new Set([
  "zombie",
  "husk",
  "drowned",
  "skeleton",
  "stray",
  "creeper",
  "spider",
  "cave_spider",
  "witch",
  "slime",
  "magma_cube",
  "pillager",
  "vindicator",
  "evoker",
  "ravager",
  "phantom",
  "blaze",
  "ghast",
  "hoglin",
  "zoglin",
  "piglin_brute",
  "wither_skeleton",
  "silverfish",
  "endermite",
  "guardian",
  "elder_guardian",
  "warden"
]);

export async function executeActions(bot, actions, context) {
  const results = [];

  for (const action of actions) {
    try {
      await runAction(bot, action, context);
      results.push({ type: action.type, ok: true });
    } catch (error) {
      console.warn(`[action:${action.type}] ${error.message}`);
      results.push({
        type: action.type,
        ok: false,
        error: error.message
      });
    }
  }

  return results;
}

export async function safeChat(bot, state, cooldownMs, rawMessage) {
  const message = String(rawMessage ?? "").trim();
  if (!message) {
    return;
  }

  const now = Date.now();
  if (state.lastChatAt > 0 && now - state.lastChatAt < cooldownMs) {
    return;
  }

  bot.chat(message.slice(0, 180));
  state.lastChatAt = now;
}

export function hasEdibleFood(bot) {
  return Boolean(findBestFoodItem(bot));
}

export function findNearbyHostiles(bot, maxDistance = 12) {
  const botPosition = bot.entity?.position;
  if (!botPosition) {
    return [];
  }

  return Object.values(bot.entities)
    .filter((entity) => entity?.type === "mob")
    .map((entity) => ({
      entity,
      distance: botPosition.distanceTo(entity.position),
      name: entity.name
    }))
    .filter(
      (entry) =>
        entry.distance <= maxDistance &&
        HOSTILE_MOB_NAMES.has(String(entry.name ?? "").toLowerCase())
    )
    .sort((a, b) => a.distance - b.distance);
}

async function runAction(bot, action, context) {
  switch (action.type) {
    case "chat":
      await safeChat(
        bot,
        context.state,
        context.config.chatCooldownMs,
        action.message
      );
      return;
    case "move_to":
      await moveToGoal(
        bot,
        new GoalNear(action.x, action.y, action.z, action.radius),
        action.timeoutMs
      );
      return;
    case "mine_block":
      await mineNearestBlock(bot, action);
      return;
    case "attack_nearest":
      await attackNearest(bot, action.maxDistance);
      return;
    case "follow_player":
      await followPlayer(bot, action);
      return;
    case "craft_item":
      await craftItem(bot, action);
      return;
    case "place_block":
      await placeBlockFromInventory(bot, action.block);
      return;
    case "wait":
      await sleep(action.ms);
      return;
    case "eat_food":
      await eatFood(bot);
      return;
    case "flee_hostiles":
      await fleeHostiles(bot, action);
      return;
    case "goto_waypoint":
      await gotoWaypoint(bot, action, context);
      return;
    case "set_waypoint":
      await setWaypoint(bot, action, context);
      return;
    case "delete_waypoint":
      await deleteWaypoint(action, context);
      return;
    case "stop":
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      return;
    default:
      return;
  }
}

async function mineNearestBlock(bot, action) {
  const blockId = bot.registry.blocksByName[action.block]?.id;
  if (!blockId) {
    throw new Error(`Unknown block name: ${action.block}`);
  }

  const block = bot.findBlock({
    matching: blockId,
    maxDistance: action.maxDistance
  });

  if (!block) {
    throw new Error(`Could not find block: ${action.block}`);
  }

  await moveToGoal(
    bot,
    new GoalNear(block.position.x, block.position.y, block.position.z, 1),
    action.timeoutMs
  );

  if (!bot.canDigBlock(block)) {
    throw new Error(`Cannot dig block now: ${action.block}`);
  }

  await bot.dig(block, true);
}

async function attackNearest(bot, maxDistance) {
  const target = findNearestMob(bot, maxDistance);
  if (!target) {
    throw new Error("No mob in range");
  }

  const distance = bot.entity.position.distanceTo(target.position);
  if (distance > 3) {
    await moveToGoal(
      bot,
      new GoalNear(target.position.x, target.position.y, target.position.z, 2),
      12000
    );
  }

  await bot.lookAt(target.position.offset(0, 1, 0), true);
  bot.attack(target);
  await sleep(250);
}

async function followPlayer(bot, action) {
  const target = bot.players[action.username]?.entity;
  if (!target) {
    throw new Error(`Player not visible: ${action.username}`);
  }

  bot.pathfinder.setGoal(new GoalFollow(target, action.distance), true);
  await sleep(action.durationMs);
  bot.pathfinder.setGoal(null);
}

async function craftItem(bot, action) {
  const itemName = String(action.item ?? "").trim().toLowerCase();
  if (!itemName) {
    throw new Error("craft_item requires item");
  }

  const itemInfo = bot.registry.itemsByName[itemName];
  if (!itemInfo) {
    throw new Error(`Unknown item: ${itemName}`);
  }

  const targetCount = clampInt(action.count, 1, 1, 64);
  let craftingTable = null;
  let recipes = bot.recipesFor(itemInfo.id, null, 1, null);

  if (recipes.length === 0) {
    craftingTable = await ensureCraftingTableNearby(bot);
    recipes = bot.recipesFor(itemInfo.id, null, 1, craftingTable);
  }

  if (recipes.length === 0) {
    throw new Error(`No recipe for item: ${itemName}`);
  }

  const recipe = recipes[0];
  const resultCount = Math.max(1, Number(recipe.result?.count ?? 1));
  const times = Math.max(1, Math.ceil(targetCount / resultCount));

  if (craftingTable) {
    await moveToGoal(
      bot,
      new GoalNear(
        craftingTable.position.x,
        craftingTable.position.y,
        craftingTable.position.z,
        2
      ),
      12000
    );
  }

  await bot.craft(recipe, times, craftingTable);
}

async function eatFood(bot) {
  const item = findBestFoodItem(bot);
  if (!item) {
    throw new Error("No edible food item in inventory");
  }

  await bot.equip(item, "hand");
  await bot.consume();
}

function findBestFoodItem(bot) {
  const foods = bot.registry?.foodsByName ?? {};
  const items = bot.inventory.items();
  let best = null;
  let bestScore = -1;

  for (const item of items) {
    const foodMeta = foods[item.name];
    if (!foodMeta) {
      continue;
    }

    const points = Number(foodMeta.foodPoints ?? 0);
    const saturation = Number(foodMeta.saturation ?? 0);
    const score = points * 100 + saturation;

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

async function fleeHostiles(bot, action) {
  const maxDistance = Number(action.maxDistance) || 10;
  const threats = findNearbyHostiles(bot, maxDistance);
  if (threats.length === 0) {
    throw new Error("No hostile mobs nearby");
  }

  const current = bot.entity.position;
  let vx = 0;
  let vz = 0;

  for (const threat of threats) {
    const dx = current.x - threat.entity.position.x;
    const dz = current.z - threat.entity.position.z;
    const distance = Math.max(1, Math.sqrt(dx * dx + dz * dz));
    const inv = 1 / distance;
    vx += (dx / distance) * inv;
    vz += (dz / distance) * inv;
  }

  const norm = Math.sqrt(vx * vx + vz * vz);
  if (!Number.isFinite(norm) || norm < 0.001) {
    throw new Error("Could not compute safe flee direction");
  }

  const fleeDistance = clampInt(action.fleeDistance, 8, 4, 18);
  const targetX = current.x + (vx / norm) * fleeDistance;
  const targetZ = current.z + (vz / norm) * fleeDistance;
  const timeoutMs = clampInt(action.durationMs, 4000, 1000, 20000);

  await moveToGoal(bot, new GoalNear(targetX, current.y, targetZ, 2), timeoutMs);
}

async function gotoWaypoint(bot, action, context) {
  const name = normalizeWaypointName(action.name);
  if (!name) {
    throw new Error("Waypoint name is required");
  }

  const waypoint = context.state.waypoints[name];
  if (!waypoint) {
    throw new Error(`Waypoint not found: ${name}`);
  }

  const currentDimension = bot.game?.dimension ?? "unknown";
  if (waypoint.dimension !== currentDimension) {
    throw new Error(
      `Waypoint ${name} is in ${waypoint.dimension}, current dimension is ${currentDimension}`
    );
  }

  const radius = clampInt(action.radius, 2, 1, 8);
  const timeoutMs = clampInt(action.timeoutMs, 20000, 1000, 60000);
  await moveToGoal(
    bot,
    new GoalNear(waypoint.x, waypoint.y, waypoint.z, radius),
    timeoutMs
  );
}

async function setWaypoint(bot, action, context) {
  const name = normalizeWaypointName(action.name);
  if (!name) {
    throw new Error("Waypoint name is required");
  }

  const pos = bot.entity?.position;
  if (!pos) {
    throw new Error("Bot position unavailable");
  }

  context.state.waypoints[name] = {
    x: round(pos.x),
    y: round(pos.y),
    z: round(pos.z),
    dimension: bot.game?.dimension ?? "unknown",
    updatedAt: new Date().toISOString()
  };

  await context.persistWaypoints(context.state.waypoints);
}

async function deleteWaypoint(action, context) {
  const name = normalizeWaypointName(action.name);
  if (!name) {
    throw new Error("Waypoint name is required");
  }

  if (!context.state.waypoints[name]) {
    throw new Error(`Waypoint not found: ${name}`);
  }

  delete context.state.waypoints[name];
  await context.persistWaypoints(context.state.waypoints);
}

async function ensureCraftingTableNearby(bot) {
  const tableBlockName = "crafting_table";
  const tableBlockId = bot.registry.blocksByName[tableBlockName]?.id;
  if (!tableBlockId) {
    throw new Error("crafting_table block not available in registry");
  }

  let table = bot.findBlock({
    matching: tableBlockId,
    maxDistance: 6
  });

  if (table) {
    return table;
  }

  const hasTableItem = bot.inventory
    .items()
    .some((item) => item.name === tableBlockName);
  if (!hasTableItem) {
    throw new Error("Crafting table needed but not available in inventory");
  }

  table = await placeBlockFromInventory(bot, tableBlockName);
  if (table) {
    return table;
  }

  table = bot.findBlock({
    matching: tableBlockId,
    maxDistance: 8
  });
  if (!table) {
    throw new Error("Failed to place/find crafting table");
  }

  return table;
}

async function placeBlockFromInventory(bot, blockItemName) {
  const itemName = String(blockItemName ?? "").trim().toLowerCase();
  if (!itemName) {
    throw new Error("place_block requires block item name");
  }

  const item = bot.inventory.items().find((entry) => entry.name === itemName);
  if (!item) {
    throw new Error(`Item not in inventory: ${itemName}`);
  }

  const reference = findPlacementReferenceBlock(bot);
  if (!reference) {
    throw new Error("No valid nearby placement reference block");
  }

  await moveToGoal(
    bot,
    new GoalNear(reference.position.x, reference.position.y, reference.position.z, 3),
    12000
  );

  await bot.equip(item, "hand");
  await bot.lookAt(reference.position.offset(0.5, 1, 0.5), true);
  const faceUp = reference.position.offset(0, 1, 0).minus(reference.position);
  await bot.placeBlock(reference, faceUp);

  return bot.blockAt(reference.position.offset(0, 1, 0));
}

function findPlacementReferenceBlock(bot) {
  const origin = bot.entity?.position?.floored?.();
  if (!origin) {
    return null;
  }

  const candidates = [];

  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const basePos = origin.offset(dx, dy, dz);
        const topPos = basePos.offset(0, 1, 0);
        const base = bot.blockAt(basePos);
        const top = bot.blockAt(topPos);

        if (!base || !top) {
          continue;
        }
        if (base.boundingBox !== "block") {
          continue;
        }
        if (top.boundingBox !== "empty") {
          continue;
        }

        const distance = bot.entity.position.distanceTo(base.position);
        candidates.push({ base, distance });
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.base ?? null;
}

function normalizeWaypointName(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  return raw.replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function findNearestMob(bot, maxDistance) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const entity of Object.values(bot.entities)) {
    if (entity.type !== "mob") {
      continue;
    }

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist <= maxDistance && dist < nearestDistance) {
      nearest = entity;
      nearestDistance = dist;
    }
  }

  return nearest;
}

function moveToGoal(bot, goal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;

    const onGoalReached = () => finish(null);
    const onPathUpdate = (result) => {
      if (result.status === "noPath") {
        finish(new Error("No path to target"));
      }
    };

    const finish = (error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      bot.removeListener("goal_reached", onGoalReached);
      bot.removeListener("path_update", onPathUpdate);

      if (error) {
        bot.pathfinder.setGoal(null);
        reject(error);
        return;
      }

      resolve();
    };

    bot.on("goal_reached", onGoalReached);
    bot.on("path_update", onPathUpdate);

    timer = setTimeout(() => {
      finish(new Error(`Move timeout after ${timeoutMs} ms`));
    }, timeoutMs);

    bot.pathfinder.setGoal(goal);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(num)));
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
