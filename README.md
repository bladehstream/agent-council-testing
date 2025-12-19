# Agent Council

A multi-agent AI consensus engine that orchestrates Claude, Codex, and Gemini to provide collaborative, cross-validated answers through a three-stage deliberation process.

This fork adds a **programmatic API** for integration into larger automation workflows.

## Features

- **Multi-Agent Consensus**: Combines responses from multiple AI models for more reliable answers
- **Peer Validation**: Agents anonymously rank each other's responses to surface quality
- **Chairman Synthesis**: A designated agent synthesizes the final answer from all inputs
- **Two-Pass Chairman**: Split large outputs into synthesis + detail passes for reliability (see [Two-Pass Chairman](#two-pass-chairman-synthesis))
- **Sectioned Output**: Robust parsing with explicit delimiters and truncation detection
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
git clone https://github.com/bladehstream/agent-council.git
cd agent-council
npm install
npm run build
```

> **IMPORTANT - Development Workflow:**
> This is a TypeScript project. Source files are in `src/`, compiled output is in `dist/`.
> **After ANY change to source files, you MUST run `npm run build`** to compile.
> The CLI runs from `dist/`, so changes to `src/` won't take effect until rebuilt.

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
  -r default -e 6:fast -c gemini:heavy

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
#     heavy: opus - Claude Opus 4.5
# ✓ gemini (gemini)
#     fast: gemini-2.5-flash-lite
#     default: gemini-2.5-flash
#     heavy: gemini-2.5-pro
# ...

# See preset configurations
./dist/index.js --list-presets
```

### Model Tiers Reference

| Tier | Claude | Gemini | Codex | Best For |
|------|--------|--------|-------|----------|
| `fast` | Haiku | 2.5 Flash Lite | 5.1 Codex Mini | Quick responses, cost-sensitive |
| `default` | Sonnet | 2.5 Flash | 5.1 Codex | Balanced quality/speed |
| `heavy` | Opus | 2.5 Pro | 5.1 Codex Max | Complex reasoning |

### Presets Reference

| Preset | Stage 1 | Stage 2 | Chairman (Pass 1 / Pass 2) | Use Case |
|--------|---------|---------|----------------------------|----------|
| `fast` | 3x fast | 3x fast | default / default | Quick answers, cost-sensitive |
| `balanced` | 3x default | 3x default | heavy / default | General purpose |
| `thorough` | 3x heavy | 6x heavy | heavy / heavy | Complex problems, critical decisions |

All presets use **two-pass chairman synthesis** by default for improved reliability. See [Two-Pass Chairman](#two-pass-chairman-synthesis) below.

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

// Option 3: Structured output with outputFormat
const structuredConfig = {
  stage1: { agents: [createAgentFromSpec('claude:default'), createAgentFromSpec('gemini:default')] },
  stage2: { agents: [createAgentFromSpec('claude:default'), createAgentFromSpec('gemini:default')] },
  stage3: {
    chairman: createAgentFromSpec('claude:heavy'),
    useReasoning: true,
    outputFormat: `Output your response as a JSON object with this exact structure:
{
  "summary": "Executive summary of the council's recommendation",
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "ambiguities": [
    {"question": "Open question needing resolution", "options": ["Option A", "Option B"]}
  ],
  "confidence": "high" | "medium" | "low"
}
Output ONLY the JSON object, no markdown code fences or additional text.`,
  },
};

const result3 = await runEnhancedPipeline("Design a caching strategy", {
  config: structuredConfig,
  tty: false,
  silent: true,
});

if (result3) {
  // Parse the structured response
  const structured = JSON.parse(result3.stage3.response);
  console.log('Summary:', structured.summary);
  console.log('Open questions:', structured.ambiguities.length);
}
```

## Programmatic API

### Core Exports

```typescript
// Pipeline
runCouncilPipeline(question, agents, chairman, options)
runEnhancedPipeline(question, options)  // Per-stage configuration
runTwoPassChairman(query, stage1, stage2, chairman, twoPass, timeoutMs, silent?, options?)
pickChairman(agents, preferredName?)
extractStage1(agentStates)
extractStage2(agentStates)
calculateAggregateRankings(stage2Results, labelMap)
runChairman(query, stage1, stage2, chairman, timeoutMs, silent?, outputFormat?)

// Model Configuration
loadModelsConfig()              // Load models.json
refreshModelsConfig()           // Refresh from package defaults
createAgentConfig(provider, tier)
createAgentFromSpec(spec)       // e.g., "claude:heavy"
createAgentWithTier(agent, tier) // Create agent with different tier
getStepDownTier(tier)           // Get N-1 tier (heavy→default→fast)
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
buildChairmanPrompt(query, stage1, stage2, outputFormat?)
buildPass1Prompt(query, stage1, stage2, options?)  // Two-pass: synthesis
buildPass2Prompt(query, pass1Output, stage1, options?)  // Two-pass: detail
buildSectionedFormatInstructions(sections, descriptions?)
parseSectionedOutput(output)  // Parse sectioned output
getMissingSections(parsed, expected)
getTruncatedSections(parsed)
parseRankingFromText(text)
MAX_HISTORY_ENTRIES
SECTION_DELIMITERS, PASS1_SECTIONS, PASS2_SECTIONS

// Types
AgentConfig, AgentState, AgentStatus
Stage1Result, Stage2Result, Stage3Result
PipelineResult, PipelineOptions, PipelineCallbacks
EnhancedPipelineOptions, EnhancedPipelineConfig
TwoPassConfig, TwoPassResult, ParsedSection  // Two-pass types
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

### Structured Output (outputFormat)

The `outputFormat` option allows you to enforce structured output from the chairman, such as JSON. This is useful for programmatic consumption of council results.

```typescript
import { runEnhancedPipeline, createAgentFromSpec } from 'agent-council';

// Define the output format as a string with instructions
const outputFormat = `Output your response as a JSON object with this exact structure:

{
  "executive_summary": "1-2 paragraph synthesis",
  "recommendations": [
    {"title": "Recommendation title", "description": "Details", "priority": "high|medium|low"}
  ],
  "ambiguities": [
    {"id": "AMB-1", "question": "Question needing decision", "options": ["A", "B"], "recommendation": "Suggested choice"}
  ],
  "spec_sections": {
    "architecture": "Architecture details as markdown",
    "data_model": "Data model details",
    "api_contracts": "API specifications",
    "security": "Security considerations"
  }
}

IMPORTANT:
- Output ONLY the JSON object, no markdown code fences
- All fields are required
- Every identified ambiguity MUST appear in the ambiguities array`;

const config = {
  stage1: {
    agents: [
      createAgentFromSpec('claude:heavy'),
      createAgentFromSpec('gemini:heavy'),
      createAgentFromSpec('codex:heavy'),
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
    outputFormat,  // <-- Structured output instructions
  },
};

const result = await runEnhancedPipeline(prompt, {
  config,
  tty: false,
  silent: true,
});

if (result) {
  // Parse the structured JSON response
  const structured = JSON.parse(result.stage3.response);
  console.log('Ambiguities to resolve:', structured.ambiguities.length);
  console.log('Architecture:', structured.spec_sections.architecture);
}
```

**Benefits of structured output:**
- Reliable parsing - no regex extraction from free-form text
- Forced completeness - schema requires all fields
- Direct integration - JSON can be used directly in downstream systems
- Validation - output can be validated against a JSON schema

### Two-Pass Chairman Synthesis

A key differentiator of agent-council is the **two-pass chairman synthesis** feature, designed to handle large output generation reliably. This addresses a common limitation where LLM outputs get truncated when generating comprehensive specifications or detailed analyses.

#### The Problem

When generating large structured outputs (e.g., 50KB+ technical specifications), single-pass synthesis often fails due to:
- Output token limits (typically 4K-16K tokens per response)
- Truncation at the end of the response (missing closing braces, incomplete sections)
- Lost critical information when truncation occurs mid-content

#### The Solution: Two Sequential Passes

```
┌─────────────────────────────────────────────────────────────────┐
│                    TWO-PASS CHAIRMAN SYNTHESIS                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Pass 1: Synthesis (Higher-tier model)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • Executive summary                                     │   │
│  │  • All ambiguities requiring human decision              │   │
│  │  • Consensus notes (where agents agreed/disagreed)       │   │
│  │  • Implementation phases                                 │   │
│  │  • Section outlines for Pass 2                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  Pass 2: Detailed Specifications (Lower-tier model)             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • Architecture details                                  │   │
│  │  • Data model specifications                             │   │
│  │  • API contracts                                         │   │
│  │  • User flows                                            │   │
│  │  • Security design                                       │   │
│  │  • Deployment recommendations                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Tier Progression

Pass 2 uses the `default` tier as a minimum floor to ensure reliable structured output:

| Preset | Pass 1 Tier | Pass 2 Tier | Rationale |
|--------|-------------|-------------|-----------|
| `fast` | default (Sonnet) | default (Sonnet) | Ensures reliable structured output |
| `balanced` | heavy (Opus) | default (Sonnet) | Best reasoning for synthesis, balanced detail |
| `thorough` | heavy (Opus) | heavy (Opus) | Maximum quality throughout |

#### Sectioned Output Format

Both passes use explicit delimiters for robust parsing and truncation detection:

```
===SECTION:executive_summary===
Content here...
===END:executive_summary===

===SECTION:ambiguities===
[{"id": "AMB-1", "question": "...", ...}]
===END:ambiguities===
```

Benefits:
- **Truncation detection**: Missing `===END:section===` indicates truncated content
- **Incremental parsing**: Each section can be parsed independently
- **Priority ordering**: Most critical sections (ambiguities) come first

#### Programmatic Usage

```typescript
import { runEnhancedPipeline, createAgentFromSpec } from 'agent-council';

const config = {
  stage1: {
    agents: [
      createAgentFromSpec('claude:default'),
      createAgentFromSpec('gemini:default'),
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
    useReasoning: false,
    useSummaries: true, // Use executive summaries to reduce input context
    twoPass: {
      enabled: true,
      pass1Tier: 'heavy',   // Synthesis with best model
      pass2Tier: 'default', // Details with balanced model
      // Optional: custom prompts for each pass
      // pass1Format: '...',
      // pass2Format: '...',
    },
  },
};

const result = await runEnhancedPipeline("Design a real-time analytics system", {
  config,
  tty: false,
  silent: false, // See pass progress
});

if (result) {
  // The combined output includes all sections from both passes
  console.log('Chairman:', result.stage3.agent); // "claude:heavy + claude:default"

  // Parse sections using the exported helpers
  import { parseSectionedOutput, PASS1_SECTIONS, PASS2_SECTIONS } from 'agent-council';

  const sections = parseSectionedOutput(result.stage3.response);
  const ambiguities = sections.find(s => s.name === 'ambiguities');
  if (ambiguities?.complete) {
    const parsed = JSON.parse(ambiguities.content);
    console.log(`Found ${parsed.length} ambiguities to resolve`);
  }
}
```

#### When to Use Two-Pass

**Recommended for:**
- Specification generation (technical specs, PRDs, architecture docs)
- Complex analysis with multiple output sections
- Any task producing >20KB of structured output
- Workflows requiring reliable JSON parsing

**Not needed for:**
- Simple Q&A
- Short summaries
- Single-section outputs

#### Automatic Fallback for Fast Preset

When using the `fast` preset, Pass 2 may fail to produce detailed sections (lighter models don't always follow structured output format). The pipeline automatically falls back to extracting section outlines from Pass 1:

```
[Pass 2] Complete. Parsed 0/6 sections.
[Fallback] Pass 2 produced 0 sections, attempting to extract from section_outlines
[Fallback] Parsed JSON with 6 keys: architecture, data_model, api_contracts, user_flows, security, deployment
[Fallback] Created 6/6 sections from outlines
```

Fallback sections include a note: *"This is a summary outline. Run with balanced or thorough preset for detailed specifications."*

This ensures the `fast` preset always produces usable output, even if abbreviated.

#### Disabling Two-Pass

For simple use cases, disable two-pass to use single-pass chairman:

```typescript
const config = {
  // ... stage1, stage2 ...
  stage3: {
    chairman: createAgentFromSpec('claude:heavy'),
    useReasoning: false,
    twoPass: { enabled: false }, // Single-pass mode
    outputFormat: 'Your custom format instructions...',
  },
};
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
npm test
# or: node tests/test-runner.mjs && node tests/test-model-config.mjs

# Real-world tests - contract, integration, smoke (requires agents)
npm run test:real-world

# Pipeline tests (requires 2+ agents)
npm run test:pipeline

# Run all tests
npm run test:all
```

**Test Coverage:**
- Unit tests: 31 tests (build, exports, types, utilities)
- Model config tests: 103 tests (models.json, presets, agent creation, stage spec parsing)
- Real-world tests: 21 tests (contract, integration, smoke tests with real CLIs)
- Pipeline tests: 7 tests (full 3-stage execution with real agents)

**Real-world tests verify:**
- CLI flags actually exist (checked against `--help` output)
- Model names are accepted by actual APIs
- Generated commands work with real CLIs
- WebSearch tool works with correct flags
- End-to-end pipeline with real agents

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
  <count>:<tier>      N agents distributed (e.g., '6:fast')
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
├── tests/              # Test suites
│   ├── test-runner.mjs       # Unit tests (31)
│   ├── test-model-config.mjs # Model config tests (103)
│   ├── test-real-world.mjs   # Contract/integration/smoke tests (21)
│   └── test-pipeline.mjs     # Pipeline integration tests (7)
├── models.json         # Model definitions and presets
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
- This fork: [bladehstream/agent-council](https://github.com/bladehstream/agent-council)
