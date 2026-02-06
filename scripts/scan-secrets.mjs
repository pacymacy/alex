import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const trackedFiles = listTrackedFiles();

const patterns = [
  {
    name: "Gemini API key",
    regex: /AIza[0-9A-Za-z_-]{35}/g
  },
  {
    name: "OpenRouter API key",
    regex: /sk-or-v1-[0-9A-Za-z_-]{20,}/g
  },
  {
    name: "OpenAI-like secret key",
    regex: /sk-[0-9A-Za-z_-]{20,}/g
  }
];

const allowlistPatterns = [
  /^REPLACE_WITH_/,
  /^YOUR_/,
  /^example/i
];

const findings = [];

for (const relativePath of trackedFiles) {
  const absolutePath = path.join(root, relativePath);
  const content = safeReadText(absolutePath);
  if (content === null) {
    continue;
  }

  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const matches = [...line.matchAll(pattern.regex)];
      for (const match of matches) {
        const value = match[0];
        if (isAllowed(value)) {
          continue;
        }
        findings.push({
          file: relativePath,
          line: index + 1,
          type: pattern.name,
          preview: maskValue(value)
        });
      }
    }
  });
}

if (findings.length === 0) {
  console.log("No obvious API secrets found in tracked files.");
  process.exit(0);
}

console.error("Potential secrets found:");
for (const finding of findings) {
  console.error(
    `- ${finding.file}:${finding.line} [${finding.type}] ${finding.preview}`
  );
}
process.exit(1);

function listTrackedFiles() {
  const output = execSync("git ls-files", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();

  if (!output) {
    return [];
  }

  return output.split("\n");
}

function safeReadText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);

    // Skip binaries.
    if (buffer.includes(0)) {
      return null;
    }

    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

function isAllowed(value) {
  return allowlistPatterns.some((pattern) => pattern.test(value));
}

function maskValue(value) {
  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
