import chalk from "chalk";
import { buildChairmanPrompt, parseRankingFromText } from "./prompts.js";
import { callAgent, DEFAULT_CHAIRMAN } from "./agents.js";
import type {
  AgentConfig,
  AgentState,
  LabelMap,
  Stage1Result,
  Stage2Result,
  Stage3Result,
} from "./types.js";

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

export async function runChairman(
  userQuery: string,
  stage1: Stage1Result[],
  stage2: Stage2Result[],
  chairman: AgentConfig,
  timeoutMs: number | undefined
): Promise<Stage3Result> {
  console.log(`\nRunning chairman: ${chairman.name}...`);
  const prompt = buildChairmanPrompt(userQuery, stage1, stage2);
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
