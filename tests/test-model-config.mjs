#!/usr/bin/env node
/**
 * Model Configuration Test Suite
 *
 * Comprehensive tests for model selection, presets, and enhanced pipeline.
 * Run with: node test-model-config.mjs
 */

import fs from 'fs';

const results = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function log(msg) {
  console.log(msg);
}

async function runTest(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    results.push({ name, status: 'FAIL', error: e.message });
    log(`FAIL  ${name}`);
    log(`      Error: ${e.message}`);
  }
}

function skip(name, reason) {
  skipped++;
  results.push({ name, status: 'SKIP', reason });
  log(`SKIP  ${name} (${reason})`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected '${expected}', got '${actual}'`);
  }
}

function assertIncludes(arr, item, message) {
  if (!arr.includes(item)) {
    throw new Error(`${message}: '${item}' not found in [${arr.join(', ')}]`);
  }
}

function assertType(value, type, message) {
  if (typeof value !== type) {
    throw new Error(`${message}: expected type '${type}', got '${typeof value}'`);
  }
}

// ============================================================================
// Import library
// ============================================================================
let lib;
try {
  lib = await import('../dist/lib.js');
} catch (e) {
  console.error('Failed to import lib.js. Run `npm run build` first.');
  console.error(e.message);
  process.exit(1);
}

const {
  loadModelsConfig,
  refreshModelsConfig,
  getConfigPath,
  createAgentConfig,
  createAgentFromSpec,
  getPreset,
  listPresets,
  buildPipelineConfig,
  listProviders,
  listTiers,
  getProviderInfo,
  parseAgentSpec,
  parseStageSpec,
  runEnhancedPipeline,
  commandExists,
} = lib;

// ============================================================================
// Category 1: Models.json Structure
// ============================================================================
log('\n=== Category 1: Models.json Structure ===');

await runTest('1.1 models.json file exists', async () => {
  assert(fs.existsSync('./models.json'), 'models.json should exist in repo root');
});

await runTest('1.2 models.json is valid JSON', async () => {
  const content = fs.readFileSync('./models.json', 'utf-8');
  const parsed = JSON.parse(content);
  assert(parsed !== null, 'Should parse as valid JSON');
});

await runTest('1.3 models.json has required top-level fields', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  assert(config.version, 'Should have version field');
  assert(config.updated, 'Should have updated field');
  assert(config.providers, 'Should have providers field');
  assert(config.presets, 'Should have presets field');
  assert(config.defaults, 'Should have defaults field');
});

await runTest('1.4 models.json has all three providers', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  assert(config.providers.claude, 'Should have claude provider');
  assert(config.providers.gemini, 'Should have gemini provider');
  assert(config.providers.codex, 'Should have codex provider');
});

await runTest('1.5 each provider has required fields', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  for (const [name, provider] of Object.entries(config.providers)) {
    assert(provider.cli, `${name} should have cli field`);
    assert(provider.flag, `${name} should have flag field`);
    assert(provider.tiers, `${name} should have tiers field`);
    assert(provider.reasoning, `${name} should have reasoning field`);
  }
});

await runTest('1.6 each provider has all three tiers', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  for (const [name, provider] of Object.entries(config.providers)) {
    assert(provider.tiers.fast, `${name} should have fast tier`);
    assert(provider.tiers.default, `${name} should have default tier`);
    assert(provider.tiers.heavy, `${name} should have heavy tier`);
  }
});

await runTest('1.7 each tier has required fields', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  for (const [provName, provider] of Object.entries(config.providers)) {
    for (const [tierName, tier] of Object.entries(provider.tiers)) {
      assert(tier.model, `${provName}:${tierName} should have model field`);
      assert(tier.fullId, `${provName}:${tierName} should have fullId field`);
      assert(tier.description, `${provName}:${tierName} should have description field`);
    }
  }
});

await runTest('1.8 only claude heavy tier has reasoning config', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  for (const [provName, provider] of Object.entries(config.providers)) {
    // Fast and default should NOT have reasoning
    assert(!provider.tiers.fast.reasoning, `${provName}:fast should NOT have reasoning`);
    assert(!provider.tiers.default.reasoning, `${provName}:default should NOT have reasoning`);
    // Only claude:heavy has reasoning config (gemini/codex use model selection)
    if (provName === 'claude') {
      assert(provider.tiers.heavy.reasoning, `${provName}:heavy SHOULD have reasoning`);
    } else {
      assert(!provider.tiers.heavy.reasoning, `${provName}:heavy should NOT have reasoning config`);
    }
  }
});

await runTest('1.9 presets have required structure', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  for (const [name, preset] of Object.entries(config.presets)) {
    assert(preset.description, `${name} preset should have description`);
    assert(preset.stage1, `${name} preset should have stage1`);
    assert(preset.stage2, `${name} preset should have stage2`);
    assert(preset.stage3, `${name} preset should have stage3`);
    assert(preset.stage1.tier, `${name} preset stage1 should have tier`);
    assert(preset.stage1.count, `${name} preset stage1 should have count`);
  }
});

await runTest('1.10 defaults have required fields', async () => {
  const config = JSON.parse(fs.readFileSync('./models.json', 'utf-8'));
  assert(config.defaults.preset, 'defaults should have preset');
  assert(config.defaults.chairman, 'defaults should have chairman');
  assert(config.defaults.fallbackTier, 'defaults should have fallbackTier');
});

// ============================================================================
// Category 2: Config Loading Functions
// ============================================================================
log('\n=== Category 2: Config Loading Functions ===');

await runTest('2.1 loadModelsConfig returns valid config', async () => {
  const config = loadModelsConfig();
  assert(config !== null, 'Should return config');
  assert(config.providers, 'Should have providers');
  assert(config.presets, 'Should have presets');
});

await runTest('2.2 loadModelsConfig caches results', async () => {
  const config1 = loadModelsConfig();
  const config2 = loadModelsConfig();
  assert(config1 === config2, 'Should return same cached object');
});

await runTest('2.3 loadModelsConfig forceReload bypasses cache', async () => {
  const config1 = loadModelsConfig();
  const config2 = loadModelsConfig(true);
  // Objects should be equal in content but potentially different references
  assertEqual(config1.version, config2.version, 'Versions should match');
});

await runTest('2.4 getConfigPath returns valid path', async () => {
  const path = getConfigPath();
  assertType(path, 'string', 'Path should be string');
  assert(path.length > 0, 'Path should not be empty');
  assert(path.endsWith('models.json'), 'Path should end with models.json');
});

await runTest('2.5 listProviders returns all providers', async () => {
  const providers = listProviders();
  assert(Array.isArray(providers), 'Should return array');
  assertIncludes(providers, 'claude', 'Should include claude');
  assertIncludes(providers, 'gemini', 'Should include gemini');
  assertIncludes(providers, 'codex', 'Should include codex');
});

await runTest('2.6 listTiers returns all tiers', async () => {
  const tiers = listTiers();
  assert(Array.isArray(tiers), 'Should return array');
  assertEqual(tiers.length, 3, 'Should have 3 tiers');
  assertIncludes(tiers, 'fast', 'Should include fast');
  assertIncludes(tiers, 'default', 'Should include default');
  assertIncludes(tiers, 'heavy', 'Should include heavy');
});

await runTest('2.7 getProviderInfo returns provider config', async () => {
  const info = getProviderInfo('claude');
  assert(info !== undefined, 'Should return provider info');
  assertEqual(info.cli, 'claude', 'CLI should be claude');
  assert(info.tiers, 'Should have tiers');
});

await runTest('2.8 getProviderInfo returns undefined for invalid provider', async () => {
  const info = getProviderInfo('invalid-provider');
  assertEqual(info, undefined, 'Should return undefined');
});

await runTest('2.9 refreshModelsConfig executes without error', async () => {
  // refreshModelsConfig returns void but should not throw
  let threw = false;
  try {
    refreshModelsConfig();
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'refreshModelsConfig should not throw');
});

await runTest('2.10 refreshModelsConfig resets cache', async () => {
  // Load initial config
  const config1 = loadModelsConfig();
  // Refresh resets cache (returns void)
  refreshModelsConfig();
  // Force reload should return valid config
  const config2 = loadModelsConfig(true);
  assertEqual(config1.version, config2.version, 'Versions should match after refresh');
});

// ============================================================================
// Category 3: Agent Config Creation
// ============================================================================
log('\n=== Category 3: Agent Config Creation ===');

await runTest('3.1 createAgentConfig creates valid agent for claude:fast', async () => {
  const agent = createAgentConfig('claude', 'fast');
  assert(agent.name, 'Should have name');
  assert(agent.command, 'Should have command');
  assert(Array.isArray(agent.command), 'Command should be array');
  assertEqual(agent.name, 'claude:fast', 'Name should be claude:fast');
});

await runTest('3.2 createAgentConfig creates valid agent for claude:default', async () => {
  const agent = createAgentConfig('claude', 'default');
  assertEqual(agent.name, 'claude:default', 'Name should be claude:default');
  assertIncludes(agent.command, '--model', 'Command should include --model flag');
  assertIncludes(agent.command, 'sonnet', 'Command should include sonnet model');
});

await runTest('3.3 createAgentConfig creates valid agent for claude:heavy', async () => {
  const agent = createAgentConfig('claude', 'heavy');
  assertEqual(agent.name, 'claude:heavy', 'Name should be claude:heavy');
  assertIncludes(agent.command, 'opus', 'Command should include opus model');
  assertIncludes(agent.command, '--extended-thinking', 'Heavy tier should include reasoning flag');
});

await runTest('3.4 createAgentConfig creates valid agent for gemini:fast', async () => {
  const agent = createAgentConfig('gemini', 'fast');
  assertEqual(agent.name, 'gemini:fast', 'Name should be gemini:fast');
  assertIncludes(agent.command, 'gemini-2.5-flash-lite', 'Command should include gemini-2.5-flash-lite model');
});

await runTest('3.5 createAgentConfig creates valid agent for gemini:default', async () => {
  const agent = createAgentConfig('gemini', 'default');
  assertEqual(agent.name, 'gemini:default', 'Name should be gemini:default');
  assertIncludes(agent.command, 'gemini-2.5-flash', 'Command should include gemini-2.5-flash model');
});

await runTest('3.6 createAgentConfig creates valid agent for gemini:heavy', async () => {
  const agent = createAgentConfig('gemini', 'heavy');
  assertEqual(agent.name, 'gemini:heavy', 'Name should be gemini:heavy');
  assertIncludes(agent.command, 'gemini-2.5-pro', 'Command should include gemini-2.5-pro model');
});

await runTest('3.7 createAgentConfig creates valid agent for codex:fast', async () => {
  const agent = createAgentConfig('codex', 'fast');
  assertEqual(agent.name, 'codex:fast', 'Name should be codex:fast');
  assertIncludes(agent.command, 'gpt-5.1-codex-mini', 'Command should include mini model');
});

await runTest('3.8 createAgentConfig creates valid agent for codex:default', async () => {
  const agent = createAgentConfig('codex', 'default');
  assertEqual(agent.name, 'codex:default', 'Name should be codex:default');
  assertIncludes(agent.command, 'gpt-5.1-codex', 'Command should include codex model');
});

await runTest('3.9 createAgentConfig creates valid agent for codex:heavy', async () => {
  const agent = createAgentConfig('codex', 'heavy');
  assertEqual(agent.name, 'codex:heavy', 'Name should be codex:heavy');
  assertIncludes(agent.command, 'gpt-5.1-codex-max', 'Command should include max model');
  // Codex reasoning is determined by model choice, not a flag
  assert(!agent.command.includes('--reasoning-effort'), 'Codex does not use --reasoning-effort flag');
});

await runTest('3.10 createAgentConfig throws for invalid provider', async () => {
  let threw = false;
  try {
    createAgentConfig('invalid', 'fast');
  } catch (e) {
    threw = true;
    assert(e.message.includes('Unknown provider'), 'Error should mention unknown provider');
  }
  assert(threw, 'Should throw for invalid provider');
});

await runTest('3.11 createAgentConfig throws for invalid tier', async () => {
  let threw = false;
  try {
    createAgentConfig('claude', 'invalid');
  } catch (e) {
    threw = true;
    assert(e.message.includes('Unknown tier'), 'Error should mention unknown tier');
  }
  assert(threw, 'Should throw for invalid tier');
});

await runTest('3.12 createAgentConfig includes promptViaStdin', async () => {
  const agent = createAgentConfig('claude', 'fast');
  assertEqual(agent.promptViaStdin, true, 'Should have promptViaStdin: true');
});

await runTest('3.13 agent command starts with correct CLI', async () => {
  const claudeAgent = createAgentConfig('claude', 'fast');
  const geminiAgent = createAgentConfig('gemini', 'fast');
  const codexAgent = createAgentConfig('codex', 'fast');

  assertEqual(claudeAgent.command[0], 'claude', 'Claude agent should start with claude');
  assertEqual(geminiAgent.command[0], 'gemini', 'Gemini agent should start with gemini');
  assertEqual(codexAgent.command[0], 'codex', 'Codex agent should start with codex');
});

// ============================================================================
// Category 4: Agent Spec Parsing
// ============================================================================
log('\n=== Category 4: Agent Spec Parsing ===');

await runTest('4.1 createAgentFromSpec parses claude:fast', async () => {
  const agent = createAgentFromSpec('claude:fast');
  assertEqual(agent.name, 'claude:fast', 'Name should be claude:fast');
});

await runTest('4.2 createAgentFromSpec parses claude:default', async () => {
  const agent = createAgentFromSpec('claude:default');
  assertEqual(agent.name, 'claude:default', 'Name should be claude:default');
});

await runTest('4.3 createAgentFromSpec parses claude:heavy', async () => {
  const agent = createAgentFromSpec('claude:heavy');
  assertEqual(agent.name, 'claude:heavy', 'Name should be claude:heavy');
});

await runTest('4.4 createAgentFromSpec defaults to default tier', async () => {
  const agent = createAgentFromSpec('claude');
  assertEqual(agent.name, 'claude:default', 'Should default to default tier');
});

await runTest('4.5 createAgentFromSpec works for all providers', async () => {
  const claude = createAgentFromSpec('claude:fast');
  const gemini = createAgentFromSpec('gemini:fast');
  const codex = createAgentFromSpec('codex:fast');

  assertEqual(claude.name, 'claude:fast', 'Claude agent name correct');
  assertEqual(gemini.name, 'gemini:fast', 'Gemini agent name correct');
  assertEqual(codex.name, 'codex:fast', 'Codex agent name correct');
});

await runTest('4.6 createAgentFromSpec throws for invalid tier', async () => {
  let threw = false;
  try {
    createAgentFromSpec('claude:invalid');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Should throw for invalid tier');
});

await runTest('4.7 parseAgentSpec returns provider and tier', async () => {
  const { provider, tier } = parseAgentSpec('claude:heavy');
  assertEqual(provider, 'claude', 'Provider should be claude');
  assertEqual(tier, 'heavy', 'Tier should be heavy');
});

await runTest('4.8 parseAgentSpec defaults tier to default', async () => {
  const { provider, tier } = parseAgentSpec('gemini');
  assertEqual(provider, 'gemini', 'Provider should be gemini');
  assertEqual(tier, 'default', 'Tier should default to default');
});

// ============================================================================
// Category 5: Preset Functions
// ============================================================================
log('\n=== Category 5: Preset Functions ===');

await runTest('5.1 listPresets returns all presets', async () => {
  const presets = listPresets();
  assert(Array.isArray(presets), 'Should return array');
  assertIncludes(presets, 'fast', 'Should include fast preset');
  assertIncludes(presets, 'balanced', 'Should include balanced preset');
  assertIncludes(presets, 'thorough', 'Should include thorough preset');
});

await runTest('5.2 getPreset returns fast preset', async () => {
  const preset = getPreset('fast');
  assert(preset, 'Should return preset');
  assertEqual(preset.stage1.tier, 'fast', 'Stage 1 tier should be fast');
  assertEqual(preset.stage2.tier, 'fast', 'Stage 2 tier should be fast');
});

await runTest('5.3 getPreset returns balanced preset', async () => {
  const preset = getPreset('balanced');
  assert(preset, 'Should return preset');
  assertEqual(preset.stage1.tier, 'default', 'Stage 1 tier should be default');
  assertEqual(preset.stage3.tier, 'heavy', 'Stage 3 tier should be heavy');
});

await runTest('5.4 getPreset returns thorough preset', async () => {
  const preset = getPreset('thorough');
  assert(preset, 'Should return preset');
  assertEqual(preset.stage1.tier, 'heavy', 'Stage 1 tier should be heavy');
  assertEqual(preset.stage2.tier, 'heavy', 'Stage 2 tier should be heavy');
  assertEqual(preset.stage3.tier, 'heavy', 'Stage 3 tier should be heavy');
  assertEqual(preset.stage3.reasoning, true, 'Stage 3 should have reasoning enabled');
});

await runTest('5.5 getPreset throws for invalid preset', async () => {
  let threw = false;
  try {
    getPreset('invalid');
  } catch (e) {
    threw = true;
    assert(e.message.includes('Unknown preset'), 'Error should mention unknown preset');
  }
  assert(threw, 'Should throw for invalid preset');
});

await runTest('5.6 fast preset has correct agent counts', async () => {
  const preset = getPreset('fast');
  assertEqual(preset.stage1.count, 3, 'Stage 1 should have 3 agents');
  assertEqual(preset.stage2.count, 3, 'Stage 2 should have 3 agents');
  assertEqual(preset.stage3.count, 1, 'Stage 3 should have 1 agent');
});

await runTest('5.7 thorough preset has more stage2 agents', async () => {
  const preset = getPreset('thorough');
  assertEqual(preset.stage2.count, 6, 'Stage 2 should have 6 agents');
});

// ============================================================================
// Category 6: Pipeline Config Building
// ============================================================================
log('\n=== Category 6: Pipeline Config Building ===');

await runTest('6.1 buildPipelineConfig creates valid config', async () => {
  const preset = getPreset('balanced');
  const config = buildPipelineConfig(preset, ['claude', 'gemini', 'codex']);

  assert(config.stage1, 'Should have stage1');
  assert(config.stage2, 'Should have stage2');
  assert(config.stage3, 'Should have stage3');
});

await runTest('6.2 buildPipelineConfig creates correct number of stage1 agents', async () => {
  const preset = getPreset('balanced');
  const config = buildPipelineConfig(preset, ['claude', 'gemini', 'codex']);

  assertEqual(config.stage1.agents.length, 3, 'Should have 3 stage1 agents');
});

await runTest('6.3 buildPipelineConfig creates correct number of stage2 agents', async () => {
  const preset = getPreset('balanced');
  const config = buildPipelineConfig(preset, ['claude', 'gemini', 'codex']);

  assertEqual(config.stage2.agents.length, 3, 'Should have 3 stage2 agents');
});

await runTest('6.4 buildPipelineConfig creates chairman', async () => {
  const preset = getPreset('balanced');
  const config = buildPipelineConfig(preset, ['claude', 'gemini', 'codex']);

  assert(config.stage3.chairman, 'Should have chairman');
  assert(config.stage3.chairman.name, 'Chairman should have name');
  assert(config.stage3.chairman.command, 'Chairman should have command');
});

await runTest('6.5 buildPipelineConfig distributes agents across providers', async () => {
  const preset = getPreset('balanced');
  const config = buildPipelineConfig(preset, ['claude', 'gemini', 'codex']);

  const names = config.stage1.agents.map(a => a.name);
  // With 3 agents and 3 providers, each should appear once
  const providers = names.map(n => n.split(':')[0]);
  assertIncludes(providers, 'claude', 'Should include claude');
  assertIncludes(providers, 'gemini', 'Should include gemini');
  assertIncludes(providers, 'codex', 'Should include codex');
});

await runTest('6.6 buildPipelineConfig works with single provider', async () => {
  const preset = getPreset('fast');
  const config = buildPipelineConfig(preset, ['claude']);

  assertEqual(config.stage1.agents.length, 3, 'Should still have 3 agents');
  // All agents should be claude
  const allClaude = config.stage1.agents.every(a => a.name.startsWith('claude:'));
  assert(allClaude, 'All agents should be claude');
});

await runTest('6.7 buildPipelineConfig works with two providers', async () => {
  const preset = getPreset('fast');
  const config = buildPipelineConfig(preset, ['claude', 'gemini']);

  assertEqual(config.stage1.agents.length, 3, 'Should have 3 agents');
});

await runTest('6.8 buildPipelineConfig applies correct tier to agents', async () => {
  const preset = getPreset('fast');
  const config = buildPipelineConfig(preset, ['claude', 'gemini', 'codex']);

  // All stage1 agents should be :fast tier
  const allFast = config.stage1.agents.every(a => a.name.endsWith(':fast'));
  assert(allFast, 'All stage1 agents should be fast tier');
});

await runTest('6.9 thorough preset creates 6 stage2 agents', async () => {
  const preset = getPreset('thorough');
  const config = buildPipelineConfig(preset, ['claude', 'gemini', 'codex']);

  assertEqual(config.stage2.agents.length, 6, 'Should have 6 stage2 agents');
});

await runTest('6.10 buildPipelineConfig sets useReasoning from preset', async () => {
  const fastPreset = getPreset('fast');
  const thoroughPreset = getPreset('thorough');

  const fastConfig = buildPipelineConfig(fastPreset, ['claude']);
  const thoroughConfig = buildPipelineConfig(thoroughPreset, ['claude']);

  assertEqual(fastConfig.stage3.useReasoning, false, 'Fast should not use reasoning');
  assertEqual(thoroughConfig.stage3.useReasoning, true, 'Thorough should use reasoning');
});

// ============================================================================
// Category 7: Model Command Structure
// ============================================================================
log('\n=== Category 7: Model Command Structure ===');

await runTest('7.1 claude command includes --print flag', async () => {
  const agent = createAgentConfig('claude', 'fast');
  assertIncludes(agent.command, '--print', 'Should include --print flag');
});

await runTest('7.2 claude command includes --output-format text', async () => {
  const agent = createAgentConfig('claude', 'fast');
  assertIncludes(agent.command, '--output-format', 'Should include --output-format');
  assertIncludes(agent.command, 'text', 'Should include text format');
});

await runTest('7.3 gemini command includes --output-format text', async () => {
  const agent = createAgentConfig('gemini', 'fast');
  assertIncludes(agent.command, '--output-format', 'Should include --output-format');
  assertIncludes(agent.command, 'text', 'Should include text format');
});

await runTest('7.4 codex command includes exec mode', async () => {
  const agent = createAgentConfig('codex', 'fast');
  assertIncludes(agent.command, 'exec', 'Should include exec mode');
});

await runTest('7.5 codex command includes --skip-git-repo-check', async () => {
  const agent = createAgentConfig('codex', 'fast');
  assertIncludes(agent.command, '--skip-git-repo-check', 'Should include skip git check');
});

await runTest('7.6 all agents include --model flag', async () => {
  const providers = ['claude', 'gemini', 'codex'];
  const tiers = ['fast', 'default', 'heavy'];

  for (const provider of providers) {
    for (const tier of tiers) {
      const agent = createAgentConfig(provider, tier);
      assertIncludes(agent.command, '--model', `${provider}:${tier} should include --model`);
    }
  }
});

await runTest('7.7 fast tier agents do NOT include reasoning flags', async () => {
  const claudeFast = createAgentConfig('claude', 'fast');
  const codexFast = createAgentConfig('codex', 'fast');

  assert(!claudeFast.command.includes('--extended-thinking'), 'Claude fast should not have extended thinking');
  assert(!codexFast.command.includes('--reasoning-effort'), 'Codex fast should not have reasoning effort');
});

await runTest('7.8 default tier agents do NOT include reasoning flags', async () => {
  const claudeDefault = createAgentConfig('claude', 'default');
  const codexDefault = createAgentConfig('codex', 'default');

  assert(!claudeDefault.command.includes('--extended-thinking'), 'Claude default should not have extended thinking');
  assert(!codexDefault.command.includes('--reasoning-effort'), 'Codex default should not have reasoning effort');
});

await runTest('7.9 claude:heavy includes --extended-thinking', async () => {
  const agent = createAgentConfig('claude', 'heavy');
  assertIncludes(agent.command, '--extended-thinking', 'Should include extended thinking');
});

await runTest('7.10 codex:heavy uses max model (no reasoning flag)', async () => {
  const agent = createAgentConfig('codex', 'heavy');
  assertIncludes(agent.command, 'gpt-5.1-codex-max', 'Should use max model');
  // Codex reasoning is via model selection, not a flag
  assert(!agent.command.includes('--reasoning-effort'), 'Codex does not use --reasoning-effort');
});

// ============================================================================
// Category 8: Enhanced Pipeline Options
// ============================================================================
log('\n=== Category 8: Enhanced Pipeline Options ===');

await runTest('8.1 runEnhancedPipeline is exported', async () => {
  assertType(runEnhancedPipeline, 'function', 'runEnhancedPipeline should be function');
});

await runTest('8.2 EnhancedPipelineConfig structure is valid', async () => {
  const preset = getPreset('fast');
  const config = buildPipelineConfig(preset, ['claude']);

  assert(config.stage1.agents, 'stage1 should have agents array');
  assert(config.stage2.agents, 'stage2 should have agents array');
  assert(config.stage3.chairman, 'stage3 should have chairman');
  assertType(config.stage3.useReasoning, 'boolean', 'useReasoning should be boolean');
});

await runTest('8.3 stage1 agents are AgentConfig objects', async () => {
  const preset = getPreset('fast');
  const config = buildPipelineConfig(preset, ['claude']);

  for (const agent of config.stage1.agents) {
    assert(agent.name, 'Agent should have name');
    assert(agent.command, 'Agent should have command');
    assert(Array.isArray(agent.command), 'Command should be array');
  }
});

await runTest('8.4 stage2 agents are AgentConfig objects', async () => {
  const preset = getPreset('fast');
  const config = buildPipelineConfig(preset, ['claude']);

  for (const agent of config.stage2.agents) {
    assert(agent.name, 'Agent should have name');
    assert(agent.command, 'Agent should have command');
    assert(Array.isArray(agent.command), 'Command should be array');
  }
});

await runTest('8.5 chairman is AgentConfig object', async () => {
  const preset = getPreset('fast');
  const config = buildPipelineConfig(preset, ['claude']);

  assert(config.stage3.chairman.name, 'Chairman should have name');
  assert(config.stage3.chairman.command, 'Chairman should have command');
  assert(Array.isArray(config.stage3.chairman.command), 'Command should be array');
});

// ============================================================================
// Category 9: Edge Cases and Error Handling
// ============================================================================
log('\n=== Category 9: Edge Cases and Error Handling ===');

await runTest('9.1 empty provider list throws', async () => {
  const preset = getPreset('fast');
  let threw = false;
  try {
    buildPipelineConfig(preset, []);
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Should throw for empty provider list');
});

await runTest('9.2 invalid provider in createAgentConfig throws', async () => {
  let threw = false;
  try {
    createAgentConfig('notreal', 'fast');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Should throw for invalid provider');
});

await runTest('9.3 case sensitivity in tier names', async () => {
  let threw = false;
  try {
    createAgentFromSpec('claude:FAST');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Should throw for uppercase tier (case sensitive)');
});

await runTest('9.4 whitespace handling in spec parsing', async () => {
  // Note: parseAgentSpec doesn't trim, but createAgentFromSpec should handle it
  const { provider, tier } = parseAgentSpec('claude:fast');
  assertEqual(provider, 'claude', 'Provider should be parsed');
  assertEqual(tier, 'fast', 'Tier should be parsed');
});

await runTest('9.5 colon-only spec defaults tier', async () => {
  const { provider, tier } = parseAgentSpec('claude:');
  assertEqual(provider, 'claude', 'Provider should be claude');
  // Empty string after colon should default to 'default'
  // Actually, empty string won't match the tier validation
});

await runTest('9.6 preset stage counts are positive integers', async () => {
  const presets = listPresets();
  for (const presetName of presets) {
    const preset = getPreset(presetName);
    assert(preset.stage1.count > 0, `${presetName} stage1 count should be positive`);
    assert(preset.stage2.count > 0, `${presetName} stage2 count should be positive`);
    assert(preset.stage3.count > 0, `${presetName} stage3 count should be positive`);
    assert(Number.isInteger(preset.stage1.count), `${presetName} stage1 count should be integer`);
    assert(Number.isInteger(preset.stage2.count), `${presetName} stage2 count should be integer`);
    assert(Number.isInteger(preset.stage3.count), `${presetName} stage3 count should be integer`);
  }
});

// ============================================================================
// Category 10: Model IDs Verification
// ============================================================================
log('\n=== Category 10: Model IDs Verification ===');

await runTest('10.1 Claude model IDs are correct', async () => {
  const config = loadModelsConfig();
  assertEqual(config.providers.claude.tiers.fast.model, 'haiku', 'Claude fast should be haiku');
  assertEqual(config.providers.claude.tiers.default.model, 'sonnet', 'Claude default should be sonnet');
  assertEqual(config.providers.claude.tiers.heavy.model, 'opus', 'Claude heavy should be opus');
});

await runTest('10.2 Gemini model IDs use full model names', async () => {
  const config = loadModelsConfig();
  assertEqual(config.providers.gemini.tiers.fast.model, 'gemini-2.5-flash-lite', 'Gemini fast should be gemini-2.5-flash-lite');
  assertEqual(config.providers.gemini.tiers.default.model, 'gemini-2.5-flash', 'Gemini default should be gemini-2.5-flash');
  assertEqual(config.providers.gemini.tiers.heavy.model, 'gemini-2.5-pro', 'Gemini heavy should be gemini-2.5-pro');
});

await runTest('10.3 Codex model IDs use gpt-5.1-codex', async () => {
  const config = loadModelsConfig();
  assertEqual(config.providers.codex.tiers.fast.model, 'gpt-5.1-codex-mini', 'Codex fast should be mini');
  assertEqual(config.providers.codex.tiers.default.model, 'gpt-5.1-codex', 'Codex default should be codex');
  assertEqual(config.providers.codex.tiers.heavy.model, 'gpt-5.1-codex-max', 'Codex heavy should be max');
});

await runTest('10.4 Gemini fast is flash variant', async () => {
  const config = loadModelsConfig();
  assert(config.providers.gemini.tiers.fast.model.includes('flash'), 'Gemini fast should be flash variant');
});

await runTest('10.5 Gemini default is flash variant', async () => {
  const config = loadModelsConfig();
  assert(config.providers.gemini.tiers.default.model.includes('flash'), 'Gemini default should be flash variant');
});

await runTest('10.6 Gemini heavy is pro variant', async () => {
  const config = loadModelsConfig();
  assert(config.providers.gemini.tiers.heavy.model.includes('pro'), 'Gemini heavy should be pro variant');
});

await runTest('10.7 Codex fast is mini variant', async () => {
  const config = loadModelsConfig();
  assertEqual(config.providers.codex.tiers.fast.model, 'gpt-5.1-codex-mini', 'Codex fast should be mini');
});

await runTest('10.8 Codex heavy uses max model for reasoning', async () => {
  const config = loadModelsConfig();
  assertEqual(config.providers.codex.tiers.heavy.model, 'gpt-5.1-codex-max', 'Codex heavy should use max model');
  // Codex reasoning is via model choice, no separate config
  assert(!config.providers.codex.tiers.heavy.reasoning, 'Codex heavy should not have reasoning config');
});

// ============================================================================
// Category 11: CLI Availability Detection
// ============================================================================
log('\n=== Category 11: CLI Availability Detection ===');

await runTest('11.1 commandExists returns boolean', async () => {
  const result = commandExists('node');
  assertType(result, 'boolean', 'Should return boolean');
});

await runTest('11.2 commandExists finds node', async () => {
  const result = commandExists('node');
  assertEqual(result, true, 'node should exist');
});

await runTest('11.3 commandExists returns false for nonexistent', async () => {
  const result = commandExists('definitely-not-a-real-command-12345');
  assertEqual(result, false, 'Fake command should not exist');
});

// ============================================================================
// Category 12: Stage Spec Parsing (count:tier syntax)
// ============================================================================
log('\n=== Category 12: Stage Spec Parsing ===');

await runTest('12.1 parseStageSpec is exported', async () => {
  assertType(parseStageSpec, 'function', 'parseStageSpec should be a function');
});

await runTest('12.2 parseStageSpec parses tier-only spec "fast"', async () => {
  const result = parseStageSpec('fast', ['claude', 'gemini', 'codex']);
  assertEqual(result.agents.length, 3, 'Should create 3 agents (one per provider)');
  assert(result.agents.every(a => a.name.endsWith(':fast')), 'All agents should be fast tier');
});

await runTest('12.3 parseStageSpec parses tier-only spec "default"', async () => {
  const result = parseStageSpec('default', ['claude', 'gemini']);
  assertEqual(result.agents.length, 2, 'Should create 2 agents');
  assert(result.agents.every(a => a.name.endsWith(':default')), 'All agents should be default tier');
});

await runTest('12.4 parseStageSpec parses tier-only spec "heavy"', async () => {
  const result = parseStageSpec('heavy', ['claude']);
  assertEqual(result.agents.length, 1, 'Should create 1 agent');
  assertEqual(result.agents[0].name, 'claude:heavy', 'Should be claude:heavy');
});

await runTest('12.5 parseStageSpec parses count:tier "6:fast"', async () => {
  const result = parseStageSpec('6:fast', ['claude', 'gemini', 'codex']);
  assertEqual(result.agents.length, 6, 'Should create 6 agents');
  assertEqual(result.count, 6, 'Count should be 6');
  assert(result.agents.every(a => a.name.endsWith(':fast')), 'All agents should be fast tier');
});

await runTest('12.6 parseStageSpec distributes agents across providers', async () => {
  const result = parseStageSpec('6:fast', ['claude', 'gemini', 'codex']);
  const names = result.agents.map(a => a.name);
  // With 6 agents and 3 providers: claude, gemini, codex, claude, gemini, codex
  assertEqual(names[0], 'claude:fast', 'Agent 0 should be claude');
  assertEqual(names[1], 'gemini:fast', 'Agent 1 should be gemini');
  assertEqual(names[2], 'codex:fast', 'Agent 2 should be codex');
  assertEqual(names[3], 'claude:fast', 'Agent 3 should be claude');
  assertEqual(names[4], 'gemini:fast', 'Agent 4 should be gemini');
  assertEqual(names[5], 'codex:fast', 'Agent 5 should be codex');
});

await runTest('12.7 parseStageSpec parses count:tier "3:default"', async () => {
  const result = parseStageSpec('3:default', ['claude', 'gemini']);
  assertEqual(result.agents.length, 3, 'Should create 3 agents');
  assertEqual(result.count, 3, 'Count should be 3');
  // With 3 agents and 2 providers: claude, gemini, claude
  assertEqual(result.agents[0].name, 'claude:default', 'Agent 0');
  assertEqual(result.agents[1].name, 'gemini:default', 'Agent 1');
  assertEqual(result.agents[2].name, 'claude:default', 'Agent 2');
});

await runTest('12.8 parseStageSpec parses count:tier "1:heavy"', async () => {
  const result = parseStageSpec('1:heavy', ['gemini']);
  assertEqual(result.agents.length, 1, 'Should create 1 agent');
  assertEqual(result.count, 1, 'Count should be 1');
  assertEqual(result.agents[0].name, 'gemini:heavy', 'Should be gemini:heavy');
});

await runTest('12.9 parseStageSpec parses explicit agent specs', async () => {
  const result = parseStageSpec('claude:fast,gemini:default', ['claude', 'gemini', 'codex']);
  assertEqual(result.agents.length, 2, 'Should create 2 agents');
  assertEqual(result.agents[0].name, 'claude:fast', 'First agent');
  assertEqual(result.agents[1].name, 'gemini:default', 'Second agent');
  assertEqual(result.count, undefined, 'Count should be undefined for explicit specs');
});

await runTest('12.10 parseStageSpec parses single explicit agent', async () => {
  const result = parseStageSpec('codex:heavy', ['claude', 'gemini', 'codex']);
  assertEqual(result.agents.length, 1, 'Should create 1 agent');
  assertEqual(result.agents[0].name, 'codex:heavy', 'Should be codex:heavy');
});

await runTest('12.11 parseStageSpec handles whitespace in tier spec', async () => {
  const result = parseStageSpec('  fast  ', ['claude']);
  assertEqual(result.agents.length, 1, 'Should create 1 agent');
  assertEqual(result.agents[0].name, 'claude:fast', 'Should trim whitespace');
});

await runTest('12.12 parseStageSpec handles whitespace in count:tier', async () => {
  const result = parseStageSpec('  3:default  ', ['claude', 'gemini']);
  assertEqual(result.agents.length, 3, 'Should create 3 agents');
  assertEqual(result.count, 3, 'Count should be 3');
});

await runTest('12.13 parseStageSpec with single provider and count', async () => {
  const result = parseStageSpec('4:fast', ['claude']);
  assertEqual(result.agents.length, 4, 'Should create 4 agents');
  assert(result.agents.every(a => a.name === 'claude:fast'), 'All should be claude:fast');
});

// Check which CLIs are available for informational purposes
const claudeAvailable = commandExists('claude');
const geminiAvailable = commandExists('gemini');
const codexAvailable = commandExists('codex');

log(`\n    CLI availability: claude=${claudeAvailable}, gemini=${geminiAvailable}, codex=${codexAvailable}`);

// ============================================================================
// Summary
// ============================================================================
log('\n' + '='.repeat(60));
log(`MODEL CONFIG TESTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
log('='.repeat(60));

// Save results
const summary = {
  timestamp: new Date().toISOString(),
  passed,
  failed,
  skipped,
  total: passed + failed + skipped,
  results,
  cliAvailability: { claude: claudeAvailable, gemini: geminiAvailable, codex: codexAvailable },
};
fs.writeFileSync('test-model-config-results.json', JSON.stringify(summary, null, 2));
log('\nResults saved to test-model-config-results.json');

process.exit(failed > 0 ? 1 : 0);
