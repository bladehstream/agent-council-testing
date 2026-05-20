export interface ProviderCallInput {
  model: string;
  prompt: string;
  system?: string;
  max_tokens?: number;
  temperature?: number;
  timeout_ms?: number;
}

export interface ProviderCallOutput {
  response: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface Provider {
  readonly name: string;
  isAvailable(): boolean;
  call(input: ProviderCallInput): Promise<ProviderCallOutput>;
}

export class ProviderError extends Error {
  constructor(public provider: string, message: string, public cause?: unknown) {
    super(message);
    this.name = "ProviderError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms?: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ]);
}
