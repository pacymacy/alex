import { buildSystemPrompt } from "./prompt.js";

export function createPlannerClient(config) {
  const providerCandidates = buildProviderCandidates(config);
  let preferredProviderIndex = 0;

  if (providerCandidates.length === 0) {
    console.warn(
      "[planner] No usable API key found in configured providers. Planner will return wait actions."
    );
  } else {
    const names = providerCandidates.map((provider) => provider.name).join(", ");
    console.log(`[planner] Provider order: ${names}`);
  }

  return {
    async plan({ goal, observation, maxActions }) {
      if (providerCandidates.length === 0) {
        return {
          summary: "No API key configured.",
          say: "",
          actions: [{ type: "wait", ms: 1000 }]
        };
      }

      const errors = [];
      const start = preferredProviderIndex;

      for (let i = 0; i < providerCandidates.length; i += 1) {
        const index = (start + i) % providerCandidates.length;
        const provider = providerCandidates[index];

        try {
          const result = await requestPlan(provider, config, {
            goal,
            observation,
            maxActions
          });

          if (preferredProviderIndex !== index) {
            console.warn(`[planner] Switched provider to "${provider.name}".`);
          }
          preferredProviderIndex = index;
          return result;
        } catch (error) {
          errors.push(`${provider.name}: ${error.message}`);
        }
      }

      throw new Error(`All configured providers failed. ${errors.join(" | ")}`);
    }
  };
}

function buildProviderCandidates(config) {
  const sources = Array.isArray(config.providers) ? config.providers : [];
  const candidates = [];

  for (const provider of sources) {
    const apiKey = resolveApiKey(provider);
    if (!isUsableApiKey(apiKey)) {
      continue;
    }
    candidates.push({
      ...provider,
      apiKey
    });
  }

  return candidates;
}

function resolveApiKey(provider) {
  return (
    provider.apiKey ||
    providerSpecificEnvKey(provider.name) ||
    process.env.LLM_API_KEY ||
    ""
  ).trim();
}

function providerSpecificEnvKey(name) {
  switch (name) {
    case "openrouter":
      return process.env.OPENROUTER_API_KEY || "";
    case "gemini":
      return process.env.GEMINI_API_KEY || "";
    case "openai":
      return process.env.OPENAI_API_KEY || "";
    default:
      return "";
  }
}

function isUsableApiKey(value) {
  if (typeof value !== "string") {
    return false;
  }

  const key = value.trim();
  if (!key) {
    return false;
  }

  return (
    key !== "REPLACE_ME" &&
    !key.startsWith("REPLACE_WITH_") &&
    !key.startsWith("YOUR_")
  );
}

async function requestPlan(provider, config, input) {
  const endpoint = `${provider.baseUrl}/chat/completions`;
  const payload = {
    model: provider.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(input.maxActions)
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            goal: input.goal,
            observation: input.observation
          },
          null,
          2
        )
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(provider),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`timeout after ${config.timeoutMs} ms`);
    }
    throw new Error(`request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = parseContent(data?.choices?.[0]?.message?.content);
  const parsed = parsePlan(content);
  return sanitizePlan(parsed, input.maxActions);
}

function buildHeaders(provider) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${provider.apiKey}`
  };

  if (provider.baseUrl.includes("openrouter.ai")) {
    if (provider.siteUrl) {
      headers["HTTP-Referer"] = provider.siteUrl;
    }
    if (provider.appName) {
      headers["X-Title"] = provider.appName;
    }
  }

  return headers;
}

function parseContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("\n");
  }

  return "";
}

function parsePlan(content) {
  if (typeof content !== "string" || content.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(content);
  } catch {
    const extracted = extractFirstJsonObject(content);
    if (!extracted) {
      return {};
    }
    try {
      return JSON.parse(extracted);
    } catch {
      return {};
    }
  }
}

function sanitizePlan(plan, maxActions) {
  const safePlan = isRecord(plan) ? plan : {};
  const rawActions = Array.isArray(safePlan.actions) ? safePlan.actions : [];
  const actions = rawActions
    .map((action) => normalizeAction(action))
    .filter(Boolean)
    .slice(0, maxActions);

  return {
    summary: asString(safePlan.summary, "").trim().slice(0, 240),
    say: asString(safePlan.say, "").trim().slice(0, 180),
    actions: actions.length > 0 ? actions : [{ type: "wait", ms: 800 }]
  };
}

function normalizeAction(action) {
  if (!isRecord(action)) {
    return null;
  }

  const type = asString(action.type, "").trim().toLowerCase();
  switch (type) {
    case "chat": {
      const message = asString(action.message, "").trim().slice(0, 180);
      if (!message) {
        return null;
      }
      return { type: "chat", message };
    }
    case "move_to": {
      const x = toFiniteNumber(action.x);
      const y = toFiniteNumber(action.y);
      const z = toFiniteNumber(action.z);
      if (x === null || y === null || z === null) {
        return null;
      }
      return {
        type: "move_to",
        x,
        y,
        z,
        radius: toInt(action.radius, 1, 1, 6),
        timeoutMs: toInt(action.timeoutMs, 20000, 1000, 60000)
      };
    }
    case "mine_block": {
      const block = asString(action.block, "").trim().toLowerCase();
      if (!block) {
        return null;
      }
      return {
        type: "mine_block",
        block,
        maxDistance: toInt(action.maxDistance, 24, 2, 64),
        timeoutMs: toInt(action.timeoutMs, 20000, 1000, 60000)
      };
    }
    case "attack_nearest":
      return {
        type: "attack_nearest",
        maxDistance: toInt(action.maxDistance, 10, 2, 30)
      };
    case "follow_player": {
      const username = asString(action.username, "").trim();
      if (!username) {
        return null;
      }
      return {
        type: "follow_player",
        username,
        distance: toInt(action.distance, 2, 1, 6),
        durationMs: toInt(action.durationMs, 4000, 500, 30000)
      };
    }
    case "craft_item": {
      const item = asString(action.item, "").trim().toLowerCase();
      if (!item) {
        return null;
      }
      return {
        type: "craft_item",
        item,
        count: toInt(action.count, 1, 1, 64)
      };
    }
    case "place_block": {
      const block = asString(action.block, "").trim().toLowerCase();
      if (!block) {
        return null;
      }
      return {
        type: "place_block",
        block
      };
    }
    case "eat_food":
      return { type: "eat_food" };
    case "flee_hostiles":
      return {
        type: "flee_hostiles",
        maxDistance: toInt(action.maxDistance, 10, 3, 32),
        fleeDistance: toInt(action.fleeDistance, 8, 3, 24),
        durationMs: toInt(action.durationMs, 4000, 500, 30000)
      };
    case "goto_waypoint": {
      const name = normalizeWaypointName(action.name);
      if (!name) {
        return null;
      }
      return {
        type: "goto_waypoint",
        name,
        radius: toInt(action.radius, 2, 1, 8),
        timeoutMs: toInt(action.timeoutMs, 25000, 1000, 60000)
      };
    }
    case "set_waypoint": {
      const name = normalizeWaypointName(action.name);
      if (!name) {
        return null;
      }
      return { type: "set_waypoint", name };
    }
    case "delete_waypoint": {
      const name = normalizeWaypointName(action.name);
      if (!name) {
        return null;
      }
      return { type: "delete_waypoint", name };
    }
    case "wait":
      return { type: "wait", ms: toInt(action.ms, 1000, 200, 15000) };
    case "stop":
      return { type: "stop" };
    default:
      return null;
  }
}

function extractFirstJsonObject(value) {
  const start = value.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return clamp(Math.round(num), min, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeWaypointName(value) {
  const raw = asString(value, "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  return raw.replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}
