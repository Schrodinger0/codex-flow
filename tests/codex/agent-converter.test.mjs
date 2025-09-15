import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertAgentFromMarkdown, convertAllAgents } from '../../src/tools/codex/agent-converter.js';

test('convertAgentFromMarkdown produces expected Codex metadata', () => {
  const root = path.join('/repo', '.claude/agents');
  const filePath = path.join(root, 'development/backend/dev-backend-api.md');
  const markdown = `---\nname: dev-backend-api\ntype: development\ndescription: Backend API implementer\ncapabilities:\n  - implement endpoints\n  - write tests\npriority: high\nmetadata:\n  complexity: moderate\n  autonomous: true\ntriggers:\n  keywords:\n    - backend api\n    - rest endpoint\n  file_patterns:\n    - src/server/**/*.ts\n  task_patterns:\n    - build * api\n  domains:\n    - backend\n    - api\nhooks:\n  pre: echo \\\"Preparing backend task\\\"\ntools:\n  - Read\n  - Write\n---\n# Backend API Developer\n\nHandles backend endpoint implementation tasks and coordinates with testing agents.\n\n- Owns new endpoint creation\n- Ensures coverage\n`;

  const { definition } = convertAgentFromMarkdown(filePath, root, markdown);

  assert.equal(definition.agent.id, 'dev-backend-api');
  assert.equal(definition.agent.name, 'Backend API Developer');
  assert.equal(definition.agent.classification.domain, 'development');
  assert.equal(definition.agent.classification.subdomain, 'backend');
  assert.ok(Math.abs(definition.runtime.autonomy_level - 0.85) < 1e-6);
  assert.equal(definition.runtime.concurrency.max_parallel_tasks, 3);
  assert.deepEqual(definition.capabilities.core, ['implement endpoints', 'write tests']);
  assert.deepEqual(definition.triggers.keywords, ['backend api', 'rest endpoint']);
  assert.deepEqual(definition.triggers.regex[0], { pattern: '^build .* api$', priority: 'medium' });
  assert.equal(definition.workflow.startup_script, 'scripts/start-dev-backend-api.ts');
  assert.deepEqual(definition.hooks.pre_task, ['echo \\"Preparing backend task\\"']);
});

test('convertAllAgents writes outputs and generates indexes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-agents-'));
  const sourceDir = path.join(tmpDir, '.claude/agents');
  const outDir = path.join(tmpDir, 'codex/agents');
  await fs.mkdir(path.join(sourceDir, 'analysis'), { recursive: true });

  const sampleAgent = `---\nname: analyst-token-efficiency\ntype: analyst\ndescription: Token cost analyst\ncapabilities:\n  - analyze usage\n  - recommend optimizations\npriority: medium\ntriggers:\n  keywords: analyze tokens\n  task_patterns:\n    - reduce * tokens\n---\n# Token Efficiency Analyst\n\nFocuses on optimizing token usage.\n`;

  await fs.writeFile(path.join(sourceDir, 'analysis', 'analyst-token-efficiency.md'), sampleAgent, 'utf8');

  const result = await convertAllAgents({
    sourceDir,
    outputDir: outDir,
  });

  assert.equal(result.index.agents.length, 1);
  assert.equal(result.index.agents[0].id, 'analyst-token-efficiency');
  assert.deepEqual(result.triggers.keywords['analyze tokens'], ['analyst-token-efficiency']);

  const defPath = path.join(outDir, 'analysis', 'analyst-token-efficiency.codex.yaml');
  await assert.doesNotReject(fs.stat(defPath));
  await assert.doesNotReject(fs.stat(path.join(outDir, 'index.json')));
  await assert.doesNotReject(fs.stat(path.join(outDir, 'triggers.json')));
});
