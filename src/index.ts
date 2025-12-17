#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import { DEFAULT_AGENTS, filterAvailableAgents } from "./agents.js";
import { pickChairman, printFinal, runCouncilPipeline } from "./pipeline.js";
import { startRepl } from "./repl.js";

function buildArgs() {
  return yargs(hideBin(process.argv))
    .scriptName("agent-council")
    .usage("$0 [question] [options]")
    .positional("question", {
      describe: "The question to send to the council (omit to enter interactive mode)",
      type: "string",
    })
    .option("chairman", {
      type: "string",
      describe: "Which agent synthesizes the final answer",
    })
    .option("timeout", {
      type: "number",
      default: 0,
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
  const question = argv._[0]?.toString();
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

  const chairman = pickChairman(available, argv.chairman);
  const useTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // If no question provided, enter REPL mode
  if (!question) {
    await startRepl(available, chairman);
    return;
  }

  // Single-run mode (backwards compatible)
  const result = await runCouncilPipeline(question, available, chairman, {
    timeoutMs,
    tty: useTty,
  });

  if (!result) {
    process.exit(1);
  }

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printFinal(result.stage1, result.stage2, result.aggregate, result.stage3);
  }
}

// Only run main() when executed directly, not when imported
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
