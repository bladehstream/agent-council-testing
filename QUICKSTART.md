# Agent Council - Quick Start Guide

This guide covers setup, testing, and usage of the agent-council programmatic API.

## Prerequisites

You need at least 2 of the following AI CLI tools installed and authenticated:

| Tool | Install | Authenticate |
|------|---------|--------------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | `claude auth` |
| **Codex CLI** | `npm install -g @openai/codex` | `codex auth` |
| **Gemini CLI** | `npm install -g @google/gemini-cli` | `gemini auth` |

Verify installation:
```bash
which claude codex gemini
```

## Installation

### From npm (when published)
```bash
npm install agent-council
```

### From source
```bash
git clone https://github.com/bladehstream/agent-council-testing.git
cd agent-council-testing
npm install
npm run build
```

> **IMPORTANT - Development Workflow:**
> This is a TypeScript project. Source files are in `src/`, compiled output is in `dist/`.
> **After ANY change to source files, you MUST run `npm run build`** to compile.
> The CLI runs from `dist/`, so changes to `src/` won't take effect until rebuilt.

## Quick Verification

### 1. Check available agents
```bash
node -e "
import('./dist/lib.js').then(({ filterAvailableAgents, DEFAULT_AGENTS }) => {
  const { available, unavailable } = filterAvailableAgents(DEFAULT_AGENTS);
  console.log('Available:', available.map(a => a.name).join(', ') || 'none');
  console.log('Unavailable:', unavailable.map(a => a.name).join(', ') || 'none');
});
"
```

### 2. Verify CLI works
```bash
./dist/index.js --help
```

### 3. Verify programmatic API
```bash
node -e "
import('./dist/lib.js').then(lib => {
  console.log('Exports:', Object.keys(lib).length);
  console.log('Functions:', Object.keys(lib).filter(k => typeof lib[k] === 'function').join(', '));
});
"
```

## Running Tests

### Unit Tests (no agents required)
```bash
npm test
# or: node tests/test-runner.mjs && node tests/test-model-config.mjs
```

Expected output: `SUMMARY: 31 passed, 0 failed, 0 skipped` followed by `MODEL CONFIG TESTS: 103 passed, 0 failed, 0 skipped`

### Real-World Tests (requires agents)
```bash
npm run test:real-world
```

These tests verify actual CLI behavior:
- Contract tests: CLI flags exist in `--help` output
- Model validation: Model names accepted by APIs
- Integration: Generated commands work with real CLIs
- Smoke tests: End-to-end pipeline with real agents

Expected output: `REAL-WORLD TESTS: 21 passed, 0 failed, 0 skipped`

### Pipeline Tests (requires 2+ agents)
```bash
npm run test:pipeline
```

Note: Pipeline tests take 60-90 seconds each due to real AI agent calls.

### All Tests
```bash
npm run test:all
```

## Usage Examples

### CLI Usage - Basic

```bash
# Simple question (uses default models)
./dist/index.js "What is the best programming language for web development?"

# Interactive REPL mode
./dist/index.js
```

### CLI Usage - Presets (Recommended)

Presets optimize the model selection for different use cases:

```bash
# Fast preset - quick answers, lower cost
# Uses: Haiku, Flash, Mini for stages 1-2, default for chairman
./dist/index.js "What is dependency injection?" --preset fast

# Balanced preset - good quality, reasonable speed
# Uses: Sonnet, Pro, Codex for stages 1-2, heavy for chairman
./dist/index.js "Compare REST vs GraphQL" --preset balanced

# Thorough preset - maximum quality with deep reasoning
# Uses: Opus, Deep Think, Max with extended reasoning
./dist/index.js "Design a distributed system for 1M users" --preset thorough
```

### CLI Usage - Custom Model Selection

Fine-tune which models run at each stage using `-r` (respond), `-e` (evaluate), `-c` (chairman):

```bash
# Fast research, heavy synthesis
./dist/index.js "Explain microservices" \
  -r "claude:fast,gemini:fast,codex:fast" \
  -c "claude:heavy"

# More evaluators for better consensus (6 agents using fast tier)
./dist/index.js "Best authentication approach?" \
  -r default -e 6:fast -c gemini:heavy

# JSON output for scripting
./dist/index.js "Question" -p fast --json

# With timeout (seconds per agent)
./dist/index.js "Complex question" -p thorough -t 120
```

Stage spec formats:
- `fast` / `default` / `heavy` - All providers with that tier
- `6:fast` - 6 agents distributed across providers
- `claude:fast,gemini:default` - Explicit agent specs

### Discover Available Models

```bash
# List all models with availability
./dist/index.js --list-models

# List preset configurations
./dist/index.js --list-presets

# Show config file path
./dist/index.js --config-path

# Refresh model definitions
./dist/index.js --refreshmodels
```

### Model Tiers

| Tier | Claude | Gemini | Codex | Use Case |
|------|--------|--------|-------|----------|
| `fast` | Haiku | 2.5 Flash Lite | 5.1 Codex Mini | Quick, cost-sensitive |
| `default` | Sonnet | 2.5 Flash | 5.1 Codex | Balanced |
| `heavy` | Opus | 2.5 Pro | 5.1 Codex Max | Complex reasoning |

### Programmatic Usage

#### Using Presets (Recommended)
```javascript
import {
  runEnhancedPipeline,
  getPreset,
  buildPipelineConfig,
  loadModelsConfig,
  listProviders,
  commandExists,
} from 'agent-council';

// Load config and find available providers
const config = loadModelsConfig();
const availableProviders = listProviders(config).filter(p =>
  commandExists(config.providers[p].cli)
);

// Use a preset
const preset = getPreset('balanced', config);
const pipelineConfig = buildPipelineConfig(preset, availableProviders, config);

const result = await runEnhancedPipeline(
  "What's the best approach for authentication?",
  { config: pipelineConfig, tty: false, silent: true, timeoutMs: 60000 }
);

if (result) {
  console.log('Final answer:', result.stage3.response);
  console.log('Top ranked:', result.aggregate[0]?.agent);
}
```

#### Custom Per-Stage Configuration
```javascript
import {
  runEnhancedPipeline,
  createAgentFromSpec,
} from 'agent-council';

// Define different models for each stage
const customConfig = {
  stage1: {
    agents: [
      createAgentFromSpec('claude:fast'),
      createAgentFromSpec('gemini:fast'),
      createAgentFromSpec('codex:fast'),
    ],
  },
  stage2: {
    agents: [
      createAgentFromSpec('claude:default'),
      createAgentFromSpec('gemini:default'),
    ],
  },
  stage3: {
    chairman: createAgentFromSpec('claude:heavy'),
    useReasoning: true,
  },
};

const result = await runEnhancedPipeline("Design a caching strategy", {
  config: customConfig,
  tty: false,
  silent: true,
  timeoutMs: 120000,
});
```

#### With Stage Callbacks
```javascript
const result = await runEnhancedPipeline("Your question", {
  config: pipelineConfig,
  tty: false,
  silent: true,
  callbacks: {
    onStage1Complete: (results) => {
      console.log(`Stage 1: Got ${results.length} responses`);
      results.forEach(r => console.log(`  - ${r.agent}: ${r.response.slice(0, 50)}...`));
    },
    onStage2Complete: (rankings, aggregate) => {
      console.log(`Stage 2: Rankings complete`);
      console.log('Leaderboard:', aggregate.map(a => `${a.agent}: ${a.averageRank}`).join(', '));
    },
    onStage3Complete: (result) => {
      console.log(`Stage 3: ${result.agent} synthesized final answer`);
    },
  },
});
```

#### Legacy API (Basic Pipeline)
```javascript
import {
  runCouncilPipeline,
  filterAvailableAgents,
  pickChairman,
  DEFAULT_AGENTS,
} from 'agent-council';

// Uses default models (no tier selection)
const { available } = filterAvailableAgents(DEFAULT_AGENTS);
const chairman = pickChairman(available);

const result = await runCouncilPipeline(
  "Simple question",
  available,
  chairman,
  { tty: false, silent: true }
);
```

#### With Conversation History
```javascript
import { buildQuestionWithHistory } from 'agent-council';

const history = [];

// First question
const result1 = await runEnhancedPipeline("What database should I use?", { config, ... });
history.push({
  question: "What database should I use?",
  stage1: result1.stage1,
  stage3Response: result1.stage3.response,
});

// Follow-up with context
const result2 = await runEnhancedPipeline(
  buildQuestionWithHistory("What about cost?", history),
  { config, tty: false, silent: true }
);
```

#### Custom Agents (Non-Standard CLIs)
```javascript
import { runCouncilPipeline } from 'agent-council';

const customAgents = [
  {
    name: "ollama-llama",
    command: ["ollama", "run", "llama2"],
    promptViaStdin: true,
  },
  {
    name: "ollama-mistral",
    command: ["ollama", "run", "mistral"],
    promptViaStdin: true,
  },
];

const result = await runCouncilPipeline(
  "Your question",
  customAgents,
  customAgents[0],
  { tty: false, silent: true }
);
```

## API Reference

### Pipeline Functions

| Function | Description |
|----------|-------------|
| `runEnhancedPipeline(question, options)` | Run with per-stage model configuration |
| `runCouncilPipeline(question, agents, chairman, options)` | Run with default models (legacy) |
| `pickChairman(agents, name?)` | Select chairman from available agents |

### Model Configuration

| Function | Description |
|----------|-------------|
| `loadModelsConfig()` | Load models.json configuration |
| `refreshModelsConfig()` | Refresh config from package defaults |
| `createAgentConfig(provider, tier)` | Create agent for provider:tier |
| `createAgentFromSpec(spec)` | Create agent from "claude:heavy" format |
| `getPreset(name)` | Get preset configuration (fast/balanced/thorough) |
| `listPresets()` | List available preset names |
| `buildPipelineConfig(preset, providers)` | Build pipeline config from preset |
| `listProviders()` | List available provider names |
| `listTiers()` | List available tier names |
| `getProviderInfo(name)` | Get provider configuration |

### Agent Utilities

| Function | Description |
|----------|-------------|
| `filterAvailableAgents(agents)` | Check which agents are installed |
| `commandExists(command)` | Check if CLI command exists |
| `callAgent(state, prompt, timeoutMs)` | Execute single agent (low-level) |

### Prompt Builders

| Function | Description |
|----------|-------------|
| `buildQuestionWithHistory(question, history)` | Add conversation context |
| `buildRankingPrompt(query, stage1Results)` | Build Stage 2 prompt |
| `buildChairmanPrompt(query, stage1, stage2)` | Build Stage 3 prompt |
| `parseRankingFromText(text)` | Extract ranking from response |

### Constants

| Constant | Description |
|----------|-------------|
| `DEFAULT_AGENTS` | Array of codex, claude, gemini configs |
| `DEFAULT_CHAIRMAN` | Default chairman name ("gemini") |
| `MAX_HISTORY_ENTRIES` | Max history items in prompt (5) |

### Options

```typescript
interface PipelineOptions {
  tty: boolean;           // Enable interactive TTY rendering
  silent?: boolean;       // Suppress console output (default: false)
  timeoutMs?: number;     // Per-agent timeout in milliseconds
  callbacks?: {
    onStage1Complete?: (results: Stage1Result[]) => void | Promise<void>;
    onStage2Complete?: (results: Stage2Result[], aggregate: AggregateRanking[]) => void | Promise<void>;
    onStage3Complete?: (result: Stage3Result) => void | Promise<void>;
  };
}
```

### Result Structure

```typescript
interface PipelineResult {
  stage1: Array<{ agent: string; response: string }>;
  stage2: Array<{ agent: string; rankingRaw: string; parsedRanking: string[] }>;
  stage3: { agent: string; response: string };
  aggregate: Array<{ agent: string; averageRank: number; rankingsCount: number }>;
}
```

## Troubleshooting

### "No agents available"
- Install and authenticate at least one of: codex, claude, gemini
- Verify with `which codex claude gemini`

### Agent timeouts
- Increase `timeoutMs` in options (default varies by question complexity)
- Check agent CLI works independently: `echo "test" | claude --print`

### Import errors
- Ensure you've run `npm run build` after source changes
- Check `dist/lib.js` exists

### EPIPE errors
- Normal with `echo` command-based mock agents
- Real agents (codex, claude, gemini) handle stdin properly

## Project Structure

```
agent-council/
├── src/
│   ├── lib.ts          # Public API exports
│   ├── pipeline.ts     # Core orchestration + enhanced pipeline
│   ├── model-config.ts # Model tiers, presets, agent creation
│   ├── agents.ts       # Agent spawning
│   ├── prompts.ts      # Prompt builders
│   ├── types.ts        # TypeScript types
│   ├── repl.ts         # Interactive mode
│   └── index.ts        # CLI entry point
├── dist/               # Compiled output
├── tests/              # Test suites
│   ├── test-runner.mjs       # Unit tests (31)
│   ├── test-model-config.mjs # Model config tests (103)
│   ├── test-real-world.mjs   # Contract/integration/smoke (21)
│   └── test-pipeline.mjs     # Pipeline integration tests (7)
├── models.json         # Model definitions and presets
├── package.json
└── tsconfig.json
```

## Next Steps

1. Run the test suite to verify your setup
2. Try the CLI with a simple question
3. Integrate programmatically using the examples above
4. Explore stage callbacks for checkpoint/progress needs

For issues and contributions: https://github.com/bladehstream/agent-council-testing
