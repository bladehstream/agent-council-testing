import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  buildChairmanPrompt,
  buildPass1Prompt,
  buildPass2Prompt,
  buildRankingPrompt,
  parseRankingFromText,
  parseSectionedOutput,
  PASS1_SECTIONS,
  PASS2_SECTIONS,
  // Merge mode prompts
  formatAllResponsesForMerge,
  buildMergeChairmanPrompt,
  buildMergePass1Prompt,
  buildMergePass2Prompt,
  MERGE_PASS1_SECTIONS,
  type ChairmanPromptOptions,
} from "./prompts.js";
import { callAgent, DEFAULT_CHAIRMAN, runAgentsInteractive } from "./agents.js";
import { createAgentWithTier, getStepDownTier, parseAgentSpec } from "./model-config.js";
import type {
  AgentConfig,
  AgentState,
  CheckpointData,
  CheckpointOptions,
  EnhancedPipelineConfig,
  LabelMap,
  ModelTier,
  ParsedSection,
  PipelineMode,
  Stage1Result,
  Stage2Result,
  Stage3Result,
  TwoPassConfig,
  TwoPassResult,
} from "./types.js";

export type AggregateRanking = { agent: string; averageRank: number; rankingsCount: number };

export type PipelineResult = {
  /** Pipeline mode that was used */
  mode: PipelineMode;
  stage1: Stage1Result[];
  /** Stage 2 results (null in merge mode) */
  stage2: Stage2Result[] | null;
  stage3: Stage3Result;
  /** Aggregate rankings (null in merge mode) */
  aggregate: AggregateRanking[] | null;
  /** Two-pass result details (if two-pass was used) */
  twoPassResult?: TwoPassResult;
};

export interface PipelineCallbacks {
  onStage1Complete?: (results: Stage1Result[]) => void | Promise<void>;
  onStage2Complete?: (results: Stage2Result[], aggregate: AggregateRanking[]) => void | Promise<void>;
  onStage3Complete?: (result: Stage3Result) => void | Promise<void>;
}

export interface PipelineOptions {
  timeoutMs?: number;
  tty: boolean;
  silent?: boolean;
  callbacks?: PipelineCallbacks;
}

export interface EnhancedPipelineOptions extends PipelineOptions {
  config: EnhancedPipelineConfig;
  checkpoint?: CheckpointOptions;
}

// ============================================================================
// Checkpoint Functions
// ============================================================================

function getCheckpointPath(options: CheckpointOptions): string {
  const dir = options.checkpointDir!;
  const name = options.checkpointName ?? "council-checkpoint";
  return join(dir, `${name}.json`);
}

/**
 * Save checkpoint data to disk.
 * Creates the checkpoint directory if it doesn't exist.
 */
export function saveCheckpoint(data: CheckpointData, options: CheckpointOptions): void {
  if (!options.checkpointDir) return;

  if (!existsSync(options.checkpointDir)) {
    mkdirSync(options.checkpointDir, { recursive: true });
  }

  const path = getCheckpointPath(options);
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/**
 * Load checkpoint data from disk.
 * Returns null if no checkpoint exists or if the checkpoint is for a different question.
 */
export function loadCheckpoint(question: string, options: CheckpointOptions): CheckpointData | null {
  if (!options.checkpointDir) return null;

  const path = getCheckpointPath(options);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf-8");
    const data = JSON.parse(content) as CheckpointData;

    // Validate checkpoint version
    if (data.version !== 1) {
      console.log(chalk.yellow("Checkpoint version mismatch, ignoring checkpoint"));
      return null;
    }

    // Validate question matches
    if (data.question !== question) {
      console.log(chalk.yellow("Checkpoint question doesn't match, ignoring checkpoint"));
      return null;
    }

    return data;
  } catch (err) {
    console.log(chalk.yellow(`Failed to load checkpoint: ${err instanceof Error ? err.message : err}`));
    return null;
  }
}

/**
 * Remove checkpoint file after successful completion.
 */
export function clearCheckpoint(options: CheckpointOptions): void {
  if (!options.checkpointDir) return;

  const path = getCheckpointPath(options);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Ignore errors when clearing checkpoint
    }
  }
}

export async function runCouncilPipeline(
  question: string,
  agents: AgentConfig[],
  chairman: AgentConfig,
  options: PipelineOptions
): Promise<PipelineResult | null> {
  const { timeoutMs, tty, silent = false, callbacks } = options;

  // Stage 1: Individual Responses
  const stage1States = await runAgentsInteractive(
    "Stage 1 - Individual Responses",
    question,
    agents,
    timeoutMs,
    { tty }
  );
  const stage1 = extractStage1(stage1States, silent);

  if (stage1.length === 0) {
    if (!silent) {
      console.log(chalk.red("No agent responses were completed; aborting."));
    }
    return null;
  }

  // Stage 1 callback
  await callbacks?.onStage1Complete?.(stage1);

  // Build label map for Stage 2
  const labels = stage1.map((_, idx) => `Response ${String.fromCharCode(65 + idx)}`);
  const labelToAgent: LabelMap = {};
  labels.forEach((label, idx) => {
    labelToAgent[label] = stage1[idx].agent;
  });

  // Stage 2: Peer Rankings
  const rankingPrompt = buildRankingPrompt(question, stage1);
  const stage2States = await runAgentsInteractive(
    "Stage 2 - Peer Rankings",
    rankingPrompt,
    agents,
    timeoutMs,
    { tty }
  );
  const stage2 = extractStage2(stage2States, silent);

  // Calculate aggregate rankings
  const aggregate = calculateAggregateRankings(stage2, labelToAgent);

  // Stage 2 callback
  await callbacks?.onStage2Complete?.(stage2, aggregate);

  // Stage 3: Chairman Synthesis
  const stage3 = await runChairman(question, stage1, stage2, chairman, timeoutMs, silent);

  // Stage 3 callback
  await callbacks?.onStage3Complete?.(stage3);

  return { mode: 'compete', stage1, stage2, stage3, aggregate };
}

/**
 * Extract executive summary from a Stage 1 response.
 * Tries JSON parsing first, then falls back to markdown header search.
 */
export function extractSummaryFromResponse(response: string): string | undefined {
  // Try 1: Parse as JSON directly
  try {
    const parsed = JSON.parse(response);
    if (parsed.executive_summary && typeof parsed.executive_summary === 'string') {
      return parsed.executive_summary;
    }
  } catch {
    // Not valid JSON, try other methods
  }

  // Try 2: Extract JSON from markdown code fences
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.executive_summary && typeof parsed.executive_summary === 'string') {
        return parsed.executive_summary;
      }
    } catch {
      // Code fence content not valid JSON
    }
  }

  // Try 3: Look for markdown header format
  const headerMatch = response.match(
    /##\s*Executive\s+Summary\s*\n([\s\S]*?)(?=\n##\s|\n---|\n\*\*\*|$)/i
  );
  if (headerMatch) {
    return headerMatch[1].trim();
  }

  // Try 4: Look for bold label format
  const boldMatch = response.match(
    /\*\*Executive\s+Summary[:\*]*\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n---|\n\*\*\*|$)/i
  );
  if (boldMatch) {
    return boldMatch[1].trim();
  }

  return undefined;
}

export function extractStage1(results: AgentState[], silent = false): Stage1Result[] {
  // Log failed agents
  const failed = results.filter((r) => r.status !== "completed");
  if (failed.length > 0 && !silent) {
    console.log(chalk.yellow(`\n⚠ ${failed.length} Stage 1 agent(s) failed:`));
    for (const agent of failed) {
      const duration = agent.endTime && agent.startTime
        ? `${((agent.endTime - agent.startTime) / 1000).toFixed(1)}s`
        : 'unknown';
      console.log(chalk.yellow(`  • ${agent.config.name}: ${agent.status} (${duration})`));
      if (agent.errorMessage) {
        console.log(chalk.gray(`    Error: ${agent.errorMessage}`));
      }
      if (agent.stderr.length > 0) {
        const stderrPreview = agent.stderr.join("").trim().slice(0, 200);
        if (stderrPreview) {
          console.log(chalk.gray(`    Stderr: ${stderrPreview}${stderrPreview.length >= 200 ? '...' : ''}`));
        }
      }
      if (agent.exitCode !== undefined && agent.exitCode !== 0) {
        console.log(chalk.gray(`    Exit code: ${agent.exitCode}`));
      }
    }
  }

  return results
    .filter((r) => r.status === "completed")
    .map((r) => {
      const response = r.stdout.join("").trim();
      return {
        agent: r.config.name,
        response,
        summary: extractSummaryFromResponse(response),
      };
    });
}

export function extractStage2(results: AgentState[], silent = false): Stage2Result[] {
  // Log failed agents
  const failed = results.filter((r) => r.status !== "completed");
  if (failed.length > 0 && !silent) {
    console.log(chalk.yellow(`\n⚠ ${failed.length} Stage 2 evaluator(s) failed:`));
    for (const agent of failed) {
      const duration = agent.endTime && agent.startTime
        ? `${((agent.endTime - agent.startTime) / 1000).toFixed(1)}s`
        : 'unknown';
      console.log(chalk.yellow(`  • ${agent.config.name}: ${agent.status} (${duration})`));
      if (agent.errorMessage) {
        console.log(chalk.gray(`    Error: ${agent.errorMessage}`));
      }
      if (agent.stderr.length > 0) {
        const stderrPreview = agent.stderr.join("").trim().slice(0, 200);
        if (stderrPreview) {
          console.log(chalk.gray(`    Stderr: ${stderrPreview}${stderrPreview.length >= 200 ? '...' : ''}`));
        }
      }
    }
  }

  return results
    .filter((r) => r.status === "completed")
    .map((r) => {
      const rankingRaw = r.stdout.join("").trim();
      return {
        agent: r.config.name,
        rankingRaw,
        parsedRanking: parseRankingFromText(rankingRaw),
      };
    });
}

export function calculateAggregateRankings(stage2: Stage2Result[], labels: LabelMap) {
  const positions: Record<string, number[]> = {};
  stage2.forEach((res) => {
    res.parsedRanking.forEach((label, idx) => {
      const agent = labels[label];
      if (!agent) return;
      if (!positions[agent]) positions[agent] = [];
      positions[agent].push(idx + 1);
    });
  });

  return Object.entries(positions)
    .map(([agent, arr]) => ({
      agent,
      averageRank: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100,
      rankingsCount: arr.length,
    }))
    .sort((a, b) => a.averageRank - b.averageRank);
}

/**
 * Run the chairman synthesis stage.
 *
 * @param userQuery - The original user question
 * @param stage1 - Individual agent responses from Stage 1
 * @param stage2 - Peer rankings from Stage 2
 * @param chairman - The chairman agent configuration
 * @param timeoutMs - Optional timeout in milliseconds
 * @param silent - Suppress console output
 * @param options - Chairman prompt options (outputFormat, useSummaries) or outputFormat string for backward compatibility
 * @returns The chairman's synthesized response
 */
export async function runChairman(
  userQuery: string,
  stage1: Stage1Result[],
  stage2: Stage2Result[],
  chairman: AgentConfig,
  timeoutMs: number | undefined,
  silent: boolean = false,
  options?: ChairmanPromptOptions | string
): Promise<Stage3Result> {
  if (!silent) {
    console.log(`\nRunning chairman: ${chairman.name}...`);
  }
  const prompt = buildChairmanPrompt(userQuery, stage1, stage2, options);
  const state: AgentState = {
    config: chairman,
    status: "pending",
    stdout: [],
    stderr: [],
  };
  const res = await callAgent(state, prompt, timeoutMs);
  const responseText =
    res.status === "completed" ? res.stdout.join("").trim() : `Error from chairman (${res.status})`;
  return { agent: chairman.name, response: responseText };
}

export function pickChairman(agents: AgentConfig[], chairmanName?: string): AgentConfig {
  return (
    agents.find((a) => a.name === chairmanName) ||
    agents.find((a) => a.name === DEFAULT_CHAIRMAN) ||
    agents[0]
  );
}

// ============================================================================
// Two-Pass Chairman
// ============================================================================

/**
 * Determine the tier for Pass 2 based on configuration.
 * If pass2Tier is specified, use it. Otherwise, step down from pass1Tier.
 * Exception: if pass1Tier is "heavy" and pass2Tier is not specified, check the preset.
 */
function resolvePass2Tier(twoPass: TwoPassConfig, chairmanTier: ModelTier): ModelTier {
  if (twoPass.pass2Tier) {
    return twoPass.pass2Tier;
  }
  const pass1Tier = twoPass.pass1Tier ?? chairmanTier;
  return getStepDownTier(pass1Tier);
}

/**
 * Extract fallback sections from Pass 1's section_outlines when Pass 2 fails.
 * This allows fast presets to still produce usable output even if the lighter
 * model can't generate full detailed specs.
 *
 * @param pass1Sections - Parsed sections from Pass 1
 * @param silent - Suppress console output
 * @returns Array of synthetic sections derived from section_outlines
 */
function extractFallbackFromOutlines(
  pass1Sections: ParsedSection[],
  silent: boolean
): ParsedSection[] {
  if (!silent) {
    console.log(chalk.cyan(`  [Fallback] Pass 2 produced 0 sections, attempting to extract from section_outlines`));
  }

  const outlinesSection = pass1Sections.find(s => s.name === "section_outlines");
  if (!outlinesSection) {
    if (!silent) {
      console.log(chalk.yellow(`  [Fallback] No section_outlines found in Pass 1`));
      console.log(chalk.yellow(`  [Fallback] Available Pass 1 sections: ${pass1Sections.map(s => s.name).join(", ")}`));
    }
    return [];
  }

  if (!outlinesSection.content || outlinesSection.content.trim().length === 0) {
    if (!silent) {
      console.log(chalk.yellow(`  [Fallback] section_outlines is empty`));
    }
    return [];
  }

  // Try to parse as JSON first (structured outlines)
  let outlines: Record<string, string> = {};
  const content = outlinesSection.content.trim();

  try {
    outlines = JSON.parse(content);
    if (!silent) {
      console.log(chalk.cyan(`  [Fallback] Parsed JSON with ${Object.keys(outlines).length} keys: ${Object.keys(outlines).join(", ")}`));
    }
  } catch (e) {
    if (!silent) {
      console.log(chalk.yellow(`  [Fallback] JSON parse failed: ${e instanceof Error ? e.message : 'unknown error'}`));
      console.log(chalk.yellow(`  [Fallback] Content preview (first 200 chars): ${content.substring(0, 200)}`));
    }
    // If not JSON, try to extract key-value pairs from the text
    // Formats: "section_name": "content" OR - section_name: content
    const lines = content.split("\n");
    for (const line of lines) {
      // Match: "key": "value" or key: value or - key: value
      const match = line.match(/^\s*-?\s*"?(\w+)"?\s*[:=]\s*"?(.+?)"?\s*,?\s*$/) ||
                    line.match(/^\s*"(\w+)":\s*"(.+)"\s*,?\s*$/);
      if (match) {
        outlines[match[1]] = match[2];
      }
    }
    if (!silent) {
      console.log(chalk.cyan(`  [Fallback] Regex extracted ${Object.keys(outlines).length} outlines`));
    }
  }

  if (Object.keys(outlines).length === 0) {
    if (!silent) {
      console.log(chalk.yellow(`  [Fallback] No outlines could be extracted`));
    }
    return [];
  }

  // Create synthetic sections for each Pass 2 section
  const fallbackSections: ParsedSection[] = [];
  const fallbackNote = "\n\n---\n*Note: This is a summary outline. Run with balanced or thorough preset for detailed specifications.*";

  for (const sectionName of PASS2_SECTIONS) {
    const outlineContent = outlines[sectionName];
    if (outlineContent) {
      fallbackSections.push({
        name: sectionName,
        content: outlineContent + fallbackNote,
        complete: true,
      });
    }
  }

  if (!silent) {
    if (fallbackSections.length > 0) {
      console.log(chalk.cyan(`  [Fallback] Created ${fallbackSections.length}/${PASS2_SECTIONS.length} sections from outlines`));
    } else {
      console.log(chalk.yellow(`  [Fallback] No matching section names found in outlines`));
      console.log(chalk.yellow(`  [Fallback] Expected: ${PASS2_SECTIONS.join(", ")}`));
      console.log(chalk.yellow(`  [Fallback] Got: ${Object.keys(outlines).join(", ")}`));
    }
  }

  return fallbackSections;
}

/**
 * Run the two-pass chairman synthesis.
 *
 * Pass 1 (Synthesis): Produces executive summary, ambiguities, consensus notes,
 * implementation phases, and section outlines.
 *
 * Pass 2 (Detail): Expands section outlines into full detailed specifications.
 *
 * @param userQuery - The original user question
 * @param stage1 - Individual agent responses from Stage 1
 * @param stage2 - Peer rankings from Stage 2
 * @param chairman - The chairman agent configuration
 * @param twoPass - Two-pass configuration
 * @param timeoutMs - Optional timeout in milliseconds
 * @param silent - Suppress console output
 * @param promptOptions - Chairman prompt options (useSummaries)
 * @returns TwoPassResult with outputs from both passes
 */
export async function runTwoPassChairman(
  userQuery: string,
  stage1: Stage1Result[],
  stage2: Stage2Result[],
  chairman: AgentConfig,
  twoPass: TwoPassConfig,
  timeoutMs: number | undefined,
  silent: boolean = false,
  promptOptions?: ChairmanPromptOptions
): Promise<TwoPassResult> {
  // Determine tiers for each pass
  const { tier: chairmanTier } = parseAgentSpec(chairman.name);
  const pass1Tier = twoPass.pass1Tier ?? chairmanTier;
  const pass2Tier = resolvePass2Tier(twoPass, chairmanTier);

  // Create agents for each pass (may be same or different based on tiers)
  const pass1Agent = pass1Tier === chairmanTier
    ? chairman
    : createAgentWithTier(chairman, pass1Tier);
  const pass2Agent = pass2Tier === chairmanTier
    ? chairman
    : createAgentWithTier(chairman, pass2Tier);

  if (!silent) {
    console.log(`\nRunning two-pass chairman synthesis...`);
    console.log(`  Pass 1 (${pass1Agent.name}): Synthesis`);
    console.log(`  Pass 2 (${pass2Agent.name}): Detailed specifications`);
  }

  // === PASS 1: Synthesis ===
  if (!silent) {
    console.log(`\n  [Pass 1] Running synthesis with ${pass1Agent.name}...`);
  }

  const pass1Prompt = twoPass.pass1Format
    ? buildChairmanPrompt(userQuery, stage1, stage2, { ...promptOptions, outputFormat: twoPass.pass1Format })
    : buildPass1Prompt(userQuery, stage1, stage2, promptOptions);

  const pass1State: AgentState = {
    config: pass1Agent,
    status: "pending",
    stdout: [],
    stderr: [],
  };

  const pass1Result = await callAgent(pass1State, pass1Prompt, timeoutMs);
  const pass1Response = pass1Result.status === "completed"
    ? pass1Result.stdout.join("").trim()
    : `Error from chairman pass 1 (${pass1Result.status})`;

  // Parse Pass 1 sections
  const pass1Sections = parseSectionedOutput(pass1Response);
  const pass1SectionNames = pass1Sections.filter(s => s.complete).map(s => s.name);

  if (!silent) {
    console.log(`  [Pass 1] Complete. Parsed ${pass1SectionNames.length}/${PASS1_SECTIONS.length} sections.`);
    if (pass1SectionNames.length < PASS1_SECTIONS.length) {
      const missing = PASS1_SECTIONS.filter(s => !pass1SectionNames.includes(s));
      console.log(chalk.yellow(`  [Pass 1] Missing sections: ${missing.join(", ")}`));
    }
  }

  // Check for Pass 1 failure
  if (pass1Response.startsWith("Error from chairman")) {
    return {
      pass1: { agent: pass1Agent.name, response: pass1Response },
      pass2: { agent: pass2Agent.name, response: "" },
      parsedSections: { pass1: [], pass2: [] },
    };
  }

  // === PASS 2: Detailed Specifications ===
  if (!silent) {
    console.log(`\n  [Pass 2] Running detailed specifications with ${pass2Agent.name}...`);
  }

  const pass2Prompt = twoPass.pass2Format
    ? buildChairmanPrompt(userQuery, stage1, stage2, { ...promptOptions, outputFormat: twoPass.pass2Format })
    : buildPass2Prompt(userQuery, pass1Response, stage1, promptOptions);

  const pass2State: AgentState = {
    config: pass2Agent,
    status: "pending",
    stdout: [],
    stderr: [],
  };

  const pass2Result = await callAgent(pass2State, pass2Prompt, timeoutMs);
  const pass2Response = pass2Result.status === "completed"
    ? pass2Result.stdout.join("").trim()
    : `Error from chairman pass 2 (${pass2Result.status})`;

  // Parse Pass 2 sections
  const pass2Sections = parseSectionedOutput(pass2Response);
  const pass2SectionNames = pass2Sections.filter(s => s.complete).map(s => s.name);

  if (!silent) {
    console.log(`  [Pass 2] Complete. Parsed ${pass2SectionNames.length}/${PASS2_SECTIONS.length} sections.`);
    if (pass2SectionNames.length < PASS2_SECTIONS.length) {
      const missing = PASS2_SECTIONS.filter(s => !pass2SectionNames.includes(s));
      console.log(chalk.yellow(`  [Pass 2] Missing sections: ${missing.join(", ")}`));
    }
  }

  // Fallback: If Pass 2 produced no sections, extract from section_outlines in Pass 1
  let finalPass2Sections = pass2Sections;
  let usedFallback = false;

  if (pass2SectionNames.length === 0) {
    const fallbackSections = extractFallbackFromOutlines(pass1Sections, silent);
    if (fallbackSections.length > 0) {
      finalPass2Sections = fallbackSections;
      usedFallback = true;
    }
  }

  // Combine outputs
  const combined = combinePassOutputs(pass1Response, pass2Response, pass1Sections, finalPass2Sections);

  return {
    pass1: { agent: pass1Agent.name, response: pass1Response },
    pass2: { agent: pass2Agent.name, response: pass2Response },
    combined,
    parsedSections: {
      pass1: pass1SectionNames,
      pass2: usedFallback
        ? finalPass2Sections.map(s => s.name + " (from outline)")
        : pass2SectionNames,
    },
    usedFallback,
  };
}

/**
 * Combine Pass 1 and Pass 2 outputs into a single response.
 * Uses the sectioned format for easy downstream parsing.
 */
function combinePassOutputs(
  pass1Raw: string,
  pass2Raw: string,
  pass1Sections: ParsedSection[],
  pass2Sections: ParsedSection[]
): string {
  const allSections: string[] = [];

  // Add Pass 1 sections
  for (const section of pass1Sections) {
    if (section.complete) {
      allSections.push(`===SECTION:${section.name}===\n${section.content}\n===END:${section.name}===`);
    }
  }

  // Add Pass 2 sections
  for (const section of pass2Sections) {
    if (section.complete) {
      allSections.push(`===SECTION:${section.name}===\n${section.content}\n===END:${section.name}===`);
    }
  }

  return allSections.join("\n\n");
}

// ============================================================================
// Merge Mode Chairman
// ============================================================================

/**
 * Run a single-pass merge chairman.
 * Merges ALL stage 1 responses into a unified output.
 *
 * @param query - The original user question
 * @param allResponses - All Stage 1 responses (not just winner)
 * @param chairman - The chairman agent configuration
 * @param timeoutMs - Optional timeout in milliseconds
 * @param silent - Suppress console output
 * @param outputFormat - Optional output format instructions
 * @returns The merged response
 */
export async function runMergeChairman(
  query: string,
  allResponses: Stage1Result[],
  chairman: AgentConfig,
  timeoutMs: number | undefined,
  silent: boolean = false,
  outputFormat?: string
): Promise<Stage3Result> {
  if (!silent) {
    console.log(`\nRunning merge chairman: ${chairman.name}...`);
    console.log(`  Merging ${allResponses.length} responses`);
  }

  const formattedResponses = formatAllResponsesForMerge(allResponses);
  const prompt = buildMergeChairmanPrompt(query, formattedResponses, outputFormat);

  const state: AgentState = {
    config: chairman,
    status: "pending",
    stdout: [],
    stderr: [],
  };

  const res = await callAgent(state, prompt, timeoutMs);
  const responseText =
    res.status === "completed" ? res.stdout.join("").trim() : `Error from chairman (${res.status})`;

  return { agent: chairman.name, response: responseText };
}

/**
 * Run two-pass merge chairman.
 * Pass 1: Merge and categorize all responses
 * Pass 2: Refine and produce final output
 *
 * @param query - The original user question
 * @param responses - All Stage 1 responses
 * @param chairman - The chairman agent configuration
 * @param twoPass - Two-pass configuration
 * @param timeoutMs - Optional timeout in milliseconds
 * @param silent - Suppress console output
 * @param promptOptions - Chairman prompt options
 * @returns TwoPassResult with outputs from both passes
 */
export async function runTwoPassMergeChairman(
  query: string,
  responses: Stage1Result[],
  chairman: AgentConfig,
  twoPass: TwoPassConfig,
  timeoutMs: number | undefined,
  silent: boolean = false,
  promptOptions?: ChairmanPromptOptions
): Promise<TwoPassResult> {
  // Determine tiers for each pass
  const { tier: chairmanTier } = parseAgentSpec(chairman.name);
  const pass1Tier = twoPass.pass1Tier ?? chairmanTier;
  const pass2Tier = twoPass.pass2Tier ?? getStepDownTier(pass1Tier);

  // Create agents for each pass
  const pass1Agent = pass1Tier === chairmanTier
    ? chairman
    : createAgentWithTier(chairman, pass1Tier);
  const pass2Agent = pass2Tier === chairmanTier
    ? chairman
    : createAgentWithTier(chairman, pass2Tier);

  if (!silent) {
    console.log(`\nRunning two-pass merge chairman...`);
    console.log(`  Pass 1 (${pass1Agent.name}): Merge & Categorize (${responses.length} responses)`);
    console.log(`  Pass 2 (${pass2Agent.name}): Refine & Finalize`);
  }

  // === PASS 1: Merge & Categorize ===
  if (!silent) {
    console.log(`\n  [Pass 1] Running merge with ${pass1Agent.name}...`);
  }

  const pass1Prompt = twoPass.pass1Format
    ? buildMergeChairmanPrompt(query, formatAllResponsesForMerge(responses), twoPass.pass1Format)
    : buildMergePass1Prompt(query, responses, promptOptions);

  const pass1State: AgentState = {
    config: pass1Agent,
    status: "pending",
    stdout: [],
    stderr: [],
  };

  const pass1Result = await callAgent(pass1State, pass1Prompt, timeoutMs);
  const pass1Response = pass1Result.status === "completed"
    ? pass1Result.stdout.join("").trim()
    : `Error from chairman pass 1 (${pass1Result.status})`;

  // Parse Pass 1 sections
  const pass1Sections = parseSectionedOutput(pass1Response);
  const pass1SectionNames = pass1Sections.filter(s => s.complete).map(s => s.name);

  if (!silent) {
    console.log(`  [Pass 1] Complete. Parsed ${pass1SectionNames.length}/${MERGE_PASS1_SECTIONS.length} sections.`);
    if (pass1SectionNames.length < MERGE_PASS1_SECTIONS.length) {
      const missing = MERGE_PASS1_SECTIONS.filter(s => !pass1SectionNames.includes(s));
      console.log(chalk.yellow(`  [Pass 1] Missing sections: ${missing.join(", ")}`));
    }
  }

  // Check for Pass 1 failure
  if (pass1Response.startsWith("Error from chairman")) {
    return {
      pass1: { agent: pass1Agent.name, response: pass1Response },
      pass2: { agent: pass2Agent.name, response: "" },
      parsedSections: { pass1: [], pass2: [] },
    };
  }

  // === PASS 2: Refine & Finalize ===
  if (!silent) {
    console.log(`\n  [Pass 2] Running refinement with ${pass2Agent.name}...`);
  }

  const pass2Prompt = twoPass.pass2Format
    ? buildMergePass2Prompt(query, pass1Response, responses, { ...promptOptions, outputFormat: twoPass.pass2Format })
    : buildMergePass2Prompt(query, pass1Response, responses, promptOptions);

  const pass2State: AgentState = {
    config: pass2Agent,
    status: "pending",
    stdout: [],
    stderr: [],
  };

  const pass2Result = await callAgent(pass2State, pass2Prompt, timeoutMs);
  const pass2Response = pass2Result.status === "completed"
    ? pass2Result.stdout.join("").trim()
    : `Error from chairman pass 2 (${pass2Result.status})`;

  // Parse Pass 2 sections (if structured output was requested)
  const pass2Sections = parseSectionedOutput(pass2Response);
  const pass2SectionNames = pass2Sections.filter(s => s.complete).map(s => s.name);

  if (!silent) {
    if (pass2SectionNames.length > 0) {
      console.log(`  [Pass 2] Complete. Parsed ${pass2SectionNames.length} sections.`);
    } else {
      console.log(`  [Pass 2] Complete. (Unstructured output)`);
    }
  }

  // For merge mode, the combined output is either:
  // 1. The Pass 2 response if it produced structured sections
  // 2. Just the Pass 2 response if it's unstructured (which is fine for merge)
  const combined = pass2SectionNames.length > 0
    ? combinePassOutputs(pass1Response, pass2Response, pass1Sections, pass2Sections)
    : pass2Response;

  return {
    pass1: { agent: pass1Agent.name, response: pass1Response },
    pass2: { agent: pass2Agent.name, response: pass2Response },
    combined,
    parsedSections: {
      pass1: pass1SectionNames,
      pass2: pass2SectionNames,
    },
  };
}

export function printFinal(
  stage1: Stage1Result[],
  stage2: Stage2Result[] | null,
  aggregate: AggregateRanking[] | null,
  stage3: Stage3Result
) {
  console.log("\n=== Stage 1 Responses ===");
  stage1.forEach((r) => {
    console.log(`\n[${r.agent}]`);
    console.log(r.response);
  });

  if (stage2 && stage2.length > 0) {
    console.log("\n=== Stage 2 Rankings ===");
    stage2.forEach((r) => {
      console.log(`\n[${r.agent}]`);
      console.log(r.rankingRaw);
    });
  }

  if (aggregate && aggregate.length > 0) {
    console.log("\nAggregate ranking (lower is better):");
    aggregate.forEach((entry) => {
      console.log(`- ${entry.agent}: avg rank ${entry.averageRank} (from ${entry.rankingsCount} rankings)`);
    });
  }

  console.log("\n=== Stage 3 Chairman Synthesis ===");
  console.log(`\n[${stage3.agent}]`);
  console.log(stage3.response);
}

export function abortIfNoStage1(stage1: Stage1Result[]) {
  if (stage1.length === 0) {
    console.log(chalk.red("No agent responses were completed; aborting."));
    return true;
  }
  return false;
}

/**
 * Check if a chairman response indicates failure.
 */
function isChairmanFailure(response: string): boolean {
  return response.startsWith("Error from chairman");
}

/**
 * Enhanced pipeline with per-stage agent configuration.
 * Supports two modes:
 * - 'compete' (default): Responses are ranked, winner is refined
 * - 'merge': All responses are merged together (skips stage2)
 *
 * Also supports checkpointing for resumption and chairman fallback.
 */
export async function runEnhancedPipeline(
  question: string,
  options: EnhancedPipelineOptions
): Promise<PipelineResult | null> {
  const { config, timeoutMs, tty, silent = false, callbacks, checkpoint } = options;

  // Determine mode (default to compete for backward compatibility)
  const mode: PipelineMode = config.mode || 'compete';

  // Validate config for mode
  if (mode === 'compete' && !config.stage2) {
    throw new Error("Compete mode requires stage2 (evaluators) configuration");
  }

  if (!silent) {
    console.log(chalk.cyan(`\nPipeline mode: ${mode.toUpperCase()}`));
  }

  let stage1: Stage1Result[];
  let stage2: Stage2Result[] | null = null;
  let labelToAgent: LabelMap = {};
  let aggregate: AggregateRanking[] | null = null;

  // Check for existing checkpoint (only relevant for compete mode)
  const existingCheckpoint = checkpoint && mode === 'compete'
    ? loadCheckpoint(question, checkpoint)
    : null;

  if (existingCheckpoint) {
    if (!silent) {
      console.log(chalk.cyan(`Resuming from checkpoint (completed: ${existingCheckpoint.completedStage})`));
    }

    // Restore state from checkpoint
    if (existingCheckpoint.completedStage === "stage1" || existingCheckpoint.completedStage === "stage2") {
      stage1 = existingCheckpoint.stage1!;
      labelToAgent = existingCheckpoint.labelToAgent!;

      // Stage 1 callback (replay for consistency)
      await callbacks?.onStage1Complete?.(stage1);
    }

    if (existingCheckpoint.completedStage === "stage2") {
      stage2 = existingCheckpoint.stage2!;
      aggregate = existingCheckpoint.aggregate!;

      // Stage 2 callback (replay for consistency)
      await callbacks?.onStage2Complete?.(stage2, aggregate);
    }
  }

  // ==========================================================================
  // Stage 1: Individual Responses (same for both modes)
  // ==========================================================================
  if (!existingCheckpoint || existingCheckpoint.completedStage === "complete") {
    // Use custom prompt if provided, otherwise use the question directly
    const stage1Prompt = config.stage1.prompt || question;

    const stage1States = await runAgentsInteractive(
      "Stage 1 - Individual Responses",
      stage1Prompt,
      config.stage1.agents,
      timeoutMs,
      { tty }
    );
    stage1 = extractStage1(stage1States, silent);

    if (stage1.length === 0) {
      if (!silent) {
        console.log(chalk.red("No agent responses were completed; aborting."));
      }
      return null;
    }

    // Stage 1 callback
    await callbacks?.onStage1Complete?.(stage1);

    // Build label map for Stage 2 (only needed for compete mode)
    if (mode === 'compete') {
      const labels = stage1.map((_, idx) => `Response ${String.fromCharCode(65 + idx)}`);
      labels.forEach((label, idx) => {
        labelToAgent[label] = stage1[idx].agent;
      });

      // Save checkpoint after Stage 1 (compete mode only)
      if (checkpoint) {
        saveCheckpoint({
          version: 1,
          timestamp: new Date().toISOString(),
          question,
          completedStage: "stage1",
          stage1,
          labelToAgent,
        }, checkpoint);
        if (!silent) {
          console.log(chalk.gray("Checkpoint saved after Stage 1"));
        }
      }
    }
  }

  // Build chairman options
  const chairmanOptions: ChairmanPromptOptions = {
    outputFormat: config.stage3.outputFormat,
    useSummaries: config.stage3.useSummaries,
  };

  let stage3: Stage3Result;
  let twoPassResult: TwoPassResult | undefined;

  // ==========================================================================
  // Mode-specific processing
  // ==========================================================================
  if (mode === 'merge') {
    // ========================================================================
    // MERGE MODE: Skip stage2, pass all responses to chairman
    // ========================================================================
    if (!silent) {
      console.log(chalk.cyan(`\nMerge mode: Skipping Stage 2, merging ${stage1!.length} responses`));
    }

    if (config.stage3.twoPass?.enabled) {
      // Two-pass merge chairman
      twoPassResult = await runTwoPassMergeChairman(
        question,
        stage1!,
        config.stage3.chairman,
        config.stage3.twoPass,
        timeoutMs,
        silent,
        chairmanOptions
      );

      stage3 = {
        agent: `${twoPassResult.pass1.agent} + ${twoPassResult.pass2.agent}`,
        response: twoPassResult.combined || twoPassResult.pass2.response || twoPassResult.pass1.response,
      };

      // Try fallback if primary failed
      if (isChairmanFailure(twoPassResult.pass1.response) && config.stage3.fallback) {
        if (!silent) {
          console.log(chalk.yellow(`\nPrimary chairman failed, trying fallback (${config.stage3.fallback.name})...`));
        }
        twoPassResult = await runTwoPassMergeChairman(
          question,
          stage1!,
          config.stage3.fallback,
          config.stage3.twoPass,
          timeoutMs,
          silent,
          chairmanOptions
        );
        stage3 = {
          agent: `${twoPassResult.pass1.agent} + ${twoPassResult.pass2.agent}`,
          response: twoPassResult.combined || twoPassResult.pass2.response || twoPassResult.pass1.response,
        };
      }
    } else {
      // Single-pass merge chairman
      stage3 = await runMergeChairman(
        question,
        stage1!,
        config.stage3.chairman,
        timeoutMs,
        silent,
        config.stage3.outputFormat
      );

      // Try fallback if primary failed
      if (isChairmanFailure(stage3.response) && config.stage3.fallback) {
        if (!silent) {
          console.log(chalk.yellow(`\nPrimary chairman failed, trying fallback (${config.stage3.fallback.name})...`));
        }
        stage3 = await runMergeChairman(
          question,
          stage1!,
          config.stage3.fallback,
          timeoutMs,
          silent,
          config.stage3.outputFormat
        );
      }
    }

    // Stage 3 callback
    await callbacks?.onStage3Complete?.(stage3);

    return {
      mode: 'merge',
      stage1: stage1!,
      stage2: null,
      stage3,
      aggregate: null,
      twoPassResult,
    };

  } else {
    // ========================================================================
    // COMPETE MODE: Run stage2, then chairman with rankings context
    // ========================================================================

    // Stage 2: Peer Rankings (skip if restored from checkpoint with stage2 complete)
    if (!existingCheckpoint || existingCheckpoint.completedStage === "stage1") {
      const rankingPrompt = buildRankingPrompt(question, stage1!);
      const stage2States = await runAgentsInteractive(
        "Stage 2 - Peer Rankings",
        rankingPrompt,
        config.stage2!.agents,
        timeoutMs,
        { tty }
      );
      stage2 = extractStage2(stage2States, silent);

      // Calculate aggregate rankings
      aggregate = calculateAggregateRankings(stage2, labelToAgent);

      // Stage 2 callback
      await callbacks?.onStage2Complete?.(stage2, aggregate);

      // Save checkpoint after Stage 2
      if (checkpoint) {
        saveCheckpoint({
          version: 1,
          timestamp: new Date().toISOString(),
          question,
          completedStage: "stage2",
          stage1: stage1!,
          stage2,
          labelToAgent,
          aggregate,
        }, checkpoint);
        if (!silent) {
          console.log(chalk.gray("Checkpoint saved after Stage 2"));
        }
      }
    }

    // Stage 3: Chairman Synthesis
    if (config.stage3.twoPass?.enabled) {
      // Two-pass chairman mode
      twoPassResult = await runTwoPassChairman(
        question,
        stage1!,
        stage2!,
        config.stage3.chairman,
        config.stage3.twoPass,
        timeoutMs,
        silent,
        chairmanOptions
      );

      stage3 = {
        agent: `${twoPassResult.pass1.agent} + ${twoPassResult.pass2.agent}`,
        response: twoPassResult.combined || twoPassResult.pass1.response + "\n\n" + twoPassResult.pass2.response,
      };

      // Check for failure and try fallback
      if (isChairmanFailure(twoPassResult.pass1.response) && config.stage3.fallback) {
        if (!silent) {
          console.log(chalk.yellow(`\nPrimary chairman failed in two-pass mode, trying fallback (${config.stage3.fallback.name})...`));
        }
        twoPassResult = await runTwoPassChairman(
          question,
          stage1!,
          stage2!,
          config.stage3.fallback,
          config.stage3.twoPass,
          timeoutMs,
          silent,
          chairmanOptions
        );
        stage3 = {
          agent: `${twoPassResult.pass1.agent} + ${twoPassResult.pass2.agent}`,
          response: twoPassResult.combined || twoPassResult.pass1.response + "\n\n" + twoPassResult.pass2.response,
        };
      }
    } else {
      // Single-pass chairman mode (original behavior)
      stage3 = await runChairman(
        question,
        stage1!,
        stage2!,
        config.stage3.chairman,
        timeoutMs,
        silent,
        chairmanOptions
      );

      // Try fallback if primary chairman failed
      if (isChairmanFailure(stage3.response) && config.stage3.fallback) {
        if (!silent) {
          console.log(chalk.yellow(`\nPrimary chairman failed, trying fallback (${config.stage3.fallback.name})...`));
        }
        stage3 = await runChairman(
          question,
          stage1!,
          stage2!,
          config.stage3.fallback,
          timeoutMs,
          silent,
          chairmanOptions
        );
      }
    }
  }

  // Stage 3 callback
  await callbacks?.onStage3Complete?.(stage3);

  // Clear checkpoint on successful completion (even if chairman failed, stages are preserved)
  if (checkpoint && !isChairmanFailure(stage3.response)) {
    clearCheckpoint(checkpoint);
    if (!silent) {
      console.log(chalk.gray("Checkpoint cleared after successful completion"));
    }
  }

  return {
    mode: 'compete',
    stage1: stage1!,
    stage2: stage2!,
    stage3,
    aggregate: aggregate!,
    twoPassResult,
  };
}
