/**
 * Model configuration module
 * Handles loading models.json and creating agent configurations
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { AgentConfig } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export type ModelTier = "fast" | "default" | "heavy";

export interface TierConfig {
  model: string;
  fullId: string;
  description: string;
  reasoning?: {
    flag: string;
    value: string | boolean;
  };
}

export interface ProviderReasoning {
  supported: boolean;
  method: string;
  flag: string;
  values?: string[];
  note: string;
}

export interface ProviderConfig {
  cli: string;
  flag: string;
  tiers: Record<ModelTier, TierConfig>;
  reasoning: ProviderReasoning;
}

export interface StageConfig {
  tier: ModelTier;
  count: number;
  reasoning?: boolean;
}

export interface PresetConfig {
  description: string;
  stage1: StageConfig;
  stage2: StageConfig;
  stage3: StageConfig;
}

export interface ModelsConfig {
  $schema?: string;
  version: string;
  updated: string;
  providers: Record<string, ProviderConfig>;
  presets: Record<string, PresetConfig>;
  defaults: {
    preset: string;
    chairman: string;
    fallbackTier: ModelTier;
  };
}

export interface EnhancedPipelineConfig {
  stage1: {
    agents: AgentConfig[];
  };
  stage2: {
    agents: AgentConfig[];
  };
  stage3: {
    chairman: AgentConfig;
    useReasoning: boolean;
  };
}

// ============================================================================
// Configuration Loading
// ============================================================================

const CONFIG_DIR = join(homedir(), ".agent-council");
const USER_MODELS_PATH = join(CONFIG_DIR, "models.json");

function getPackageModelsPath(): string {
  // Look for models.json relative to compiled output
  const distPath = join(__dirname, "..", "models.json");
  if (existsSync(distPath)) return distPath;

  // Fallback to repo root
  const repoPath = join(__dirname, "..", "..", "models.json");
  if (existsSync(repoPath)) return repoPath;

  throw new Error("models.json not found in package");
}

let cachedConfig: ModelsConfig | null = null;

export function loadModelsConfig(forceReload = false): ModelsConfig {
  if (cachedConfig && !forceReload) return cachedConfig;

  // Try user config first, fall back to package config
  const configPath = existsSync(USER_MODELS_PATH)
    ? USER_MODELS_PATH
    : getPackageModelsPath();

  const content = readFileSync(configPath, "utf-8");
  cachedConfig = JSON.parse(content) as ModelsConfig;
  return cachedConfig;
}

export function refreshModelsConfig(): void {
  // Copy package models.json to user config directory
  const packagePath = getPackageModelsPath();
  const content = readFileSync(packagePath, "utf-8");

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(USER_MODELS_PATH, content);
  cachedConfig = null;
  console.log(`Models config refreshed: ${USER_MODELS_PATH}`);
}

export function getConfigPath(): string {
  return existsSync(USER_MODELS_PATH) ? USER_MODELS_PATH : getPackageModelsPath();
}

// ============================================================================
// Agent Configuration Building
// ============================================================================

const BASE_AGENT_COMMANDS: Record<string, { command: string[]; promptViaStdin: boolean }> = {
  codex: {
    command: ["codex", "exec", "--skip-git-repo-check", "-"],
    promptViaStdin: true,
  },
  claude: {
    command: ["claude", "--print", "--output-format", "text"],
    promptViaStdin: true,
  },
  gemini: {
    command: ["gemini", "--output-format", "text"],
    promptViaStdin: false, // Gemini uses positional args, not stdin
  },
};

export function createAgentConfig(
  provider: string,
  tier: ModelTier,
  config: ModelsConfig = loadModelsConfig()
): AgentConfig {
  const providerConfig = config.providers[provider];
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const tierConfig = providerConfig.tiers[tier];
  if (!tierConfig) {
    throw new Error(`Unknown tier '${tier}' for provider '${provider}'`);
  }

  const base = BASE_AGENT_COMMANDS[provider];
  if (!base) {
    throw new Error(`No base command config for provider: ${provider}`);
  }

  // Build command with model flag
  const command = [...base.command, providerConfig.flag, tierConfig.model];

  // Add reasoning flag if tier has it
  if (tierConfig.reasoning) {
    if (typeof tierConfig.reasoning.value === "boolean") {
      if (tierConfig.reasoning.value) {
        command.push(tierConfig.reasoning.flag);
      }
    } else {
      command.push(tierConfig.reasoning.flag, tierConfig.reasoning.value);
    }
  }

  return {
    name: `${provider}:${tier}`,
    command,
    promptViaStdin: base.promptViaStdin,
  };
}

export function createAgentFromSpec(spec: string): AgentConfig {
  // Parse spec like "claude:heavy" or "gemini:fast"
  const [provider, tierStr] = spec.split(":");
  const tier = (tierStr || "default") as ModelTier;

  if (!["fast", "default", "heavy"].includes(tier)) {
    throw new Error(`Invalid tier '${tier}'. Must be: fast, default, heavy`);
  }

  return createAgentConfig(provider, tier);
}

// ============================================================================
// Preset and Pipeline Configuration
// ============================================================================

export function getPreset(name: string, config: ModelsConfig = loadModelsConfig()): PresetConfig {
  const preset = config.presets[name];
  if (!preset) {
    throw new Error(`Unknown preset: ${name}. Available: ${Object.keys(config.presets).join(", ")}`);
  }
  return preset;
}

export function listPresets(config: ModelsConfig = loadModelsConfig()): string[] {
  return Object.keys(config.presets);
}

export function buildPipelineConfig(
  preset: PresetConfig,
  availableProviders: string[],
  config: ModelsConfig = loadModelsConfig()
): EnhancedPipelineConfig {
  // Create agents for each stage based on preset and available providers
  const stage1Agents: AgentConfig[] = [];
  const stage2Agents: AgentConfig[] = [];

  // Distribute agents across available providers
  for (let i = 0; i < preset.stage1.count; i++) {
    const provider = availableProviders[i % availableProviders.length];
    stage1Agents.push(createAgentConfig(provider, preset.stage1.tier, config));
  }

  for (let i = 0; i < preset.stage2.count; i++) {
    const provider = availableProviders[i % availableProviders.length];
    stage2Agents.push(createAgentConfig(provider, preset.stage2.tier, config));
  }

  // Parse chairman spec (e.g., "claude:heavy")
  const chairmanSpec = config.defaults.chairman;
  const [chairProvider, chairTierStr] = chairmanSpec.split(":");
  const chairTier = (chairTierStr || preset.stage3.tier) as ModelTier;

  // Use first available provider if specified chairman provider isn't available
  const chairmanProvider = availableProviders.includes(chairProvider)
    ? chairProvider
    : availableProviders[0];

  const chairman = createAgentConfig(chairmanProvider, chairTier, config);

  return {
    stage1: { agents: stage1Agents },
    stage2: { agents: stage2Agents },
    stage3: {
      chairman,
      useReasoning: preset.stage3.reasoning ?? false,
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export function listProviders(config: ModelsConfig = loadModelsConfig()): string[] {
  return Object.keys(config.providers);
}

export function listTiers(): ModelTier[] {
  return ["fast", "default", "heavy"];
}

export function getProviderInfo(
  provider: string,
  config: ModelsConfig = loadModelsConfig()
): ProviderConfig | undefined {
  return config.providers[provider];
}

export function parseAgentSpec(spec: string): { provider: string; tier: ModelTier } {
  const [provider, tierStr] = spec.split(":");
  const tier = (tierStr || "default") as ModelTier;

  if (!["fast", "default", "heavy"].includes(tier)) {
    throw new Error(`Invalid tier '${tier}'. Must be: fast, default, heavy`);
  }

  return { provider, tier };
}

// ============================================================================
// Stage Spec Parsing (for CLI)
// ============================================================================

export interface ParsedStageSpec {
  agents: AgentConfig[];
  count?: number;
}

const VALID_TIERS: ModelTier[] = ["fast", "default", "heavy"];

/**
 * Parse a stage specification string into agent configurations.
 *
 * Supported formats:
 * - Tier only: "fast", "default", "heavy" → all providers with that tier
 * - Count:tier: "6:fast", "3:default" → N agents distributed across providers
 * - Agent specs: "claude:fast,gemini:default" → explicit agent list
 *
 * @param spec The stage specification string
 * @param availableProviders List of available provider names
 * @param config Optional models configuration
 * @returns Parsed stage configuration with agents array
 */
export function parseStageSpec(
  spec: string,
  availableProviders: string[],
  config: ModelsConfig = loadModelsConfig()
): ParsedStageSpec {
  const trimmed = spec.trim();

  // Check for count:tier format: "6:fast" or "3:default"
  const countTierMatch = trimmed.match(/^(\d+):(fast|default|heavy)$/);
  if (countTierMatch) {
    const count = parseInt(countTierMatch[1], 10);
    const tier = countTierMatch[2] as ModelTier;
    // Distribute agents across providers
    const agents: AgentConfig[] = [];
    for (let i = 0; i < count; i++) {
      const provider = availableProviders[i % availableProviders.length];
      agents.push(createAgentConfig(provider, tier, config));
    }
    return { agents, count };
  }

  // Check if it's a tier-only value (e.g., "fast", "default", "heavy")
  if (VALID_TIERS.includes(trimmed as ModelTier)) {
    const agents = availableProviders.map((p) => createAgentConfig(p, trimmed as ModelTier, config));
    return { agents };
  }

  // Otherwise parse as comma-separated agent specs
  const agents = spec.split(",").map((s) => createAgentFromSpec(s.trim()));
  return { agents };
}
