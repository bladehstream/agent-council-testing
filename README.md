# Agent Council

A multi-agent AI consensus engine that orchestrates Claude, Codex, and Gemini to provide collaborative, cross-validated answers through a three-stage deliberation process.

This fork adds a **programmatic API** for integration into larger automation workflows.

## Features

- **Multi-Agent Consensus**: Combines responses from multiple AI models for more reliable answers
- **Peer Validation**: Agents anonymously rank each other's responses to surface quality
- **Chairman Synthesis**: A designated agent synthesizes the final answer from all inputs
- **Granular Model Selection**: Choose model tiers (fast/default/heavy) per stage
- **Presets**: Built-in configurations (fast, balanced, thorough) for common use cases
- **Per-Stage Configuration**: Different agents and counts for each pipeline stage
- **Programmatic API**: Full library exports for embedding in applications
- **Stage Callbacks**: Hook into pipeline stages for progress tracking and checkpointing
- **Silent Mode**: Suppress console output for clean programmatic usage
- **Custom Agents**: Add any CLI-based AI tool as a council member

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         AGENT COUNCIL                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Stage 1: Individual Responses (Parallel)                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│  │  Codex  │  │ Claude  │  │ Gemini  │                         │
│  └────┬────┘  └────┬────┘  └────┬────┘                         │
│       │            │            │                               │
│       ▼            ▼            ▼                               │
│  Stage 2: Peer Rankings (Parallel, Anonymized)                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│  │ Rank:   │  │ Rank:   │  │ Rank:   │                         │
│  │ B > A > C│  │ A > B > C│  │ B > A > C│                       │
│  └────┬────┘  └────┬────┘  └────┬────┘                         │
│       │            │            │                               │
│       └────────────┼────────────┘                               │
│                    ▼                                            │
│  Stage 3: Chairman Synthesis                                    │
│  ┌─────────────────────────────────────┐                       │
│  │  Chairman (Gemini) synthesizes      │                       │
│  │  final answer from all responses    │                       │
│  │  and peer rankings                  │                       │
│  └─────────────────────────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

### From Source

```bash
git clone https://github.com/bladehstream/agent-council-testing.git
cd agent-council-testing
npm install
npm run build
```

### Prerequisites

At least 2 of the following AI CLI tools must be installed and authenticated:

| Tool | Installation | Authentication |
|------|-------------|----------------|
| Claude | `npm install -g @anthropic-ai/claude-code` | `claude auth` |
| Codex | `npm install -g @openai/codex` | `codex auth` |
| Gemini | `npm install -g @google/gemini-cli` | `gemini auth` |

Verify your setup:
```bash
node -e "import('./dist/lib.js').then(({filterAvailableAgents, DEFAULT_AGENTS}) => {
  const {available} = filterAvailableAgents(DEFAULT_AGENTS);
  console.log('Available:', available.map(a => a.name).join(', '));
})"
```

## Quick Start

### Basic Usage

```bash
# Simple question (uses all available agents with default models)
./dist/index.js "What's the best database for real-time analytics?"

# Interactive REPL mode
./dist/index.js
```

### Using Presets (Recommended)

Presets provide optimized configurations for different use cases:

```bash
# Fast mode - quick answers, lower cost (Haiku, Flash, Mini)
./dist/index.js "What is dependency injection?" --preset fast

# Balanced mode - good quality, reasonable speed (Sonnet, Pro, Codex)
./dist/index.js "Compare REST vs GraphQL for a mobile app" --preset balanced

# Thorough mode - maximum quality, deep reasoning (Opus, Deep Think, Max)
./dist/index.js "Design a distributed caching strategy for 1M concurrent users" --preset thorough
```

### Custom Model Selection

Fine-tune which models run at each stage:

```bash
# Use fast models for research, heavy model for synthesis
./dist/index.js "Explain microservices architecture" \
  -r "claude:fast,gemini:fast,codex:fast" \
  -c "claude:heavy"

# More evaluators for better consensus (6 agents in stage 2)
./dist/index.js "What's the best authentication approach?" \
  -r default -e "6 fast" -c "gemini:heavy"

# Single provider, different tiers per stage
./dist/index.js "Review this code design" \
  -r "claude:fast,claude:fast,claude:default" \
  -e "claude:default,claude:default" \
  -c "claude:heavy"
```

### Discover Available Models

```bash
# See all models with availability status
./dist/index.js --list-models

# Output:
# ✓ claude (claude)
#     fast: haiku - Claude 3.5 Haiku
#     default: sonnet - Claude 4 Sonnet
#     heavy: opus +reasoning - Claude Opus 4.5
# ✓ gemini (gemini)
#     fast: gemini-3.0-flash
#     default: gemini-3.0-pro
#     heavy: gemini-3.0-deep-think
# ...

# See preset configurations
./dist/index.js --list-presets
```

### Model Tiers Reference

| Tier | Claude | Gemini | Codex | Best For |
|------|--------|--------|-------|----------|
| `fast` | Haiku | 3.0 Flash | 5.2 Mini | Quick responses, cost-sensitive |
| `default` | Sonnet | 3.0 Pro | 5.2 | Balanced quality/speed |
| `heavy` | Opus +thinking | 3.0 Deep Think | 5.2 Max +xhigh | Complex reasoning |

### Presets Reference

| Preset | Stage 1 | Stage 2 | Chairman | Use Case |
|--------|---------|---------|----------|----------|
| `fast` | 3x fast | 3x fast | default | Quick answers, cost-sensitive |
| `balanced` | 3x default | 3x default | heavy | General purpose |
| `thorough` | 3x heavy | 6x heavy | heavy +reasoning | Complex problems, critical decisions |

### Other CLI Options

```bash
# JSON output for scripting
./dist/index.js "Question" --preset fast --json

# Timeout per agent (seconds)
./dist/index.js "Complex question" --preset thorough --timeout 120

# Refresh model definitions
./dist/index.js --refreshmodels
```

### Programmatic Usage

```typescript
import {
  runEnhancedPipeline,
  createAgentFromSpec,
  getPreset,
  buildPipelineConfig,
  loadModelsConfig,
  listProviders,
} from 'agent-council';

// Option 1: Use a preset (simplest)
const config = loadModelsConfig();
const availableProviders = listProviders(config).filter(p => /* check availability */);
const preset = getPreset('balanced', config);
const pipelineConfig = buildPipelineConfig(preset, availableProviders, config);

const result = await runEnhancedPipeline("Your question", {
  config: pipelineConfig,
  tty: false,
  silent: true,
});

// Option 2: Custom per-stage configuration
const customConfig = {
  stage1: {
    agents: [
      createAgentFromSpec('claude:fast'),
      createAgentFromSpec('gemini:fast'),
    ],
  },
  stage2: {
    agents: [
      createAgentFromSpec('claude:default'),
      createAgentFromSpec('gemini:default'),
      createAgentFromSpec('codex:default'),
    ],
  },
  stage3: {
    chairman: createAgentFromSpec('claude:heavy'),
    useReasoning: true,
  },
};

const result2 = await runEnhancedPipeline("Complex question", {
  config: customConfig,
  tty: false,
  silent: true,
  timeoutMs: 120000,
});

if (result2) {
  console.log('Final answer:', result2.stage3.response);
  console.log('Top ranked:', result2.aggregate[0]?.agent);
}
```

## Programmatic API

### Core Exports

```typescript
// Pipeline
runCouncilPipeline(question, agents, chairman, options)
runEnhancedPipeline(question, options)  // Per-stage configuration
pickChairman(agents, preferredName?)
extractStage1(agentStates)
extractStage2(agentStates)
calculateAggregateRankings(stage2Results, labelMap)
runChairman(query, stage1, stage2, chairman, timeoutMs, silent?)

// Model Configuration
loadModelsConfig()              // Load models.json
refreshModelsConfig()           // Refresh from package defaults
createAgentConfig(provider, tier)
createAgentFromSpec(spec)       // e.g., "claude:heavy"
getPreset(name)                 // Get preset configuration
listPresets()                   // List available presets
buildPipelineConfig(preset, providers)

// Agents
filterAvailableAgents(agents)  // Returns { available, unavailable }
callAgent(state, prompt, timeoutMs)
commandExists(command)
DEFAULT_AGENTS
DEFAULT_CHAIRMAN

// Prompts
buildQuestionWithHistory(question, history)
buildRankingPrompt(query, stage1Results)
buildChairmanPrompt(query, stage1, stage2)
parseRankingFromText(text)
MAX_HISTORY_ENTRIES

// Types
AgentConfig, AgentState, AgentStatus
Stage1Result, Stage2Result, Stage3Result
PipelineResult, PipelineOptions, PipelineCallbacks
EnhancedPipelineOptions, EnhancedPipelineConfig
ModelsConfig, PresetConfig, ModelTier
FilterResult, ConversationEntry, SessionState
```

### Pipeline Options

```typescript
interface PipelineOptions {
  tty: boolean;              // Enable interactive TTY rendering
  silent?: boolean;          // Suppress console output (default: false)
  timeoutMs?: number;        // Per-agent timeout in milliseconds
  callbacks?: PipelineCallbacks;
}

interface PipelineCallbacks {
  onStage1Complete?: (results: Stage1Result[]) => void | Promise<void>;
  onStage2Complete?: (results: Stage2Result[], aggregate: AggregateRanking[]) => void | Promise<void>;
  onStage3Complete?: (result: Stage3Result) => void | Promise<void>;
}
```

### Stage Callbacks

Use callbacks for progress tracking, logging, or checkpointing:

```typescript
const result = await runCouncilPipeline(question, agents, chairman, {
  tty: false,
  silent: true,
  callbacks: {
    onStage1Complete: (results) => {
      console.log(`Got ${results.length} individual responses`);
    },
    onStage2Complete: async (rankings, aggregate) => {
      console.log(`Top ranked: ${aggregate[0]?.agent}`);
      await saveCheckpoint({ rankings, aggregate });
    },
    onStage3Complete: (result) => {
      console.log(`Chairman ${result.agent} completed synthesis`);
    },
  },
});
```

### Conversation History

```typescript
import { buildQuestionWithHistory, type ConversationEntry } from 'agent-council';

const history: ConversationEntry[] = [];

// First question
const result1 = await runCouncilPipeline("What database should I use?", ...);
history.push({
  question: "What database should I use?",
  stage1: result1.stage1,
  stage3Response: result1.stage3.response,
});

// Follow-up with context (last 5 entries included)
const followUp = buildQuestionWithHistory("What about cost?", history);
const result2 = await runCouncilPipeline(followUp, ...);
```

### Enhanced Pipeline (Per-Stage Configuration)

```typescript
import {
  runEnhancedPipeline,
  createAgentFromSpec,
  getPreset,
  buildPipelineConfig,
  loadModelsConfig,
} from 'agent-council';

// Option 1: Use a preset
const config = loadModelsConfig();
const preset = getPreset('balanced', config);
const pipelineConfig = buildPipelineConfig(preset, ['claude', 'gemini', 'codex'], config);

const result = await runEnhancedPipeline("Your question", {
  config: pipelineConfig,
  tty: false,
  silent: true,
});

// Option 2: Custom configuration
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

const result2 = await runEnhancedPipeline("Complex question", {
  config: customConfig,
  tty: false,
  silent: true,
});
```

### Custom Agents

```typescript
const customAgents: AgentConfig[] = [
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

## Testing

```bash
# Unit tests (no agents required)
node test-runner.mjs

# Model configuration tests (no agents required)
node test-model-config.mjs

# Integration tests (requires 2+ agents)
node test-pipeline.mjs

# Run all tests
node test-runner.mjs && node test-model-config.mjs && node test-pipeline.mjs
```

**Test Coverage:**
- Unit tests: 31 tests (build, exports, types, utilities)
- Model config tests: 88 tests (models.json, presets, agent creation)
- Pipeline tests: 7 tests (full 3-stage execution with real agents)

See [TEST_RECORD.md](./TEST_RECORD.md) for detailed test documentation.

## CLI Reference

### Single Question Mode

```bash
agent-council "Your question" [options]

Options:
  -r, --respond       Responders: [count] <tier> or <agent specs>
  -e, --evaluate      Evaluators: [count] <tier> or <agent specs>
  -c, --chairman      Chairman agent (e.g., 'claude:heavy')
  -p, --preset        Use preset (fast, balanced, thorough)
  -t, --timeout       Per-agent timeout in seconds (0 = no timeout)
  --json              Output results as JSON
  --list-models       List available models and tiers
  --list-presets      List available presets
  --refreshmodels     Refresh models.json from package
  --config-path       Show config file path
  --help              Show help
  --version           Show version

Stage Spec Formats:
  <tier>              All providers with tier (e.g., 'fast')
  <count> <tier>      N agents distributed (e.g., '6 fast')
  <agent specs>       Explicit agents (e.g., 'claude:fast,gemini:default')
```

### Interactive REPL Mode

```bash
agent-council  # No arguments starts REPL

Commands:
  /help              Show available commands
  /agents            List available agents
  /chairman [name]   Show or set chairman
  /timeout [seconds] Show or set timeout
  /history           Show conversation history
  /clear             Clear conversation history
  /exit              Exit the REPL
```

### Keyboard Controls (TTY Mode)

| Key | Action |
|-----|--------|
| `1`, `2`, `3` | Focus agent N |
| `↑` / `↓` | Navigate focus |
| `k` | Kill focused agent |
| `ESC` | Abort all agents |
| `Ctrl+C` | Quit |

## Project Structure

```
agent-council/
├── src/
│   ├── lib.ts          # Public API exports
│   ├── pipeline.ts     # Core 3-stage orchestration
│   ├── model-config.ts # Model tier and preset configuration
│   ├── agents.ts       # Agent spawning and management
│   ├── prompts.ts      # Prompt construction
│   ├── types.ts        # TypeScript definitions
│   ├── repl.ts         # Interactive REPL mode
│   └── index.ts        # CLI entry point
├── dist/               # Compiled JavaScript + declarations
├── models.json         # Model definitions and presets
├── test-runner.mjs     # Unit test suite
├── test-pipeline.mjs   # Integration test suite
├── QUICKSTART.md       # Setup and usage guide
├── TEST_RECORD.md      # Test documentation
└── package.json
```

## Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Setup, testing, and usage examples
- [TEST_RECORD.md](./TEST_RECORD.md) - Test suite documentation and results

## License

MIT

## Credits

- Original project: [mylukin/agent-council](https://github.com/mylukin/agent-council)
- This fork: [bladehstream/agent-council-testing](https://github.com/bladehstream/agent-council-testing)
