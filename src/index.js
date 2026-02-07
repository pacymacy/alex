import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { loadConfig } from "./config.js";
import { createPlannerClient } from "./llm/client.js";
import {
  executeActions,
  findNearbyHostiles,
  hasEdibleFood,
  safeChat
} from "./minecraft/actions.js";
import { buildObservation } from "./minecraft/observe.js";
import { buildAutonomyPlan, listPersonalities } from "./runtime/autonomy.js";
import { loadWaypoints, saveWaypoints } from "./runtime/waypoints.js";

const { Movements, pathfinder } = pathfinderPkg;

const config = await loadConfig(process.argv[2]);
const planner = createPlannerClient(config.llm);
const initialWaypoints = await loadWaypointsSafe();
const initialPersonality = buildInitialPersonalityState(config);

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
  goalMode: config.autonomy.goalMode,
  autonomyEnabled: config.autonomy.enabled,
  tickCount: 0,
  lastChatAt: 0,
  lastSafetyChatAt: 0,
  chatLog: [],
  lastPlanSummary: "",
  waypoints: initialWaypoints,
  safetyEnabled: true,
  personality: initialPersonality
};

let loopHandle = null;

bot.once("spawn", async () => {
  bot.pathfinder.setMovements(new Movements(bot));
  console.log(
    `[alex] Spawned as ${bot.username}. Initial goal: "${state.goal}".`
  );
  console.log(`[alex] Loaded waypoints: ${Object.keys(state.waypoints).length}`);
  console.log(
    `[alex] autonomy=${state.autonomyEnabled} goalMode=${state.goalMode} safety=${state.safetyEnabled}`
  );
  console.log(
    `[alex] personality=${state.personality.active} stage=${state.personality.stage} policyHash=${state.personality.policyHash}`
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
    const handledBySafety = await runSafetyBehaviors();
    if (handledBySafety) {
      console.log(`[alex] Tick ${state.tickCount} handled by safety behavior.`);
      return;
    }

    const autonomyPlan = buildAutonomyPlan(bot, state);
    if (autonomyPlan) {
      const autonomyHandled = await runPlannedActions("auto", autonomyPlan);
      if (autonomyHandled) {
        return;
      }
    }

    const observation = buildObservation(bot, state);
    const plan = await planner.plan({
      goal: state.goal,
      observation,
      maxActions: config.maxActionsPerTick
    });

    await runPlannedActions("llm", plan);
  } catch (error) {
    console.error(`[alex] Tick failed: ${error.message}`);
  } finally {
    state.busy = false;
  }
}

async function runPlannedActions(source, plan) {
  if (!plan || !Array.isArray(plan.actions) || plan.actions.length === 0) {
    return false;
  }

  state.lastPlanSummary = `[${source}] ${String(plan.summary ?? "").trim()}`;

  if (plan.say) {
    await safeChat(bot, state, config.chatCooldownMs, plan.say);
  }

  const results = await executeActions(bot, plan.actions, actionContext());
  const successCount = results.filter((entry) => entry.ok).length;
  const failureCount = results.length - successCount;
  const reasonSummary = summarizeReasonCodes(results);

  console.log(
    `[alex] Tick ${state.tickCount} ${source} plan persona=${state.personality.active} stage=${state.personality.stage} policyHash=${state.personality.policyHash} "${String(
      plan.summary ?? ""
    ).slice(0, 120)}" actions=${plan.actions.length} ok=${successCount} fail=${failureCount} reasons=${reasonSummary}`
  );

  return successCount > 0;
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
      setGoal(args);
      await safeChat(bot, state, 0, `[alex] new goal: ${state.goal}`);
      break;
    case "mission":
      if (!args) {
        await safeChat(bot, state, 0, "[alex] usage: !alex mission <text>");
        break;
      }
      setGoal(args);
      await safeChat(bot, state, 0, `[alex] mission set: ${state.goal}`);
      break;
    case "auto":
      await handleAutoCommand(args);
      break;
    case "mode":
      await handleModeCommand(args);
      break;
    case "persona":
    case "personality":
      await handlePersonaCommand(args);
      break;
    case "wp":
    case "waypoint":
      await handleWaypointCommand(args);
      break;
    case "safety":
      await handleSafetyCommand(args);
      break;
    case "save":
      await persistWaypoints(state.waypoints);
      await safeChat(bot, state, 0, "[alex] waypoints saved");
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
    "[alex] commands: help | pause | resume | goal <text> | mission <text> | auto on/off | mode auto/manual | persona [list|set <name>|stage|lock|unlock] | wp set/goto/del/list <name> | safety on/off | status | tick"
  );
}

function buildStatusLine() {
  const hostileCount = findNearbyHostiles(bot, 12).length;
  const waypointCount = Object.keys(state.waypoints).length;

  return `[alex] paused=${state.paused} safety=${state.safetyEnabled} auto=${state.autonomyEnabled} mode=${state.goalMode} persona=${state.personality.active} stage=${state.personality.stage} hp=${round(
    bot.health
  )} food=${round(bot.food)} hostiles=${hostileCount} waypoints=${waypointCount} tick=${state.tickCount} goal="${state.goal}"`;
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

function summarizeReasonCodes(results) {
  const counts = {};
  for (const result of results) {
    if (result?.ok) {
      continue;
    }
    const code = String(result?.reasonCode ?? "UNKNOWN_ERROR");
    counts[code] = (counts[code] ?? 0) + 1;
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([code, count]) => `${code}:${count}`).join(",");
}

function setGoal(rawGoal) {
  const next = String(rawGoal ?? "").trim();
  if (!next) {
    return;
  }
  state.goal = next.slice(0, 240);
  state.goalMode = "manual";
}

async function handleWaypointCommand(args) {
  const text = String(args ?? "").trim();
  if (!text) {
    await safeChat(
      bot,
      state,
      0,
      "[alex] waypoint usage: !alex wp set <name> | goto <name> | del <name> | list"
    );
    return;
  }

  const [subRaw, ...rest] = text.split(/\s+/);
  const sub = String(subRaw).toLowerCase();
  const name = normalizeWaypointName(rest.join(" "));

  switch (sub) {
    case "set": {
      if (!name) {
        await safeChat(bot, state, 0, "[alex] usage: !alex wp set <name>");
        return;
      }

      const ok = await runManualAction(
        {
          type: "set_waypoint",
          name
        },
        `[alex] waypoint set: ${name}`
      );
      if (ok) {
        await safeChat(bot, state, 0, `[alex] waypoint set: ${name}`);
      }
      return;
    }
    case "goto": {
      if (!name) {
        await safeChat(bot, state, 0, "[alex] usage: !alex wp goto <name>");
        return;
      }

      const ok = await runManualAction(
        {
          type: "goto_waypoint",
          name,
          radius: 2,
          timeoutMs: 45000
        },
        `[alex] moving to waypoint: ${name}`
      );
      if (ok) {
        await safeChat(bot, state, 0, `[alex] moved to waypoint: ${name}`);
      }
      return;
    }
    case "del":
    case "delete":
    case "rm": {
      if (!name) {
        await safeChat(bot, state, 0, "[alex] usage: !alex wp del <name>");
        return;
      }

      const ok = await runManualAction(
        {
          type: "delete_waypoint",
          name
        },
        `[alex] waypoint deleted: ${name}`
      );
      if (ok) {
        await safeChat(bot, state, 0, `[alex] waypoint deleted: ${name}`);
      }
      return;
    }
    case "list": {
      const names = Object.keys(state.waypoints).sort();
      if (names.length === 0) {
        await safeChat(bot, state, 0, "[alex] no waypoints set");
        return;
      }
      await safeChat(bot, state, 0, `[alex] waypoints: ${names.join(", ")}`);
      return;
    }
    default:
      await safeChat(bot, state, 0, `[alex] unknown waypoint cmd: ${sub}`);
  }
}

async function handleSafetyCommand(args) {
  const mode = String(args ?? "").trim().toLowerCase();
  if (mode === "on") {
    state.safetyEnabled = true;
    await safeChat(bot, state, 0, "[alex] safety enabled");
    return;
  }

  if (mode === "off") {
    state.safetyEnabled = false;
    await safeChat(bot, state, 0, "[alex] safety disabled");
    return;
  }

  await safeChat(bot, state, 0, `[alex] safety=${state.safetyEnabled}`);
}

async function handleAutoCommand(args) {
  const mode = String(args ?? "").trim().toLowerCase();
  if (mode === "on") {
    state.autonomyEnabled = true;
    await safeChat(bot, state, 0, "[alex] autonomy enabled");
    return;
  }

  if (mode === "off") {
    state.autonomyEnabled = false;
    await safeChat(bot, state, 0, "[alex] autonomy disabled");
    return;
  }

  await safeChat(
    bot,
    state,
    0,
    `[alex] autonomy=${state.autonomyEnabled} goalMode=${state.goalMode}`
  );
}

async function handleModeCommand(args) {
  const mode = String(args ?? "").trim().toLowerCase();
  if (mode === "auto") {
    state.goalMode = "auto";
    state.goal = config.initialGoal;
    await safeChat(bot, state, 0, `[alex] goal mode auto, goal="${state.goal}"`);
    return;
  }

  if (mode === "manual") {
    state.goalMode = "manual";
    await safeChat(bot, state, 0, `[alex] goal mode manual, goal="${state.goal}"`);
    return;
  }

  await safeChat(bot, state, 0, `[alex] goalMode=${state.goalMode}`);
}

async function handlePersonaCommand(args) {
  const text = String(args ?? "").trim();
  if (!text) {
    await safeChat(
      bot,
      state,
      0,
      `[alex] persona=${state.personality.active} stage=${state.personality.stage} hotSwap=${state.personality.allowHotSwap}`
    );
    return;
  }

  const [subRaw, ...rest] = text.split(/\s+/);
  const sub = String(subRaw).toLowerCase();
  const payload = rest.join(" ").trim().toLowerCase();

  switch (sub) {
    case "list":
      await safeChat(
        bot,
        state,
        0,
        `[alex] personas: ${listPersonalities().join(", ")}`
      );
      return;
    case "set": {
      if (!payload) {
        await safeChat(bot, state, 0, "[alex] usage: !alex persona set <name>");
        return;
      }

      if (!state.personality.allowHotSwap) {
        await safeChat(bot, state, 0, "[alex] persona hot-swap is locked");
        return;
      }

      const ok = setActivePersonality(payload);
      if (!ok) {
        await safeChat(bot, state, 0, `[alex] unknown persona: ${payload}`);
        return;
      }

      state.goalMode = "auto";
      await safeChat(
        bot,
        state,
        0,
        `[alex] persona set to ${state.personality.active} stage=${state.personality.stage}`
      );
      return;
    }
    case "stage":
      await safeChat(
        bot,
        state,
        0,
        `[alex] persona=${state.personality.active} stage=${state.personality.stage} changedAt=${state.personality.lastStageChangeAt}`
      );
      return;
    case "lock":
      state.personality.allowHotSwap = false;
      await safeChat(bot, state, 0, "[alex] persona hot-swap locked");
      return;
    case "unlock":
      state.personality.allowHotSwap = true;
      await safeChat(bot, state, 0, "[alex] persona hot-swap unlocked");
      return;
    default:
      await safeChat(
        bot,
        state,
        0,
        "[alex] persona usage: list | set <name> | stage | lock | unlock"
      );
  }
}

async function runManualAction(action, contextMessage) {
  if (state.busy) {
    await safeChat(bot, state, 0, "[alex] busy, try again in a moment");
    return false;
  }

  state.busy = true;
  try {
    const results = await executeActions(bot, [action], actionContext());
    const first = results[0];
    if (!first?.ok) {
      await safeChat(
        bot,
        state,
        0,
        `[alex] action failed (${first?.reasonCode ?? "UNKNOWN_ERROR"}): ${first?.error ?? "unknown error"}`
      );
      return false;
    }

    if (contextMessage) {
      console.log(contextMessage);
    }
    return true;
  } finally {
    state.busy = false;
  }
}

function actionContext() {
  return {
    config,
    state,
    persistWaypoints
  };
}

async function runSafetyBehaviors() {
  if (!state.safetyEnabled) {
    return false;
  }

  const health = Number(bot.health ?? 20);
  const food = Number(bot.food ?? 20);
  const threats = findNearbyHostiles(bot, 10);

  if (threats.length > 0 && health <= 10) {
    const results = await executeActions(
      bot,
      [
        {
          type: "flee_hostiles",
          maxDistance: 10,
          fleeDistance: 10,
          durationMs: 4500
        }
      ],
      actionContext()
    );

    if (results[0]?.ok) {
      await safetyNotice(
        `[alex] safety: fleeing ${threats[0].name} (${round(threats[0].distance)}m)`
      );
      return true;
    }
  }

  if (hasEdibleFood(bot) && (food <= 14 || health <= 8)) {
    const results = await executeActions(
      bot,
      [{ type: "eat_food" }],
      actionContext()
    );

    if (results[0]?.ok) {
      await safetyNotice("[alex] safety: eating food");
      return true;
    }
  }

  const freeSlots = estimateFreeInventorySlots(bot);
  if (freeSlots <= 1) {
    const cleanup = await executeActions(
      bot,
      [{ type: "drop_items", minFreeSlots: 4 }],
      actionContext()
    );
    if (cleanup[0]?.ok) {
      await safetyNotice("[alex] safety: clearing inventory overflow");
      return true;
    }
  }

  if (isNightTime(bot) && isLikelySurface(bot)) {
    const shelterName = resolveShelterWaypointName(state);
    if (shelterName) {
      const shelter = state.waypoints[shelterName];
      const shelterDistance = distanceToWaypoint(bot, shelter);
      if (shelterDistance === null || shelterDistance > 8) {
        const shelterMove = await executeActions(
          bot,
          [{ type: "goto_waypoint", name: shelterName, radius: 4, timeoutMs: 32000 }],
          actionContext()
        );
        if (shelterMove[0]?.ok) {
          await safetyNotice(`[alex] safety: night shelter -> ${shelterName}`);
          return true;
        }
      }
    }

    if (countInventoryItem(bot, "torch") > 0) {
      const torch = await executeActions(
        bot,
        [{ type: "place_block", block: "torch" }],
        actionContext()
      );
      if (torch[0]?.ok) {
        await safetyNotice("[alex] safety: placing night torch");
        return true;
      }
    }
  }

  return false;
}

async function safetyNotice(message) {
  const now = Date.now();
  if (state.lastSafetyChatAt > 0 && now - state.lastSafetyChatAt < 8000) {
    return;
  }
  state.lastSafetyChatAt = now;
  await safeChat(bot, state, 0, message);
}

async function persistWaypoints(waypoints) {
  try {
    await saveWaypoints(waypoints);
  } catch (error) {
    console.error(`[alex] Failed to save waypoints: ${error.message}`);
  }
}

async function loadWaypointsSafe() {
  try {
    return await loadWaypoints();
  } catch (error) {
    console.error(`[alex] Failed to load waypoints: ${error.message}`);
    return {};
  }
}

function normalizeWaypointName(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  return raw.replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function buildInitialPersonalityState(runtimeConfig) {
  const active = String(runtimeConfig.autonomy.personality.active).toLowerCase();
  const policy = resolvePersonalityPolicy(runtimeConfig, active);

  return {
    active,
    allowHotSwap: runtimeConfig.autonomy.personality.allowHotSwap,
    policy,
    stage: active === "cave_dweller" ? "CD-0" : "BASE-0",
    lastStageChangeAt: new Date().toISOString(),
    policyHash: buildPolicyHash(policy)
  };
}

function setActivePersonality(requested) {
  const available = new Set(listPersonalities());
  if (!available.has(requested)) {
    return false;
  }

  const policy = resolvePersonalityPolicy(config, requested);
  state.personality.active = requested;
  state.personality.policy = policy;
  state.personality.stage = requested === "cave_dweller" ? "CD-0" : "BASE-0";
  state.personality.lastStageChangeAt = new Date().toISOString();
  state.personality.policyHash = buildPolicyHash(policy);
  return true;
}

function resolvePersonalityPolicy(runtimeConfig, active) {
  if (active === "cave_dweller") {
    return runtimeConfig.autonomy.personality.policies.cave_dweller;
  }

  return {
    profile: "default"
  };
}

function buildPolicyHash(value) {
  const text = JSON.stringify(value);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function estimateFreeInventorySlots(currentBot) {
  if (typeof currentBot.inventory?.emptySlotCount === "function") {
    const value = Number(currentBot.inventory.emptySlotCount());
    if (Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }

  const used = currentBot.inventory.items().length;
  return Math.max(0, 36 - used);
}

function isNightTime(currentBot) {
  const timeOfDay = Number(currentBot.time?.timeOfDay ?? 0);
  return timeOfDay >= 13000 && timeOfDay <= 23000;
}

function isLikelySurface(currentBot) {
  const y = Number(currentBot.entity?.position?.y ?? 0);
  return y >= 58;
}

function resolveShelterWaypointName(runtimeState) {
  if (runtimeState.waypoints?.home_core) {
    return "home_core";
  }
  if (runtimeState.waypoints?.home) {
    return "home";
  }
  return "";
}

function distanceToWaypoint(currentBot, waypoint) {
  if (!currentBot.entity?.position || !waypoint) {
    return null;
  }

  const currentDimension = currentBot.game?.dimension ?? "unknown";
  if (waypoint.dimension && waypoint.dimension !== currentDimension) {
    return null;
  }

  const dx = currentBot.entity.position.x - waypoint.x;
  const dy = currentBot.entity.position.y - waypoint.y;
  const dz = currentBot.entity.position.z - waypoint.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function countInventoryItem(currentBot, itemName) {
  let total = 0;
  for (const item of currentBot.inventory.items()) {
    if (item.name === itemName) {
      total += item.count;
    }
  }
  return total;
}
