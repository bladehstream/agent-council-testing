import type { ConversationEntry, Stage1Result, Stage2Result } from "./types.js";

export const MAX_HISTORY_ENTRIES = 5;

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
