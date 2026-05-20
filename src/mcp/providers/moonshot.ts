import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Moonshot AI (Kimi) — uses an OpenAI-compatible chat-completions API.
 * Accepts either MOONSHOT_API_KEY or KIMI_API_KEY for ergonomics.
 * Base URL can be overridden with MOONSHOT_BASE_URL (e.g. for the .cn endpoint).
 */
export class MoonshotProvider extends OpenAICompatibleProvider {
  readonly name = "moonshot";
  protected readonly apiKeyEnvs = ["MOONSHOT_API_KEY", "KIMI_API_KEY"];
  protected readonly baseURL = process.env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1";
}
