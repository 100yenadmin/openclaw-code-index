/**
 * MCP Server (Multi-Repo)
 *
 * Model Context Protocol server that runs on stdio.
 * External AI tools (Cursor, Claude) spawn this process and
 * communicate via stdin/stdout using the MCP protocol.
 *
 * Supports multiple indexed repositories via the global registry.
 *
 * Tools: list_repos, query, cypher, context, impact, detect_changes, rename
 * Resources: repos, repo/{name}/context, repo/{name}/clusters, ...
 */

import { createRequire } from 'module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CompatibleStdioServerTransport } from './compatible-stdio-transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GITNEXUS_TOOLS } from './tools.js';
import { installGlobalStdoutSentinel } from './stdio-context.js';
import type { LocalBackend } from './local/local-backend.js';
import { getResourceDefinitions, getResourceTemplates, readResource } from './resources.js';
import { parseMaxTokens, truncateToTokenBudget } from '../cli/token-budget.js';

const OPENCLAW_READ_ONLY_TOOLS = new Set([
  'list_repos',
  'query',
  'context',
  'impact',
  'detect_changes',
  'cypher',
]);
const BUDGETED_TOOLS = new Set(['query', 'context', 'impact']);
const OPENCLAW_QUERY_LIMIT_MAX = 20;
const OPENCLAW_QUERY_SYMBOLS_MAX = 50;
const OPENCLAW_IMPACT_DEPTH_MAX = 8;
const OPENCLAW_IMPACT_TIMEOUT_MAX = 60_000;

function openclawReadOnlyMode(): boolean {
  return process.env.OPENCLAW_CODE_INDEX_MCP === '1' || process.env.GITNEXUS_MCP_READ_ONLY === '1';
}

function defaultRepo(): string {
  return (
    process.env.OPENCLAW_CODE_INDEX_DEFAULT_REPO || process.env.GITNEXUS_MCP_DEFAULT_REPO || ''
  );
}

function openclawRepoAllowed(repo: string): boolean {
  const configured = process.env.OPENCLAW_CODE_INDEX_ALLOWED_REPOS;
  if (configured) {
    return configured
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .includes(repo);
  }
  return /^openclaw(?:-|$)/u.test(repo);
}

function normalizeArgsForOpenClaw(toolName: string, args: Record<string, any> | undefined) {
  const normalized = { ...(args || {}) };
  if (toolName !== 'list_repos' && !normalized.repo && defaultRepo()) {
    normalized.repo = defaultRepo();
  }
  if (toolName === 'query') {
    normalized.limit = clampPositiveInteger(normalized.limit, OPENCLAW_QUERY_LIMIT_MAX);
    normalized.max_symbols = clampPositiveInteger(
      normalized.max_symbols,
      OPENCLAW_QUERY_SYMBOLS_MAX,
    );
  }
  if (toolName === 'impact') {
    normalized.maxDepth = clampPositiveInteger(normalized.maxDepth, OPENCLAW_IMPACT_DEPTH_MAX);
    normalized.crossDepth = clampPositiveInteger(normalized.crossDepth, OPENCLAW_IMPACT_DEPTH_MAX);
    normalized.timeoutMs = clampPositiveInteger(
      normalized.timeoutMs ?? normalized.timeout,
      OPENCLAW_IMPACT_TIMEOUT_MAX,
    );
    normalized.timeout = undefined;
  }
  return normalized;
}

function assertOpenClawReadOnlyCall(toolName: string, args: Record<string, any> | undefined) {
  if (!openclawReadOnlyMode()) return;
  if (!OPENCLAW_READ_ONLY_TOOLS.has(toolName)) {
    throw new Error(`Tool "${toolName}" is not available in OpenClaw Code Index read-only mode.`);
  }
  const repo = typeof args?.repo === 'string' ? args.repo : '';
  if (repo.startsWith('@')) {
    throw new Error('Group mode is not available in OpenClaw Code Index read-only mode.');
  }
  if (repo && !openclawRepoAllowed(repo)) {
    throw new Error(`Repo "${repo}" is not an OpenClaw Code Index alias.`);
  }
}

function clampPositiveInteger(raw: unknown, max: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return Math.min(value, max);
}

function filterOpenClawToolResult(toolName: string, result: any): any {
  if (!openclawReadOnlyMode() || toolName !== 'list_repos' || !Array.isArray(result)) {
    return result;
  }
  return result.filter((repo) => typeof repo?.name === 'string' && openclawRepoAllowed(repo.name));
}

function toolForMcp(tool: (typeof GITNEXUS_TOOLS)[number]): (typeof GITNEXUS_TOOLS)[number] {
  if (!openclawReadOnlyMode()) return tool;
  if (!['query', 'context', 'impact', 'detect_changes', 'cypher'].includes(tool.name)) return tool;
  return {
    ...tool,
    description: `${tool.description}\n\nOPENCLAW CODE INDEX: This read-only MCP defaults omitted repo parameters to openclaw-latest-release. Pass repo explicitly for openclaw-main, beta/ref aliases, or local-worktree indexes. Use maxTokens on query/context/impact for bounded retrieval slices.`,
  };
}

function assertOpenClawReadOnlyResource(uri: string) {
  if (!openclawReadOnlyMode()) return;
  const match = /^gitnexus:\/\/repo\/([^/]+)/u.exec(uri);
  if (match && !openclawRepoAllowed(decodeURIComponent(match[1]))) {
    throw new Error(
      `Resource repo "${decodeURIComponent(match[1])}" is not an OpenClaw Code Index alias.`,
    );
  }
  if (/^gitnexus:\/\/group\//u.test(uri)) {
    throw new Error('Group resources are not available in OpenClaw Code Index read-only mode.');
  }
}

function applyTokenBudget(
  toolName: string,
  args: Record<string, any> | undefined,
  text: string,
): string {
  if (!BUDGETED_TOOLS.has(toolName)) return text;
  const parsed = parseMaxTokens(args?.maxTokens);
  if (parsed.error) throw new Error(`maxTokens ${parsed.error}`);
  return parsed.value ? truncateToTokenBudget(text, parsed.value) : text;
}

/**
 * Next-step hints appended to tool responses.
 *
 * Agents often stop after one tool call. These hints guide them to the
 * logical next action, creating a self-guiding workflow without hooks.
 *
 * Design: Each hint is a short, actionable instruction (not a suggestion).
 * The hint references the specific tool/resource to use next.
 */
function getNextStepHint(toolName: string, args: Record<string, any> | undefined): string {
  const repo = args?.repo;
  const repoParam = repo ? `, repo: "${repo}"` : '';
  const repoPath = repo || '{name}';

  switch (toolName) {
    case 'list_repos':
      return `\n\n---\n**Next:** READ gitnexus://repo/{name}/context for any repo above to get its overview and check staleness.`;

    case 'query':
      return `\n\n---\n**Next:** To understand a specific symbol in depth, use context({name: "<symbol_name>"${repoParam}}) to see categorized refs and process participation.`;

    case 'context':
      return `\n\n---\n**Next:** If planning changes, use impact({target: "${args?.name || '<name>'}", direction: "upstream"${repoParam}}) to check blast radius. To see execution flows, READ gitnexus://repo/${repoPath}/processes.`;

    case 'impact':
      return `\n\n---\n**Next:** Review d=1 items first (WILL BREAK). To check affected execution flows, READ gitnexus://repo/${repoPath}/processes.`;

    case 'detect_changes':
      return `\n\n---\n**Next:** Review affected processes. Use context() on high-risk changed symbols. READ gitnexus://repo/${repoPath}/process/{name} for full execution traces.`;

    case 'rename':
      return `\n\n---\n**Next:** Run detect_changes(${repoParam ? `{repo: "${repo}"}` : ''}) to verify no unexpected side effects from the rename.`;

    case 'cypher':
      return `\n\n---\n**Next:** To explore a result symbol, use context({name: "<name>"${repoParam}}). For schema reference, READ gitnexus://repo/${repoPath}/schema.`;

    // Legacy tool names — still return useful hints
    case 'search':
      return `\n\n---\n**Next:** To understand a result in context, use context({name: "<symbol_name>"${repoParam}}).`;
    case 'explore':
      return `\n\n---\n**Next:** If planning changes, use impact({target: "<name>", direction: "upstream"${repoParam}}).`;
    case 'overview':
      return `\n\n---\n**Next:** To drill into an area, READ gitnexus://repo/${repoPath}/cluster/{name}. To see execution flows, READ gitnexus://repo/${repoPath}/processes.`;

    default:
      return '';
  }
}

/**
 * Create a configured MCP Server with all handlers registered.
 * Transport-agnostic — caller connects the desired transport.
 */
export function createMCPServer(backend: LocalBackend): Server {
  const require = createRequire(import.meta.url);
  const pkgVersion: string = require('../../package.json').version;
  const server = new Server(
    {
      name: 'gitnexus',
      version: pkgVersion,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // Handle list resources request
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = getResourceDefinitions();
    return {
      resources: resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  // Handle list resource templates request (for dynamic resources)
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const templates = getResourceTemplates();
    return {
      resourceTemplates: templates.map((t) => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      assertOpenClawReadOnlyResource(uri);
      const content = await readResource(uri, backend);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/yaml',
            text: content,
          },
        ],
      };
    } catch (err: any) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Error: ${err.message}`,
          },
        ],
      };
    }
  });

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GITNEXUS_TOOLS.filter(
      (tool) => !openclawReadOnlyMode() || OPENCLAW_READ_ONLY_TOOLS.has(tool.name),
    )
      .map((tool) => toolForMcp(tool))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
  }));

  // Handle tool calls — append next-step hints to guide agent workflow
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const normalizedArgs = normalizeArgsForOpenClaw(
        name,
        args as Record<string, any> | undefined,
      );
      assertOpenClawReadOnlyCall(name, normalizedArgs);
      const result = filterOpenClawToolResult(name, await backend.callTool(name, normalizedArgs));
      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const hint = getNextStepHint(name, normalizedArgs as Record<string, any> | undefined);
      const responseText = applyTokenBudget(name, normalizedArgs, resultText + hint);

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Handle list prompts request
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'detect_impact',
        description:
          'Analyze the impact of your current changes before committing. Guides through scope selection, change detection, process analysis, and risk assessment.',
        arguments: [
          {
            name: 'scope',
            description: 'What to analyze: unstaged, staged, all, or compare',
            required: false,
          },
          { name: 'base_ref', description: 'Branch/commit for compare scope', required: false },
        ],
      },
      ...(!openclawReadOnlyMode()
        ? [
            {
              name: 'generate_map',
              description:
                'Generate architecture documentation from the knowledge graph. Creates a codebase overview with execution flows and mermaid diagrams.',
              arguments: [
                {
                  name: 'repo',
                  description: 'Repository name (omit if only one indexed)',
                  required: false,
                },
              ],
            },
          ]
        : []),
    ],
  }));

  // Handle get prompt request
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'detect_impact') {
      const scope = args?.scope || 'all';
      const baseRef = args?.base_ref || '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Analyze the impact of my current code changes before committing.

Follow these steps:
1. Run \`detect_changes(${JSON.stringify({ scope, ...(baseRef ? { base_ref: baseRef } : {}) })})\` to find what changed and affected processes
2. For each changed symbol in critical processes, run \`context({name: "<symbol>"})\` to see its full reference graph
3. For any high-risk items (many callers or cross-process), run \`impact({target: "<symbol>", direction: "upstream"})\` for blast radius
4. Summarize: changes, affected processes, risk level, and recommended actions

Present the analysis as a clear risk report.`,
            },
          },
        ],
      };
    }

    if (name === 'generate_map') {
      if (openclawReadOnlyMode()) {
        throw new Error(
          'Prompt "generate_map" is not available in OpenClaw Code Index read-only mode.',
        );
      }
      const repo = args?.repo || '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Generate architecture documentation for this codebase using the knowledge graph.

Follow these steps:
1. READ \`gitnexus://repo/${repo || '{name}'}/context\` for codebase stats
2. READ \`gitnexus://repo/${repo || '{name}'}/clusters\` to see all functional areas
3. READ \`gitnexus://repo/${repo || '{name}'}/processes\` to see all execution flows
4. For the top 5 most important processes, READ \`gitnexus://repo/${repo || '{name}'}/process/{name}\` for step-by-step traces
5. Generate a mermaid architecture diagram showing the major areas and their connections
6. Write an ARCHITECTURE.md file with: overview, functional areas, key execution flows, and the mermaid diagram`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}

/**
 * Start the MCP server on stdio transport (for CLI use).
 */
export async function startMCPServer(backend: LocalBackend): Promise<void> {
  const server = createMCPServer(backend);

  // Idempotent global sentinel install. cli/mcp.ts calls this first thing
  // (before warnMissingOptionalGrammars / backend.init can emit to stdout);
  // calling again here is a safety net for direct callers of startMCPServer
  // (tests, future entry points). The transport's _safeStdout Proxy is a
  // second layer that guarantees transport writes reach the sentinel even
  // if anything else re-replaces process.stdout.write later. Tagged
  // transport writes (wrapped in withMcpWrite by compatible-stdio-transport.send)
  // pass through to the captured realStdoutWrite; untagged writes reaching
  // the Proxy or process.stdout get redirected to stderr with the
  // [mcp:stdout-redirect] prefix. See stdio-context.ts.
  const sentinel = installGlobalStdoutSentinel();
  const safeStdout = new Proxy(process.stdout, {
    get(target, prop, receiver) {
      if (prop === 'write') return sentinel.write;
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
  const transport = new CompatibleStdioServerTransport(process.stdin, safeStdout);
  await server.connect(transport);

  // Surface the redirect counter on shutdown so users see the volume of
  // stray writes even when individual payloads were truncated/suppressed.
  process.on('exit', () => sentinel.flushSummary());

  // Graceful shutdown helper. Pino's default destination is `sync: false`
  // (buffered), so we must `flushLoggerSync()` before `process.exit` —
  // otherwise records emitted during disconnect/close are lost. The flush
  // is a no-op when the singleton was never used or when running under
  // vitest. See `gitnexus/src/core/logger.ts`.
  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await backend.disconnect();
    } catch {}
    try {
      await server.close();
    } catch {}
    const { flushLoggerSync } = await import('../core/logger.js');
    flushLoggerSync();
    process.exit(exitCode);
  };

  // Handle graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Log crashes to stderr so they aren't silently lost.
  // uncaughtException is fatal — shut down.
  // unhandledRejection is logged but kept non-fatal (availability-first):
  // killing the server for one missed catch would be worse than logging it.
  process.on('uncaughtException', (err) => {
    process.stderr.write(`GitNexus MCP uncaughtException: ${err?.stack || err}\n`);
    shutdown(1);
  });
  process.on('unhandledRejection', (reason: any) => {
    process.stderr.write(`GitNexus MCP unhandledRejection: ${reason?.stack || reason}\n`);
  });

  // Handle stdio errors — stdin close means the parent process is gone
  process.stdin.on('end', shutdown);
  process.stdin.on('error', () => shutdown());
  process.stdout.on('error', () => shutdown());
}
