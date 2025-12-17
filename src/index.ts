#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import { DEFAULT_AGENTS, filterAvailableAgents, commandExists } from "./agents.js";
import { pickChairman, printFinal, runCouncilPipeline, runEnhancedPipeline } from "./pipeline.js";
import { startRepl } from "./repl.js";
import {
  loadModelsConfig,
  refreshModelsConfig,
  getConfigPath,
  createAgentFromSpec,
  getPreset,
  listPresets,
  listProviders,
  buildPipelineConfig,
  parseStageSpec,
  type ModelTier,
} from "./model-config.js";

function buildArgs() {
  return yargs(hideBin(process.argv))
    .scriptName("agent-council")
    .usage("$0 [question] [options]")
    .positional("question", {
      describe: "The question to send to the council (omit to enter interactive mode)",
      type: "string",
    })
    .option("respond", {
      alias: "r",
      type: "string",
      describe: "Responders: <tier>, <count>:<tier>, or <agent specs> (e.g., 'fast', '3:default', 'claude:fast,gemini:fast')",
    })
    .option("evaluate", {
      alias: "e",
      type: "string",
      describe: "Evaluators: <tier>, <count>:<tier>, or <agent specs> (e.g., 'default', '6:fast')",
    })
    .option("chairman", {
      alias: "c",
      type: "string",
      describe: "Chairman agent (e.g., 'claude:heavy')",
    })
    .option("preset", {
      alias: "p",
      type: "string",
      describe: "Use a preset (fast, balanced, thorough)",
    })
    .option("timeout", {
      alias: "t",
      type: "number",
      default: 0,
      describe: "Per-agent timeout in seconds (0 means no timeout)",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Output results as JSON",
    })
    .option("refreshmodels", {
      type: "boolean",
      default: false,
      describe: "Refresh models.json from package defaults",
    })
    .option("list-presets", {
      type: "boolean",
      default: false,
      describe: "List available presets",
    })
    .option("list-models", {
      type: "boolean",
      default: false,
      describe: "List available models and tiers",
    })
    .option("config-path", {
      type: "boolean",
      default: false,
      describe: "Show path to models.json config",
    })
    .help();
}

function printModelList() {
  const config = loadModelsConfig();
  console.log(chalk.bold("\nAvailable Models:\n"));

  for (const [provider, providerConfig] of Object.entries(config.providers)) {
    const cliAvailable = commandExists(providerConfig.cli);
    const status = cliAvailable ? chalk.green("✓") : chalk.red("✗");
    console.log(`${status} ${chalk.bold(provider)} (${providerConfig.cli})`);

    for (const [tier, tierConfig] of Object.entries(providerConfig.tiers)) {
      const reasoning = tierConfig.reasoning ? chalk.cyan(" +reasoning") : "";
      console.log(`    ${tier}: ${tierConfig.model}${reasoning}`);
      console.log(chalk.gray(`           ${tierConfig.description}`));
    }
    console.log();
  }
}

function printPresetList() {
  const config = loadModelsConfig();
  console.log(chalk.bold("\nAvailable Presets:\n"));

  for (const [name, preset] of Object.entries(config.presets)) {
    console.log(`${chalk.bold(name)}: ${preset.description}`);
    console.log(`    Stage 1: ${preset.stage1.count}x ${preset.stage1.tier}`);
    console.log(`    Stage 2: ${preset.stage2.count}x ${preset.stage2.tier}`);
    console.log(`    Stage 3: 1x ${preset.stage3.tier}${preset.stage3.reasoning ? " +reasoning" : ""}`);
    console.log();
  }
}

function getAvailableProviders(): string[] {
  const config = loadModelsConfig();
  return Object.keys(config.providers).filter((provider) => {
    const cli = config.providers[provider].cli;
    return commandExists(cli);
  });
}

async function main() {
  const argv = await buildArgs().parseAsync();
  const question = argv._[0]?.toString();
  const timeoutMs = argv.timeout && argv.timeout > 0 ? argv.timeout * 1000 : undefined;

  // Handle utility commands
  if (argv.refreshmodels) {
    refreshModelsConfig();
    return;
  }

  if (argv["config-path"]) {
    console.log(getConfigPath());
    return;
  }

  if (argv["list-models"]) {
    printModelList();
    return;
  }

  if (argv["list-presets"]) {
    printPresetList();
    return;
  }

  // Check for available providers
  const availableProviders = getAvailableProviders();

  if (availableProviders.length === 0) {
    console.error(chalk.red("Error: No agents available. Please install at least one of: codex, claude, gemini"));
    process.exit(1);
  }

  if (availableProviders.length < 2) {
    console.log(chalk.yellow(`Warning: Only ${availableProviders.length} provider available. Council works best with multiple agents.\n`));
  }

  const useTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // Determine if using enhanced mode (preset or stage flags)
  const useEnhanced = argv.preset || argv.respond || argv.evaluate;

  if (useEnhanced) {
    // Enhanced pipeline mode
    const config = loadModelsConfig();

    let pipelineConfig;

    if (argv.preset && !argv.respond && !argv.evaluate) {
      // Use preset configuration (only if no stage overrides)
      const preset = getPreset(argv.preset, config);
      pipelineConfig = buildPipelineConfig(preset, availableProviders, config);
      console.log(chalk.cyan(`Using preset: ${argv.preset}\n`));
    } else {
      // Build config from stage flags (or preset as base with overrides)
      const respondConfig = argv.respond
        ? parseStageSpec(argv.respond, availableProviders)
        : { agents: availableProviders.map((p) => createAgentFromSpec(`${p}:default`)) };

      const evaluateConfig = argv.evaluate
        ? parseStageSpec(argv.evaluate, availableProviders)
        : { agents: availableProviders.map((p) => createAgentFromSpec(`${p}:default`)) };

      const chairmanSpec = argv.chairman || `${availableProviders[0]}:heavy`;
      const chairman = createAgentFromSpec(chairmanSpec);

      pipelineConfig = {
        stage1: { agents: respondConfig.agents },
        stage2: { agents: evaluateConfig.agents },
        stage3: { chairman, useReasoning: false },
      };
    }

    // Override chairman if specified
    if (argv.chairman && argv.preset) {
      pipelineConfig.stage3.chairman = createAgentFromSpec(argv.chairman);
    }

    // If no question provided, enter REPL mode (fall back to classic mode)
    if (!question) {
      const { available } = filterAvailableAgents(DEFAULT_AGENTS);
      const chairman = pickChairman(available, argv.chairman);
      await startRepl(available, chairman);
      return;
    }

    const result = await runEnhancedPipeline(question, {
      config: pipelineConfig,
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
  } else {
    // Classic mode (backwards compatible)
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

    const chairman = pickChairman(available, argv.chairman);

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
