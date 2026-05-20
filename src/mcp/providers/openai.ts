import { OpenAICompatibleProvider } from "./openai-compatible.js";

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly name = "openai";
  protected readonly apiKeyEnvs = ["OPENAI_API_KEY"];
}
