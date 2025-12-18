import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { buildChairmanPrompt, buildRankingPrompt, parseRankingFromText, type ChairmanPromptOptions } from "./prompts.js";
import { callAgent, DEFAULT_CHAIRMAN, runAgentsInteractive } from "./agents.js";
import type {
  AgentConfig,
  AgentState,
  CheckpointData,
  CheckpointOptions,
  EnhancedPipelineConfig,
  LabelMap,
  Stage1Result,
  Stage2Result,
  Stage3Result,
} from "./types.js";

export type AggregateRanking = { agent: string; averageRank: number; rankingsCount: number };

export type PipelineResult = {
  stage1: Stage1Result[];
  stage2: Stage2Result[];
  stage3: Stage3Result;
  aggregate: AggregateRanking[];
};

export interface PipelineCallbacks {
  onStage1Complete?: (results: Stage1Result[]) => void | Promise<void>;
  onStage2Complete?: (results: Stage2Result[], aggregate: AggregateRanking[]) => void | Promise<void>;
  onStage3Complete?: (result: Stage3Result) => void | Promise<void>;
}

export interface PipelineOptions {
  timeoutMs?: number;
  tty: boolean;
  silent?: boolean;
  callbacks?: PipelineCallbacks;
}

export interface EnhancedPipelineOptions extends PipelineOptions {
  config: EnhancedPipelineConfig;
  checkpoint?: CheckpointOptions;
}

// ============================================================================
// Checkpoint Functions
// ============================================================================

function getCheckpointPath(options: CheckpointOptions): string {
  const dir = options.checkpointDir!;
  const name = options.checkpointName ?? "council-checkpoint";
  return join(dir, `${name}.json`);
}

/**
 * Save checkpoint data to disk.
 * Creates the checkpoint directory if it doesn't exist.
 */
export function saveCheckpoint(data: CheckpointData, options: CheckpointOptions): void {
  if (!options.checkpointDir) return;

  if (!existsSync(options.checkpointDir)) {
    mkdirSync(options.checkpointDir, { recursive: true });
  }

  const path = getCheckpointPath(options);
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/**
 * Load checkpoint data from disk.
 * Returns null if no checkpoint exists or if the checkpoint is for a different question.
 */
export function loadCheckpoint(question: string, options: CheckpointOptions): CheckpointData | null {
  if (!options.checkpointDir) return null;

  const path = getCheckpointPath(options);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf-8");
    const data = JSON.parse(content) as CheckpointData;

    // Validate checkpoint version
    if (data.version !== 1) {
      console.log(chalk.yellow("Checkpoint version mismatch, ignoring checkpoint"));
      return null;
    }

    // Validate question matches
    if (data.question !== question) {
      console.log(chalk.yellow("Checkpoint question doesn't match, ignoring checkpoint"));
      return null;
    }

    return data;
  } catch (err) {
    console.log(chalk.yellow(`Failed to load checkpoint: ${err instanceof Error ? err.message : err}`));
    return null;
  }
}

/**
 * Remove checkpoint file after successful completion.
 */
export function clearCheckpoint(options: CheckpointOptions): void {
  if (!options.checkpointDir) return;

  const path = getCheckpointPath(options);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Ignore errors when clearing checkpoint
    }
  }
}

export async function runCouncilPipeline(
  question: string,
  agents: AgentConfig[],
  chairman: AgentConfig,
  options: PipelineOptions
): Promise<PipelineResult | null> {
  const { timeoutMs, tty, silent = false, callbacks } = options;

  // Stage 1: Individual Responses
  const stage1States = await runAgentsInteractive(
    "Stage 1 - Individual Responses",
    question,
    agents,
    timeoutMs,
    { tty }
  );
  const stage1 = extractStage1(stage1States);

  if (stage1.length === 0) {
    if (!silent) {
      console.log(chalk.red("No agent responses were completed; aborting."));
    }
    return null;
  }

  // Stage 1 callback
  await callbacks?.onStage1Complete?.(stage1);

  // Build label map for Stage 2
  const labels = stage1.map((_, idx) => `Response ${String.fromCharCode(65 + idx)}`);
  const labelToAgent: LabelMap = {};
  labels.forEach((label, idx) => {
    labelToAgent[label] = stage1[idx].agent;
  });

  // Stage 2: Peer Rankings
  const rankingPrompt = buildRankingPrompt(question, stage1);
  const stage2States = await runAgentsInteractive(
    "Stage 2 - Peer Rankings",
    rankingPrompt,
    agents,
    timeoutMs,
    { tty }
  );
  const stage2 = extractStage2(stage2States);

  // Calculate aggregate rankings
  const aggregate = calculateAggregateRankings(stage2, labelToAgent);

  // Stage 2 callback
  await callbacks?.onStage2Complete?.(stage2, aggregate);

  // Stage 3: Chairman Synthesis
  const stage3 = await runChairman(question, stage1, stage2, chairman, timeoutMs, silent);

  // Stage 3 callback
  await callbacks?.onStage3Complete?.(stage3);

  return { stage1, stage2, stage3, aggregate };
}

/**
 * Extract executive summary from a Stage 1 response.
 * Tries JSON parsing first, then falls back to markdown header search.
 */
export function extractSummaryFromResponse(response: string): string | undefined {
  // Try 1: Parse as JSON directly
  try {
    const parsed = JSON.parse(response);
    if (parsed.executive_summary && typeof parsed.executive_summary === 'string') {
      return parsed.executive_summary;
    }
  } catch {
    // Not valid JSON, try other methods
  }

  // Try 2: Extract JSON from markdown code fences
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.executive_summary && typeof parsed.executive_summary === 'string') {
        return parsed.executive_summary;
      }
    } catch {
      // Code fence content not valid JSON
    }
  }

  // Try 3: Look for markdown header format
  const headerMatch = response.match(
    /##\s*Executive\s+Summary\s*\n([\s\S]*?)(?=\n##\s|\n---|\n\*\*\*|$)/i
  );
  if (headerMatch) {
    return headerMatch[1].trim();
  }

  // Try 4: Look for bold label format
  const boldMatch = response.match(
    /\*\*Executive\s+Summary[:\*]*\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n---|\n\*\*\*|$)/i
  );
  if (boldMatch) {
    return boldMatch[1].trim();
  }

  return undefined;
}

export function extractStage1(results: AgentState[]): Stage1Result[] {
  return results
    .filter((r) => r.status === "completed")
    .map((r) => {
      const response = r.stdout.join("").trim();
      return {
        agent: r.config.name,
        response,
        summary: extractSummaryFromResponse(response),
      };
    });
}

export function extractStage2(results: AgentState[]): Stage2Result[] {
  return results
    .filter((r) => r.status === "completed")
    .map((r) => {
      const rankingRaw = r.stdout.join("").trim();
      return {
        agent: r.config.name,
        rankingRaw,
        parsedRanking: parseRankingFromText(rankingRaw),
      };
    });
}

export function calculateAggregateRankings(stage2: Stage2Result[], labels: LabelMap) {
  const positions: Record<string, number[]> = {};
  stage2.forEach((res) => {
    res.parsedRanking.forEach((label, idx) => {
      const agent = labels[label];
      if (!agent) return;
      if (!positions[agent]) positions[agent] = [];
      positions[agent].push(idx + 1);
    });
  });

  return Object.entries(positions)
    .map(([agent, arr]) => ({
      agent,
      averageRank: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100,
      rankingsCount: arr.length,
    }))
    .sort((a, b) => a.averageRank - b.averageRank);
}

/**
 * Run the chairman synthesis stage.
 *
 * @param userQuery - The original user question
 * @param stage1 - Individual agent responses from Stage 1
 * @param stage2 - Peer rankings from Stage 2
 * @param chairman - The chairman agent configuration
 * @param timeoutMs - Optional timeout in milliseconds
 * @param silent - Suppress console output
 * @param options - Chairman prompt options (outputFormat, useSummaries) or outputFormat string for backward compatibility
 * @returns The chairman's synthesized response
 */
export async function runChairman(
  userQuery: string,
  stage1: Stage1Result[],
  stage2: Stage2Result[],
  chairman: AgentConfig,
  timeoutMs: number | undefined,
  silent: boolean = false,
  options?: ChairmanPromptOptions | string
): Promise<Stage3Result> {
  if (!silent) {
    console.log(`\nRunning chairman: ${chairman.name}...`);
  }
  const prompt = buildChairmanPrompt(userQuery, stage1, stage2, options);
  const state: AgentState = {
    config: chairman,
    status: "pending",
    stdout: [],
    stderr: [],
  };
  const res = await callAgent(state, prompt, timeoutMs);
  const responseText =
    res.status === "completed" ? res.stdout.join("").trim() : `Error from chairman (${res.status})`;
  return { agent: chairman.name, response: responseText };
}

export function pickChairman(agents: AgentConfig[], chairmanName?: string): AgentConfig {
  return (
    agents.find((a) => a.name === chairmanName) ||
    agents.find((a) => a.name === DEFAULT_CHAIRMAN) ||
    agents[0]
  );
}

export function printFinal(
  stage1: Stage1Result[],
  stage2: Stage2Result[],
  aggregate: ReturnType<typeof calculateAggregateRankings>,
  stage3: Stage3Result
) {
  console.log("\n=== Stage 1 Responses ===");
  stage1.forEach((r) => {
    console.log(`\n[${r.agent}]`);
    console.log(r.response);
  });

  console.log("\n=== Stage 2 Rankings ===");
  stage2.forEach((r) => {
    console.log(`\n[${r.agent}]`);
    console.log(r.rankingRaw);
  });

  if (aggregate.length) {
    console.log("\nAggregate ranking (lower is better):");
    aggregate.forEach((entry) => {
      console.log(`- ${entry.agent}: avg rank ${entry.averageRank} (from ${entry.rankingsCount} rankings)`);
    });
  }

  console.log("\n=== Stage 3 Chairman Synthesis ===");
  console.log(`\n[${stage3.agent}]`);
  console.log(stage3.response);
}

export function abortIfNoStage1(stage1: Stage1Result[]) {
  if (stage1.length === 0) {
    console.log(chalk.red("No agent responses were completed; aborting."));
    return true;
  }
  return false;
}

/**
 * Check if a chairman response indicates failure.
 */
function isChairmanFailure(response: string): boolean {
  return response.startsWith("Error from chairman");
}

/**
 * Enhanced pipeline with per-stage agent configuration.
 * Supports checkpointing for resumption and single chairman fallback.
 */
export async function runEnhancedPipeline(
  question: string,
  options: EnhancedPipelineOptions
): Promise<PipelineResult | null> {
  const { config, timeoutMs, tty, silent = false, callbacks, checkpoint } = options;

  let stage1: Stage1Result[];
  let stage2: Stage2Result[];
  let labelToAgent: LabelMap;
  let aggregate: AggregateRanking[];

  // Check for existing checkpoint
  const existingCheckpoint = checkpoint ? loadCheckpoint(question, checkpoint) : null;

  if (existingCheckpoint) {
    if (!silent) {
      console.log(chalk.cyan(`\nResuming from checkpoint (completed: ${existingCheckpoint.completedStage})`));
    }

    // Restore state from checkpoint
    if (existingCheckpoint.completedStage === "stage1" || existingCheckpoint.completedStage === "stage2") {
      stage1 = existingCheckpoint.stage1!;
      labelToAgent = existingCheckpoint.labelToAgent!;

      // Stage 1 callback (replay for consistency)
      await callbacks?.onStage1Complete?.(stage1);
    }

    if (existingCheckpoint.completedStage === "stage2") {
      stage2 = existingCheckpoint.stage2!;
      aggregate = existingCheckpoint.aggregate!;

      // Stage 2 callback (replay for consistency)
      await callbacks?.onStage2Complete?.(stage2, aggregate);
    }
  }

  // Stage 1: Individual Responses (skip if restored from checkpoint)
  if (!existingCheckpoint || existingCheckpoint.completedStage === "complete") {
    const stage1States = await runAgentsInteractive(
      "Stage 1 - Individual Responses",
      question,
      config.stage1.agents,
      timeoutMs,
      { tty }
    );
    stage1 = extractStage1(stage1States);

    if (stage1.length === 0) {
      if (!silent) {
        console.log(chalk.red("No agent responses were completed; aborting."));
      }
      return null;
    }

    // Stage 1 callback
    await callbacks?.onStage1Complete?.(stage1);

    // Build label map for Stage 2
    const labels = stage1.map((_, idx) => `Response ${String.fromCharCode(65 + idx)}`);
    labelToAgent = {};
    labels.forEach((label, idx) => {
      labelToAgent[label] = stage1[idx].agent;
    });

    // Save checkpoint after Stage 1
    if (checkpoint) {
      saveCheckpoint({
        version: 1,
        timestamp: new Date().toISOString(),
        question,
        completedStage: "stage1",
        stage1,
        labelToAgent,
      }, checkpoint);
      if (!silent) {
        console.log(chalk.gray("Checkpoint saved after Stage 1"));
      }
    }
  }

  // Stage 2: Peer Rankings (skip if restored from checkpoint with stage2 complete)
  if (!existingCheckpoint || existingCheckpoint.completedStage === "stage1") {
    const rankingPrompt = buildRankingPrompt(question, stage1!);
    const stage2States = await runAgentsInteractive(
      "Stage 2 - Peer Rankings",
      rankingPrompt,
      config.stage2.agents,
      timeoutMs,
      { tty }
    );
    stage2 = extractStage2(stage2States);

    // Calculate aggregate rankings
    aggregate = calculateAggregateRankings(stage2, labelToAgent!);

    // Stage 2 callback
    await callbacks?.onStage2Complete?.(stage2, aggregate);

    // Save checkpoint after Stage 2
    if (checkpoint) {
      saveCheckpoint({
        version: 1,
        timestamp: new Date().toISOString(),
        question,
        completedStage: "stage2",
        stage1: stage1!,
        stage2,
        labelToAgent: labelToAgent!,
        aggregate,
      }, checkpoint);
      if (!silent) {
        console.log(chalk.gray("Checkpoint saved after Stage 2"));
      }
    }
  }

  // Build chairman options
  const chairmanOptions: ChairmanPromptOptions = {
    outputFormat: config.stage3.outputFormat,
    useSummaries: config.stage3.useSummaries,
  };

  // Stage 3: Chairman Synthesis with fallback support
  let stage3 = await runChairman(
    question,
    stage1!,
    stage2!,
    config.stage3.chairman,
    timeoutMs,
    silent,
    chairmanOptions
  );

  // Try fallback if primary chairman failed and fallback is configured
  if (isChairmanFailure(stage3.response) && config.stage3.fallback) {
    if (!silent) {
      console.log(chalk.yellow(`\nPrimary chairman (${config.stage3.chairman.name}) failed, trying fallback (${config.stage3.fallback.name})...`));
    }
    stage3 = await runChairman(
      question,
      stage1!,
      stage2!,
      config.stage3.fallback,
      timeoutMs,
      silent,
      chairmanOptions
    );
  }

  // Stage 3 callback
  await callbacks?.onStage3Complete?.(stage3);

  // Clear checkpoint on successful completion (even if chairman failed, stages are preserved)
  if (checkpoint && !isChairmanFailure(stage3.response)) {
    clearCheckpoint(checkpoint);
    if (!silent) {
      console.log(chalk.gray("Checkpoint cleared after successful completion"));
    }
  }

  return { stage1: stage1!, stage2: stage2!, stage3, aggregate: aggregate! };
}
