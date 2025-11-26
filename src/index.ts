import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import { DEFAULT_AGENTS, filterAvailableAgents, runAgentsInteractive } from "./agents.js";
import { buildRankingPrompt } from "./prompts.js";
import {
  abortIfNoStage1,
  calculateAggregateRankings,
  extractStage1,
  extractStage2,
  pickChairman,
  printFinal,
  runChairman,
} from "./pipeline.js";
import type { LabelMap } from "./types.js";

function buildArgs() {
  return yargs(hideBin(process.argv))
    .scriptName("llm-local-council")
    .usage("$0 <question> [options]")
    .positional("question", {
      describe: "The question to send to the council",
      type: "string",
      demandOption: true,
    })
    .option("chairman", {
      type: "string",
      describe: "Which agent synthesizes the final answer",
    })
    .option("timeout", {
      type: "number",
      default: 300,
      describe: "Per-agent timeout in seconds (0 means no timeout)",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Output results as JSON",
    })
    .help();
}

async function main() {
  const argv = await buildArgs().parseAsync();
  const question = argv._[0]?.toString() || (argv as any).question;
  const timeoutMs = argv.timeout && argv.timeout > 0 ? argv.timeout * 1000 : undefined;

  // Filter agents based on command availability
  const { available, unavailable } = filterAvailableAgents(DEFAULT_AGENTS);

  if (unavailable.length > 0) {
    console.log(chalk.yellow("Skipping unavailable agents:"));
    for (const { name, command } of unavailable) {
      console.log(chalk.gray(`  - ${name} (command '${command}' not found)`));
    }
    console.log();
  }

  if (available.length === 0) {
    console.error(chalk.red("Error: No agents available. Please install at least one of: codex, claude, gemini"));
    process.exit(1);
  }

  if (available.length < 2) {
    console.log(chalk.yellow(`Warning: Only ${available.length} agent available. Council works best with multiple agents.\n`));
  }

  const agents = available;
  const chairman = pickChairman(agents, argv.chairman);
  const useTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const stage1States = await runAgentsInteractive("Stage 1 - Individual Responses", question, agents, timeoutMs, {
    tty: useTty,
  });
  const stage1 = extractStage1(stage1States);
  if (abortIfNoStage1(stage1)) return;

  const labels = stage1.map((_, idx) => `Response ${String.fromCharCode(65 + idx)}`);
  const labelToAgent: LabelMap = {};
  labels.forEach((label, idx) => {
    labelToAgent[label] = stage1[idx].agent;
  });

  const rankingPrompt = buildRankingPrompt(question, stage1);
  const stage2States = await runAgentsInteractive("Stage 2 - Peer Rankings", rankingPrompt, agents, timeoutMs, {
    tty: useTty,
  });
  const stage2 = extractStage2(stage2States);

  const aggregate = calculateAggregateRankings(stage2, labelToAgent);
  const stage3 = await runChairman(question, stage1, stage2, chairman, timeoutMs);

  if (argv.json) {
    console.log(
      JSON.stringify(
        {
          stage1,
          stage2,
          aggregate,
          stage3,
        },
        null,
        2
      )
    );
  } else {
    printFinal(stage1, stage2, aggregate, stage3);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
