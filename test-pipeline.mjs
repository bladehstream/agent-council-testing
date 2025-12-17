#!/usr/bin/env node
/**
 * Full Pipeline Integration Tests
 *
 * These tests require at least 2 agents to be available (codex, claude, gemini).
 * Run with: node test-pipeline.mjs
 */

import {
  runCouncilPipeline,
  filterAvailableAgents,
  pickChairman,
  buildQuestionWithHistory,
  DEFAULT_AGENTS,
} from './dist/lib.js';
import fs from 'fs';

const results = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function log(msg) {
  console.log(msg);
}

async function runTest(name, fn, timeout = 120000) {
  log(`\nRunning: ${name}`);
  const start = Date.now();

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Test timeout')), timeout)
    );
    await Promise.race([fn(), timeoutPromise]);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    passed++;
    results.push({ name, status: 'PASS', elapsed: `${elapsed}s` });
    log(`PASS  ${name} (${elapsed}s)`);
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    failed++;
    results.push({ name, status: 'FAIL', error: e.message, elapsed: `${elapsed}s` });
    log(`FAIL  ${name} (${elapsed}s)`);
    log(`      Error: ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ============================================================================
// Pre-flight check
// ============================================================================
log('=== Pre-flight Check ===');
const { available, unavailable } = filterAvailableAgents(DEFAULT_AGENTS);
log(`Available agents: ${available.map(a => a.name).join(', ') || 'none'}`);
log(`Unavailable agents: ${unavailable.map(a => a.name).join(', ') || 'none'}`);

if (available.length < 2) {
  log('\nERROR: Need at least 2 agents for pipeline tests');
  log('Please install and authenticate: codex, claude, or gemini');
  process.exit(1);
}

const chairman = pickChairman(available);
log(`Chairman: ${chairman.name}`);

// ============================================================================
// Pipeline Tests
// ============================================================================
log('\n=== Full Pipeline Tests ===');

await runTest('Pipeline: Basic question', async () => {
  const result = await runCouncilPipeline(
    'What is 2 + 2? Answer with just the number.',
    available,
    chairman,
    { tty: false, silent: true, timeoutMs: 60000 }
  );

  assert(result !== null, 'Pipeline should return result');
  assert(result.stage1.length >= 2, 'Should have at least 2 stage1 responses');
  assert(result.stage2.length >= 2, 'Should have at least 2 stage2 rankings');
  assert(result.stage3.response, 'Should have stage3 response');
  assert(result.aggregate.length > 0, 'Should have aggregate rankings');

  log(`      Stage1 responses: ${result.stage1.length}`);
  log(`      Stage2 rankings: ${result.stage2.length}`);
  log(`      Stage3 chairman: ${result.stage3.agent}`);
  log(`      Answer preview: ${result.stage3.response.slice(0, 100)}...`);
});

await runTest('Pipeline: Stage callbacks fire', async () => {
  const callbackLog = [];

  const result = await runCouncilPipeline(
    'What is the capital of France? One word answer.',
    available,
    chairman,
    {
      tty: false,
      silent: true,
      timeoutMs: 60000,
      callbacks: {
        onStage1Complete: (results) => {
          callbackLog.push({ stage: 1, count: results.length });
        },
        onStage2Complete: (rankings, aggregate) => {
          callbackLog.push({ stage: 2, rankings: rankings.length, aggregate: aggregate.length });
        },
        onStage3Complete: (result) => {
          callbackLog.push({ stage: 3, agent: result.agent });
        },
      },
    }
  );

  assert(result !== null, 'Pipeline should return result');
  assert(callbackLog.length === 3, `All 3 callbacks should fire, got ${callbackLog.length}`);
  assert(callbackLog[0].stage === 1, 'Stage 1 callback should fire first');
  assert(callbackLog[1].stage === 2, 'Stage 2 callback should fire second');
  assert(callbackLog[2].stage === 3, 'Stage 3 callback should fire third');

  log(`      Callbacks fired: ${callbackLog.map(c => `stage${c.stage}`).join(' -> ')}`);
});

await runTest('Pipeline: Async callbacks awaited', async () => {
  const order = [];

  const result = await runCouncilPipeline(
    'What is 1 + 1?',
    available,
    chairman,
    {
      tty: false,
      silent: true,
      timeoutMs: 60000,
      callbacks: {
        onStage1Complete: async () => {
          await new Promise(r => setTimeout(r, 50));
          order.push('stage1');
        },
        onStage2Complete: async () => {
          await new Promise(r => setTimeout(r, 50));
          order.push('stage2');
        },
        onStage3Complete: async () => {
          await new Promise(r => setTimeout(r, 50));
          order.push('stage3');
        },
      },
    }
  );

  assert(result !== null, 'Pipeline should return result');
  assert(order.join(',') === 'stage1,stage2,stage3', `Callbacks should be awaited in order, got: ${order.join(',')}`);

  log(`      Execution order: ${order.join(' -> ')}`);
});

await runTest('Pipeline: Partial callbacks work', async () => {
  let stage2Called = false;

  const result = await runCouncilPipeline(
    'What color is the sky?',
    available,
    chairman,
    {
      tty: false,
      silent: true,
      timeoutMs: 60000,
      callbacks: {
        // Only defining stage2 callback
        onStage2Complete: () => {
          stage2Called = true;
        },
      },
    }
  );

  assert(result !== null, 'Pipeline should return result');
  assert(stage2Called, 'Stage2 callback should be called');

  log(`      Partial callback (stage2 only) worked`);
});

await runTest('Pipeline: Intermediate results accessible', async () => {
  const result = await runCouncilPipeline(
    'Name a programming language.',
    available,
    chairman,
    { tty: false, silent: true, timeoutMs: 60000 }
  );

  assert(result !== null, 'Pipeline should return result');

  // Verify all intermediate results are accessible
  assert(Array.isArray(result.stage1), 'stage1 should be array');
  assert(Array.isArray(result.stage2), 'stage2 should be array');
  assert(typeof result.stage3 === 'object', 'stage3 should be object');
  assert(Array.isArray(result.aggregate), 'aggregate should be array');

  // Verify structure of each stage
  for (const s1 of result.stage1) {
    assert(s1.agent, 'stage1 item should have agent');
    assert(s1.response, 'stage1 item should have response');
  }

  for (const s2 of result.stage2) {
    assert(s2.agent, 'stage2 item should have agent');
    assert(s2.rankingRaw !== undefined, 'stage2 item should have rankingRaw');
    assert(Array.isArray(s2.parsedRanking), 'stage2 item should have parsedRanking array');
  }

  assert(result.stage3.agent, 'stage3 should have agent');
  assert(result.stage3.response, 'stage3 should have response');

  log(`      All intermediate results properly structured`);
});

await runTest('Pipeline: Conversation history', async () => {
  // First question
  const result1 = await runCouncilPipeline(
    'Name a color.',
    available,
    chairman,
    { tty: false, silent: true, timeoutMs: 60000 }
  );

  assert(result1 !== null, 'First pipeline should return result');

  // Build history
  const history = [{
    question: 'Name a color.',
    stage1: result1.stage1,
    stage3Response: result1.stage3.response,
  }];

  // Follow-up with history
  const questionWithHistory = buildQuestionWithHistory('What is a darker shade of that color?', history);
  assert(questionWithHistory.length > 'What is a darker shade of that color?'.length, 'Should include history context');

  const result2 = await runCouncilPipeline(
    questionWithHistory,
    available,
    chairman,
    { tty: false, silent: true, timeoutMs: 60000 }
  );

  assert(result2 !== null, 'Second pipeline should return result');

  log(`      First answer: ${result1.stage3.response.slice(0, 50)}...`);
  log(`      Follow-up answer: ${result2.stage3.response.slice(0, 50)}...`);
});

await runTest('Pipeline: Multiple sequential councils', async () => {
  const questions = [
    'What is 1+1?',
    'What is 2+2?',
    'What is 3+3?',
  ];

  const results = [];
  for (const q of questions) {
    const result = await runCouncilPipeline(
      q,
      available,
      chairman,
      { tty: false, silent: true, timeoutMs: 60000 }
    );
    results.push(result);
  }

  const successCount = results.filter(r => r !== null).length;
  assert(successCount === 3, `Expected 3 successful councils, got ${successCount}`);

  log(`      Successfully ran ${successCount} sequential councils`);
});

// ============================================================================
// Summary
// ============================================================================
log('\n' + '='.repeat(60));
log(`PIPELINE TESTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
log('='.repeat(60));

// Save results
const summary = {
  timestamp: new Date().toISOString(),
  agents: available.map(a => a.name),
  chairman: chairman.name,
  passed,
  failed,
  skipped,
  total: passed + failed + skipped,
  results
};
fs.writeFileSync('test-pipeline-results.json', JSON.stringify(summary, null, 2));
log('\nResults saved to test-pipeline-results.json');

process.exit(failed > 0 ? 1 : 0);
