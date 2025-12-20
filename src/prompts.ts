import type { ConversationEntry, ParsedSection, Stage1Result, Stage2Result } from "./types.js";

export const MAX_HISTORY_ENTRIES = 5;

// ============================================================================
// Sectioned Output Format
// ============================================================================

/**
 * Delimiters for sectioned output format.
 * Used to reliably parse multi-section output and detect truncation.
 */
export const SECTION_DELIMITERS = {
  start: (name: string) => `===SECTION:${name}===`,
  end: (name: string) => `===END:${name}===`,
  pattern: {
    start: /===SECTION:(\w+)===/g,
    end: /===END:(\w+)===/g,
    section: /===SECTION:(\w+)===([\s\S]*?)===END:\1===/g,
  },
} as const;

/**
 * Default sections for Pass 1 (synthesis).
 * Order is by priority - most critical first.
 */
export const PASS1_SECTIONS = [
  'executive_summary',
  'ambiguities',
  'consensus_notes',
  'implementation_phases',
  'section_outlines',
] as const;

/**
 * Default sections for Pass 2 (detailed specifications).
 */
export const PASS2_SECTIONS = [
  'architecture',
  'data_model',
  'api_contracts',
  'user_flows',
  'security',
  'deployment',
] as const;

/**
 * Parse sectioned output into individual sections.
 * Detects complete and incomplete (truncated) sections.
 *
 * @param output - Raw output with section delimiters
 * @returns Array of parsed sections with completion status
 */
export function parseSectionedOutput(output: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const seenSections = new Set<string>();

  // Find all complete sections
  let match;
  const pattern = new RegExp(SECTION_DELIMITERS.pattern.section.source, 'g');
  while ((match = pattern.exec(output)) !== null) {
    const [, name, content] = match;
    sections.push({
      name,
      content: content.trim(),
      complete: true,
    });
    seenSections.add(name);
  }

  // Find incomplete sections (started but not ended - truncated)
  const startPattern = new RegExp(SECTION_DELIMITERS.pattern.start.source, 'g');
  while ((match = startPattern.exec(output)) !== null) {
    const [fullMatch, name] = match;
    if (!seenSections.has(name)) {
      // Section started but didn't complete
      const startIdx = match.index + fullMatch.length;
      const content = output.slice(startIdx).trim();
      sections.push({
        name,
        content,
        complete: false,
      });
    }
  }

  return sections;
}

/**
 * Get list of missing sections by comparing parsed sections to expected list.
 *
 * @param parsed - Parsed sections from output
 * @param expected - Expected section names
 * @returns Array of missing section names
 */
export function getMissingSections(parsed: ParsedSection[], expected: readonly string[]): string[] {
  const parsedNames = new Set(parsed.filter(s => s.complete).map(s => s.name));
  return expected.filter(name => !parsedNames.has(name));
}

/**
 * Get list of truncated (incomplete) sections.
 *
 * @param parsed - Parsed sections from output
 * @returns Array of truncated section names
 */
export function getTruncatedSections(parsed: ParsedSection[]): string[] {
  return parsed.filter(s => !s.complete).map(s => s.name);
}

/**
 * Build sectioned output format instructions for the chairman.
 *
 * @param sections - Section names to request
 * @param sectionDescriptions - Optional descriptions for each section
 * @returns Format instructions string
 */
export function buildSectionedFormatInstructions(
  sections: readonly string[],
  sectionDescriptions?: Record<string, string>
): string {
  const sectionList = sections.map(name => {
    const desc = sectionDescriptions?.[name] || name.replace(/_/g, ' ');
    return `- ${name}: ${desc}`;
  }).join('\n');

  return `You MUST output your response using sectioned format with explicit delimiters.

For EACH section, use this exact format:
===SECTION:section_name===
{section content here}
===END:section_name===

REQUIRED SECTIONS (in this order):
${sectionList}

CRITICAL REQUIREMENTS:
1. Every section MUST start with ===SECTION:name=== and end with ===END:name===
2. Output sections in the order listed above
3. Do not add any text outside of sections
4. Each section's content should be valid JSON or markdown as appropriate
5. Complete all sections - do not stop mid-section`;
}

export function buildQuestionWithHistory(
  question: string,
  history: ConversationEntry[]
): string {
  if (history.length === 0) return question;

  const recentHistory = history.slice(-MAX_HISTORY_ENTRIES);
  let context = "Previous conversation:\n";
  for (const entry of recentHistory) {
    context += `Q: ${entry.question}\n`;
    context += `A: ${entry.stage3Response}\n\n`;
  }
  context += `Current question: ${question}`;
  return context;
}

export function buildRankingPrompt(userQuery: string, stage1Results: Stage1Result[]): string {
  const labels = stage1Results.map((_, idx) => String.fromCharCode(65 + idx));
  const responsesText = stage1Results
    .map((result, idx) => `Response ${labels[idx]}:\n${result.response}`)
    .join("\n\n");

  return `
You are evaluating different responses to the following question:

Question: ${userQuery}

Here are the responses from different agents (anonymized):

${responsesText}

Your task:
1. Evaluate each response: briefly note strengths and weaknesses.
2. Provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:
`.trim();
}

/**
 * Options for building the chairman prompt.
 */
export interface ChairmanPromptOptions {
  /** Optional output format instructions (e.g., JSON schema) */
  outputFormat?: string;
  /** Use executive summaries instead of full responses to reduce context size */
  useSummaries?: boolean;
}

/**
 * Build the chairman prompt for Stage 3 synthesis.
 *
 * @param userQuery - The original user question
 * @param stage1Results - Individual agent responses from Stage 1
 * @param stage2Results - Peer rankings from Stage 2
 * @param options - Chairman prompt options (or outputFormat string for backward compatibility)
 * @returns The complete chairman prompt
 */
export function buildChairmanPrompt(
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[],
  options?: ChairmanPromptOptions | string
): string {
  // Handle backward compatibility: string param means outputFormat only
  const opts: ChairmanPromptOptions = typeof options === 'string'
    ? { outputFormat: options }
    : options ?? {};

  const stage1Text = stage1Results
    .map((r) => {
      // Use summary if available and useSummaries is enabled
      const content = opts.useSummaries && r.summary
        ? r.summary
        : r.response;
      const label = opts.useSummaries && r.summary
        ? '(Executive Summary)'
        : '(Full Response)';
      return `Agent: ${r.agent} ${label}\n${content}`;
    })
    .join("\n\n");

  const stage2Text = stage2Results
    .map((r) => `Agent: ${r.agent}\nRanking: ${r.rankingRaw}`)
    .join("\n\n");

  // Build output format section if provided
  const formatSection = opts.outputFormat
    ? `

OUTPUT FORMAT REQUIREMENTS:
${opts.outputFormat}

You MUST follow the output format exactly as specified above.`
    : "";

  // Add note about summaries if using them
  const summaryNote = opts.useSummaries
    ? `
Note: You are seeing executive summaries from each agent, not their full responses.
These summaries capture the key architectural decisions, risks, and recommendations.
Focus on synthesizing these insights into a cohesive specification.`
    : "";

  return `
You are the Chairman of an agent council. Multiple AI agents have provided responses
to a user's question, and then ranked each other's responses.

Original Question: ${userQuery}

STAGE 1 - Individual Responses:
${stage1Text}

STAGE 2 - Peer Rankings:
${stage2Text}
${summaryNote}

Your task as Chairman is to synthesize all of this information into a single,
comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Patterns of agreement or disagreement
${formatSection}

Provide your synthesis:
`.trim();
}

// ============================================================================
// Merge Mode Prompts
// ============================================================================

/**
 * Format all Stage 1 responses for merge chairman input.
 * Uses clear delimiters for each response with explicit model attribution.
 *
 * @param responses - All Stage 1 responses
 * @returns Formatted string with all responses
 */
export function formatAllResponsesForMerge(responses: Stage1Result[]): string {
  return responses.map((r, i) => {
    return `===RESPONSE FROM: ${r.agent}===
MODEL: ${r.agent}
RESPONSE_INDEX: ${i + 1}

${r.response}

===END RESPONSE FROM: ${r.agent}===`;
  }).join('\n\n');
}

/**
 * Build the merge chairman prompt for single-pass merge mode.
 *
 * @param query - The original user question
 * @param formattedResponses - Formatted responses from formatAllResponsesForMerge
 * @param outputFormat - Optional output format instructions
 * @returns The merge chairman prompt
 */
export function buildMergeChairmanPrompt(
  query: string,
  formattedResponses: string,
  outputFormat?: string
): string {
  const basePrompt = `You are the Chairman of an agent council operating in MERGE MODE.

You have received multiple responses to the same query from different AI models.
Your task is to MERGE them into a single comprehensive output.

IMPORTANT: Do NOT pick a winner - synthesize ALL valuable content from every response.

## Source Attribution

Each response below is tagged with its source model using this format:
===RESPONSE FROM: model_name===
MODEL: model_name
RESPONSE_INDEX: N

When you include content in your merged output, you MUST track which model(s) contributed it.
Use the MODEL field from each response to identify the source.

## Merge Guidelines

1. **Include unique content**: If something appears in only one response, include it (it represents that model's unique insight)

2. **Deduplicate similar content**: If multiple responses cover the same point, keep the most specific/detailed version and note which models had similar content

3. **Flag conflicts**: If responses contradict each other, include both perspectives with a note about the disagreement

4. **Preserve structure**: Maintain logical organization in the merged output

5. **Track attribution**: For each item in your output, remember which model(s) contributed to it

## Original Query

${query}

## Responses to Merge

${formattedResponses}

## Your Task

Produce a merged output that combines the best of all responses.`;

  if (outputFormat) {
    return `${basePrompt}\n\n## Output Format\n\n${outputFormat}`;
  }

  return basePrompt;
}

/**
 * Default section descriptions for merge Pass 1 (categorization/deduplication).
 */
export const MERGE_PASS1_SECTIONS = [
  'merged_content',
  'unique_insights',
  'conflicts',
  'coverage_gaps',
] as const;

export const MERGE_PASS1_SECTION_DESCRIPTIONS: Record<string, string> = {
  merged_content: 'Primary merged output combining all responses',
  unique_insights: 'JSON array of insights that appeared in only one response, with attribution',
  conflicts: 'JSON array of contradictions between responses, with both perspectives',
  coverage_gaps: 'Areas that no response adequately covered, requiring follow-up',
};

/**
 * Build Pass 1 prompt for two-pass merge mode.
 * Pass 1 focuses on merging, categorizing, and identifying gaps.
 *
 * @param query - The original user question
 * @param responses - All Stage 1 responses
 * @param options - Chairman prompt options
 * @returns The merge Pass 1 prompt
 */
export function buildMergePass1Prompt(
  query: string,
  responses: Stage1Result[],
  options?: ChairmanPromptOptions
): string {
  const opts = options ?? {};

  const formattedResponses = responses.map((r, i) => {
    const content = opts.useSummaries && r.summary ? r.summary : r.response;
    const label = opts.useSummaries && r.summary ? '(Summary)' : '(Full)';
    return `===RESPONSE FROM: ${r.agent}===
MODEL: ${r.agent}
RESPONSE_INDEX: ${i + 1}
CONTENT_TYPE: ${label}

${content}

===END RESPONSE FROM: ${r.agent}===`;
  }).join('\n\n');

  const formatInstructions = buildSectionedFormatInstructions(
    MERGE_PASS1_SECTIONS,
    MERGE_PASS1_SECTION_DESCRIPTIONS
  );

  return `
You are the Chairman of an agent council (Merge Mode - Pass 1 of 2: Synthesis & Categorization).

Multiple AI agents have provided responses to the same query. Your task is to MERGE them.

Original Query: ${query}

## Responses to Merge

${formattedResponses}

## Your Task (Pass 1 - Merge & Categorize)

1. Merge all responses into a comprehensive unified output
2. Identify unique insights from individual models
3. Flag any conflicts or contradictions
4. Note coverage gaps for Pass 2 to address

${formatInstructions}

## Section Content Requirements

merged_content: The primary merged output. Combine the best of all responses into a cohesive whole.
Deduplicate similar content, keeping the most detailed version.

unique_insights: JSON array where each item has:
{
  "source": "agent name",
  "insight": "The unique point this agent made",
  "value": "Why this insight is valuable"
}

conflicts: JSON array where each item has:
{
  "topic": "What the conflict is about",
  "positions": [
    { "source": "agent1", "position": "Their view" },
    { "source": "agent2", "position": "Their view" }
  ],
  "resolution": "Your recommended resolution or 'requires human decision'"
}

coverage_gaps: JSON array of areas that need more detail:
["Gap 1 description", "Gap 2 description", ...]

Begin your merge synthesis:
`.trim();
}

/**
 * Build Pass 2 prompt for two-pass merge mode.
 * Pass 2 focuses on refining, filling gaps, and producing final output.
 *
 * @param query - The original user question
 * @param pass1Output - The output from Pass 1
 * @param responses - Original Stage 1 responses (for reference)
 * @param options - Chairman prompt options
 * @returns The merge Pass 2 prompt
 */
export function buildMergePass2Prompt(
  query: string,
  pass1Output: string,
  responses: Stage1Result[],
  options?: ChairmanPromptOptions
): string {
  const opts = options ?? {};

  // Brief reference to original responses
  const referenceText = responses.map((r) => {
    const content = opts.useSummaries && r.summary ? r.summary : r.response;
    return `[${r.agent}]: ${content.substring(0, 1500)}${content.length > 1500 ? '...' : ''}`;
  }).join('\n\n');

  const formatInstructions = opts.outputFormat
    ? `\n## Output Format\n\n${opts.outputFormat}`
    : '';

  return `
*** CRITICAL: READ OUTPUT FORMAT FIRST ***
${formatInstructions || 'Output a comprehensive merged result addressing all content from Pass 1.'}
*** END FORMAT INSTRUCTIONS ***

You are the Chairman of an agent council (Merge Mode - Pass 2 of 2: Refinement & Finalization).

You completed Pass 1 which merged multiple agent responses. Now refine and finalize.

Original Query: ${query}

<pass1_output>
${pass1Output}
</pass1_output>

<original_responses_reference>
${referenceText}
</original_responses_reference>

## Your Task (Pass 2 - Refine & Finalize)

1. Take the merged_content from Pass 1 and refine it
2. Resolve any conflicts flagged in Pass 1 (make decisions or note for human review)
3. Fill coverage_gaps identified in Pass 1 using the original responses
4. Incorporate unique_insights appropriately
5. Produce the final, polished merged output

Focus on creating a cohesive, comprehensive final result.
${formatInstructions}

Begin your final output:
`.trim();
}

export function parseRankingFromText(rankingText: string): string[] {
  const finalMarker = "FINAL RANKING:";
  if (rankingText.includes(finalMarker)) {
    const [, tail] = rankingText.split(finalMarker);
    const numbered = tail.match(/\d+\.\s*Response [A-Z]/g);
    if (numbered && numbered.length) {
      return numbered
        .map((item) => {
          const match = item.match(/Response [A-Z]/);
          return match ? match[0] : "";
        })
        .filter(Boolean);
    }
    const matches = tail.match(/Response [A-Z]/g);
    if (matches) return matches;
  }
  const fallback = rankingText.match(/Response [A-Z]/g);
  return fallback || [];
}

// ============================================================================
// Two-Pass Chairman Prompts
// ============================================================================

/**
 * Default section descriptions for Pass 1 (synthesis).
 */
export const PASS1_SECTION_DESCRIPTIONS: Record<string, string> = {
  executive_summary: '2-3 paragraph synthesis of key findings, recommendations, and confidence level',
  ambiguities: 'JSON array of questions requiring human decision, with priority, options, and recommendations',
  consensus_notes: 'Summary of where agents agreed/disagreed and how conflicts were resolved',
  implementation_phases: 'JSON array of implementation phases with deliverables',
  section_outlines: 'Brief outline (2-3 sentences each) for each detailed spec section to be expanded in Pass 2',
};

/**
 * Default section descriptions for Pass 2 (detailed specifications).
 */
export const PASS2_SECTION_DESCRIPTIONS: Record<string, string> = {
  architecture: 'Detailed system architecture: components, interactions, technology choices, diagrams',
  data_model: 'Complete data model: entities, relationships, storage recommendations, data flow',
  api_contracts: 'API specifications: endpoints, request/response formats, authentication',
  user_flows: 'Critical user journeys: steps, happy paths, error cases',
  security: 'Security design: authentication, authorization, data protection, threat model',
  deployment: 'Infrastructure and deployment: scaling, monitoring, CI/CD recommendations',
};

/**
 * Build Pass 1 (synthesis) prompt for two-pass chairman.
 *
 * @param userQuery - The original user question
 * @param stage1Results - Individual agent responses from Stage 1
 * @param stage2Results - Peer rankings from Stage 2
 * @param options - Chairman prompt options
 * @returns The Pass 1 prompt
 */
export function buildPass1Prompt(
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[],
  options?: ChairmanPromptOptions
): string {
  const opts = options ?? {};

  const stage1Text = stage1Results
    .map((r) => {
      const content = opts.useSummaries && r.summary ? r.summary : r.response;
      const label = opts.useSummaries && r.summary ? '(Executive Summary)' : '(Full Response)';
      return `Agent: ${r.agent} ${label}\n${content}`;
    })
    .join("\n\n");

  const stage2Text = stage2Results
    .map((r) => `Agent: ${r.agent}\nRanking: ${r.rankingRaw}`)
    .join("\n\n");

  const formatInstructions = buildSectionedFormatInstructions(
    PASS1_SECTIONS,
    PASS1_SECTION_DESCRIPTIONS
  );

  const summaryNote = opts.useSummaries
    ? `
Note: You are seeing executive summaries from each agent, not their full responses.
These summaries capture the key architectural decisions, risks, and recommendations.`
    : "";

  return `
You are the Chairman of an agent council (Pass 1 of 2: Synthesis).
Multiple AI agents have provided responses and ranked each other's work.

Original Question: ${userQuery}

STAGE 1 - Individual Responses:
${stage1Text}

STAGE 2 - Peer Rankings:
${stage2Text}
${summaryNote}

YOUR TASK (Pass 1 - Synthesis):
Analyze all responses and produce a synthesis that captures:
1. Executive summary of findings and recommendations
2. All ambiguities and questions requiring human decision
3. Areas of consensus and disagreement
4. High-level implementation phases
5. Brief outlines for each detailed spec section (to be expanded in Pass 2)

${formatInstructions}

SECTION CONTENT REQUIREMENTS:

executive_summary: A 2-3 paragraph narrative covering key findings, main recommendations, and your confidence level.

ambiguities: A JSON array where each item has:
{
  "id": "AMB-1",
  "question": "Clear question needing human decision",
  "priority": "critical|important|minor",
  "context": "Why this matters",
  "options": ["Option A", "Option B"],
  "recommendation": "Your recommended choice with rationale"
}

consensus_notes: Narrative describing where agents agreed, where they disagreed, and how you resolved conflicts.

implementation_phases: A JSON array where each item has:
{
  "phase": 1,
  "name": "Phase name",
  "description": "What this phase accomplishes",
  "key_deliverables": ["Deliverable 1", "Deliverable 2"]
}

section_outlines: A JSON object with brief outlines for Pass 2 sections:
{
  "architecture": "2-3 sentence outline of architecture approach",
  "data_model": "2-3 sentence outline of data model approach",
  "api_contracts": "2-3 sentence outline of API approach",
  "user_flows": "2-3 sentence outline of key flows",
  "security": "2-3 sentence outline of security approach",
  "deployment": "2-3 sentence outline of deployment approach"
}

Begin your synthesis:
`.trim();
}

/**
 * Build Pass 2 (detail) prompt for two-pass chairman.
 *
 * @param userQuery - The original user question
 * @param pass1Output - The output from Pass 1
 * @param stage1Results - Individual agent responses (for reference)
 * @param options - Chairman prompt options
 * @returns The Pass 2 prompt
 */
export function buildPass2Prompt(
  userQuery: string,
  pass1Output: string,
  stage1Results: Stage1Result[],
  options?: ChairmanPromptOptions
): string {
  const opts = options ?? {};

  // Include original responses for reference (summaries if available)
  const referenceText = stage1Results
    .map((r) => {
      const content = opts.useSummaries && r.summary ? r.summary : r.response;
      return `[${r.agent}]: ${content.substring(0, 2000)}${content.length > 2000 ? '...' : ''}`;
    })
    .join("\n\n");

  const formatInstructions = buildSectionedFormatInstructions(
    PASS2_SECTIONS,
    PASS2_SECTION_DESCRIPTIONS
  );

  // Put format FIRST before context to ensure model sees it early
  return `
*** CRITICAL OUTPUT FORMAT - READ THIS FIRST ***
${formatInstructions}
*** END FORMAT INSTRUCTIONS ***

You are the Chairman of an agent council (Pass 2 of 2: Detailed Specifications).
You have already completed Pass 1 (synthesis). Now expand the section outlines into full specifications.

Original Question: ${userQuery}

<pass1_context>
PASS 1 OUTPUT (your synthesis from the previous pass):
${pass1Output}
</pass1_context>

<agent_context>
AGENT RESPONSES (for reference):
${referenceText}
</agent_context>

YOUR TASK (Pass 2 - Detailed Specifications):
Expand each section outline from Pass 1 into comprehensive specifications.
Use the agent responses as source material, but synthesize into a cohesive design.

SECTION CONTENT REQUIREMENTS:

architecture: Comprehensive architecture section including:
- System overview and component diagram (ASCII/text)
- Component descriptions with responsibilities
- Technology recommendations with rationale
- Communication patterns and protocols
- Scalability considerations

data_model: Complete data model including:
- Entity definitions with attributes
- Relationships and cardinality
- Storage recommendations (database choices)
- Data flow descriptions
- Migration considerations if applicable

api_contracts: Full API specifications including:
- API style (REST/GraphQL/gRPC) with rationale
- Endpoint definitions with methods and paths
- Request/response schemas
- Authentication mechanisms
- Error handling patterns

user_flows: Critical user journeys including:
- Flow name and actor
- Step-by-step sequences
- Happy path outcomes
- Error cases and recovery
- Edge cases to consider

security: Security architecture including:
- Authentication strategy and implementation
- Authorization model (RBAC, ABAC, etc.)
- Data protection (encryption, PII handling)
- Compliance considerations
- Threat model and mitigations

deployment: Infrastructure and operations including:
- Cloud/infrastructure recommendations
- Scaling strategy (horizontal/vertical)
- Monitoring and observability
- CI/CD pipeline design
- Disaster recovery considerations

*** REMINDER: You MUST use the sectioned format with ===SECTION:name=== and ===END:name=== delimiters ***
Start with ===SECTION:architecture=== now:
`.trim();
}
