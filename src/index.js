import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { loadConfig } from "./config.js";
import { createPlannerClient } from "./llm/client.js";
import { executeActions, safeChat } from "./minecraft/actions.js";
import { buildObservation } from "./minecraft/observe.js";

const { Movements, pathfinder } = pathfinderPkg;

const config = await loadConfig(process.argv[2]);
const planner = createPlannerClient(config.llm);

const bot = mineflayer.createBot({
  host: config.minecraft.host,
  port: config.minecraft.port,
  username: config.minecraft.username,
  auth: config.minecraft.auth,
  version: config.minecraft.version || undefined
});

bot.loadPlugin(pathfinder);

const state = {
  paused: false,
  busy: false,
  goal: config.initialGoal,
  tickCount: 0,
  lastChatAt: 0,
  chatLog: [],
  lastPlanSummary: ""
};

let loopHandle = null;

bot.once("spawn", async () => {
  bot.pathfinder.setMovements(new Movements(bot));
  console.log(
    `[alex] Spawned as ${bot.username}. Initial goal: "${state.goal}".`
  );

  await safeChat(bot, state, 0, "alex online. type !alex help");
  loopHandle = setInterval(() => {
    void runTick(false);
  }, config.loopIntervalMs);
});

bot.on("chat", (username, message) => {
  if (username === bot.username) {
    return;
  }

  addChatLog(username, message);
  if (username === config.ownerUsername) {
    void handleOwnerCommand(message);
  }
});

bot.on("whisper", (username, message) => {
  if (username === bot.username) {
    return;
  }

  addChatLog(username, `(whisper) ${message}`);
  if (username === config.ownerUsername) {
    void handleOwnerCommand(message);
  }
});

bot.on("error", (error) => {
  console.error(`[alex] Bot error: ${error.message}`);
});

bot.on("kicked", (reason) => {
  console.error(`[alex] Kicked: ${formatKickedReason(reason)}`);
});

bot.on("end", () => {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
  console.log("[alex] Disconnected.");
});

process.on("SIGINT", () => {
  console.log("\n[alex] Shutting down...");
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
  bot.quit("shutdown");
  setTimeout(() => process.exit(0), 150);
});

async function runTick(force) {
  if (state.busy) {
    return;
  }
  if (state.paused && !force) {
    return;
  }

  state.busy = true;
  state.tickCount += 1;

  try {
    const observation = buildObservation(bot, state);
    const plan = await planner.plan({
      goal: state.goal,
      observation,
      maxActions: config.maxActionsPerTick
    });

    state.lastPlanSummary = plan.summary;

    if (plan.say) {
      await safeChat(bot, state, config.chatCooldownMs, plan.say);
    }

    await executeActions(bot, plan.actions, { config, state });
    console.log(
      `[alex] Tick ${state.tickCount} complete. actions=${plan.actions.length}`
    );
  } catch (error) {
    console.error(`[alex] Tick failed: ${error.message}`);
  } finally {
    state.busy = false;
  }
}

async function handleOwnerCommand(rawMessage) {
  const text = String(rawMessage ?? "").trim();
  if (!text.toLowerCase().startsWith("!alex")) {
    return;
  }

  const payload = text.slice("!alex".length).trim();
  if (!payload) {
    await sendOwnerHelp();
    return;
  }

  const [commandRaw, ...rest] = payload.split(/\s+/);
  const command = commandRaw.toLowerCase();
  const args = rest.join(" ").trim();

  switch (command) {
    case "help":
      await sendOwnerHelp();
      break;
    case "pause":
      state.paused = true;
      await safeChat(bot, state, 0, "[alex] paused");
      break;
    case "resume":
      state.paused = false;
      await safeChat(bot, state, 0, "[alex] resumed");
      break;
    case "goal":
      if (!args) {
        await safeChat(bot, state, 0, "[alex] usage: !alex goal <text>");
        break;
      }
      state.goal = args;
      await safeChat(bot, state, 0, `[alex] new goal: ${state.goal}`);
      break;
    case "status":
      await safeChat(bot, state, 0, buildStatusLine());
      break;
    case "tick":
      await safeChat(bot, state, 0, "[alex] forcing one tick");
      await runTick(true);
      break;
    default:
      await safeChat(bot, state, 0, `[alex] unknown command: ${command}`);
      break;
  }
}

async function sendOwnerHelp() {
  await safeChat(
    bot,
    state,
    0,
    "[alex] commands: help | pause | resume | goal <text> | status | tick"
  );
}

function buildStatusLine() {
  return `[alex] paused=${state.paused} goal="${state.goal}" hp=${round(
    bot.health
  )} food=${round(bot.food)} tick=${state.tickCount}`;
}

function addChatLog(username, message) {
  state.chatLog.push({
    at: new Date().toISOString(),
    username,
    message: String(message).slice(0, 280)
  });

  if (state.chatLog.length > 40) {
    state.chatLog.splice(0, state.chatLog.length - 40);
  }
}

function formatKickedReason(reason) {
  if (typeof reason === "string") {
    return reason;
  }
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function round(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.round(num * 100) / 100;
}
