import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ProviderCallInput, ProviderCallOutput } from "./types.js";
import { ProviderError } from "./types.js";

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  isAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderError(this.name, "ANTHROPIC_API_KEY is not set");
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async call(input: ProviderCallInput): Promise<ProviderCallOutput> {
    const client = this.getClient();
    const controller = new AbortController();
    const timer = input.timeout_ms
      ? setTimeout(() => controller.abort(), input.timeout_ms)
      : null;
    try {
      const resp = await client.messages.create(
        {
          model: input.model,
          max_tokens: input.max_tokens ?? 4096,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.system ? { system: input.system } : {}),
          messages: [{ role: "user", content: input.prompt }],
        },
        { signal: controller.signal }
      );
      const text = resp.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      return {
        response: text,
        usage: {
          input_tokens: resp.usage.input_tokens,
          output_tokens: resp.usage.output_tokens,
        },
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
