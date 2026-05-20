import { loadConfig } from "./config.js";
import type { ModelEntry, ProviderName } from "./config.js";
import type { Provider } from "./providers/types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GoogleProvider } from "./providers/google.js";
import { MoonshotProvider } from "./providers/moonshot.js";
import { OpenAIProvider } from "./providers/openai.js";

let providers: Record<ProviderName, Provider> | null = null;

export function getProviders(): Record<ProviderName, Provider> {
  if (!providers) {
    providers = {
      openai: new OpenAIProvider(),
      moonshot: new MoonshotProvider(),
      google: new GoogleProvider(),
      anthropic: new AnthropicProvider(),
    };
  }
  return providers;
}

export interface ResolvedModel {
  id: string;
  provider: ProviderName;
  model: string;
  entry: ModelEntry;
}

export function resolveModel(to: string): ResolvedModel {
  const cfg = loadConfig();
  const direct = cfg.models[to];
  if (direct) {
    return { id: to, provider: direct.provider, model: direct.model, entry: direct };
  }
  for (const [id, entry] of Object.entries(cfg.models)) {
    if (entry.aliases?.includes(to)) {
      return { id, provider: entry.provider, model: entry.model, entry };
    }
  }
  const validIds = Object.keys(cfg.models);
  const validAliases = Object.values(cfg.models).flatMap((e) => e.aliases ?? []);
  throw new Error(
    `unknown model "${to}". Valid ids: [${validIds.join(", ")}]. Aliases: [${validAliases.join(", ")}].`
  );
}

export interface RouteArgs {
  task: string;
  to: string;
  system?: string;
  max_tokens?: number;
  temperature?: number;
  timeout_ms?: number;
}

export interface RouteResult {
  id: string;
  model: string;
  provider: ProviderName;
  response: string;
  usage?: { input_tokens: number; output_tokens: number };
  elapsed_ms: number;
}

export async function route(args: RouteArgs): Promise<RouteResult> {
  const resolved = resolveModel(args.to);
  const provider = getProviders()[resolved.provider];
  if (!provider.isAvailable()) {
    throw new Error(
      `provider "${resolved.provider}" is unavailable — required API key is not set in the environment`
    );
  }
  const t0 = Date.now();
  const out = await provider.call({
    model: resolved.model,
    prompt: args.task,
    system: args.system,
    max_tokens: args.max_tokens,
    temperature: args.temperature,
    timeout_ms: args.timeout_ms,
  });
  return {
    id: resolved.id,
    model: resolved.model,
    provider: resolved.provider,
    response: out.response,
    usage: out.usage,
    elapsed_ms: Date.now() - t0,
  };
}

export interface FanOutArgs {
  task: string;
  to: string[];
  system?: string | Record<string, string>;
  max_tokens?: number;
  temperature?: number;
  timeout_ms?: number;
}

export interface FanOutResultItem {
  id: string;
  model: string;
  provider?: ProviderName;
  response?: string;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number };
  elapsed_ms: number;
}

export interface FanOutResult {
  results: FanOutResultItem[];
}

function pickSystem(
  target: string,
  resolvedId: string | undefined,
  system: FanOutArgs["system"]
): string | undefined {
  if (system === undefined) return undefined;
  if (typeof system === "string") return system;
  return system[target] ?? (resolvedId ? system[resolvedId] : undefined);
}

export async function fanOut(args: FanOutArgs): Promise<FanOutResult> {
  const calls = args.to.map(async (target): Promise<FanOutResultItem> => {
    const t0 = Date.now();
    let resolvedId: string | undefined;
    let resolvedProvider: ProviderName | undefined;
    let resolvedModel = target;
    try {
      const resolved = resolveModel(target);
      resolvedId = resolved.id;
      resolvedProvider = resolved.provider;
      resolvedModel = resolved.model;
      const system = pickSystem(target, resolvedId, args.system);
      const result = await route({
        task: args.task,
        to: target,
        system,
        max_tokens: args.max_tokens,
        temperature: args.temperature,
        timeout_ms: args.timeout_ms,
      });
      return {
        id: result.id,
        model: result.model,
        provider: result.provider,
        response: result.response,
        usage: result.usage,
        elapsed_ms: result.elapsed_ms,
      };
    } catch (err) {
      return {
        id: resolvedId ?? target,
        model: resolvedModel,
        provider: resolvedProvider,
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - t0,
      };
    }
  });
  const results = await Promise.all(calls);
  return { results };
}

export interface ListedModel {
  id: string;
  aliases: string[];
  provider: ProviderName;
  model: string;
  available: boolean;
  description?: string;
}

export function listModels(): { models: ListedModel[] } {
  const cfg = loadConfig();
  const provs = getProviders();
  const models: ListedModel[] = Object.entries(cfg.models).map(([id, entry]) => ({
    id,
    aliases: entry.aliases ?? [],
    provider: entry.provider,
    model: entry.model,
    available: provs[entry.provider].isAvailable(),
    description: entry.description,
  }));
  return { models };
}
