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
node test-runner.mjs
```

Expected output: `SUMMARY: 31 passed, 0 failed, 0 skipped`

### Pipeline Tests (requires 2+ agents)
```bash
node test-pipeline.mjs
```

Note: Pipeline tests take 60-90 seconds each due to real AI agent calls.

## Usage Examples

### CLI Usage

```bash
# Single question mode
./dist/index.js "What is the best programming language for web development?"

# With JSON output
./dist/index.js "Explain microservices" --json

# With timeout (seconds)
./dist/index.js "Complex question" --timeout 120

# Specify chairman
./dist/index.js "Question" --chairman claude

# Interactive REPL mode
./dist/index.js
```

### Programmatic Usage

#### Basic Pipeline
```javascript
import {
  runCouncilPipeline,
  filterAvailableAgents,
  pickChairman,
  DEFAULT_AGENTS,
} from 'agent-council';

// Check available agents
const { available } = filterAvailableAgents(DEFAULT_AGENTS);
console.log(`Using agents: ${available.map(a => a.name).join(', ')}`);

// Pick a chairman (defaults to gemini, falls back to first available)
const chairman = pickChairman(available);

// Run the council
const result = await runCouncilPipeline(
  "What's the best approach for handling authentication?",
  available,
  chairman,
  { tty: false, silent: true, timeoutMs: 60000 }
);

if (result) {
  console.log('Final answer:', result.stage3.response);
}
```

#### With Stage Callbacks
```javascript
const result = await runCouncilPipeline(
  "Your question here",
  available,
  chairman,
  {
    tty: false,
    silent: true,
    timeoutMs: 60000,
    callbacks: {
      onStage1Complete: (results) => {
        console.log(`Stage 1: Got ${results.length} individual responses`);
      },
      onStage2Complete: (rankings, aggregate) => {
        console.log(`Stage 2: Got ${rankings.length} peer rankings`);
        console.log('Top ranked:', aggregate[0]?.agent);
      },
      onStage3Complete: (result) => {
        console.log(`Stage 3: Chairman ${result.agent} synthesized final answer`);
      },
    },
  }
);
```

#### With Conversation History
```javascript
import { buildQuestionWithHistory } from 'agent-council';

const history = [];

// First question
const result1 = await runCouncilPipeline("What database should I use?", ...);
history.push({
  question: "What database should I use?",
  stage1: result1.stage1,
  stage3Response: result1.stage3.response,
});

// Follow-up with context
const result2 = await runCouncilPipeline(
  buildQuestionWithHistory("What about cost?", history),
  available,
  chairman,
  { tty: false, silent: true }
);
```

#### Custom Agents
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
  customAgents[0], // first agent as chairman
  { tty: false, silent: true }
);
```

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `runCouncilPipeline(question, agents, chairman, options)` | Run full 3-stage council |
| `pickChairman(agents, name?)` | Select chairman from available agents |
| `filterAvailableAgents(agents)` | Check which agents are installed |
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
│   ├── lib.ts        # Public API exports
│   ├── pipeline.ts   # Core orchestration
│   ├── agents.ts     # Agent spawning
│   ├── prompts.ts    # Prompt builders
│   ├── types.ts      # TypeScript types
│   ├── repl.ts       # Interactive mode
│   └── index.ts      # CLI entry point
├── dist/             # Compiled output
├── test-runner.mjs   # Unit tests
├── test-pipeline.mjs # Integration tests
├── package.json
└── tsconfig.json
```

## Next Steps

1. Run the test suite to verify your setup
2. Try the CLI with a simple question
3. Integrate programmatically using the examples above
4. Explore stage callbacks for checkpoint/progress needs

For issues and contributions: https://github.com/bladehstream/agent-council-testing
