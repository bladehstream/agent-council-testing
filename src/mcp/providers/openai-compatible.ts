import OpenAI from "openai";
import type { Provider, ProviderCallInput, ProviderCallOutput } from "./types.js";
import { ProviderError } from "./types.js";

/**
 * Base class for any OpenAI-compatible chat-completions API
 * (OpenAI itself, Moonshot / Kimi, DeepSeek, Groq, etc.).
 * Subclasses override the env var name and optional baseURL.
 */
export abstract class OpenAICompatibleProvider implements Provider {
  abstract readonly name: string;
  protected abstract readonly apiKeyEnvs: string[];
  protected readonly baseURL?: string;
  private client: OpenAI | null = null;

  isAvailable(): boolean {
    return this.apiKeyEnvs.some((k) => Boolean(process.env[k]));
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const envName = this.apiKeyEnvs.find((k) => process.env[k]);
    if (!envName) {
      throw new ProviderError(
        this.name,
        `none of ${this.apiKeyEnvs.join(", ")} is set in the environment`
      );
    }
    this.client = new OpenAI({
      apiKey: process.env[envName]!,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    });
    return this.client;
  }

  async call(input: ProviderCallInput): Promise<ProviderCallOutput> {
    const client = this.getClient();
    const messages: { role: "system" | "user"; content: string }[] = [];
    if (input.system) messages.push({ role: "system", content: input.system });
    messages.push({ role: "user", content: input.prompt });

    const controller = new AbortController();
    const timer = input.timeout_ms
      ? setTimeout(() => controller.abort(), input.timeout_ms)
      : null;
    try {
      const resp = await client.chat.completions.create(
        {
          model: input.model,
          messages,
          ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        },
        { signal: controller.signal }
      );
      const choice = resp.choices?.[0];
      const content = choice?.message?.content;
      const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
      return {
        response: text,
        usage: resp.usage
          ? {
              input_tokens: resp.usage.prompt_tokens ?? 0,
              output_tokens: resp.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      throw new ProviderError(
        this.name,
        err instanceof Error ? err.message : String(err),
        err
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
