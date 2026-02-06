const LOG_TO_PLANK = [
  { log: "oak_log", plank: "oak_planks" },
  { log: "birch_log", plank: "birch_planks" },
  { log: "spruce_log", plank: "spruce_planks" },
  { log: "jungle_log", plank: "jungle_planks" },
  { log: "acacia_log", plank: "acacia_planks" },
  { log: "dark_oak_log", plank: "dark_oak_planks" },
  { log: "mangrove_log", plank: "mangrove_planks" },
  { log: "cherry_log", plank: "cherry_planks" },
  { log: "crimson_stem", plank: "crimson_planks" },
  { log: "warped_stem", plank: "warped_planks" }
];

const LOG_BLOCK_PRIORITY = LOG_TO_PLANK.map((entry) => entry.log);
const PLANK_ITEMS = LOG_TO_PLANK.map((entry) => entry.plank);
const PICKAXE_ITEMS = [
  "wooden_pickaxe",
  "stone_pickaxe",
  "iron_pickaxe",
  "diamond_pickaxe",
  "netherite_pickaxe"
];
const STONE_TIER_PICKAXES = [
  "stone_pickaxe",
  "iron_pickaxe",
  "diamond_pickaxe",
  "netherite_pickaxe"
];

export function buildAutonomyPlan(bot, state) {
  if (!state.autonomyEnabled) {
    return null;
  }

  if (state.goalMode === "manual") {
    return null;
  }

  const counts = inventoryCounts(bot);
  const home = state.waypoints.home;
  const logCount = sumItems(counts, LOG_BLOCK_PRIORITY);
  const plankCount = sumItems(counts, PLANK_ITEMS);
  const stickCount = counts.stick ?? 0;
  const pickaxeCount = sumItems(counts, PICKAXE_ITEMS);
  const stoneTierPickaxeCount = sumItems(counts, STONE_TIER_PICKAXES);
  const cobbleCount = counts.cobblestone ?? 0;
  const coalCount = (counts.coal ?? 0) + (counts.charcoal ?? 0);
  const torchCount = counts.torch ?? 0;
  const craftingTableCount = counts.crafting_table ?? 0;
  const furnaceCount = counts.furnace ?? 0;

  if (!home) {
    return {
      summary: "Setting home waypoint",
      actions: [{ type: "set_waypoint", name: "home" }]
    };
  }

  if (logCount < 8 && plankCount < 20) {
    return {
      summary: "Gathering wood logs",
      actions: [
        {
          type: "mine_block",
          block: findBestNearbyLog(bot) ?? "oak_log",
          maxDistance: 32,
          timeoutMs: 32000
        }
      ]
    };
  }

  const plankItem = pickPlankToCraft(counts);
  if (plankCount < 24 && plankItem) {
    return {
      summary: `Crafting ${plankItem}`,
      actions: [
        {
          type: "craft_item",
          item: plankItem,
          count: 24 - plankCount
        }
      ]
    };
  }

  if (craftingTableCount < 1 && plankCount >= 4) {
    return {
      summary: "Crafting a crafting table",
      actions: [{ type: "craft_item", item: "crafting_table", count: 1 }]
    };
  }

  if (stickCount < 6 && plankCount >= 2) {
    return {
      summary: "Crafting sticks",
      actions: [{ type: "craft_item", item: "stick", count: 8 }]
    };
  }

  if (pickaxeCount < 1 && stickCount >= 2 && plankCount >= 3) {
    return {
      summary: "Crafting wooden pickaxe",
      actions: [{ type: "craft_item", item: "wooden_pickaxe", count: 1 }]
    };
  }

  if (cobbleCount < 24 && pickaxeCount >= 1) {
    return {
      summary: "Mining stone for cobblestone",
      actions: [{ type: "mine_block", block: "stone", maxDistance: 24, timeoutMs: 26000 }]
    };
  }

  if (stoneTierPickaxeCount < 1 && cobbleCount >= 3 && stickCount >= 2) {
    return {
      summary: "Crafting stone pickaxe",
      actions: [{ type: "craft_item", item: "stone_pickaxe", count: 1 }]
    };
  }

  if (furnaceCount < 1 && cobbleCount >= 8) {
    return {
      summary: "Crafting furnace",
      actions: [{ type: "craft_item", item: "furnace", count: 1 }]
    };
  }

  if (coalCount < 8 && stoneTierPickaxeCount >= 1) {
    return {
      summary: "Mining coal ore",
      actions: [{ type: "mine_block", block: "coal_ore", maxDistance: 28, timeoutMs: 26000 }]
    };
  }

  if (torchCount < 16 && coalCount >= 1 && stickCount >= 1) {
    return {
      summary: "Crafting torches",
      actions: [{ type: "craft_item", item: "torch", count: 16 }]
    };
  }

  const homeDistance = distanceToWaypoint(bot, home);
  if (homeDistance !== null && homeDistance > 60) {
    return {
      summary: "Returning closer to home",
      actions: [{ type: "goto_waypoint", name: "home", radius: 4, timeoutMs: 30000 }]
    };
  }

  const patrol = nextPatrolPoint(home, state.tickCount);
  return {
    summary: "Patrolling around home",
    actions: [
      {
        type: "move_to",
        x: patrol.x,
        y: patrol.y,
        z: patrol.z,
        radius: 3,
        timeoutMs: 16000
      }
    ]
  };
}

function inventoryCounts(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) {
    counts[item.name] = (counts[item.name] ?? 0) + item.count;
  }
  return counts;
}

function sumItems(counts, names) {
  let total = 0;
  for (const name of names) {
    total += counts[name] ?? 0;
  }
  return total;
}

function pickPlankToCraft(counts) {
  for (const pair of LOG_TO_PLANK) {
    if ((counts[pair.log] ?? 0) > 0) {
      return pair.plank;
    }
  }
  return null;
}

function findBestNearbyLog(bot) {
  for (const name of LOG_BLOCK_PRIORITY) {
    const id = bot.registry.blocksByName[name]?.id;
    if (!id) {
      continue;
    }
    const block = bot.findBlock({
      matching: id,
      maxDistance: 32
    });
    if (block) {
      return name;
    }
  }

  return null;
}

function distanceToWaypoint(bot, waypoint) {
  if (!waypoint || !bot.entity?.position) {
    return null;
  }

  const currentDimension = bot.game?.dimension ?? "unknown";
  if (waypoint.dimension && waypoint.dimension !== currentDimension) {
    return null;
  }

  const dx = bot.entity.position.x - waypoint.x;
  const dy = bot.entity.position.y - waypoint.y;
  const dz = bot.entity.position.z - waypoint.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function nextPatrolPoint(home, tickCount) {
  const index = Number.isFinite(tickCount) ? tickCount : 0;
  const angle = (index % 8) * (Math.PI / 4);
  const radius = 8 + ((index % 3) + 1) * 3;

  return {
    x: round(home.x + Math.cos(angle) * radius),
    y: round(home.y),
    z: round(home.z + Math.sin(angle) * radius)
  };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
