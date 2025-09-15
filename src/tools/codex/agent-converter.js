import path from 'node:path';
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';

const MAX_DESCRIPTION = 200;

function extractFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: content };
  }

  const [, front, body] = match;
  return { data: parseFrontMatter(front), body };
}

function parseFrontMatter(front) {
  try {
    return (yaml.load(front) || {});
  } catch (error) {
    const sanitized = front.replace(/^(\w[\w-]*):\s+(.+)$/gm, (_, key, value) => {
      const trimmed = value.trim();
      if (trimmed.startsWith('|') || trimmed.startsWith('>') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
        return `${key}: ${value}`;
      }
      const escaped = trimmed.replace(/"/g, '\\"');
      return `${key}: "${escaped}"`;
    });
    return (yaml.load(sanitized) || {});
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTitleCase(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function deriveAgentName(body, fallback) {
  const headingMatch = body.match(/^#\s+(.+)$/m);
  return headingMatch ? headingMatch[1].trim() : toTitleCase(fallback);
}

function extractFirstParagraph(body) {
  return body
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .find((segment) => segment && !segment.startsWith('#')) || '';
}

function truncate(value, length) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function deriveDescription(front, body) {
  const base = front.description || front.metadata?.description;
  const short = base ? String(base) : extractFirstParagraph(body);
  return {
    short: truncate(short, MAX_DESCRIPTION),
    long: base ? extractFirstParagraph(body) : undefined,
  };
}

function deriveTier(typeValue) {
  const value = String(typeValue || '').toLowerCase();
  if (['coordinator', 'coordination', 'orchestration', 'planner', 'planning'].includes(value)) {
    return 'coordinator';
  }
  if (['generalist', 'agent'].includes(value)) {
    return 'generalist';
  }
  if (['architecture', 'architect', 'strategy'].includes(value)) {
    return 'coordinator';
  }
  return 'specialist';
}

function mapPriorityToAutonomy(priority, autonomous) {
  if (autonomous === true) return 0.85;
  if (autonomous === false) return 0.55;
  switch (String(priority || '').toLowerCase()) {
    case 'critical':
      return 0.9;
    case 'high':
      return 0.8;
    case 'medium':
      return 0.65;
    case 'low':
      return 0.5;
    default:
      return 0.6;
  }
}

function mapComplexityToConcurrency(complexity) {
  switch (String(complexity || '').toLowerCase()) {
    case 'complex':
      return { max_parallel_tasks: 2, queue_strategy: 'priority' };
    case 'moderate':
      return { max_parallel_tasks: 3, queue_strategy: 'priority' };
    case 'simple':
      return { max_parallel_tasks: 4, queue_strategy: 'weighted-round-robin' };
    default:
      return { max_parallel_tasks: 3, queue_strategy: 'priority' };
  }
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function deriveTools(front) {
  return {
    allowed: normalizeStringArray(front.tools),
    restricted: normalizeStringArray(front.restricted_tools || front.restrictedTools),
  };
}

function wildcardToRegex(pattern) {
  if (!pattern) return '';
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*');
  return `^${escaped}$`;
}

function deriveTriggers(front) {
  const triggers = front.triggers || {};
  const keywords = normalizeStringArray(triggers.keywords);
  const filePatterns = normalizeStringArray(triggers.file_patterns || triggers.files || triggers.paths);
  const taskPatterns = normalizeStringArray(triggers.task_patterns || triggers.patterns);
  const regex = taskPatterns.map((pattern) => ({ pattern: wildcardToRegex(pattern), priority: 'medium' }));
  const prefers = normalizeStringArray(front.integration?.can_delegate_to);
  const complements = normalizeStringArray(front.integration?.shares_context_with);

  return {
    keywords,
    regex,
    file_patterns: filePatterns,
    delegations: {
      prefers,
      complements,
    },
  };
}

function deriveHooks(front) {
  const hooks = front.hooks || {};
  const format = (value) => {
    if (!value) return [];
    if (typeof value === 'string') return [value.trim()].filter(Boolean);
    return normalizeStringArray(value);
  };
  return {
    pre_task: format(hooks.pre),
    post_task: format(hooks.post),
    failure: format(hooks.failure),
  };
}

function deriveWorkflow(front, agentId) {
  const runtimeDeps = normalizeStringArray(front.runtime_dependencies || front.dependencies?.runtime);
  const packageDeps = normalizeStringArray(front.dependencies?.packages);
  return {
    startup_script: `scripts/start-${agentId}.ts`,
    setup_tasks: [],
    teardown_tasks: [],
    dependencies: {
      runtime: runtimeDeps,
      packages: packageDeps,
    },
  };
}

function deriveMemoryPolicy(front) {
  return {
    retention: {
      short_term: '7d',
      long_term: true,
    },
    namespaces: normalizeStringArray(front.memory?.namespaces),
    sharing_policy: {
      share_with: normalizeStringArray(front.integration?.shares_context_with),
      redact: normalizeStringArray(front.memory?.redact),
    },
  };
}

function deriveMetrics(agentId) {
  return {
    tracked: ['tasks_completed', 'avg_latency_ms', 'success_rate'],
    thresholds: {
      heartbeat_miss: 2,
      failure_rate_pct: 10,
    },
    escalation: {
      notify: [`${agentId}-maintainer`, 'codex-operations'],
    },
  };
}

function deriveResponsibilities(front, body) {
  let primary = normalizeStringArray(front.capabilities);
  let secondary = normalizeStringArray(front.metadata?.specialization);
  if (primary.length === 0) {
    primary = Array.from(body.matchAll(/^[*-]\s+(.+)$/gm)).map(([, text]) => text.trim()).slice(0, 5);
  }
  if (secondary.length === 0 && front.integration?.can_delegate_to) {
    secondary = normalizeStringArray(front.integration.can_delegate_to);
  }
  return { primary, secondary };
}

function deriveCapabilities(front) {
  const core = normalizeStringArray(front.capabilities);
  const quality = {
    reliability: 0.9,
    responsiveness: 0.7,
    quality: 0.9,
  };
  switch (String(front.priority || '').toLowerCase()) {
    case 'critical':
      quality.reliability = 0.97;
      quality.responsiveness = 0.85;
      quality.quality = 0.96;
      break;
    case 'high':
      quality.reliability = 0.94;
      quality.responsiveness = 0.8;
      quality.quality = 0.94;
      break;
    case 'low':
      quality.reliability = 0.85;
      quality.responsiveness = 0.6;
      quality.quality = 0.85;
      break;
    default:
      break;
  }
  return {
    core,
    detail: {
      languages: normalizeStringArray(front.metadata?.languages),
      frameworks: normalizeStringArray(front.metadata?.frameworks),
      domains: normalizeStringArray(front.metadata?.domains || front.triggers?.domains),
      tools: deriveTools(front),
    },
    quality,
  };
}

function deriveObservability(domain, agentId) {
  return {
    log_level: 'info',
    log_channels: [`codex://logs/${domain}`],
    tracing: {
      enabled: true,
      sample_rate: 0.2,
    },
  };
}

export function convertAgentFromMarkdown(filePath, rootDir, content) {
  const { data: front, body } = extractFrontMatter(content);
  const relative = path.relative(rootDir, filePath);
  const domainParts = relative.split(path.sep);
  const fileName = domainParts.pop() || path.basename(relative);
  const domain = domainParts.shift() || 'uncategorized';
  const subdomain = domainParts.length ? domainParts.join('/') : undefined;
  const basename = fileName.replace(/\.md$/i, '');
  const agentId = slugify(front.name || basename);
  const name = deriveAgentName(body, agentId);
  const { short, long } = deriveDescription(front, body);
  const tier = deriveTier(front.type);
  const autonomy = mapPriorityToAutonomy(front.priority, front.metadata?.autonomous);
  const concurrency = mapComplexityToConcurrency(front.metadata?.complexity);

  const classification = {
    domain,
    tier,
  };
  if (subdomain) {
    classification.subdomain = subdomain;
  }

  const definition = {
    version: 1,
    agent: {
      id: agentId,
      name,
      classification,
      description: short,
      long_description: long,
    },
    runtime: {
      execution_mode: 'async',
      autonomy_level: autonomy,
      concurrency,
      resource_limits: {
        cpu: tier === 'coordinator' ? 2 : 1,
        memory_mb: tier === 'coordinator' ? 1024 : 512,
        disk_mb: 1024,
      },
      heartbeat_interval_ms: 15000,
      timeout_ms: 600000,
    },
    capabilities: deriveCapabilities(front),
    responsibilities: deriveResponsibilities(front, body),
    triggers: deriveTriggers(front),
    workflow: deriveWorkflow(front, agentId),
    memory: deriveMemoryPolicy(front),
    metrics: deriveMetrics(agentId),
    hooks: deriveHooks(front),
    testing: deriveTesting(front),
    observability: deriveObservability(domain, agentId),
  };

  const markdown = body.trim();
  const relativePath = path.join(domain, ...(subdomain ? [subdomain] : []), `${agentId}.codex.yaml`);
  return { definition, markdown, relativePath };
}

function deriveTesting(front) {
  const testing = front.testing || {};
  const smoke = testing.smoke ? { command: String(testing.smoke) } : undefined;
  const integration = testing.integration ? { command: String(testing.integration) } : undefined;
  const policy = testing.verification_policy || testing.policy;
  return {
    smoke,
    integration,
    verification_policy: policy ? String(policy) : 'require-smoke-on-spawn',
  };
}

async function collectMarkdownFiles(dir) {
  const results = [];

  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (entry.name === 'README.md' || entry.name === 'MIGRATION_SUMMARY.md') {
          continue;
        }
        results.push(entryPath);
      }
    }
  };

  await walk(dir);
  return results;
}

async function clearOutputDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    return;
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await clearOutputDir(entryPath);
        await fs.rmdir(entryPath).catch(() => undefined);
      } else {
        await fs.unlink(entryPath).catch(() => undefined);
      }
    })
  );
}

export async function convertAllAgents({ sourceDir, outputDir, includeMarkdownBrief = true }) {
  const files = await collectMarkdownFiles(sourceDir);

  const definitions = [];
  const indexEntries = [];
  const triggerKeywordMap = new Map();
  const triggerRegexMap = [];
  const triggerFileMap = new Map();

  await clearOutputDir(outputDir);

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const { definition, markdown, relativePath } = convertAgentFromMarkdown(file, sourceDir, content);
    definitions.push(definition);

    const outFile = path.join(outputDir, relativePath);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, yaml.dump(definition, { lineWidth: 120 }));

    if (includeMarkdownBrief) {
      const markdownPath = outFile.replace(/\.codex\.yaml$/, '.md');
      await fs.writeFile(markdownPath, `${markdown}\n`);
    }

    indexEntries.push({
      id: definition.agent.id,
      name: definition.agent.name,
      domain: definition.agent.classification.domain,
      subdomain: definition.agent.classification.subdomain,
      tier: definition.agent.classification.tier,
      description: definition.agent.description,
      autonomy_level: definition.runtime.autonomy_level,
      max_parallel_tasks: definition.runtime.concurrency.max_parallel_tasks,
      keywords: definition.triggers.keywords,
    });

    for (const keyword of definition.triggers.keywords) {
      if (!triggerKeywordMap.has(keyword)) {
        triggerKeywordMap.set(keyword, new Set());
      }
      triggerKeywordMap.get(keyword).add(definition.agent.id);
    }

    for (const regex of definition.triggers.regex) {
      const existing = triggerRegexMap.find((entry) => entry.pattern === regex.pattern && entry.priority === regex.priority);
      if (existing) {
        existing.agents.add(definition.agent.id);
      } else {
        triggerRegexMap.push({ pattern: regex.pattern, priority: regex.priority, agents: new Set([definition.agent.id]) });
      }
    }

    for (const pattern of definition.triggers.file_patterns) {
      if (!triggerFileMap.has(pattern)) {
        triggerFileMap.set(pattern, new Set());
      }
      triggerFileMap.get(pattern).add(definition.agent.id);
    }
  }

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    agents: indexEntries.sort((a, b) => a.id.localeCompare(b.id)),
  };

  const triggers = {
    keywords: Object.fromEntries(Array.from(triggerKeywordMap.entries()).map(([keyword, agents]) => [keyword, Array.from(agents).sort()])),
    regex: triggerRegexMap.map((entry) => ({ pattern: entry.pattern, priority: entry.priority, agents: Array.from(entry.agents).sort() })),
    file_patterns: Object.fromEntries(Array.from(triggerFileMap.entries()).map(([pattern, agents]) => [pattern, Array.from(agents).sort()])),
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'index.json'), JSON.stringify(index, null, 2));
  await fs.writeFile(path.join(outputDir, 'triggers.json'), JSON.stringify(triggers, null, 2));

  return { definitions, index, triggers };
}
