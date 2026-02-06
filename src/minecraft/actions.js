import pathfinderPkg from "mineflayer-pathfinder";

const { goals } = pathfinderPkg;

const { GoalNear, GoalFollow } = goals;

export async function executeActions(bot, actions, context) {
  for (const action of actions) {
    try {
      await runAction(bot, action, context);
    } catch (error) {
      console.warn(`[action:${action.type}] ${error.message}`);
    }
  }
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
    case "wait":
      await sleep(action.ms);
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
