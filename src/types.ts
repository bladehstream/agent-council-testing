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

export type Stage1Result = {
  agent: string;
  /** Raw response text from the agent */
  response: string;
  /** Executive summary extracted from structured JSON output (if available) */
  summary?: string;
};
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
    /**
     * Optional fallback chairman to use if the primary chairman fails.
     * Only one fallback attempt is made.
     */
    fallback?: AgentConfig;
    /**
     * Use executive summaries instead of full responses for chairman context.
     * Significantly reduces context size when Stage 1 responses are large.
     * Requires Stage 1 agents to output structured JSON with executive_summary field.
     */
    useSummaries?: boolean;
  };
};

// Checkpoint types for pipeline resumption
export type CheckpointStage = "stage1" | "stage2" | "complete";

export type CheckpointData = {
  version: 1;
  timestamp: string;
  question: string;
  completedStage: CheckpointStage;
  stage1?: Stage1Result[];
  stage2?: Stage2Result[];
  labelToAgent?: LabelMap;
  aggregate?: Array<{ agent: string; averageRank: number; rankingsCount: number }>;
};

export type CheckpointOptions = {
  /**
   * Directory where checkpoint files are saved.
   * If not provided, checkpointing is disabled.
   */
  checkpointDir?: string;
  /**
   * Optional filename for the checkpoint (without extension).
   * Defaults to "council-checkpoint".
   */
  checkpointName?: string;
};
