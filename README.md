# Agent Council

A multi-agent AI council system that coordinates multiple AI CLI tools (Claude, Codex, Gemini) to collaboratively answer questions through a three-stage voting pipeline.

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
npm install
npm run build
npm link  # Makes 'agent-council' available globally
```

## Usage

```bash
agent-council "Your question here"

# Options
agent-council "Question" --chairman gemini  # Set chairman (default: gemini)
agent-council "Question" --timeout 60       # Per-agent timeout in seconds (default: 300)
agent-council "Question" --json             # Output as JSON
```

## Interactive Controls

During execution, use these keyboard controls:

| Key | Action |
|-----|--------|
| `1`, `2`, `3` | Focus agent N |
| `↑` / `↓` | Navigate focus |
| `k` | Kill focused agent |
| `ESC` | Abort all agents |
| `Ctrl+C` | Quit |

## Requirements

The following CLI tools must be installed and configured:

- [Claude Code](https://github.com/anthropics/claude-code) (`claude`)
- [Codex CLI](https://github.com/openai/codex) (`codex`)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)

## Development

```bash
npm run dev -- "Test question"  # Run without building
npm test                        # Run tests
npm run test:watch              # Run tests in watch mode
```

## License

MIT
