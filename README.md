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

### CLI Usage

```bash
# Single question
./dist/index.js "What's the best database for real-time analytics?"

# With JSON output
./dist/index.js "Explain microservices" --json

# With timeout (seconds per agent)
./dist/index.js "Complex question" --timeout 120

# Specify chairman
./dist/index.js "Question" --chairman claude

# Interactive REPL mode
./dist/index.js
```

### Model Selection

Use presets or per-stage configuration to control which models run at each stage:

```bash
# Use a preset (fast, balanced, thorough)
./dist/index.js "Question" --preset fast

# Custom per-stage configuration
./dist/index.js "Question" \
  --stage1 "claude:fast,gemini:fast,codex:fast" \
  --stage2 "claude:default,gemini:default" \
  --chairman "claude:heavy"

# List available models and tiers
./dist/index.js --list-models

# List available presets
./dist/index.js --list-presets
```

**Model Tiers:**
- `fast`: Optimized for speed (Claude Haiku, Gemini Flash, Codex Mini)
- `default`: Balanced performance (Claude Sonnet, Gemini Pro, Codex)
- `heavy`: Maximum capability with reasoning (Claude Opus, Gemini Deep Think, Codex Max)

**Presets:**
| Preset | Stage 1 | Stage 2 | Chairman | Use Case |
|--------|---------|---------|----------|----------|
| `fast` | 3x fast | 3x fast | default | Quick answers, cost-sensitive |
| `balanced` | 3x default | 3x default | heavy | General purpose |
| `thorough` | 3x heavy | 6x heavy | heavy +reasoning | Complex problems |

### Programmatic Usage

```typescript
import {
  runCouncilPipeline,
  filterAvailableAgents,
  pickChairman,
  DEFAULT_AGENTS,
} from 'agent-council';

// Check available agents
const { available } = filterAvailableAgents(DEFAULT_AGENTS);
const chairman = pickChairman(available);

// Run the council
const result = await runCouncilPipeline(
  "What's the best approach for authentication?",
  available,
  chairman,
  { tty: false, silent: true }
);

if (result) {
  console.log('Final answer:', result.stage3.response);
  console.log('Aggregate ranking:', result.aggregate);
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
  --chairman <spec>   Chairman agent (e.g., 'claude:heavy')
  --timeout <seconds> Per-agent timeout (0 = no timeout)
  --json              Output results as JSON
  --preset <name>     Use preset (fast, balanced, thorough)
  --stage1 <specs>    Stage 1 agents (e.g., 'claude:fast,gemini:fast')
  --stage2 <specs>    Stage 2 agents
  --list-models       List available models and tiers
  --list-presets      List available presets
  --refreshmodels     Refresh models.json from package
  --config-path       Show config file path
  --help              Show help
  --version           Show version
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
