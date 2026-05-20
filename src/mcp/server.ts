#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fanOut, listModels, route } from "./router.js";

const DEFAULT_TIMEOUT_MS = 60_000;

const server = new McpServer({
  name: "llm-router",
  version: "0.1.0",
});

server.registerTool(
  "route",
  {
    description:
      "Send a task to a specific external LLM and return its response. " +
      "Address the model with `to` using either a canonical id (e.g. 'gpt-5.1', 'kimi-k2') " +
      "or an alias (e.g. 'gpt', 'gemini', 'kimi', 'claude'). " +
      "Call `list_models` first if you don't know what's available.",
    inputSchema: {
      task: z.string().min(1).describe("The prompt to send to the LLM."),
      to: z
        .string()
        .min(1)
        .describe("Model id or alias (e.g. 'gpt', 'gemini', 'kimi-k2', 'claude-opus-4-7')."),
      system: z.string().optional().describe("Optional system prompt / persona."),
      max_tokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`Per-call timeout in ms. Default ${DEFAULT_TIMEOUT_MS}.`),
    },
  },
  async (args) => {
    try {
      const result = await route({
        task: args.task,
        to: args.to,
        system: args.system,
        max_tokens: args.max_tokens,
        temperature: args.temperature,
        timeout_ms: args.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: err instanceof Error ? err.message : String(err) },
        ],
      };
    }
  }
);

server.registerTool(
  "fan_out",
  {
    description:
      "Send the same task to multiple external LLMs in parallel and return all responses. " +
      "Use for adversarial review across providers, e.g. `to: ['gpt-5.1', 'gemini-3-pro', 'kimi-k2']`. " +
      "Pass `system` as a string for a shared persona, or as an object keyed by model id or alias " +
      "to give each model a different persona in a single call. Partial failures are reported as " +
      "`error` on individual results; the call as a whole still succeeds.",
    inputSchema: {
      task: z.string().min(1),
      to: z
        .array(z.string().min(1))
        .min(1)
        .describe("List of model ids or aliases."),
      system: z
        .union([z.string(), z.record(z.string(), z.string())])
        .optional()
        .describe(
          "Shared persona (string) OR per-model personas keyed by id/alias (object)."
        ),
      max_tokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      timeout_ms: z.number().int().positive().optional(),
    },
  },
  async (args) => {
    const result = await fanOut({
      task: args.task,
      to: args.to,
      system: args.system,
      max_tokens: args.max_tokens,
      temperature: args.temperature,
      timeout_ms: args.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "list_models",
  {
    description:
      "List all models the router can dispatch to, including aliases, provider, and whether " +
      "the corresponding API key is present in the environment (`available`). " +
      "Models with `available: false` will return an error if called.",
    inputSchema: {},
  },
  async () => {
    const result = listModels();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(
    `llm-router-mcp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
  );
  process.exit(1);
});
