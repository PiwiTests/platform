<script setup lang="ts">
import { MCP_TOOL_DEFS } from '#shared/mcp-tools';
import { MCP_PROMPT_DEFS } from '#shared/mcp-prompts';

const config = useRuntimeConfig();
const isDemo = config.public.demoMode;
const isDesktop = useIsDesktop();
const { copy } = useCopy();

// Desktop build only: the local access token is enforced by the desktop guard
// and doubles as the MCP Bearer token (auth is off, so the endpoint accepts any
// caller once the guard has validated the token). When present it fills the URL
// and Bearer value into the client snippets below so there's nothing to swap.
const { data: reporterConfig } = await useFetch<{ url: string; token: string } | null>('/api/desktop/reporter-config', {
  immediate: isDesktop,
  default: () => null,
});

const apiKeyPlaceholder = 'pd_YOUR_API_KEY';
const bearerToken = computed(() => reporterConfig.value?.token ?? apiKeyPlaceholder);

const requestUrl = useRequestURL();
const mcpUrl = computed(() => {
  const base = reporterConfig.value?.url ?? (config.public.siteUrl as string) ?? requestUrl.origin;
  return `${base}/mcp`;
});

useHead({ title: 'MCP server — Piwi Dashboard' });

// Single source of truth: the exact catalog the MCP server exposes over
// `tools/list` (see shared/mcp-tools.ts). New tools appear here automatically.
const tools = MCP_TOOL_DEFS;

// Same for the prompts the server exposes over `prompts/list`
// (see shared/mcp-prompts.ts).
const prompts = MCP_PROMPT_DEFS;

const clientItems = [
  { label: 'Claude Code', slot: 'claude-code' },
  { label: 'Opencode', slot: 'opencode' },
  { label: 'Cursor', slot: 'cursor' },
  { label: 'VS Code', slot: 'vscode' },
  { label: 'Claude Desktop', slot: 'claude-desktop' },
  { label: 'Gemini CLI', slot: 'gemini' },
  { label: 'Windsurf / Continue', slot: 'windsurf' },
];

const claudeCodeSnippet = computed(
  () =>
    `claude mcp add --transport http piwi ${mcpUrl.value} \\\n  --header "Authorization: Bearer ${bearerToken.value}"`,
);

const opencodeSnippet = computed(() =>
  JSON.stringify(
    {
      mcp: {
        piwi: {
          type: 'remote',
          url: mcpUrl.value,
          headers: { Authorization: `Bearer ${bearerToken.value}` },
        },
      },
    },
    null,
    2,
  ),
);

const cursorSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        piwi: {
          url: mcpUrl.value,
          headers: { Authorization: `Bearer ${bearerToken.value}` },
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
          headers: { Authorization: `Bearer ${bearerToken.value}` },
        },
      },
    },
    null,
    2,
  ),
);

// Claude Desktop loads only *stdio* servers from claude_desktop_config.json: an
// entry with a `url` is refused at startup ("… are not valid MCP server
// configurations and were ignored"), so the endpoint goes behind the `mcp-remote`
// bridge. The header travels in `env` because Claude Desktop mangles arguments
// containing spaces.
const claudeDesktopSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        piwi: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            mcpUrl.value,
            '--transport',
            'http-only',
            '--header',
            'Authorization:${AUTH_HEADER}',
          ],
          env: { AUTH_HEADER: `Bearer ${bearerToken.value}` },
        },
      },
    },
    null,
    2,
  ),
);

const geminiSnippet = computed(
  () =>
    `gemini mcp add --transport http piwi ${mcpUrl.value} \\\n  --header "Authorization: Bearer ${bearerToken.value}"`,
);

const windsurfSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        piwi: {
          serverUrl: mcpUrl.value,
          headers: { Authorization: `Bearer ${bearerToken.value}` },
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

        <!-- Desktop shell only: one-click writes into detected clients' config
             files (renders nothing without the IPC bridge). -->
        <DesktopMcpClientsCard />

        <!-- Client setup — the single place to connect any MCP client. On the
             desktop build this also carries the real URL + local access token,
             already baked into every snippet (no placeholder to swap). -->
        <SectionCard icon="i-lucide-settings-2" title="Client setup" help="mcp.client-setup">
          <div v-if="reporterConfig" class="mb-4 space-y-3 rounded-md border border-default bg-elevated/50 p-3">
            <div class="space-y-1">
              <div class="text-xs text-muted">MCP URL</div>
              <div class="flex items-start gap-2">
                <code class="text-xs break-all flex-1">{{ mcpUrl }}</code>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Copy MCP URL"
                  @click="copy(mcpUrl, { toast: true })"
                />
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-xs text-muted">Access token</div>
              <div class="flex items-start gap-2">
                <code class="text-xs break-all flex-1">{{ bearerToken }}</code>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Copy access token"
                  @click="copy(bearerToken, { toast: true })"
                />
              </div>
            </div>
            <p class="text-xs text-muted">
              This app authenticates with a local access token even though sign-in is off — it is the
              <code class="font-mono">Bearer</code> value, already filled into the snippets below.
            </p>
          </div>

          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            <template v-if="reporterConfig"
              >Pick your client below — the URL and access token above are already baked into each snippet.</template
            >
            <template v-else
              >Replace <code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">pd_YOUR_API_KEY</code> with your
              actual API key. The MCP URL shown in the snippets is auto-detected from your current browser
              origin.</template
            >
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

            <!-- Opencode -->
            <template #opencode>
              <div class="space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Add to <code class="font-mono text-xs">~/.config/opencode/opencode.json</code> (global config):
                </p>
                <CodeBlock :code="opencodeSnippet" lang="json" />
                <p class="text-xs text-gray-400">
                  Restart Opencode to pick up the new MCP server. Tools become available automatically in the next
                  session.
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
                  That file only accepts servers started as a local command — pasting a
                  <code class="font-mono">url</code> entry there makes Claude Desktop report it as invalid and ignore
                  it. <code class="font-mono">mcp-remote</code> (needs Node) bridges the HTTP endpoint to that shape.
                  Restart Claude Desktop after saving.
                  <template v-if="reporterConfig"
                    >On this machine, <strong>Connect</strong> above does it without Node — it points Claude Desktop at
                    this app's own bridge.</template
                  >
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

        <!-- What it is -->
        <SectionCard icon="i-lucide-bot" title="What it provides" help="mcp.tools">
          <div class="flex flex-col gap-1.5">
            <div
              v-for="t in tools"
              :key="t.name"
              class="flex items-start gap-3 px-3 py-2.5 rounded-md bg-elevated/50 border border-default hover:bg-elevated transition-colors"
            >
              <UIcon name="i-lucide-wrench" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div class="min-w-0">
                <p class="text-sm font-mono font-semibold text-foreground">{{ t.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t.description }}</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <!-- Prompts -->
        <SectionCard icon="i-lucide-sparkles" title="Prompts">
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Prompts are ready-made instructions your MCP client offers as a slash command — nothing to install.
            <code class="font-mono">setup_piwi</code> is <strong>server-aware</strong>: it fills in this instance's URL,
            whether authentication is required, and the projects that already exist, then hands your agent a
            ready-to-run setup for a Playwright project that is not yet reporting here.
          </p>
          <div class="flex flex-col gap-1.5">
            <div
              v-for="p in prompts"
              :key="p.name"
              class="flex items-start gap-3 px-3 py-2.5 rounded-md bg-elevated/50 border border-default hover:bg-elevated transition-colors"
            >
              <UIcon name="i-lucide-square-slash" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div class="min-w-0">
                <p class="text-sm font-mono font-semibold text-foreground">{{ p.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ p.description }}</p>
                <div v-if="p.arguments?.length" class="flex flex-wrap gap-1.5 mt-1.5">
                  <code
                    v-for="arg in p.arguments"
                    :key="arg.name"
                    class="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono"
                    :title="arg.description"
                  >
                    {{ arg.name }}{{ arg.required ? '' : '?' }}
                  </code>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <!-- Agent skills -->
        <SectionCard icon="i-lucide-graduation-cap" title="Agent skills" help="mcp.skills" data-shot="mcp-agent-skills">
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            The tools above give an agent read access to your results; <strong>skills</strong> tell it what to
            <em>do</em> with them — investigate a failed run, apply a healed locator at its call site, stabilize the
            highest-impact flaky tests. Each skill is a portable <code class="font-mono">SKILL.md</code> file that
            prefers this MCP server and falls back to the dashboard UI. Install them into your test project with the
            reporter CLI (<code class="font-mono">npx @piwitests/reporter init</code>
            already does this as part of setup):
          </p>
          <CodeBlock code="npx @piwitests/reporter skills add" lang="bash" class="mb-3" />
          <DocLink to="features/mcp#agent-skills" class="text-sm">What each skill does</DocLink>
        </SectionCard>

        <!-- Authentication -->
        <SectionCard icon="i-lucide-key" title="Authentication" help="mcp.auth">
          <div class="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <p>
              MCP requests are authenticated with the same API keys used by the REST API. API keys start with
              <code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">pd_</code>.
            </p>
            <p v-if="!isDesktop">
              Generate a key in <strong>Settings → Users → [your account] → API keys</strong>, then replace
              <code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">pd_YOUR_API_KEY</code> in the snippets above.
            </p>
            <p v-else>
              This app provides a local access token automatically — shown in <strong>Client setup</strong> above and
              already filled into every snippet, so there is nothing to replace.
            </p>
            <p v-if="!isDesktop" class="text-xs text-gray-400">
              When authentication is disabled (<code class="font-mono">PIWI_AUTH_ENABLED</code> not set), any request is
              accepted without a key.
            </p>
            <p v-else class="text-xs text-gray-400">
              This desktop app keeps sign-in off but still requires its own local access token on every request — it is
              the <code class="font-mono">Bearer</code> value. The endpoint is not open.
            </p>
          </div>
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
              <template v-if="isDesktop"
                >This desktop app requires its local access token as the <code class="font-mono">Bearer</code> value on
                every request.</template
              >
              <template v-else
                >The server requires a valid Bearer token (or no auth if
                <code class="font-mono">PIWI_AUTH_ENABLED</code> is not set).</template
              >
            </p>
          </div>
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
