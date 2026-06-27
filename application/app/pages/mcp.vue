<script setup lang="ts">
import { MCP_TOOL_DEFS } from '#shared/mcp-tools';

const config = useRuntimeConfig();
const isDemo = config.public.demoMode;

const requestUrl = useRequestURL();
const mcpUrl = computed(() => {
  const base = (config.public.siteUrl as string) || requestUrl.origin;
  return `${base}/mcp`;
});

useHead({ title: 'MCP server — Piwi Dashboard' });

// Single source of truth: the exact catalog the MCP server exposes over
// `tools/list` (see shared/mcp-tools.ts). New tools appear here automatically.
const tools = MCP_TOOL_DEFS;

const clientItems = [
  { label: 'Claude Code', slot: 'claude-code' },
  { label: 'Cursor', slot: 'cursor' },
  { label: 'VS Code', slot: 'vscode' },
  { label: 'Claude Desktop', slot: 'claude-desktop' },
  { label: 'Gemini CLI', slot: 'gemini' },
  { label: 'Windsurf / Continue', slot: 'windsurf' },
];

const claudeCodeSnippet = computed(
  () => `claude mcp add --transport http piwi ${mcpUrl.value} \\\n  --header "Authorization: Bearer pd_YOUR_API_KEY"`,
);

const cursorSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        piwi: {
          url: mcpUrl.value,
          headers: { Authorization: 'Bearer pd_YOUR_API_KEY' },
        },
      },
    },
    null,
    2,
  ),
);

const vscodeSnippet = computed(() =>
  JSON.stringify(
    {
      servers: {
        piwi: {
          type: 'http',
          url: mcpUrl.value,
          headers: { Authorization: 'Bearer pd_YOUR_API_KEY' },
        },
      },
    },
    null,
    2,
  ),
);

const claudeDesktopSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        piwi: {
          type: 'http',
          url: mcpUrl.value,
          headers: { Authorization: 'Bearer pd_YOUR_API_KEY' },
        },
      },
    },
    null,
    2,
  ),
);

const geminiSnippet = computed(
  () => `gemini mcp add --transport http piwi ${mcpUrl.value} \\\n  --header "Authorization: Bearer pd_YOUR_API_KEY"`,
);

const windsurfSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        piwi: {
          serverUrl: mcpUrl.value,
          headers: { Authorization: 'Bearer pd_YOUR_API_KEY' },
        },
      },
    },
    null,
    2,
  ),
);
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="MCP server" />
    </template>

    <template #body>
      <div class="max-w-3xl mx-auto p-6 space-y-6">
        <UAlert
          v-if="isDemo"
          color="info"
          icon="i-lucide-bot"
          title="Feature preview"
          description="The MCP endpoint is not active in this demo — it requires a real Piwi backend. The tools and client setup shown below reflect what your own deployment exposes."
        />

        <!-- What it is -->
        <SectionCard icon="i-lucide-bot" title="What it provides" help="mcp.tools">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div
              v-for="t in tools"
              :key="t.name"
              class="flex items-start gap-2 p-2 rounded-md bg-elevated/50 border border-default"
            >
              <UIcon name="i-lucide-wrench" class="size-3.5 mt-0.5 shrink-0 text-primary" />
              <div>
                <p class="text-xs font-mono font-semibold text-foreground">{{ t.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ t.description }}</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <!-- Authentication -->
        <SectionCard icon="i-lucide-key" title="Authentication" help="mcp.auth">
          <div class="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <p>
              MCP requests are authenticated with the same API keys used by the REST API. API keys start with
              <code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">pd_</code>.
            </p>
            <p>
              Generate a key in <strong>Settings → Users → [your account] → API keys</strong>, then replace
              <code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">pd_YOUR_API_KEY</code> in the snippets below.
            </p>
            <p class="text-xs text-gray-400">
              When authentication is disabled (<code class="font-mono">PIWI_AUTH_ENABLED</code> not set), any request is
              accepted without a key.
            </p>
          </div>
        </SectionCard>

        <!-- Client setup -->
        <SectionCard icon="i-lucide-settings-2" title="Client setup" help="mcp.client-setup">
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Replace <code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">pd_YOUR_API_KEY</code> with your actual
            API key. The MCP URL shown below is auto-detected from your current browser origin.
          </p>

          <UTabs :items="clientItems" :ui="{ list: 'mb-4' }">
            <!-- Claude Code -->
            <template #claude-code>
              <div class="space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Run once in any terminal. Claude Code stores the server in your global MCP config.
                </p>
                <CodeBlock :code="claudeCodeSnippet" lang="sh" />
                <p class="text-xs text-gray-400">
                  After adding, restart Claude Code and use
                  <code class="font-mono">/mcp</code> to verify <strong>piwi</strong> is connected. Claude will call the
                  tools automatically when you ask about test results or failures.
                </p>
              </div>
            </template>

            <!-- Cursor -->
            <template #cursor>
              <div class="space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Add to <code class="font-mono text-xs">~/.cursor/mcp.json</code> (global) or
                  <code class="font-mono text-xs">.cursor/mcp.json</code> in your project root:
                </p>
                <CodeBlock :code="cursorSnippet" lang="json" />
                <p class="text-xs text-gray-400">
                  Restart Cursor, then enable the MCP server in Cursor Settings → MCP.
                </p>
              </div>
            </template>

            <!-- VS Code -->
            <template #vscode>
              <div class="space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Add to <code class="font-mono text-xs">.vscode/mcp.json</code> in your workspace (VS Code Copilot
                  agent mode, version 1.99+):
                </p>
                <CodeBlock :code="vscodeSnippet" lang="json" />
                <p class="text-xs text-gray-400">
                  The server appears in the Copilot chat agent drop-down once the file is saved.
                </p>
              </div>
            </template>

            <!-- Claude Desktop -->
            <template #claude-desktop>
              <div class="space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">Add to your Claude Desktop config file:</p>
                <ul class="text-xs text-gray-400 space-y-0.5 mb-2">
                  <li>
                    <strong>macOS:</strong>
                    <code class="font-mono">~/Library/Application Support/Claude/claude_desktop_config.json</code>
                  </li>
                  <li>
                    <strong>Windows:</strong>
                    <code class="font-mono">%APPDATA%\Claude\claude_desktop_config.json</code>
                  </li>
                </ul>
                <CodeBlock :code="claudeDesktopSnippet" lang="json" />
                <p class="text-xs text-gray-400">
                  Requires Claude Desktop with remote MCP support (released early 2025). Restart the app after saving.
                </p>
              </div>
            </template>

            <!-- Gemini CLI -->
            <template #gemini>
              <div class="space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">Run once to register the server with Gemini CLI:</p>
                <CodeBlock :code="geminiSnippet" lang="sh" />
                <p class="text-xs text-gray-400">
                  Gemini CLI fetches the tool list on startup and makes them available in agent mode.
                </p>
              </div>
            </template>

            <!-- Windsurf / Continue -->
            <template #windsurf>
              <div class="space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Add to your Windsurf or Continue MCP config. For Windsurf:
                  <code class="font-mono text-xs">~/.codeium/windsurf/mcp_config.json</code>. For Continue:
                  <code class="font-mono text-xs">~/.continue/config.json</code> under
                  <code class="font-mono text-xs">mcpServers</code>.
                </p>
                <CodeBlock :code="windsurfSnippet" lang="json" />
              </div>
            </template>
          </UTabs>
        </SectionCard>

        <!-- MCP URL reference -->
        <SectionCard icon="i-lucide-link" title="Server URL">
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <code class="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono break-all">{{ mcpUrl }}</code>
              <UButton
                icon="i-lucide-external-link"
                size="sm"
                color="neutral"
                variant="outline"
                title="Open API docs"
                to="/docs"
                :external="!isDemo"
              >
                REST API docs
              </UButton>
            </div>
            <p class="text-xs text-gray-400">
              This is your Piwi instance's MCP endpoint. It is also the server URL to paste into client configs above.
              The server requires a valid Bearer token (or no auth if
              <code class="font-mono">PIWI_AUTH_ENABLED</code> is not set).
            </p>
          </div>
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
