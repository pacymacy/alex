const INTERESTING_BLOCK_NAMES = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "stone",
  "coal_ore",
  "iron_ore",
  "crafting_table",
  "furnace"
];

export function buildObservation(bot, state) {
  const position = bot.entity?.position;

  return {
    timestamp: new Date().toISOString(),
    tick: state.tickCount,
    goal: state.goal,
    bot: {
      username: bot.username,
      health: round(bot.health),
      food: round(bot.food),
      position: toPoint(position),
      dimension: bot.game?.dimension ?? "unknown",
      onGround: Boolean(bot.entity?.onGround)
    },
    inventory: summarizeInventory(bot),
    nearbyPlayers: summarizeNearbyPlayers(bot, position),
    nearbyMobs: summarizeNearbyMobs(bot, position),
    nearbyBlocks: summarizeInterestingBlocks(bot, position),
    recentChat: state.chatLog.slice(-10),
    lastPlanSummary: state.lastPlanSummary
  };
}

function summarizeInventory(bot) {
  return bot.inventory
    .items()
    .map((item) => ({
      name: item.name,
      count: item.count
    }))
    .slice(0, 20);
}

function summarizeNearbyPlayers(bot, botPosition) {
  return Object.values(bot.players)
    .filter((entry) => entry?.entity && entry.username !== bot.username)
    .map((entry) => ({
      username: entry.username,
      distance: distance(botPosition, entry.entity.position),
      position: toPoint(entry.entity.position)
    }))
    .filter((player) => player.distance <= 48)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
}

function summarizeNearbyMobs(bot, botPosition) {
  return Object.values(bot.entities)
    .filter((entity) => entity.type === "mob")
    .map((entity) => ({
      name: entity.name,
      kind: entity.kind,
      distance: distance(botPosition, entity.position),
      position: toPoint(entity.position)
    }))
    .filter((mob) => mob.distance <= 24)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);
}

function summarizeInterestingBlocks(bot, botPosition) {
  const entries = [];

  for (const name of INTERESTING_BLOCK_NAMES) {
    const id = bot.registry.blocksByName[name]?.id;
    if (!id) {
      continue;
    }

    const positions = bot.findBlocks({
      matching: id,
      maxDistance: 24,
      count: 3
    });

    for (const pos of positions) {
      entries.push({
        name,
        distance: distance(botPosition, pos),
        position: toPoint(pos)
      });
    }
  }

  return entries.sort((a, b) => a.distance - b.distance).slice(0, 12);
}

function toPoint(position) {
  if (!position) {
    return null;
  }

  return {
    x: round(position.x),
    y: round(position.y),
    z: round(position.z)
  };
}

function distance(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }

  if (typeof a.distanceTo === "function") {
    return round(a.distanceTo(b));
  }

  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return round(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
