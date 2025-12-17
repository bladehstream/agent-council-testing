/**
 * agent-council programmatic API
 *
 * This module exports the core council functionality for programmatic use.
 * For CLI usage, run the `agent-council` command directly.
 */

// Core pipeline
export {
  runCouncilPipeline,
  pickChairman,
  extractStage1,
  extractStage2,
  calculateAggregateRankings,
  runChairman,
  type PipelineResult,
  type PipelineOptions,
  type PipelineCallbacks,
} from './pipeline.js';

// Agent management
export {
  DEFAULT_AGENTS,
  DEFAULT_CHAIRMAN,
  filterAvailableAgents,
  callAgent,
  commandExists,
  type FilterResult,
} from './agents.js';

// Prompt builders (useful for custom workflows)
export {
  buildQuestionWithHistory,
  buildRankingPrompt,
  buildChairmanPrompt,
  parseRankingFromText,
  MAX_HISTORY_ENTRIES,
} from './prompts.js';

// Types
export type {
  AgentConfig,
  AgentState,
  AgentStatus,
  Stage1Result,
  Stage2Result,
  Stage3Result,
  ConversationEntry,
  SessionState,
  LabelMap,
} from './types.js';
