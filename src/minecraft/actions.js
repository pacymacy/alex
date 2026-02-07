import pathfinderPkg from "mineflayer-pathfinder";

const { goals } = pathfinderPkg;

const { GoalNear, GoalFollow } = goals;
export const ACTION_REASON = Object.freeze({
  OK: "OK",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  INVALID_INPUT: "INVALID_INPUT",
  INVENTORY_FULL: "INVENTORY_FULL",
  UNKNOWN_BLOCK: "UNKNOWN_BLOCK",
  BLOCK_NOT_FOUND: "BLOCK_NOT_FOUND",
  CANNOT_DIG: "CANNOT_DIG",
  NO_TOOL: "NO_TOOL",
  NO_DROP: "NO_DROP",
  NO_TARGET: "NO_TARGET",
  NO_PLAYER: "NO_PLAYER",
  UNKNOWN_ITEM: "UNKNOWN_ITEM",
  NO_RECIPE: "NO_RECIPE",
  NO_FOOD: "NO_FOOD",
  NO_PATH: "NO_PATH",
  TIMEOUT: "TIMEOUT",
  DANGER_ABORT: "DANGER_ABORT",
  WAYPOINT_NOT_FOUND: "WAYPOINT_NOT_FOUND",
  DIMENSION_MISMATCH: "DIMENSION_MISMATCH",
  POSITION_UNAVAILABLE: "POSITION_UNAVAILABLE",
  PLACEMENT_FAILED: "PLACEMENT_FAILED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR"
});
const ACTION_REASON_VALUES = new Set(Object.values(ACTION_REASON));
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
    const actionType = String(action?.type ?? "unknown");
    const startedAt = Date.now();
    try {
      await runAction(bot, action, context);
      results.push({
        type: actionType,
        ok: true,
        reasonCode: ACTION_REASON.OK,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const reasonCode = classifyActionFailure(error);
      console.warn(`[action:${actionType}] ${reasonCode} ${error.message}`);
      results.push({
        type: actionType,
        ok: false,
        reasonCode,
        error: error.message,
        durationMs: Date.now() - startedAt
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
  switch (action?.type) {
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
    case "drop_items":
      await dropItems(bot, action);
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
      throw actionFailure(
        ACTION_REASON.UNKNOWN_ACTION,
        `Unsupported action type: ${String(action?.type ?? "unknown")}`
      );
  }
}

async function mineNearestBlock(bot, action) {
  const blockId = bot.registry.blocksByName[action.block]?.id;
  if (!blockId) {
    throw actionFailure(
      ACTION_REASON.UNKNOWN_BLOCK,
      `Unknown block name: ${action.block}`
    );
  }

  const block = bot.findBlock({
    matching: blockId,
    maxDistance: action.maxDistance
  });

  if (!block) {
    throw actionFailure(
      ACTION_REASON.BLOCK_NOT_FOUND,
      `Could not find block: ${action.block}`
    );
  }

  const expectedDrops = getExpectedDrops(block.name);
  if (expectedDrops.length > 0 && !canCollectAnyExpectedDrop(bot, expectedDrops)) {
    throw actionFailure(
      ACTION_REASON.INVENTORY_FULL,
      `Inventory is full and cannot collect drops for ${block.name}`
    );
  }

  await moveToGoal(
    bot,
    new GoalNear(block.position.x, block.position.y, block.position.z, 1),
    action.timeoutMs
  );

  await ensureHarvestToolEquipped(bot, block);

  const nearbyHostiles = findNearbyHostiles(bot, 6);
  if (nearbyHostiles.length > 0) {
    throw actionFailure(
      ACTION_REASON.DANGER_ABORT,
      `Aborted mining ${block.name}: hostile mobs within 6 blocks`
    );
  }

  if (!bot.canDigBlock(block)) {
    throw actionFailure(
      ACTION_REASON.CANNOT_DIG,
      `Cannot dig block now: ${action.block}`
    );
  }

  const beforeCounts = captureInventoryCounts(bot);
  await bot.dig(block, true);
  await sleep(900);

  if (expectedDrops.length > 0) {
    const collected = didCollectExpectedDrop(bot, beforeCounts, expectedDrops);
    if (!collected) {
      throw actionFailure(
        ACTION_REASON.NO_DROP,
        `Mined ${block.name}, but did not collect expected drops (${expectedDrops.join(", ")})`
      );
    }
  }
}

async function attackNearest(bot, maxDistance) {
  const target = findNearestMob(bot, maxDistance);
  if (!target) {
    throw actionFailure(ACTION_REASON.NO_TARGET, "No mob in range");
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
    throw actionFailure(
      ACTION_REASON.NO_PLAYER,
      `Player not visible: ${action.username}`
    );
  }

  bot.pathfinder.setGoal(new GoalFollow(target, action.distance), true);
  await sleep(action.durationMs);
  bot.pathfinder.setGoal(null);
}

async function craftItem(bot, action) {
  const itemName = String(action.item ?? "").trim().toLowerCase();
  if (!itemName) {
    throw actionFailure(
      ACTION_REASON.INVALID_INPUT,
      "craft_item requires item"
    );
  }

  const itemInfo = bot.registry.itemsByName[itemName];
  if (!itemInfo) {
    throw actionFailure(ACTION_REASON.UNKNOWN_ITEM, `Unknown item: ${itemName}`);
  }

  const targetCount = clampInt(action.count, 1, 1, 64);
  let craftingTable = null;
  let recipes = bot.recipesFor(itemInfo.id, null, 1, null);

  if (recipes.length === 0) {
    craftingTable = await ensureCraftingTableNearby(bot);
    recipes = bot.recipesFor(itemInfo.id, null, 1, craftingTable);
  }

  if (recipes.length === 0) {
    throw actionFailure(ACTION_REASON.NO_RECIPE, `No recipe for item: ${itemName}`);
  }

  const recipe = recipes[0];
  const resultCount = Math.max(1, Number(recipe.result?.count ?? 1));
  const times = Math.max(1, Math.ceil(targetCount / resultCount));
  const beforeCount = countInventoryItem(bot, itemName);

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
  await sleep(150);

  const afterCount = countInventoryItem(bot, itemName);
  if (afterCount <= beforeCount) {
    throw actionFailure(
      ACTION_REASON.NO_DROP,
      `Crafted ${itemName}, but inventory count did not increase`
    );
  }
}

async function eatFood(bot) {
  const item = findBestFoodItem(bot);
  if (!item) {
    throw actionFailure(
      ACTION_REASON.NO_FOOD,
      "No edible food item in inventory"
    );
  }

  const beforeFood = Number(bot.food ?? 0);
  const beforeHealth = Number(bot.health ?? 0);
  const beforeCount = countInventoryItem(bot, item.name);

  await bot.equip(item, "hand");
  await bot.consume();
  await sleep(120);

  const afterFood = Number(bot.food ?? 0);
  const afterHealth = Number(bot.health ?? 0);
  const afterCount = countInventoryItem(bot, item.name);
  const consumedSomething = afterCount < beforeCount;
  const gainedFood = afterFood > beforeFood + 0.01;
  const gainedHealth = afterHealth > beforeHealth + 0.01;
  if (!consumedSomething && !gainedFood && !gainedHealth) {
    throw actionFailure(
      ACTION_REASON.NO_DROP,
      "eat_food completed but no hunger/health/inventory change was observed"
    );
  }
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
    throw actionFailure(ACTION_REASON.NO_TARGET, "No hostile mobs nearby");
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
    throw actionFailure(
      ACTION_REASON.NO_PATH,
      "Could not compute safe flee direction"
    );
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
    throw actionFailure(
      ACTION_REASON.INVALID_INPUT,
      "Waypoint name is required"
    );
  }

  const waypoint = context.state.waypoints[name];
  if (!waypoint) {
    throw actionFailure(
      ACTION_REASON.WAYPOINT_NOT_FOUND,
      `Waypoint not found: ${name}`
    );
  }

  const currentDimension = bot.game?.dimension ?? "unknown";
  if (waypoint.dimension !== currentDimension) {
    throw actionFailure(
      ACTION_REASON.DIMENSION_MISMATCH,
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

  const remaining = distanceToPosition(bot.entity?.position, waypoint);
  if (Number.isFinite(remaining) && remaining > radius + 1.5) {
    throw actionFailure(
      ACTION_REASON.NO_PATH,
      `Failed waypoint postcondition: ${name} remains ${round(remaining)} blocks away`
    );
  }
}

async function setWaypoint(bot, action, context) {
  const name = normalizeWaypointName(action.name);
  if (!name) {
    throw actionFailure(
      ACTION_REASON.INVALID_INPUT,
      "Waypoint name is required"
    );
  }

  const pos = bot.entity?.position;
  if (!pos) {
    throw actionFailure(
      ACTION_REASON.POSITION_UNAVAILABLE,
      "Bot position unavailable"
    );
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
    throw actionFailure(
      ACTION_REASON.INVALID_INPUT,
      "Waypoint name is required"
    );
  }

  if (!context.state.waypoints[name]) {
    throw actionFailure(
      ACTION_REASON.WAYPOINT_NOT_FOUND,
      `Waypoint not found: ${name}`
    );
  }

  delete context.state.waypoints[name];
  await context.persistWaypoints(context.state.waypoints);
}

async function ensureCraftingTableNearby(bot) {
  const tableBlockName = "crafting_table";
  const tableBlockId = bot.registry.blocksByName[tableBlockName]?.id;
  if (!tableBlockId) {
    throw actionFailure(
      ACTION_REASON.PLACEMENT_FAILED,
      "crafting_table block not available in registry"
    );
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
    throw actionFailure(
      ACTION_REASON.NO_RECIPE,
      "Crafting table needed but not available in inventory"
    );
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
    throw actionFailure(
      ACTION_REASON.PLACEMENT_FAILED,
      "Failed to place/find crafting table"
    );
  }

  return table;
}

async function placeBlockFromInventory(bot, blockItemName) {
  const itemName = String(blockItemName ?? "").trim().toLowerCase();
  if (!itemName) {
    throw actionFailure(
      ACTION_REASON.INVALID_INPUT,
      "place_block requires block item name"
    );
  }

  const item = bot.inventory.items().find((entry) => entry.name === itemName);
  if (!item) {
    throw actionFailure(
      ACTION_REASON.INVALID_INPUT,
      `Item not in inventory: ${itemName}`
    );
  }

  const reference = findPlacementReferenceBlock(bot);
  if (!reference) {
    throw actionFailure(
      ACTION_REASON.PLACEMENT_FAILED,
      "No valid nearby placement reference block"
    );
  }

  const placeAt = reference.position.offset(0, 1, 0);
  const beforeBlockName = bot.blockAt(placeAt)?.name ?? "air";
  const beforeItemCount = countInventoryItem(bot, itemName);

  await moveToGoal(
    bot,
    new GoalNear(reference.position.x, reference.position.y, reference.position.z, 3),
    12000
  );

  await bot.equip(item, "hand");
  await bot.lookAt(reference.position.offset(0.5, 1, 0.5), true);
  const faceUp = reference.position.offset(0, 1, 0).minus(reference.position);
  await bot.placeBlock(reference, faceUp);
  await sleep(100);

  const placedBlock = bot.blockAt(placeAt);
  if (!placedBlock || placedBlock.boundingBox === "empty") {
    throw actionFailure(
      ACTION_REASON.PLACEMENT_FAILED,
      `Postcondition failed: ${itemName} did not appear at placement target`
    );
  }

  if (placedBlock.name === beforeBlockName) {
    throw actionFailure(
      ACTION_REASON.PLACEMENT_FAILED,
      `Postcondition failed: block at target did not change (${placedBlock.name})`
    );
  }

  if (!isExpectedPlacedBlock(itemName, placedBlock.name)) {
    throw actionFailure(
      ACTION_REASON.PLACEMENT_FAILED,
      `Unexpected placed block for ${itemName}: ${placedBlock.name}`
    );
  }

  const afterItemCount = countInventoryItem(bot, itemName);
  if (afterItemCount >= beforeItemCount && !isLikelyCreative(bot)) {
    throw actionFailure(
      ACTION_REASON.PLACEMENT_FAILED,
      `Postcondition failed: ${itemName} count did not decrease after placement`
    );
  }

  return placedBlock;
}

async function dropItems(bot, action) {
  const minFreeSlots = clampInt(action.minFreeSlots, 4, 1, 20);
  const priority = buildDropPriorityList(action);
  const keepAtMost = buildKeepAtMostMap(action.keepAtMost);

  let freeSlots = estimateFreeInventorySlots(bot);
  if (freeSlots >= minFreeSlots) {
    return;
  }

  let droppedAny = false;
  for (const name of priority) {
    if (freeSlots >= minFreeSlots) {
      break;
    }

    const dropped = await tossItemNameExcess(bot, name, keepAtMost[name] ?? 0);
    if (dropped > 0) {
      droppedAny = true;
      await sleep(80);
      freeSlots = estimateFreeInventorySlots(bot);
    }
  }

  freeSlots = estimateFreeInventorySlots(bot);
  if (freeSlots < minFreeSlots) {
    throw actionFailure(
      ACTION_REASON.INVENTORY_FULL,
      droppedAny
        ? `Dropped low-value items but still low on space (${freeSlots} free slot(s))`
        : `No droppable low-value items available (${freeSlots} free slot(s))`
    );
  }
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

async function ensureHarvestToolEquipped(bot, block) {
  const requiredToolIds = getRequiredHarvestToolIds(block);
  if (requiredToolIds.length === 0) {
    return;
  }

  const heldType = bot.heldItem?.type ?? null;
  if (heldType !== null && requiredToolIds.includes(heldType)) {
    return;
  }

  const tool = findBestInventoryToolByIds(bot, requiredToolIds);
  if (!tool) {
    const names = requiredToolIds
      .map((id) => bot.registry.items?.[id]?.name)
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    throw actionFailure(
      ACTION_REASON.NO_TOOL,
      `Missing required harvest tool for ${block.name}${names ? ` (need one of: ${names})` : ""}`
    );
  }

  await bot.equip(tool, "hand");

  const equippedType = bot.heldItem?.type ?? null;
  if (equippedType === null || !requiredToolIds.includes(equippedType)) {
    throw actionFailure(
      ACTION_REASON.NO_TOOL,
      `Failed to equip required harvest tool for ${block.name}`
    );
  }
}

function getRequiredHarvestToolIds(block) {
  const tools = block?.harvestTools;
  if (!tools) {
    return [];
  }

  if (Array.isArray(tools)) {
    return tools.map((entry) => Number(entry)).filter(Number.isFinite);
  }

  if (tools instanceof Set) {
    return [...tools].map((entry) => Number(entry)).filter(Number.isFinite);
  }

  if (typeof tools === "object") {
    return Object.keys(tools)
      .map((entry) => Number(entry))
      .filter(Number.isFinite);
  }

  return [];
}

function findBestInventoryToolByIds(bot, requiredIds) {
  const requiredSet = new Set(requiredIds);
  let best = null;
  let bestScore = -1;

  for (const item of bot.inventory.items()) {
    if (!requiredSet.has(item.type)) {
      continue;
    }

    const score = toolScore(item.name);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

function toolScore(name) {
  const itemName = String(name ?? "").toLowerCase();
  let tier = 0;
  if (itemName.includes("netherite")) {
    tier = 6;
  } else if (itemName.includes("diamond")) {
    tier = 5;
  } else if (itemName.includes("iron")) {
    tier = 4;
  } else if (itemName.includes("stone")) {
    tier = 3;
  } else if (itemName.includes("golden")) {
    tier = 2;
  } else if (itemName.includes("wooden")) {
    tier = 1;
  }

  const durabilityBias = itemName.includes("unbreakable") ? 1 : 0;
  return tier * 10 + durabilityBias;
}

function captureInventoryCounts(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) {
    counts[item.name] = (counts[item.name] ?? 0) + item.count;
  }
  return counts;
}

function didCollectExpectedDrop(bot, beforeCounts, expectedNames) {
  const expected = new Set(expectedNames);
  const current = captureInventoryCounts(bot);

  for (const name of expected) {
    const before = beforeCounts[name] ?? 0;
    const after = current[name] ?? 0;
    if (after > before) {
      return true;
    }
  }

  return false;
}

function canCollectAnyExpectedDrop(bot, expectedNames) {
  const freeSlots = estimateFreeInventorySlots(bot);
  if (freeSlots > 0) {
    return true;
  }

  for (const name of expectedNames) {
    if (hasStackSpaceForItem(bot, name)) {
      return true;
    }
  }

  return false;
}

function hasStackSpaceForItem(bot, itemName) {
  const target = String(itemName ?? "").toLowerCase();
  if (!target) {
    return false;
  }

  const maxStack = Number(bot.registry.itemsByName[target]?.stackSize ?? 64);
  if (!Number.isFinite(maxStack) || maxStack <= 1) {
    return false;
  }

  return bot.inventory
    .items()
    .some((item) => item.name === target && Number(item.count) < maxStack);
}

function estimateFreeInventorySlots(bot) {
  if (typeof bot.inventory?.emptySlotCount === "function") {
    const value = Number(bot.inventory.emptySlotCount());
    if (Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }

  const used = bot.inventory.items().length;
  return Math.max(0, 36 - used);
}

async function tossItemNameExcess(bot, itemName, keepCount) {
  const targetName = String(itemName ?? "").trim().toLowerCase();
  if (!targetName) {
    return 0;
  }

  let remainingToKeep = Math.max(0, Math.floor(Number(keepCount) || 0));
  let dropped = 0;

  const stacks = bot.inventory
    .items()
    .filter((item) => item.name === targetName)
    .sort((a, b) => b.count - a.count);

  for (const stack of stacks) {
    if (remainingToKeep >= stack.count) {
      remainingToKeep -= stack.count;
      continue;
    }

    const dropCount = Math.max(0, stack.count - remainingToKeep);
    if (dropCount <= 0) {
      continue;
    }

    await bot.toss(stack.type, stack.metadata ?? null, dropCount);
    dropped += dropCount;
    remainingToKeep = 0;
  }

  return dropped;
}

function buildDropPriorityList(action) {
  if (Array.isArray(action?.items) && action.items.length > 0) {
    return action.items.map((name) => String(name ?? "").toLowerCase()).filter(Boolean);
  }

  return [
    "dirt",
    "cobblestone",
    "cobbled_deepslate",
    "deepslate",
    "andesite",
    "diorite",
    "granite",
    "gravel",
    "netherrack",
    "rotten_flesh",
    "spider_eye",
    "string",
    "bone"
  ];
}

function buildKeepAtMostMap(value) {
  const defaults = {
    dirt: 16,
    cobblestone: 128,
    cobbled_deepslate: 128,
    deepslate: 64,
    andesite: 32,
    diorite: 32,
    granite: 32,
    gravel: 16,
    netherrack: 32,
    rotten_flesh: 8,
    spider_eye: 4,
    string: 32,
    bone: 32
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const merged = { ...defaults };
  for (const [key, count] of Object.entries(value)) {
    const name = String(key ?? "").toLowerCase();
    if (!name) {
      continue;
    }
    const num = Number(count);
    if (Number.isFinite(num) && num >= 0) {
      merged[name] = Math.floor(num);
    }
  }
  return merged;
}

function countInventoryItem(bot, itemName) {
  let total = 0;
  for (const item of bot.inventory.items()) {
    if (item.name === itemName) {
      total += item.count;
    }
  }
  return total;
}

function getExpectedDrops(blockName) {
  const name = String(blockName ?? "").toLowerCase();
  const exact = {
    stone: ["cobblestone", "stone"],
    deepslate: ["cobbled_deepslate", "deepslate"],
    coal_ore: ["coal", "coal_ore"],
    deepslate_coal_ore: ["coal", "deepslate_coal_ore"],
    iron_ore: ["raw_iron", "iron_ore"],
    deepslate_iron_ore: ["raw_iron", "deepslate_iron_ore"]
  };

  if (exact[name]) {
    return exact[name];
  }

  if (name.endsWith("_log") || name.endsWith("_stem")) {
    return [name];
  }

  return [];
}

function isExpectedPlacedBlock(itemName, blockName) {
  const expected = String(itemName ?? "").toLowerCase();
  const actual = String(blockName ?? "").toLowerCase();
  if (!expected || !actual) {
    return false;
  }

  if (expected === actual) {
    return true;
  }

  if (expected === "torch" && actual.endsWith("torch")) {
    return true;
  }

  if (expected.endsWith("_slab") && actual.endsWith("_slab")) {
    return true;
  }

  if (expected.endsWith("_stairs") && actual.endsWith("_stairs")) {
    return true;
  }

  return false;
}

function isLikelyCreative(bot) {
  const mode = String(bot.game?.gameMode ?? "").toLowerCase();
  return mode === "creative" || mode === "1";
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
        finish(actionFailure(ACTION_REASON.NO_PATH, "No path to target"));
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
      finish(
        actionFailure(ACTION_REASON.TIMEOUT, `Move timeout after ${timeoutMs} ms`)
      );
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

function distanceToPosition(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  const dz = Number(a.z) - Number(b.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function classifyActionFailure(error) {
  if (error && typeof error === "object" && "reasonCode" in error) {
    return normalizeReasonCode(error.reasonCode);
  }

  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("timeout")) {
    return ACTION_REASON.TIMEOUT;
  }
  if (message.includes("no path")) {
    return ACTION_REASON.NO_PATH;
  }
  if (message.includes("recipe")) {
    return ACTION_REASON.NO_RECIPE;
  }
  if (message.includes("tool")) {
    return ACTION_REASON.NO_TOOL;
  }
  if (message.includes("drop")) {
    return ACTION_REASON.NO_DROP;
  }
  return ACTION_REASON.UNKNOWN_ERROR;
}

function normalizeReasonCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return ACTION_REASON_VALUES.has(code) ? code : ACTION_REASON.UNKNOWN_ERROR;
}

function actionFailure(reasonCode, message) {
  const error = new Error(String(message ?? "Action failed"));
  error.reasonCode = normalizeReasonCode(reasonCode);
  return error;
}
