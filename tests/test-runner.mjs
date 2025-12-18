#!/usr/bin/env node
/**
 * Programmatic API Test Suite
 *
 * Run with: node test-runner.mjs
 */

const results = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function log(msg) {
  console.log(msg);
}

function test(name, fn) {
  return { name, fn };
}

function skip(name) {
  return { name, skip: true };
}

async function runTest(t) {
  if (t.skip) {
    skipped++;
    results.push({ name: t.name, status: 'SKIP' });
    log(`SKIP  ${t.name}`);
    return;
  }

  try {
    await t.fn();
    passed++;
    results.push({ name: t.name, status: 'PASS' });
    log(`PASS  ${t.name}`);
  } catch (e) {
    failed++;
    results.push({ name: t.name, status: 'FAIL', error: e.message });
    log(`FAIL  ${t.name}`);
    log(`      Error: ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Import the library
const lib = await import('../dist/lib.js');

// ============================================================================
// Category 1: Build & Package Structure
// ============================================================================
log('\n=== Category 1: Build & Package Structure ===');

await runTest(test('1.1 Core dist files exist', async () => {
  const fs = await import('fs');
  const files = ['dist/lib.js', 'dist/lib.d.ts', 'dist/index.js', 'dist/index.d.ts'];
  for (const f of files) {
    assert(fs.existsSync(f), `Missing file: ${f}`);
  }
}));

await runTest(test('1.2 Declaration files have content', async () => {
  const fs = await import('fs');
  const content = fs.readFileSync('dist/lib.d.ts', 'utf8');
  assert(content.length > 100, 'lib.d.ts should have content');
}));

await runTest(test('1.3 Package.json exports field valid', async () => {
  const fs = await import('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert(pkg.exports?.['.'], 'exports["."] should exist');
  assert(pkg.exports?.['./cli'], 'exports["./cli"] should exist');
  assert(pkg.main?.includes('lib'), 'main should point to lib');
  assert(pkg.types, 'types field should exist');
}));

// ============================================================================
// Category 2: Export Availability
// ============================================================================
log('\n=== Category 2: Export Availability ===');

await runTest(test('2.1 All expected exports present', async () => {
  const expected = [
    'runCouncilPipeline', 'pickChairman', 'extractStage1', 'extractStage2',
    'calculateAggregateRankings', 'runChairman', 'DEFAULT_AGENTS', 'DEFAULT_CHAIRMAN',
    'filterAvailableAgents', 'callAgent', 'commandExists', 'buildQuestionWithHistory',
    'buildRankingPrompt', 'buildChairmanPrompt', 'parseRankingFromText', 'MAX_HISTORY_ENTRIES'
  ];
  const actual = Object.keys(lib);
  const missing = expected.filter(e => !actual.includes(e));
  assert(missing.length === 0, `Missing exports: ${missing.join(', ')}`);
}));

await runTest(test('2.2 No undefined exports', async () => {
  const undefinedExports = Object.entries(lib)
    .filter(([k, v]) => v === undefined)
    .map(([k]) => k);
  assert(undefinedExports.length === 0, `Undefined exports: ${undefinedExports.join(', ')}`);
}));

await runTest(test('2.3 Function exports are callable', async () => {
  const functions = [
    'runCouncilPipeline', 'pickChairman', 'extractStage1', 'extractStage2',
    'calculateAggregateRankings', 'runChairman', 'filterAvailableAgents', 'callAgent',
    'commandExists', 'buildQuestionWithHistory', 'buildRankingPrompt', 'buildChairmanPrompt',
    'parseRankingFromText'
  ];
  const notFunctions = functions.filter(f => typeof lib[f] !== 'function');
  assert(notFunctions.length === 0, `Not functions: ${notFunctions.join(', ')}`);
}));

await runTest(test('2.4 Constant exports have correct types', async () => {
  assert(Array.isArray(lib.DEFAULT_AGENTS), 'DEFAULT_AGENTS should be array');
  assert(typeof lib.DEFAULT_CHAIRMAN === 'string', 'DEFAULT_CHAIRMAN should be string');
  assert(typeof lib.MAX_HISTORY_ENTRIES === 'number', 'MAX_HISTORY_ENTRIES should be number');
}));

// ============================================================================
// Category 3: Type Structure Validation
// ============================================================================
log('\n=== Category 3: Type Structure Validation ===');

await runTest(test('3.1 DEFAULT_AGENTS structure', async () => {
  const valid = lib.DEFAULT_AGENTS.every(agent =>
    typeof agent.name === 'string' &&
    Array.isArray(agent.command) &&
    agent.command.every(c => typeof c === 'string')
  );
  assert(valid, 'Invalid agent structure in DEFAULT_AGENTS');
}));

await runTest(test('3.2 FilterResult structure', async () => {
  const result = lib.filterAvailableAgents(lib.DEFAULT_AGENTS);
  assert('available' in result, 'FilterResult should have available');
  assert('unavailable' in result, 'FilterResult should have unavailable');
  assert(Array.isArray(result.available), 'available should be array');
  assert(Array.isArray(result.unavailable), 'unavailable should be array');
}));

await runTest(test('3.3 AgentConfig shape from pickChairman', async () => {
  const { available } = lib.filterAvailableAgents(lib.DEFAULT_AGENTS);
  if (available.length === 0) throw new Error('SKIP: No agents available');
  const chairman = lib.pickChairman(available);
  assert(typeof chairman.name === 'string', 'chairman should have name');
  assert(Array.isArray(chairman.command), 'chairman should have command array');
}));

// ============================================================================
// Category 4: Agent Utility Functions
// ============================================================================
log('\n=== Category 4: Agent Utility Functions ===');

await runTest(test('4.1 commandExists with valid command', async () => {
  assert(lib.commandExists('node') === true, 'node should exist');
}));

await runTest(test('4.2 commandExists with invalid command', async () => {
  assert(lib.commandExists('nonexistent-cmd-xyz-12345') === false, 'fake command should not exist');
}));

await runTest(test('4.3 filterAvailableAgents empty input', async () => {
  const result = lib.filterAvailableAgents([]);
  assert(result.available.length === 0, 'available should be empty');
  assert(result.unavailable.length === 0, 'unavailable should be empty');
}));

await runTest(test('4.4 filterAvailableAgents categorizes correctly', async () => {
  const agents = [
    { name: 'node-test', command: ['node', '--version'] },
    { name: 'fake', command: ['nonexistent-xyz-cmd'] },
  ];
  const result = lib.filterAvailableAgents(agents);
  assert(result.available.some(a => a.name === 'node-test'), 'node-test should be available');
  assert(result.unavailable.some(a => a.name === 'fake'), 'fake should be unavailable');
}));

await runTest(test('4.5 pickChairman selects from available', async () => {
  const agents = [
    { name: 'agent1', command: ['echo'] },
    { name: 'agent2', command: ['echo'] },
  ];
  const chairman = lib.pickChairman(agents);
  assert(agents.some(a => a.name === chairman.name), 'Chairman should be from input agents');
}));

await runTest(test('4.6 pickChairman with explicit name', async () => {
  const agents = [
    { name: 'agent1', command: ['echo'] },
    { name: 'agent2', command: ['echo'] },
    { name: 'preferred', command: ['echo'] },
  ];
  const chairman = lib.pickChairman(agents, 'preferred');
  assert(chairman.name === 'preferred', 'Should select specified chairman');
}));

// ============================================================================
// Category 5: Prompt Builder Functions
// ============================================================================
log('\n=== Category 5: Prompt Builder Functions ===');

await runTest(test('5.1 buildQuestionWithHistory empty history', async () => {
  const result = lib.buildQuestionWithHistory('Test question', []);
  assert(typeof result === 'string', 'Should return string');
  assert(result.includes('Test question'), 'Should contain original question');
}));

await runTest(test('5.2 buildQuestionWithHistory with history', async () => {
  const history = [{
    question: 'What is X?',
    stage1: [{ agent: 'test', response: 'X is...' }],
    stage3Response: 'X is something',
  }];
  const result = lib.buildQuestionWithHistory('Follow up', history);
  assert(result.includes('Follow up'), 'Should contain new question');
  assert(result !== 'Follow up', 'Should incorporate history context');
}));

await runTest(test('5.3 buildRankingPrompt format', async () => {
  const stage1 = [
    { agent: 'a', response: 'Response A' },
    { agent: 'b', response: 'Response B' },
  ];
  const result = lib.buildRankingPrompt('Test query', stage1);
  assert(typeof result === 'string', 'Should return string');
  assert(result.includes('FINAL RANKING'), 'Should contain FINAL RANKING instruction');
}));

await runTest(test('5.4 buildChairmanPrompt format', async () => {
  const stage1 = [{ agent: 'a', response: 'Response A' }];
  const stage2 = [{ agent: 'a', rankingRaw: 'A > B', parsedRanking: ['A', 'B'] }];
  const result = lib.buildChairmanPrompt('Test query', stage1, stage2);
  assert(typeof result === 'string', 'Should return string');
  assert(result.toLowerCase().includes('chairman'), 'Should reference chairman role');
}));

await runTest(test('5.4a buildChairmanPrompt with outputFormat', async () => {
  const stage1 = [{ agent: 'a', response: 'Response A' }];
  const stage2 = [{ agent: 'a', rankingRaw: 'A > B', parsedRanking: ['A', 'B'] }];
  const outputFormat = 'Output as JSON: {"summary": "...", "items": [...]}';
  const result = lib.buildChairmanPrompt('Test query', stage1, stage2, outputFormat);
  assert(typeof result === 'string', 'Should return string');
  assert(result.includes('OUTPUT FORMAT REQUIREMENTS'), 'Should include format requirements header');
  assert(result.includes('Output as JSON'), 'Should include the outputFormat content');
  assert(result.includes('MUST follow'), 'Should include enforcement instruction');
}));

await runTest(test('5.4b buildChairmanPrompt without outputFormat (backward compatible)', async () => {
  const stage1 = [{ agent: 'a', response: 'Response A' }];
  const stage2 = [{ agent: 'a', rankingRaw: 'A > B', parsedRanking: ['A', 'B'] }];
  const result = lib.buildChairmanPrompt('Test query', stage1, stage2);
  assert(!result.includes('OUTPUT FORMAT REQUIREMENTS'), 'Should not include format section without outputFormat');
  assert(!result.includes('MUST follow'), 'Should not include enforcement without outputFormat');
}));

await runTest(test('5.5 parseRankingFromText parses valid input', async () => {
  const input = 'Analysis...\n\nFINAL RANKING:\n1. Response A\n2. Response B\n3. Response C';
  const result = lib.parseRankingFromText(input);
  assert(Array.isArray(result), 'Should return array');
  assert(result.length === 3, 'Should parse 3 rankings');
  assert(result[0] === 'Response A', 'First should be Response A');
}));

await runTest(test('5.6 parseRankingFromText handles malformed input', async () => {
  const inputs = ['', 'No ranking here', 'FINAL RANKING:', 'random garbage'];
  for (const input of inputs) {
    const result = lib.parseRankingFromText(input);
    assert(Array.isArray(result), `Should return array for: ${input.slice(0, 20)}`);
  }
}));

// ============================================================================
// Category 6: Pipeline Unit Tests
// ============================================================================
log('\n=== Category 6: Pipeline Unit Tests ===');

await runTest(test('6.1 extractStage1 with mock data', async () => {
  const states = [
    { config: { name: 'a', command: [] }, status: 'completed', stdout: ['Output A'], stderr: [] },
    { config: { name: 'b', command: [] }, status: 'completed', stdout: ['Output B'], stderr: [] },
  ];
  const result = lib.extractStage1(states);
  assert(result.length === 2, 'Should extract 2 results');
  assert(result[0].agent === 'a', 'First agent should be a');
  assert(result[0].response === 'Output A', 'First response should match');
}));

await runTest(test('6.2 extractStage1 filters non-completed', async () => {
  const states = [
    { config: { name: 'a', command: [] }, status: 'completed', stdout: ['Output A'], stderr: [] },
    { config: { name: 'b', command: [] }, status: 'error', stdout: [], stderr: ['Error'] },
    { config: { name: 'c', command: [] }, status: 'timeout', stdout: [], stderr: [] },
  ];
  const result = lib.extractStage1(states);
  assert(result.length === 1, 'Should only extract completed');
  assert(result[0].agent === 'a', 'Only agent a should be included');
}));

await runTest(test('6.3 extractStage2 with mock data', async () => {
  const states = [
    {
      config: { name: 'a', command: [] },
      status: 'completed',
      stdout: ['Analysis...\nFINAL RANKING:\n1. Response B\n2. Response A'],
      stderr: []
    },
  ];
  const result = lib.extractStage2(states);
  assert(result.length === 1, 'Should extract 1 result');
  assert(result[0].agent === 'a', 'Agent should be a');
  assert(Array.isArray(result[0].parsedRanking), 'Should have parsedRanking array');
}));

await runTest(test('6.4 calculateAggregateRankings returns sorted array', async () => {
  const stage2 = [
    { agent: 'voter1', rankingRaw: '', parsedRanking: ['Response A', 'Response B', 'Response C'] },
    { agent: 'voter2', rankingRaw: '', parsedRanking: ['Response A', 'Response C', 'Response B'] },
  ];
  const labels = { 'Response A': 'agentA', 'Response B': 'agentB', 'Response C': 'agentC' };
  const result = lib.calculateAggregateRankings(stage2, labels);
  assert(Array.isArray(result), 'Should return array');
  if (result.length > 0) {
    assert('averageRank' in result[0], 'Should have averageRank');
    assert('agent' in result[0], 'Should have agent');
  }
}));

// ============================================================================
// Category 7: Silent Mode & Output Control
// ============================================================================
log('\n=== Category 7: Silent Mode & Output Control ===');

await runTest(test('7.1 silent: true suppresses error output', async () => {
  let output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));

  await lib.runCouncilPipeline('test', [], { name: 'x', command: ['echo'] }, {
    tty: false,
    silent: true,
    timeoutMs: 100,
  }).catch(() => {});

  console.log = originalLog;
  const hasErrorOutput = output.some(o => o.includes('No agent') || o.includes('abort'));
  assert(!hasErrorOutput, 'Silent mode should suppress error messages');
}));

await runTest(test('7.2 silent: false allows error output', async () => {
  let output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));

  await lib.runCouncilPipeline('test', [], { name: 'x', command: ['echo'] }, {
    tty: false,
    silent: false,
    timeoutMs: 100,
  }).catch(() => {});

  console.log = originalLog;
  const hasErrorOutput = output.some(o => o.toLowerCase().includes('no agent') || o.toLowerCase().includes('abort'));
  assert(hasErrorOutput, 'silent: false should allow error messages');
}));

await runTest(test('7.3 runCouncilPipeline with 0 agents returns null', async () => {
  const result = await lib.runCouncilPipeline(
    'test',
    [],
    { name: 'chairman', command: ['echo'] },
    { tty: false, silent: true }
  );
  assert(result === null, 'Should return null with 0 agents');
}));

// ============================================================================
// Category 8: Import Safety
// ============================================================================
log('\n=== Category 8: Import Safety ===');

await runTest(test('8.1 Import lib.js succeeds', async () => {
  const lib2 = await import('../dist/lib.js');
  assert(lib2.runCouncilPipeline, 'Should have runCouncilPipeline');
}));

await runTest(test('8.2 Import index.js does not auto-execute', async () => {
  // This would hang if main() auto-executed
  const idx = await import('../dist/index.js');
  assert(true, 'Import completed without hanging');
}));

// ============================================================================
// Summary
// ============================================================================
log('\n' + '='.repeat(60));
log(`SUMMARY: ${passed} passed, ${failed} failed, ${skipped} skipped`);
log('='.repeat(60));

// Export results for external use
const fs = await import('fs');
const summary = {
  timestamp: new Date().toISOString(),
  passed,
  failed,
  skipped,
  total: passed + failed + skipped,
  results
};
fs.writeFileSync('test-results.json', JSON.stringify(summary, null, 2));
log('\nResults saved to test-results.json');

process.exit(failed > 0 ? 1 : 0);
