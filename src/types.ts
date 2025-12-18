export type AgentConfig = {
  name: string;
  command: string[];
  promptViaStdin?: boolean;
};

export type AgentStatus = "pending" | "running" | "completed" | "error" | "killed" | "timeout";

export type AgentState = {
  config: AgentConfig;
  status: AgentStatus;
  stdout: string[];
  stderr: string[];
  startTime?: number;
  endTime?: number;
  exitCode?: number | null;
  errorMessage?: string;
  process?: import("node:child_process").ChildProcess;
  timeoutHandle?: NodeJS.Timeout;
};

export type Stage1Result = { agent: string; response: string };
export type Stage2Result = { agent: string; rankingRaw: string; parsedRanking: string[] };
export type Stage3Result = { agent: string; response: string };

export type LabelMap = Record<string, string>;

export type ConversationEntry = {
  question: string;
  stage1: Stage1Result[];
  stage3Response: string;
};

export type SessionState = {
  history: ConversationEntry[];
  agents: AgentConfig[];
  chairman: AgentConfig;
  timeoutMs?: number;
};

// Enhanced pipeline types for per-stage configuration
export type ModelTier = "fast" | "default" | "heavy";

export type StageAgentConfig = {
  agents: AgentConfig[];
};

export type EnhancedPipelineConfig = {
  stage1: StageAgentConfig;
  stage2: StageAgentConfig;
  stage3: {
    chairman: AgentConfig;
    useReasoning: boolean;
    /**
     * Optional output format instructions for the chairman.
     * When provided, these instructions are appended to the chairman prompt
     * to enforce structured output (e.g., JSON schema requirements).
     *
     * Example:
     * ```
     * outputFormat: `Output your response as JSON with this structure:
     * {
     *   "summary": "...",
     *   "recommendations": [...],
     *   "ambiguities": [...]
     * }`
     * ```
     */
    outputFormat?: string;
  };
};
