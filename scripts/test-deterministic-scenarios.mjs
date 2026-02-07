import assert from "node:assert/strict";
import { buildAutonomyPlan } from "../src/runtime/autonomy.js";

const BASE_POLICY = {
  surfaceRiskTolerance: 0.2,
  maxSurfaceMinutesPerTrip: 6,
  undergroundBaseDepthTarget: 56,
  hostileAvoidanceWeight: 0.9,
  explorationWeight: 0.25,
  buildingWeight: 0.6,
  minTorchReserve: 32,
  minFoodReserve: 8,
  minCoalReserve: 12,
  minIronReserve: 12,
  preferredMission: "underground_progression"
};

const BLOCK_IDS = {
  stone: 1,
  deepslate: 2,
  coal_ore: 3,
  deepslate_coal_ore: 4,
  iron_ore: 5,
  deepslate_iron_ore: 6,
  oak_log: 7,
  torch: 8,
  wall_torch: 9
};

function createVector(x, y, z) {
  return {
    x,
    y,
    z,
    distanceTo(other) {
      const dx = x - other.x;
      const dy = y - other.y;
      const dz = z - other.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  };
}

function createBot({
  y = 40,
  timeOfDay = 6000,
  inventory = {},
  emptySlots = null,
  nearbyBlocks = [],
  entities = {}
} = {}) {
  const byName = {};
  const byId = {};
  for (const [name, id] of Object.entries(BLOCK_IDS)) {
    byName[name] = { id };
    byId[id] = name;
  }

  const nearby = new Set(nearbyBlocks);

  return {
    entity: {
      position: createVector(0, y, 0)
    },
    entities,
    time: { timeOfDay },
    game: { dimension: "minecraft:overworld" },
    inventory: {
      items() {
        return Object.entries(inventory).map(([name, count], index) => ({
          name,
          type: 1000 + index,
          count
        }));
      },
      emptySlotCount() {
        if (Number.isFinite(emptySlots)) {
          return emptySlots;
        }
        return Math.max(0, 36 - Object.keys(inventory).length);
      }
    },
    registry: {
      blocksByName: byName,
      foodsByName: {
        bread: { foodPoints: 5, saturation: 6 }
      }
    },
    findBlock({ matching }) {
      const name = byId[matching];
      if (!name || !nearby.has(name)) {
        return null;
      }
      return { name, position: createVector(2, y, 2) };
    },
    findBlocks({ matching, count = 1 }) {
      const name = byId[matching];
      if (!name || !nearby.has(name)) {
        return [];
      }
      return Array.from({ length: Math.max(1, count) }, (_, index) =>
        createVector(2 + index, y, 2 + index)
      );
    }
  };
}

function createState({
  active = "cave_dweller",
  tickCount = 1,
  waypoints = {},
  policy = BASE_POLICY
} = {}) {
  return {
    autonomyEnabled: true,
    goalMode: "auto",
    tickCount,
    waypoints,
    personality: {
      active,
      stage: "CD-0",
      policy: { ...policy }
    }
  };
}

function runScenario(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    return false;
  }
}

const scenarios = [
  {
    name: "cave dweller retreats to home core when at surface at night",
    run() {
      const bot = createBot({
        y: 68,
        timeOfDay: 14000,
        inventory: { torch: 10, bread: 6 }
      });
      const state = createState({
        waypoints: {
          home_core: {
            x: 0,
            y: 32,
            z: 0,
            dimension: "minecraft:overworld"
          }
        }
      });

      const plan = buildAutonomyPlan(bot, state);
      assert.ok(plan);
      assert.equal(plan.actions[0].type, "goto_waypoint");
      assert.equal(plan.actions[0].name, "home_core");
    }
  },
  {
    name: "cave dweller reaches CD-3 with branch network and iron baseline",
    run() {
      const bot = createBot({
        y: 36,
        inventory: {
          torch: 64,
          furnace: 1,
          coal: 48,
          bread: 24,
          iron_ingot: 24,
          iron_pickaxe: 1,
          shield: 1
        }
      });
      const state = createState({
        waypoints: {
          home_core: { x: 0, y: 36, z: 0, dimension: "minecraft:overworld" },
          mine_branch_alpha: {
            x: 10,
            y: 36,
            z: 0,
            dimension: "minecraft:overworld"
          },
          mine_branch_beta: {
            x: 0,
            y: 36,
            z: 10,
            dimension: "minecraft:overworld"
          }
        }
      });

      const plan = buildAutonomyPlan(bot, state);
      assert.ok(plan);
      assert.equal(state.personality.stage, "CD-3");
      assert.match(plan.summary, /^CaveDweller CD-3:/);
    }
  },
  {
    name: "CD-2 sets alpha branch marker if missing",
    run() {
      const bot = createBot({
        y: 38,
        inventory: {
          torch: 40,
          furnace: 1,
          coal: 32,
          bread: 16,
          iron_ingot: 8,
          iron_pickaxe: 1
        }
      });
      const state = createState({
        waypoints: {
          home_core: { x: 0, y: 38, z: 0, dimension: "minecraft:overworld" }
        }
      });

      const plan = buildAutonomyPlan(bot, state);
      assert.ok(plan);
      assert.equal(state.personality.stage, "CD-2");
      assert.equal(plan.actions[0].type, "move_to");
      assert.equal(plan.actions[1].type, "set_waypoint");
      assert.equal(plan.actions[1].name, "mine_branch_alpha");
    }
  },
  {
    name: "CD-3 crafts shield when missing but resources are ready",
    run() {
      const bot = createBot({
        y: 34,
        inventory: {
          torch: 64,
          furnace: 1,
          coal: 48,
          bread: 16,
          iron_ingot: 20,
          iron_pickaxe: 1,
          oak_planks: 12,
          stick: 4
        }
      });
      const state = createState({
        waypoints: {
          home_core: { x: 0, y: 34, z: 0, dimension: "minecraft:overworld" },
          mine_branch_alpha: {
            x: 10,
            y: 34,
            z: 0,
            dimension: "minecraft:overworld"
          },
          mine_branch_beta: {
            x: 0,
            y: 34,
            z: 10,
            dimension: "minecraft:overworld"
          }
        }
      });

      const plan = buildAutonomyPlan(bot, state);
      assert.ok(plan);
      assert.equal(state.personality.stage, "CD-3");
      assert.equal(plan.actions[0].type, "craft_item");
      assert.equal(plan.actions[0].item, "shield");
    }
  },
  {
    name: "default persona still establishes home waypoint first",
    run() {
      const bot = createBot({ y: 68, inventory: {} });
      const state = createState({
        active: "default",
        waypoints: {}
      });

      const plan = buildAutonomyPlan(bot, state);
      assert.ok(plan);
      assert.equal(plan.actions[0].type, "set_waypoint");
      assert.equal(plan.actions[0].name, "home");
    }
  },
  {
    name: "default night shelter places torch when near home on surface",
    run() {
      const bot = createBot({
        y: 68,
        timeOfDay: 14000,
        inventory: { torch: 12, cobblestone: 20 }
      });
      const state = createState({
        active: "default",
        waypoints: {
          home: { x: 0, y: 68, z: 0, dimension: "minecraft:overworld" }
        }
      });

      const plan = buildAutonomyPlan(bot, state);
      assert.ok(plan);
      assert.match(plan.summary, /^Night shelter:/);
      assert.equal(plan.actions[0].type, "place_block");
      assert.equal(plan.actions[0].block, "torch");
    }
  },
  {
    name: "default mode triggers inventory cleanup when slots are low and junk overflows",
    run() {
      const bot = createBot({
        y: 64,
        timeOfDay: 6000,
        emptySlots: 1,
        inventory: {
          cobblestone: 260,
          dirt: 64,
          torch: 8
        }
      });
      const state = createState({
        active: "default",
        waypoints: {
          home: { x: 0, y: 64, z: 0, dimension: "minecraft:overworld" }
        }
      });

      const plan = buildAutonomyPlan(bot, state);
      assert.ok(plan);
      assert.match(plan.summary, /inventory cleanup/);
      assert.equal(plan.actions[0].type, "drop_items");
    }
  }
];

let passed = 0;
for (const scenario of scenarios) {
  if (runScenario(scenario.name, scenario.run)) {
    passed += 1;
  }
}

console.log(`\n${passed}/${scenarios.length} scenarios passed`);
if (passed !== scenarios.length) {
  process.exitCode = 1;
}
