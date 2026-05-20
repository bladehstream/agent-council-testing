import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProviderName = "openai" | "google" | "anthropic" | "moonshot";

export interface ModelEntry {
  provider: ProviderName;
  aliases?: string[];
  model: string;
  description?: string;
}

export interface RouterConfig {
  version: string;
  models: Record<string, ModelEntry>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findConfigPath(): string {
  const candidates = [
    process.env.LLM_ROUTER_CONFIG,
    path.resolve(process.cwd(), "router-config.json"),
    path.resolve(__dirname, "../../router-config.json"),
    path.resolve(__dirname, "../../../router-config.json"),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `router-config.json not found. Set LLM_ROUTER_CONFIG or place it in cwd. Searched: ${candidates.join(", ")}`
  );
}

let cached: RouterConfig | null = null;

export function loadConfig(): RouterConfig {
  if (cached) return cached;
  const p = findConfigPath();
  const raw = fs.readFileSync(p, "utf-8");
  const parsed = JSON.parse(raw) as RouterConfig;
  if (!parsed.models || typeof parsed.models !== "object") {
    throw new Error("router-config.json is missing a 'models' object");
  }
  cached = parsed;
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}
