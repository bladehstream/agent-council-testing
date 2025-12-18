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

/**
 * Two-pass chairman configuration for reliable large output generation.
 *
 * Pass 1 (Synthesis): Produces executive summary, ambiguities, consensus notes,
 * implementation phases, and section outlines.
 *
 * Pass 2 (Detail): Expands section outlines into full detailed specifications.
 *
 * Both passes use sectioned delimiters for robust parsing and truncation recovery.
 */
export type TwoPassConfig = {
  /**
   * Enable two-pass chairman output.
   * When enabled, the chairman runs twice: first for synthesis, then for details.
   */
  enabled: boolean;
  /**
   * Model tier for Pass 1 (synthesis).
   * If not specified, uses the chairman's configured tier.
   */
  pass1Tier?: ModelTier;
  /**
   * Model tier for Pass 2 (detailed specifications).
   * If not specified, uses N-1 tier from pass1Tier (fast stays fast).
   */
  pass2Tier?: ModelTier;
  /**
   * Output format instructions for Pass 1.
   * Should request synthesis-level output: summary, ambiguities, phases, outlines.
   */
  pass1Format?: string;
  /**
   * Output format instructions for Pass 2.
   * Should request detailed spec sections, with Pass 1 output as context.
   */
  pass2Format?: string;
};

/**
 * Result from a two-pass chairman execution.
 */
export type TwoPassResult = {
  /** Pass 1 output (synthesis) */
  pass1: Stage3Result;
  /** Pass 2 output (detailed specifications) */
  pass2: Stage3Result;
  /** Combined/merged output if applicable */
  combined?: string;
  /** Which sections were successfully parsed from each pass */
  parsedSections: {
    pass1: string[];
    pass2: string[];
  };
};

/**
 * Parsed section from sectioned output format.
 */
export type ParsedSection = {
  name: string;
  content: string;
  complete: boolean;
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
     *
     * Note: When twoPass is enabled, use twoPass.pass1Format and pass2Format instead.
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
    /**
     * Two-pass chairman configuration for reliable large output generation.
     * When enabled, splits chairman synthesis into two sequential passes:
     * - Pass 1: Synthesis (summary, ambiguities, phases, outlines)
     * - Pass 2: Detail (full spec sections)
     *
     * This improves reliability by keeping each pass within output token limits.
     */
    twoPass?: TwoPassConfig;
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
