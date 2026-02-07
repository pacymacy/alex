const PERSONALITY_DEFAULT = "default";
const PERSONALITY_CAVE_DWELLER = "cave_dweller";
const PERSONALITY_NAMES = [PERSONALITY_DEFAULT, PERSONALITY_CAVE_DWELLER];

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
const IRON_TIER_PICKAXES = [
  "iron_pickaxe",
  "diamond_pickaxe",
  "netherite_pickaxe"
];
const LOW_VALUE_DROP_KEEP = {
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

export function listPersonalities() {
  return [...PERSONALITY_NAMES];
}

export function normalizePersonalityName(value) {
  const name = String(value ?? "").trim().toLowerCase();
  return PERSONALITY_NAMES.includes(name) ? name : PERSONALITY_DEFAULT;
}

export function buildAutonomyPlan(bot, state) {
  if (!state.autonomyEnabled || state.goalMode === "manual") {
    return null;
  }

  const activePersonality = normalizePersonalityName(
    state.personality?.active ?? PERSONALITY_DEFAULT
  );

  if (activePersonality === PERSONALITY_CAVE_DWELLER) {
    return buildCaveDwellerPlan(bot, state);
  }

  return buildDefaultPlan(bot, state);
}

function buildDefaultPlan(bot, state) {
  const counts = inventoryCounts(bot);
  const home = resolveHomeWaypoint(state);
  const world = summarizeWorld(bot);
  const isUnderground = isLikelyUnderground(bot, 56);
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

  const inventoryRecovery = maybeBuildInventoryRecoveryPlan(
    bot,
    counts,
    "Default",
    3
  );
  if (inventoryRecovery) {
    return inventoryRecovery;
  }

  const homeDistance = distanceToWaypoint(bot, home);
  if (world.isNight && !isUnderground) {
    if (homeDistance !== null && homeDistance > 16) {
      return {
        summary: "Night shelter: returning to home perimeter",
        actions: [{ type: "goto_waypoint", name: home.name, radius: 4, timeoutMs: 30000 }]
      };
    }

    const nearbyTorchCount = countNearbyBlocks(bot, ["torch", "wall_torch"], 12, 8);
    if (torchCount > 0 && nearbyTorchCount < 3) {
      return {
        summary: "Night shelter: placing defensive torch lighting",
        actions: [{ type: "place_block", block: "torch" }]
      };
    }

    return {
      summary: "Night shelter: waiting in safe area",
      actions: [{ type: "wait", ms: 1200 }]
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
      actions: [
        {
          type: "mine_block",
          block: pickNearbyStone(bot),
          maxDistance: 24,
          timeoutMs: 26000
        }
      ]
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
      actions: [
        {
          type: "mine_block",
          block: pickNearbyCoalOre(bot),
          maxDistance: 28,
          timeoutMs: 26000
        }
      ]
    };
  }

  if (torchCount < 16 && coalCount >= 1 && stickCount >= 1) {
    return {
      summary: "Crafting torches",
      actions: [{ type: "craft_item", item: "torch", count: 16 }]
    };
  }

  if (homeDistance !== null && homeDistance > 60) {
    return {
      summary: "Returning closer to home",
      actions: [{ type: "goto_waypoint", name: home.name, radius: 4, timeoutMs: 30000 }]
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

function buildCaveDwellerPlan(bot, state) {
  const policy = state.personality?.policy ?? {};
  const counts = inventoryCounts(bot);
  const world = summarizeWorld(bot);
  const hostiles = findNearbyHostiles(bot, 14);
  const isUnderground = isLikelyUnderground(bot, policy.undergroundBaseDepthTarget);
  const surfaceEntry = getWaypoint(state, "surface_entry_main");
  const homeCore = getWaypoint(state, "home_core");
  const foodCount = countFoodItems(bot);

  const stage = deriveCaveDwellerStage({
    homeCore,
    counts,
    foodCount,
    policy,
    state
  });
  setPersonalityStage(state, stage);

  // Cave-dweller hard rule: avoid surface at night and retreat underground on threats.
  if (!isUnderground && (world.isNight || hostiles.length > 0)) {
    if (homeCore) {
      return {
        summary: "CaveDweller: retreating underground due to night/threat",
        actions: [{ type: "goto_waypoint", name: "home_core", radius: 4, timeoutMs: 35000 }]
      };
    }
    if (surfaceEntry) {
      return {
        summary: "CaveDweller: holding near known surface entry",
        actions: [{ type: "goto_waypoint", name: "surface_entry_main", radius: 4, timeoutMs: 20000 }]
      };
    }
  }

  if (stage === "CD-0") {
    return buildCaveStage0Plan({
      bot,
      state,
      counts,
      isUnderground,
      surfaceEntry,
      homeCore
    });
  }

  if (stage === "CD-1") {
    return buildCaveStage1Plan({
      bot,
      state,
      counts,
      foodCount,
      world,
      isUnderground,
      homeCore
    });
  }

  if (stage === "CD-2") {
    return buildCaveStage2Plan({
      bot,
      state,
      counts,
      world,
      isUnderground,
      homeCore
    });
  }

  return buildCaveStage3Plan({
    bot,
    state,
    counts,
    foodCount,
    world,
    isUnderground,
    homeCore,
    policy
  });
}

function buildCaveStage0Plan(input) {
  const { bot, counts, isUnderground, surfaceEntry, homeCore } = input;
  const logCount = sumItems(counts, LOG_BLOCK_PRIORITY);
  const plankCount = sumItems(counts, PLANK_ITEMS);
  const stickCount = counts.stick ?? 0;
  const pickaxeCount = sumItems(counts, PICKAXE_ITEMS);

  const inventoryRecovery = maybeBuildInventoryRecoveryPlan(
    bot,
    counts,
    "CaveDweller CD-0",
    2
  );
  if (inventoryRecovery) {
    return inventoryRecovery;
  }

  if (!surfaceEntry && !isUnderground) {
    return {
      summary: "CaveDweller CD-0: tagging primary surface entry",
      actions: [{ type: "set_waypoint", name: "surface_entry_main" }]
    };
  }

  if (!homeCore && isUnderground) {
    return {
      summary: "CaveDweller CD-0: tagging underground core",
      actions: [{ type: "set_waypoint", name: "home_core" }]
    };
  }

  if (logCount < 10 && plankCount < 20) {
    return {
      summary: "CaveDweller CD-0: collecting startup logs",
      actions: [
        {
          type: "mine_block",
          block: findBestNearbyLog(bot) ?? "oak_log",
          maxDistance: 34,
          timeoutMs: 32000
        }
      ]
    };
  }

  const plankItem = pickPlankToCraft(counts);
  if (plankCount < 20 && plankItem) {
    return {
      summary: "CaveDweller CD-0: crafting planks",
      actions: [{ type: "craft_item", item: plankItem, count: 20 - plankCount }]
    };
  }

  if (stickCount < 4 && plankCount >= 2) {
    return {
      summary: "CaveDweller CD-0: crafting sticks",
      actions: [{ type: "craft_item", item: "stick", count: 6 }]
    };
  }

  if (pickaxeCount < 1 && stickCount >= 2 && plankCount >= 3) {
    return {
      summary: "CaveDweller CD-0: crafting wooden pickaxe",
      actions: [{ type: "craft_item", item: "wooden_pickaxe", count: 1 }]
    };
  }

  if (!isUnderground) {
    return {
      summary: "CaveDweller CD-0: moving underground via stone exposure",
      actions: [
        {
          type: "mine_block",
          block: pickNearbyStone(bot),
          maxDistance: 42,
          timeoutMs: 32000
        }
      ]
    };
  }

  return {
    summary: "CaveDweller CD-0: waiting for stable underground position",
    actions: [{ type: "wait", ms: 1200 }]
  };
}

function buildCaveStage1Plan(input) {
  const { bot, counts, foodCount, world, isUnderground, homeCore } = input;
  const plankCount = sumItems(counts, PLANK_ITEMS);
  const stickCount = counts.stick ?? 0;
  const pickaxeCount = sumItems(counts, PICKAXE_ITEMS);
  const stoneTierPickaxeCount = sumItems(counts, STONE_TIER_PICKAXES);
  const cobbleCount = counts.cobblestone ?? 0;
  const coalCount = (counts.coal ?? 0) + (counts.charcoal ?? 0);
  const torchCount = counts.torch ?? 0;
  const craftingTableCount = counts.crafting_table ?? 0;
  const furnaceCount = counts.furnace ?? 0;

  const inventoryRecovery = maybeBuildInventoryRecoveryPlan(
    bot,
    counts,
    "CaveDweller CD-1",
    3
  );
  if (inventoryRecovery) {
    return inventoryRecovery;
  }

  if (!homeCore && isUnderground) {
    return {
      summary: "CaveDweller CD-1: saving home core waypoint",
      actions: [{ type: "set_waypoint", name: "home_core" }]
    };
  }

  if (!isUnderground && world.isNight && homeCore) {
    return {
      summary: "CaveDweller CD-1: returning underground for night safety",
      actions: [{ type: "goto_waypoint", name: "home_core", radius: 4, timeoutMs: 35000 }]
    };
  }

  if (craftingTableCount < 1 && plankCount >= 4) {
    return {
      summary: "CaveDweller CD-1: crafting table",
      actions: [{ type: "craft_item", item: "crafting_table", count: 1 }]
    };
  }

  if (pickaxeCount < 1 && stickCount >= 2 && plankCount >= 3) {
    return {
      summary: "CaveDweller CD-1: crafting wooden pickaxe",
      actions: [{ type: "craft_item", item: "wooden_pickaxe", count: 1 }]
    };
  }

  if (cobbleCount < 18 && pickaxeCount >= 1) {
    return {
      summary: "CaveDweller CD-1: mining stone for core infrastructure",
      actions: [
        {
          type: "mine_block",
          block: pickNearbyStone(bot),
          maxDistance: 24,
          timeoutMs: 26000
        }
      ]
    };
  }

  if (furnaceCount < 1 && cobbleCount >= 8) {
    return {
      summary: "CaveDweller CD-1: crafting furnace",
      actions: [{ type: "craft_item", item: "furnace", count: 1 }]
    };
  }

  if (stoneTierPickaxeCount < 1 && cobbleCount >= 3 && stickCount >= 2) {
    return {
      summary: "CaveDweller CD-1: upgrading to stone pickaxe",
      actions: [{ type: "craft_item", item: "stone_pickaxe", count: 1 }]
    };
  }

  if (coalCount < 12 && stoneTierPickaxeCount >= 1) {
    return {
      summary: "CaveDweller CD-1: mining coal for cave lighting",
      actions: [
        {
          type: "mine_block",
          block: pickNearbyCoalOre(bot),
          maxDistance: 26,
          timeoutMs: 26000
        }
      ]
    };
  }

  if (torchCount < 32 && coalCount >= 1 && stickCount >= 1) {
    return {
      summary: "CaveDweller CD-1: crafting torch reserve",
      actions: [{ type: "craft_item", item: "torch", count: 32 - torchCount }]
    };
  }

  if (foodCount < 8 && world.isDay && !isUnderground) {
    return {
      summary: "CaveDweller CD-1: brief surface forage window",
      actions: [{ type: "mine_block", block: findBestNearbyLog(bot) ?? "oak_log", maxDistance: 20, timeoutMs: 18000 }]
    };
  }

  if (homeCore) {
    const distanceFromCore = distanceToWaypoint(bot, homeCore);
    if (distanceFromCore !== null && distanceFromCore > 48) {
      return {
        summary: "CaveDweller CD-1: returning to underground core radius",
        actions: [{ type: "goto_waypoint", name: "home_core", radius: 4, timeoutMs: 30000 }]
      };
    }
  }

  return {
    summary: "CaveDweller CD-1: stabilizing cave outpost",
    actions: [{ type: "wait", ms: 1000 }]
  };
}

function buildCaveStage2Plan(input) {
  const { bot, counts, world, isUnderground, homeCore, state } = input;
  const stickCount = counts.stick ?? 0;
  const coalCount = (counts.coal ?? 0) + (counts.charcoal ?? 0);
  const torchCount = counts.torch ?? 0;
  const stoneTierPickaxeCount = sumItems(counts, STONE_TIER_PICKAXES);
  const ironIngotCount = counts.iron_ingot ?? 0;

  const inventoryRecovery = maybeBuildInventoryRecoveryPlan(
    bot,
    counts,
    "CaveDweller CD-2",
    3
  );
  if (inventoryRecovery) {
    return inventoryRecovery;
  }

  if (!isUnderground && world.isNight && homeCore) {
    return {
      summary: "CaveDweller CD-2: night detected, returning underground",
      actions: [{ type: "goto_waypoint", name: "home_core", radius: 4, timeoutMs: 35000 }]
    };
  }

  if (!getWaypoint(state, "mine_branch_alpha") && homeCore) {
    return {
      summary: "CaveDweller CD-2: creating alpha mining branch marker",
      actions: [
        {
          type: "move_to",
          x: homeCore.x + 10,
          y: homeCore.y,
          z: homeCore.z,
          radius: 3,
          timeoutMs: 16000
        },
        { type: "set_waypoint", name: "mine_branch_alpha" }
      ]
    };
  }

  if (!getWaypoint(state, "mine_branch_beta") && homeCore) {
    return {
      summary: "CaveDweller CD-2: creating beta mining branch marker",
      actions: [
        {
          type: "move_to",
          x: homeCore.x,
          y: homeCore.y,
          z: homeCore.z + 10,
          radius: 3,
          timeoutMs: 16000
        },
        { type: "set_waypoint", name: "mine_branch_beta" }
      ]
    };
  }

  if (torchCount < 32 && coalCount >= 1 && stickCount >= 1) {
    return {
      summary: "CaveDweller CD-2: maintaining torch reserve",
      actions: [{ type: "craft_item", item: "torch", count: 32 - torchCount }]
    };
  }

  if (stoneTierPickaxeCount < 1) {
    return {
      summary: "CaveDweller CD-2: ensuring stone-tier mining tool",
      actions: [{ type: "craft_item", item: "stone_pickaxe", count: 1 }]
    };
  }

  if (ironIngotCount < 12) {
    return {
      summary: "CaveDweller CD-2: mining iron for progression",
      actions: [
        {
          type: "mine_block",
          block: pickNearbyIronOre(bot),
          maxDistance: 28,
          timeoutMs: 28000
        }
      ]
    };
  }

  if (coalCount < 24) {
    return {
      summary: "CaveDweller CD-2: topping up coal reserves",
      actions: [
        {
          type: "mine_block",
          block: pickNearbyCoalOre(bot),
          maxDistance: 28,
          timeoutMs: 26000
        }
      ]
    };
  }

  return {
    summary: "CaveDweller CD-2: branch mining for stone and safety",
    actions: [
      {
        type: "mine_block",
        block: pickNearbyStone(bot),
        maxDistance: 24,
        timeoutMs: 24000
      }
    ]
  };
}

function buildCaveStage3Plan(input) {
  const { bot, counts, foodCount, world, isUnderground, homeCore, state, policy } =
    input;
  const stickCount = counts.stick ?? 0;
  const plankCount = sumItems(counts, PLANK_ITEMS);
  const cobbleCount = counts.cobblestone ?? 0;
  const coalCount = (counts.coal ?? 0) + (counts.charcoal ?? 0);
  const torchCount = counts.torch ?? 0;
  const ironIngotCount = counts.iron_ingot ?? 0;
  const shieldCount = counts.shield ?? 0;
  const ironPickaxeCount = counts.iron_pickaxe ?? 0;
  const totalPickaxeCount = sumItems(counts, PICKAXE_ITEMS);
  const minTorchTarget = Math.max(48, policy.minTorchReserve ?? 32);
  const minCoalTarget = Math.max(24, policy.minCoalReserve ?? 12);
  const minIronTarget = Math.max(16, policy.minIronReserve ?? 12);
  const minFoodTarget = Math.max(12, policy.minFoodReserve ?? 8);

  const inventoryRecovery = maybeBuildInventoryRecoveryPlan(
    bot,
    counts,
    "CaveDweller CD-3",
    4
  );
  if (inventoryRecovery) {
    return inventoryRecovery;
  }

  if (!isUnderground && world.isNight && homeCore) {
    return {
      summary: "CaveDweller CD-3: night exposure detected, retreating to core",
      actions: [{ type: "goto_waypoint", name: "home_core", radius: 4, timeoutMs: 35000 }]
    };
  }

  if (!isUnderground && findNearbyHostiles(bot, 14).length > 0 && homeCore) {
    return {
      summary: "CaveDweller CD-3: surface threats detected, retreating underground",
      actions: [{ type: "goto_waypoint", name: "home_core", radius: 4, timeoutMs: 35000 }]
    };
  }

  if (homeCore) {
    const distanceFromCore = distanceToWaypoint(bot, homeCore);
    if (distanceFromCore !== null && distanceFromCore > 72) {
      return {
        summary: "CaveDweller CD-3: too far from core, returning to safe radius",
        actions: [{ type: "goto_waypoint", name: "home_core", radius: 4, timeoutMs: 32000 }]
      };
    }
  }

  if (!getWaypoint(state, "surface_entry_backup") && !world.isNight) {
    if (!isUnderground) {
      return {
        summary: "CaveDweller CD-3: tagging backup surface entry",
        actions: [{ type: "set_waypoint", name: "surface_entry_backup" }]
      };
    }

    if (getWaypoint(state, "surface_entry_main")) {
      return {
        summary: "CaveDweller CD-3: routing toward surface entry for backup path setup",
        actions: [{ type: "goto_waypoint", name: "surface_entry_main", radius: 4, timeoutMs: 26000 }]
      };
    }
  }

  if (shieldCount < 1 && ironIngotCount >= 1 && plankCount >= 6) {
    return {
      summary: "CaveDweller CD-3: crafting shield for corridor combat safety",
      actions: [{ type: "craft_item", item: "shield", count: 1 }]
    };
  }

  if (ironPickaxeCount < 1 && ironIngotCount >= 3 && stickCount >= 2) {
    return {
      summary: "CaveDweller CD-3: restoring iron pickaxe baseline",
      actions: [{ type: "craft_item", item: "iron_pickaxe", count: 1 }]
    };
  }

  if (totalPickaxeCount < 2 && cobbleCount >= 3 && stickCount >= 2) {
    return {
      summary: "CaveDweller CD-3: crafting backup mining tool",
      actions: [{ type: "craft_item", item: "stone_pickaxe", count: 1 }]
    };
  }

  if (torchCount < minTorchTarget && coalCount >= 1 && stickCount >= 1) {
    return {
      summary: "CaveDweller CD-3: replenishing deep-cave torch reserves",
      actions: [{ type: "craft_item", item: "torch", count: minTorchTarget - torchCount }]
    };
  }

  if (foodCount < minFoodTarget && isUnderground && getWaypoint(state, "surface_entry_main")) {
    return {
      summary: "CaveDweller CD-3: low food reserve, moving toward controlled surface exit",
      actions: [{ type: "goto_waypoint", name: "surface_entry_main", radius: 4, timeoutMs: 28000 }]
    };
  }

  if (ironIngotCount < minIronTarget) {
    return {
      summary: "CaveDweller CD-3: mining iron to stabilize gear pipeline",
      actions: [{ type: "mine_block", block: pickNearbyIronOre(bot), maxDistance: 30, timeoutMs: 28000 }]
    };
  }

  if (coalCount < minCoalTarget) {
    return {
      summary: "CaveDweller CD-3: mining coal for sustained smelting and torches",
      actions: [{ type: "mine_block", block: pickNearbyCoalOre(bot), maxDistance: 28, timeoutMs: 26000 }]
    };
  }

  return {
    summary: "CaveDweller CD-3: disciplined branch mining with shielded fallback",
    actions: [{ type: "mine_block", block: pickNearbyStone(bot), maxDistance: 24, timeoutMs: 24000 }]
  };
}

function deriveCaveDwellerStage(input) {
  const { homeCore, counts, foodCount, policy, state } = input;
  const torchCount = counts.torch ?? 0;
  const furnaceCount = counts.furnace ?? 0;
  const coalCount = (counts.coal ?? 0) + (counts.charcoal ?? 0);
  const ironIngotCount = counts.iron_ingot ?? 0;
  const ironTierPickaxeCount = sumItems(counts, IRON_TIER_PICKAXES);
  const hasBranchNetwork = Boolean(
    getWaypoint(state, "mine_branch_alpha") && getWaypoint(state, "mine_branch_beta")
  );

  if (!homeCore) {
    return "CD-0";
  }

  if (
    torchCount < policy.minTorchReserve ||
    furnaceCount < 1 ||
    coalCount < policy.minCoalReserve ||
    foodCount < policy.minFoodReserve
  ) {
    return "CD-1";
  }

  if (
    !hasBranchNetwork ||
    ironTierPickaxeCount < 1 ||
    ironIngotCount < (policy.minIronReserve ?? 12)
  ) {
    return "CD-2";
  }

  return "CD-3";
}

function setPersonalityStage(state, nextStage) {
  if (!state.personality) {
    return;
  }

  if (state.personality.stage === nextStage) {
    return;
  }

  state.personality.stage = nextStage;
  state.personality.lastStageChangeAt = new Date().toISOString();
}

function getWaypoint(state, name) {
  return state.waypoints?.[name] ?? null;
}

function resolveHomeWaypoint(state) {
  const homeCore = getWaypoint(state, "home_core");
  if (homeCore) {
    return { ...homeCore, name: "home_core" };
  }

  const home = getWaypoint(state, "home");
  if (home) {
    return { ...home, name: "home" };
  }

  return null;
}

function findNearbyHostiles(bot, maxDistance) {
  const position = bot.entity?.position;
  if (!position) {
    return [];
  }

  return Object.values(bot.entities)
    .filter((entity) => entity?.type === "mob")
    .map((entity) => ({
      name: String(entity.name ?? "").toLowerCase(),
      distance: position.distanceTo(entity.position)
    }))
    .filter(
      (entry) =>
        entry.distance <= maxDistance && HOSTILE_MOB_NAMES.has(entry.name)
    )
    .sort((a, b) => a.distance - b.distance);
}

function isLikelyUnderground(bot, undergroundDepthTarget) {
  const y = Number(bot.entity?.position?.y ?? 100);
  return y <= undergroundDepthTarget;
}

function summarizeWorld(bot) {
  const timeOfDay = Number(bot.time?.timeOfDay ?? 0);
  return {
    isNight: timeOfDay >= 13000 && timeOfDay <= 23000
  };
}

function inventoryCounts(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) {
    counts[item.name] = (counts[item.name] ?? 0) + item.count;
  }
  return counts;
}

function countFoodItems(bot) {
  const foods = bot.registry?.foodsByName ?? {};
  let total = 0;

  for (const item of bot.inventory.items()) {
    if (foods[item.name]) {
      total += item.count;
    }
  }

  return total;
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

function pickNearbyIronOre(bot) {
  return pickNearbyBlockName(bot, ["deepslate_iron_ore", "iron_ore"], 30);
}

function pickNearbyCoalOre(bot) {
  return pickNearbyBlockName(bot, ["deepslate_coal_ore", "coal_ore"], 30);
}

function pickNearbyStone(bot) {
  return pickNearbyBlockName(bot, ["stone", "deepslate", "cobbled_deepslate"], 24);
}

function pickNearbyBlockName(bot, candidates, maxDistance) {
  for (const name of candidates) {
    const id = bot.registry.blocksByName[name]?.id;
    if (!id) {
      continue;
    }
    const block = bot.findBlock({
      matching: id,
      maxDistance
    });
    if (block) {
      return name;
    }
  }

  return candidates[0];
}

function maybeBuildInventoryRecoveryPlan(bot, counts, label, minFreeSlots) {
  const freeSlots = estimateFreeInventorySlots(bot);
  if (freeSlots >= minFreeSlots) {
    return null;
  }

  if (!hasDroppableOverflow(counts)) {
    return null;
  }

  return {
    summary: `${label}: inventory cleanup (freeSlots=${freeSlots})`,
    actions: [{ type: "drop_items", minFreeSlots: Math.max(4, minFreeSlots + 1) }]
  };
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

function hasDroppableOverflow(counts) {
  for (const [name, keep] of Object.entries(LOW_VALUE_DROP_KEEP)) {
    if ((counts[name] ?? 0) > keep) {
      return true;
    }
  }
  return false;
}

function countNearbyBlocks(bot, blockNames, maxDistance, countPerType) {
  if (typeof bot.findBlocks !== "function") {
    return 0;
  }

  let total = 0;
  for (const name of blockNames) {
    const id = bot.registry.blocksByName[name]?.id;
    if (!id) {
      continue;
    }

    const matches = bot.findBlocks({
      matching: id,
      maxDistance,
      count: countPerType
    });
    total += Array.isArray(matches) ? matches.length : 0;
  }
  return total;
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
