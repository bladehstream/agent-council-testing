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

export function buildChairmanPrompt(
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[]
): string {
  const stage1Text = stage1Results
    .map((r) => `Agent: ${r.agent}\nResponse: ${r.response}`)
    .join("\n\n");
  const stage2Text = stage2Results
    .map((r) => `Agent: ${r.agent}\nRanking: ${r.rankingRaw}`)
    .join("\n\n");

  return `
You are the Chairman of an agent council. Multiple AI agents have provided responses
to a user's question, and then ranked each other's responses.

Original Question: ${userQuery}

STAGE 1 - Individual Responses:
${stage1Text}

STAGE 2 - Peer Rankings:
${stage2Text}

Your task as Chairman is to synthesize all of this information into a single,
comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:
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
