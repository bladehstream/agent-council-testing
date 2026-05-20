import { GoogleGenAI } from "@google/genai";
import type { Provider, ProviderCallInput, ProviderCallOutput } from "./types.js";
import { ProviderError, withTimeout } from "./types.js";

export class GoogleProvider implements Provider {
  readonly name = "google";
  private client: GoogleGenAI | null = null;

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  }

  private getClient(): GoogleGenAI {
    if (this.client) return this.client;
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new ProviderError(this.name, "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set");
    }
    this.client = new GoogleGenAI({ apiKey });
    return this.client;
  }

  async call(input: ProviderCallInput): Promise<ProviderCallOutput> {
    const client = this.getClient();
    const generationConfig: Record<string, unknown> = {};
    if (input.system) generationConfig.systemInstruction = input.system;
    if (input.max_tokens !== undefined) generationConfig.maxOutputTokens = input.max_tokens;
    if (input.temperature !== undefined) generationConfig.temperature = input.temperature;

    try {
      const resp = await withTimeout(
        client.models.generateContent({
          model: input.model,
          contents: input.prompt,
          ...(Object.keys(generationConfig).length ? { config: generationConfig } : {}),
        }),
        input.timeout_ms
      );
      const text = resp.text ?? "";
      const usage = resp.usageMetadata;
      return {
        response: text,
        usage: usage
          ? {
              input_tokens: usage.promptTokenCount ?? 0,
              output_tokens: usage.candidatesTokenCount ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      throw new ProviderError(
        this.name,
        err instanceof Error ? err.message : String(err),
        err
      );
    }
  }
}
