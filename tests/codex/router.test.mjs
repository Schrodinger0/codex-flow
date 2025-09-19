import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeTask, routeFiles } from '../../src/router/index.mjs';

test('routeTask matches keywords (openapi → api-docs)', () => {
  const r = routeTask('Please generate openapi spec for my service');
  assert.equal(r.stage === 'keyword' || r.stage === 'regex', true);
  assert.ok(r.candidates.includes('api-docs'));
});

test('routeTask matches regex (design .* architecture → system-architect)', () => {
  const r = routeTask('Design system architecture for the MVP');
  assert.equal(r.stage === 'regex' || r.stage === 'keyword', true);
  assert.ok(r.candidates.includes('system-architect'));
});

test('routeFiles matches file globs (**/*.ts → code-analyzer)', () => {
  const r = routeFiles(['src/server/index.ts']);
  assert.equal(r.stage, 'file');
  assert.ok(r.candidates.includes('code-analyzer'));
});
