import chalk from "chalk";
import { buildChairmanPrompt, buildRankingPrompt, parseRankingFromText } from "./prompts.js";
import { callAgent, DEFAULT_CHAIRMAN, runAgentsInteractive } from "./agents.js";
import type {
  AgentConfig,
  AgentState,
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

export function extractStage1(results: AgentState[]): Stage1Result[] {
  return results
    .filter((r) => r.status === "completed")
    .map((r) => ({ agent: r.config.name, response: r.stdout.join("").trim() }));
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
 * @param outputFormat - Optional output format instructions for structured output
 * @returns The chairman's synthesized response
 */
export async function runChairman(
  userQuery: string,
  stage1: Stage1Result[],
  stage2: Stage2Result[],
  chairman: AgentConfig,
  timeoutMs: number | undefined,
  silent: boolean = false,
  outputFormat?: string
): Promise<Stage3Result> {
  if (!silent) {
    console.log(`\nRunning chairman: ${chairman.name}...`);
  }
  const prompt = buildChairmanPrompt(userQuery, stage1, stage2, outputFormat);
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
 * Enhanced pipeline with per-stage agent configuration.
 * Allows different agents/models for each stage of the council.
 */
export async function runEnhancedPipeline(
  question: string,
  options: EnhancedPipelineOptions
): Promise<PipelineResult | null> {
  const { config, timeoutMs, tty, silent = false, callbacks } = options;

  // Stage 1: Individual Responses (using stage1 agents)
  const stage1States = await runAgentsInteractive(
    "Stage 1 - Individual Responses",
    question,
    config.stage1.agents,
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

  // Stage 2: Peer Rankings (using stage2 agents - may differ from stage1)
  const rankingPrompt = buildRankingPrompt(question, stage1);
  const stage2States = await runAgentsInteractive(
    "Stage 2 - Peer Rankings",
    rankingPrompt,
    config.stage2.agents,
    timeoutMs,
    { tty }
  );
  const stage2 = extractStage2(stage2States);

  // Calculate aggregate rankings
  const aggregate = calculateAggregateRankings(stage2, labelToAgent);

  // Stage 2 callback
  await callbacks?.onStage2Complete?.(stage2, aggregate);

  // Stage 3: Chairman Synthesis (using stage3 chairman config)
  const stage3 = await runChairman(
    question,
    stage1,
    stage2,
    config.stage3.chairman,
    timeoutMs,
    silent,
    config.stage3.outputFormat
  );

  // Stage 3 callback
  await callbacks?.onStage3Complete?.(stage3);

  return { stage1, stage2, stage3, aggregate };
}
