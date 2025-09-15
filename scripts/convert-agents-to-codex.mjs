import path from 'node:path';
import { convertAllAgents } from '../src/tools/codex/agent-converter.js';

async function run() {
  const sourceDir = path.resolve(process.cwd(), '.claude/agents');
  const outputDir = path.resolve(process.cwd(), 'codex/agents');

  const { index, triggers } = await convertAllAgents({
    sourceDir,
    outputDir,
    includeMarkdownBrief: true,
  });

  console.log(`Converted agents written to ${outputDir}`);
  console.log(`Index contains ${index.agents.length} agents`);
  console.log(`Trigger keywords tracked: ${Object.keys(triggers.keywords).length}`);
}

run().catch((error) => {
  console.error('Failed to convert agents to Codex schema');
  console.error(error);
  process.exitCode = 1;
});
