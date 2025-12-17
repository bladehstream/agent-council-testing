# Agent Council

[中文文档](./README.zh-CN.md)

A multi-model AI council CLI that provides consensus-driven decisions using Claude, Codex, and Gemini.

## How It Works

```text
Stage 1: Individual Responses
  All agents answer the question in parallel

Stage 2: Peer Rankings
  Each agent evaluates and ranks all responses

Stage 3: Chairman Synthesis
  A designated agent synthesizes the final answer based on all responses and rankings
```

## Installation

```bash
# Install globally from npm
npm install -g agent-council

# Or clone and build locally
git clone https://github.com/mylukin/agent-council.git
cd agent-council
npm install
npm link
```

## Claude Code Plugin

Use agent-council as a Claude Code plugin for seamless integration:

```bash
# Step 1: Install CLI globally
npm install -g agent-council

# Step 2: Add marketplace (in Claude Code)
/plugin marketplace add mylukin/agent-council

# Step 3: Install plugin
/plugin install agent-council
```

The plugin provides:
- **council** agent: Invoke with complex architectural decisions
- **council-decision** skill: Auto-triggered for design trade-offs

## Prerequisites

The following CLI tools must be installed and configured:

- [Claude Code](https://github.com/anthropics/claude-code) (`claude`)
- [Codex CLI](https://github.com/openai/codex) (`codex`)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)

At least one agent must be available. The council works best with multiple agents.

## Usage

### REPL Mode (Interactive)

```bash
# Start interactive mode
agent-council

> What's the best database for real-time analytics?
# Council processes and responds...

> What about cost considerations?
# Follow-up question with conversation history...
```

### Single Question Mode

```bash
agent-council "Your question here"

# Options
agent-council "Question" --chairman gemini  # Set chairman (default: gemini)
agent-council "Question" --timeout 60       # Per-agent timeout in seconds
agent-council "Question" --json             # Output as JSON
```

### Slash Commands (REPL Mode)

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/agents` | List available agents |
| `/chairman [name]` | Show or set chairman |
| `/timeout [seconds]` | Show or set timeout |
| `/history` | Show conversation history |
| `/clear` | Clear conversation history |
| `/exit` | Exit the REPL |

## Interactive Controls

During execution, use these keyboard controls:

| Key | Action |
|-----|--------|
| `1`, `2`, `3` | Focus agent N |
| `↑` / `↓` | Navigate focus |
| `k` | Kill focused agent |
| `ESC` | Abort all agents |
| `Ctrl+C` | Quit |

## Programmatic API

agent-council can also be used as a library:

```typescript
import {
  runCouncilPipeline,
  filterAvailableAgents,
  pickChairman,
  DEFAULT_AGENTS,
  type PipelineCallbacks,
} from 'agent-council';

// Check which agents are available
const { available, unavailable } = filterAvailableAgents(DEFAULT_AGENTS);
console.log(`Available: ${available.map(a => a.name).join(', ')}`);
console.log(`Unavailable: ${unavailable.map(a => a.name).join(', ')}`);

// Pick a chairman
const chairman = pickChairman(available);

// Optional: Stage callbacks for progress/checkpointing
const callbacks: PipelineCallbacks = {
  onStage1Complete: (results) => {
    console.log(`Stage 1: ${results.length} responses collected`);
  },
  onStage2Complete: async (rankings, aggregate) => {
    console.log(`Stage 2: Rankings complete`);
    // Could save checkpoint here
  },
  onStage3Complete: (result) => {
    console.log(`Stage 3: Chairman synthesis complete`);
  },
};

// Run the council
const result = await runCouncilPipeline(
  "What's the best database for real-time analytics?",
  available,
  chairman,
  { tty: false, silent: true, callbacks }
);

if (result) {
  console.log('Final answer:', result.stage3.response);

  // Access intermediate results
  console.log('Individual responses:', result.stage1);
  console.log('Peer rankings:', result.stage2);
  console.log('Aggregate ranking:', result.aggregate);
}
```

### Conversation History

```typescript
import {
  runCouncilPipeline,
  buildQuestionWithHistory,
  type ConversationEntry,
} from 'agent-council';

const history: ConversationEntry[] = [];

// First question
const result1 = await runCouncilPipeline(
  "What database should I use?",
  available,
  chairman,
  { tty: false, silent: true }
);

// Store for context
if (result1) {
  history.push({
    question: "What database should I use?",
    stage1: result1.stage1,
    stage3Response: result1.stage3.response,
  });
}

// Follow-up with history context
const result2 = await runCouncilPipeline(
  buildQuestionWithHistory("What about cost?", history),
  available,
  chairman,
  { tty: false, silent: true }
);
```

### Custom Agents

```typescript
import { runCouncilPipeline, type AgentConfig } from 'agent-council';

const customAgent: AgentConfig = {
  name: "ollama",
  command: ["ollama", "run", "llama2"],
  promptViaStdin: true,
};

const agents = [customAgent, ...otherAgents];
```

### API Reference

#### Core Functions

| Function | Description |
|----------|-------------|
| `runCouncilPipeline()` | Execute the full 3-stage council process |
| `pickChairman()` | Select a chairman from available agents |
| `filterAvailableAgents()` | Check which agents are installed |
| `callAgent()` | Execute a single agent (low-level) |

#### Pipeline Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tty` | boolean | - | Enable interactive TTY rendering |
| `silent` | boolean | false | Suppress console output |
| `timeoutMs` | number | undefined | Timeout per agent in milliseconds |
| `callbacks` | PipelineCallbacks | undefined | Stage completion callbacks |

#### Stage Callbacks

```typescript
interface PipelineCallbacks {
  onStage1Complete?: (results: Stage1Result[]) => void | Promise<void>;
  onStage2Complete?: (results: Stage2Result[], aggregate: AggregateRanking[]) => void | Promise<void>;
  onStage3Complete?: (result: Stage3Result) => void | Promise<void>;
}
```

Callbacks can be synchronous or async. The pipeline awaits async callbacks before proceeding.

## Development

```bash
npm run dev -- "Test question"  # Run without building
npm test                        # Run tests
npm run test:watch              # Run tests in watch mode
```

## License

MIT
