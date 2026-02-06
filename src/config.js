import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_PATH = "config/config.local.json";
const EXAMPLE_CONFIG_PATH = "config/config.example.json";
const DEFAULT_PROVIDER_ORDER = ["openrouter", "gemini", "openai"];
const PROVIDER_DEFAULTS = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini"
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  }
};

export async function loadConfig(customPath) {
  const cwd = process.cwd();
  const requestedPath = customPath
    ? path.resolve(cwd, customPath)
    : path.resolve(cwd, DEFAULT_CONFIG_PATH);

  let configPath = requestedPath;
  let rawConfig;

  try {
    rawConfig = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (customPath || error.code !== "ENOENT") {
      throw new Error(`Could not read config at ${configPath}: ${error.message}`);
    }

    configPath = path.resolve(cwd, EXAMPLE_CONFIG_PATH);
    rawConfig = await fs.readFile(configPath, "utf8");
    console.warn(
      `[config] ${DEFAULT_CONFIG_PATH} not found. Using ${EXAMPLE_CONFIG_PATH}.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    throw new Error(`Config is not valid JSON (${configPath}): ${error.message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Config root must be an object (${configPath}).`);
  }

  const mc = isRecord(parsed.minecraft) ? parsed.minecraft : {};
  const autonomy = isRecord(parsed.autonomy) ? parsed.autonomy : {};
  const llm = isRecord(parsed.llm) ? parsed.llm : {};

  return {
    minecraft: {
      host: asNonEmptyString(mc.host, "127.0.0.1"),
      port: asInteger(mc.port, 25565, 1, 65535),
      username: asNonEmptyString(mc.username, "alex_bot"),
      auth: asNonEmptyString(mc.auth, "offline"),
      version: asString(mc.version, "").trim()
    },
    ownerUsername: asNonEmptyString(parsed.ownerUsername, "alex"),
    initialGoal: asNonEmptyString(parsed.initialGoal, "Collect wood and stay safe."),
    autonomy: {
      enabled: asBoolean(autonomy.enabled, true),
      goalMode: normalizeGoalMode(autonomy.goalMode)
    },
    loopIntervalMs: asInteger(parsed.loopIntervalMs, 4500, 1000, 60000),
    maxActionsPerTick: asInteger(parsed.maxActionsPerTick, 3, 1, 8),
    chatCooldownMs: asInteger(parsed.chatCooldownMs, 4000, 500, 60000),
    llm: normalizeLlmConfig(llm)
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function asNonEmptyString(value, fallback) {
  const str = asString(value, "").trim();
  return str.length > 0 ? str : fallback;
}

function asInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  return clamp(Math.round(num), min, max);
}

function asNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  return clamp(num, min, max);
}

function asBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function normalizeGoalMode(value) {
  const mode = asString(value, "").trim().toLowerCase();
  return mode === "manual" ? "manual" : "auto";
}

function normalizeLlmConfig(llm) {
  const temperature = asNumber(llm.temperature, 0.2, 0, 2);
  const maxTokens = asInteger(llm.maxTokens, 320, 64, 4096);
  const timeoutMs = asInteger(llm.timeoutMs, 20000, 1000, 120000);

  if (isLegacySingleProviderConfig(llm)) {
    return {
      providerOrder: ["primary"],
      providers: [
        {
          name: "primary",
          baseUrl: stripTrailingSlash(
            asNonEmptyString(llm.baseUrl, "https://api.openai.com/v1")
          ),
          model: asNonEmptyString(llm.model, "gpt-4.1-mini"),
          apiKey: asString(llm.apiKey, "").trim(),
          siteUrl: asString(llm.siteUrl, "").trim(),
          appName: asString(llm.appName, "").trim()
        }
      ],
      temperature,
      maxTokens,
      timeoutMs
    };
  }

  const providerOrder = normalizeProviderOrder(llm.providerOrder);
  const providers = providerOrder.map((name) =>
    normalizeProvider(name, llm[name], PROVIDER_DEFAULTS[name])
  );

  return {
    providerOrder,
    providers,
    temperature,
    maxTokens,
    timeoutMs
  };
}

function normalizeProviderOrder(value) {
  const seen = new Set();
  const normalized = [];

  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = asString(entry, "").trim().toLowerCase();
      if (!name || !PROVIDER_DEFAULTS[name] || seen.has(name)) {
        continue;
      }
      seen.add(name);
      normalized.push(name);
    }
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return [...DEFAULT_PROVIDER_ORDER];
}

function normalizeProvider(name, value, defaults) {
  const raw = isRecord(value) ? value : {};

  return {
    name,
    baseUrl: stripTrailingSlash(asNonEmptyString(raw.baseUrl, defaults.baseUrl)),
    model: asNonEmptyString(raw.model, defaults.model),
    apiKey: asString(raw.apiKey, "").trim(),
    siteUrl: asString(raw.siteUrl, "").trim(),
    appName: asString(raw.appName, "").trim()
  };
}

function isLegacySingleProviderConfig(llm) {
  return (
    typeof llm.baseUrl === "string" ||
    typeof llm.model === "string" ||
    typeof llm.apiKey === "string"
  );
}
