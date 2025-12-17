import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import chalk from "chalk";
import type { AgentConfig, AgentState, AgentStatus } from "./types.js";

/**
 * Result of filtering agents by command availability
 */
export interface FilterResult {
  available: AgentConfig[];
  unavailable: Array<{ name: string; command: string }>;
}

/**
 * Check if a command exists in PATH
 */
export function commandExists(cmd: string): boolean {
  const result = spawnSync("which", [cmd], { stdio: "pipe" });
  return result.status === 0;
}

/**
 * Filter agents to only include those with available commands
 */
export function filterAvailableAgents(agents: AgentConfig[]): FilterResult {
  const available: AgentConfig[] = [];
  const unavailable: Array<{ name: string; command: string }> = [];

  for (const agent of agents) {
    const cmd = agent.command[0];
    if (commandExists(cmd)) {
      available.push(agent);
    } else {
      unavailable.push({ name: agent.name, command: cmd });
    }
  }

  return { available, unavailable };
}

export const DEFAULT_AGENTS: AgentConfig[] = [
  // Codex: non-interactive exec mode, "-" reads prompt from stdin.
  { name: "codex", command: ["codex", "exec", "--skip-git-repo-check", "-"], promptViaStdin: true },
  // Claude: --print for non-interactive single response, text output format.
  { name: "claude", command: ["claude", "--print", "--output-format", "text"], promptViaStdin: true },
  // Gemini: non-interactive text output, prompt as positional arg.
  { name: "gemini", command: ["gemini", "--output-format", "text"], promptViaStdin: false },
];

export const DEFAULT_CHAIRMAN = "gemini";

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function callAgent(
  state: AgentState,
  prompt: string,
  timeoutMs: number | undefined
): Promise<AgentState> {
  const { config } = state;
  const useStdin = config.promptViaStdin !== false;
  state.startTime = Date.now();
  state.status = "running";

  let child;
  try {
    child = useStdin
      ? spawn(config.command[0], config.command.slice(1), { stdio: ["pipe", "pipe", "pipe"] })
      : spawn(config.command[0], [...config.command.slice(1), prompt], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    state.status = "error";
    state.errorMessage = err instanceof Error ? err.message : String(err);
    state.endTime = Date.now();
    return state;
  }

  state.process = child;

  if (useStdin && child.stdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  child.stdout?.on("data", (chunk) => {
    state.stdout.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk) => {
    state.stderr.push(chunk.toString());
  });

  const completion = new Promise<AgentState>((resolve) => {
    child.on("close", (code) => {
      state.exitCode = code;
      state.endTime = Date.now();
      if (state.status === "killed" || state.status === "timeout") {
        return resolve(state);
      }
      state.status = code === 0 ? "completed" : "error";
      resolve(state);
    });
    child.on("error", (err) => {
      state.endTime = Date.now();
      state.status = "error";
      state.errorMessage = err instanceof Error ? err.message : String(err);
      resolve(state);
    });
  });

  if (timeoutMs && timeoutMs > 0) {
    state.timeoutHandle = setTimeout(() => {
      if (state.process && state.status === "running") {
        state.status = "timeout";
        state.endTime = Date.now();
        state.process.kill("SIGTERM");
      }
    }, timeoutMs);
  }

  const result = await completion;
  if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
  return result;
}

function tailLines(text: string[], maxLines: number): string[] {
  const lines = text.join("").split(/\r?\n/);
  if (lines.length <= maxLines) return lines;
  return lines.slice(lines.length - maxLines);
}

function formatDuration(start?: number, end?: number): string {
  if (!start) return "-";
  const endTime = end || Date.now();
  const seconds = Math.max(0, Math.round((endTime - start) / 100) / 10);
  return `${seconds.toFixed(1)}s`;
}

export async function runAgentsInteractive(
  stageName: string,
  prompt: string,
  agents: AgentConfig[],
  timeoutMs: number | undefined,
  opts: { tty: boolean }
): Promise<AgentState[]> {
  const states: AgentState[] = agents.map((config) => ({
    config,
    status: "pending",
    stdout: [],
    stderr: [],
  }));

  const focused = { index: 0 };
  let aborted = false;
  let spinnerIdx = 0;
  let onKeypress: ((str: string, key: readline.Key) => void) | undefined;

  const render = () => {
    if (!opts.tty) return;
    console.clear();
    console.log(chalk.bold(`Stage: ${stageName}`));
    console.log("Keys: [number] focus | k cancel focused | ESC cancel all | ↑/↓ focus | Ctrl+C quit\n");
    console.log("Agents:");
    states.forEach((s, idx) => {
      const marker = idx === focused.index ? chalk.cyan("➤") : " ";
      const frame = s.status === "running" ? spinnerFrames[spinnerIdx % spinnerFrames.length] : " ";
      const statusColor =
        s.status === "completed"
          ? chalk.green(s.status)
          : s.status === "running"
            ? chalk.yellow(s.status)
            : s.status === "pending"
              ? chalk.gray(s.status)
              : s.status === "timeout"
                ? chalk.red(s.status)
                : s.status === "killed"
                  ? chalk.red(s.status)
                  : chalk.red(s.status);
      const duration = formatDuration(s.startTime, s.endTime);
      console.log(
        `${marker} [${idx + 1}] ${s.config.name.padEnd(8)} ${frame} ${statusColor} (${duration}) out:${s.stdout.length} err:${s.stderr.length}`
      );
    });

    const focus = states[focused.index];
    if (focus) {
      console.log("\nFocused agent output (last 12 lines):");
      const lines = tailLines(focus.stdout.length ? focus.stdout : focus.stderr, 12);
      if (lines.length === 0) {
        console.log(chalk.gray("(no output yet)"));
      } else {
        lines.forEach((line) => console.log(line));
      }
    }
  };

  const interval = opts.tty
    ? setInterval(() => {
      spinnerIdx += 1;
      render();
    }, 120)
    : null;

  const killAgent = (idx: number, reason: AgentStatus) => {
    const st = states[idx];
    if (!st) return;
    if (st.process && st.status === "running") {
      st.status = reason;
      st.endTime = Date.now();
      st.process.kill("SIGTERM");
    }
  };

  const killAll = (reason: AgentStatus) => {
    states.forEach((_, idx) => killAgent(idx, reason));
    aborted = true;
  };

  if (opts.tty) {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    onKeypress = (_str: string, key: readline.Key) => {
      if (key.name === "escape") {
        killAll("killed");
        return;
      }
      if (key.ctrl && key.name === "c") {
        killAll("killed");
        process.exit();
      }
      if (key.name === "k" || key.name === "K") {
        killAgent(focused.index, "killed");
        return;
      }
      if (key.name === "up") {
        focused.index = (focused.index + states.length - 1) % states.length;
        return;
      }
      if (key.name === "down") {
        focused.index = (focused.index + 1) % states.length;
        return;
      }
      if (_str && /\d/.test(_str)) {
        const n = Number(_str);
        if (n >= 1 && n <= states.length) {
          focused.index = n - 1;
        }
      }
    };
    process.stdin.on("keypress", onKeypress);
  }

  const runAll = states.map((state) => callAgent(state, prompt, timeoutMs));
  const results = await Promise.all(runAll);

  if (interval) clearInterval(interval);
  if (opts.tty) {
    if (onKeypress) process.stdin.removeListener("keypress", onKeypress);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  render();

  if (aborted) {
    console.log(chalk.red("\nAborted by user."));
  } else {
    console.log(chalk.green("\nStage complete."));
  }

  return results;
}
