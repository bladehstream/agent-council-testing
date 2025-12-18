/**
 * agent-council programmatic API
 *
 * This module exports the core council functionality for programmatic use.
 * For CLI usage, run the `agent-council` command directly.
 */

// Core pipeline
export {
  runCouncilPipeline,
  runEnhancedPipeline,
  pickChairman,
  extractStage1,
  extractStage2,
  extractSummaryFromResponse,
  calculateAggregateRankings,
  runChairman,
  // Two-pass chairman
  runTwoPassChairman,
  // Checkpoint functions
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  type PipelineResult,
  type PipelineOptions,
  type PipelineCallbacks,
  type EnhancedPipelineOptions,
} from './pipeline.js';

// Model configuration
export {
  loadModelsConfig,
  refreshModelsConfig,
  getConfigPath,
  createAgentConfig,
  createAgentFromSpec,
  createAgentWithTier,
  getStepDownTier,
  getPreset,
  listPresets,
  buildPipelineConfig,
  listProviders,
  listTiers,
  getProviderInfo,
  parseAgentSpec,
  parseStageSpec,
  type ModelsConfig,
  type ProviderConfig,
  type PresetConfig,
  type TierConfig,
  type ModelTier,
  type ParsedStageSpec,
} from './model-config.js';

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
  // Two-pass prompt builders
  buildPass1Prompt,
  buildPass2Prompt,
  buildSectionedFormatInstructions,
  parseSectionedOutput,
  getMissingSections,
  getTruncatedSections,
  // Section constants
  SECTION_DELIMITERS,
  PASS1_SECTIONS,
  PASS2_SECTIONS,
  PASS1_SECTION_DESCRIPTIONS,
  PASS2_SECTION_DESCRIPTIONS,
  type ChairmanPromptOptions,
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
  EnhancedPipelineConfig,
  StageAgentConfig,
  // Two-pass types
  TwoPassConfig,
  TwoPassResult,
  ParsedSection,
  // Checkpoint types
  CheckpointData,
  CheckpointOptions,
  CheckpointStage,
} from './types.js';
