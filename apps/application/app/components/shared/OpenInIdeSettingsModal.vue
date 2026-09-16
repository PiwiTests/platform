<script setup lang="ts">
/**
 * Per-browser configuration for the "Open in IDE" affordance — which method to
 * use, the local workspace root that maps a repo-relative path to an absolute
 * one, the VS Code flavor, and the JetBrains product/port. Persisted to
 * localStorage via `useOpenInIde`; never sent to the server (the source lives on
 * the visitor's machine, so the mapping is inherently per-device).
 *
 * Mounted once (in the default layout) and toggled from the file-path chooser
 * and the user menu through the composable's shared `settingsOpen` state.
 */
import {
  IDE_METHOD_LABELS,
  JETBRAINS_PRODUCTS,
  VSCODE_SCHEME_LABELS,
  type IdeMethod,
} from '~/composables/useOpenInIde';
import type { VscodeScheme } from '~/utils/ide-links';

const { prefs, settingsOpen, settingsContext } = useOpenInIde();

const methodItems = (Object.keys(IDE_METHOD_LABELS) as IdeMethod[]).map((value) => ({
  label: IDE_METHOD_LABELS[value],
  value,
}));
const schemeItems = (Object.keys(VSCODE_SCHEME_LABELS) as VscodeScheme[]).map((value) => ({
  label: VSCODE_SCHEME_LABELS[value],
  value,
}));

const showVscode = computed(() => prefs.value.method === 'auto' || prefs.value.method === 'vscode');
const showJetbrains = computed(() => prefs.value.method !== 'vscode');

const projectKey = computed(() => settingsContext.value.projectKey ?? null);
const projectLabel = computed(
  () => settingsContext.value.projectName || (projectKey.value ? `project ${projectKey.value}` : ''),
);

/** Bind a per-project map entry, deleting the key when the field is cleared. */
function mapEntry(map: 'projectRoots' | 'jetbrainsProjectNames') {
  return computed<string>({
    get: () => (projectKey.value ? (prefs.value[map][projectKey.value] ?? '') : ''),
    set: (val) => {
      const k = projectKey.value;
      if (!k) return;
      const next = { ...prefs.value[map] };
      if (val.trim()) next[k] = val;
      else delete next[k];
      prefs.value[map] = next;
    },
  });
}
const projectRoot = mapEntry('projectRoots');
const projectJbName = mapEntry('jetbrainsProjectNames');
</script>

<template>
  <UModal v-model:open="settingsOpen" :ui="{ content: 'max-w-lg' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-external-link" class="size-5 text-primary" />
        <h2 class="text-base font-semibold">Open in IDE</h2>
        <HelpHint topic="ide.open" />
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Click a source path anywhere in the dashboard to open it in your editor. These preferences are stored in this
          browser only.
        </p>

        <UFormField
          label="Method"
          name="method"
          description="Auto probes the JetBrains local server first, then falls back to a URL launch."
        >
          <USelect v-model="prefs.method" :items="methodItems" class="w-full" />
        </UFormField>

        <UFormField
          label="Workspace root"
          name="defaultRoot"
          description="Absolute path to your local checkout — repo-relative paths are joined onto it (VS Code needs this)."
        >
          <UInput v-model="prefs.defaultRoot" placeholder="/home/me/my-repo" class="w-full" />
        </UFormField>

        <UFormField v-if="showVscode" label="VS Code flavor" name="vscodeScheme">
          <USelect v-model="prefs.vscodeScheme" :items="schemeItems" class="w-full" />
        </UFormField>

        <template v-if="showJetbrains">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="JetBrains product" name="jetbrainsProduct" description="e.g. idea, webstorm, pycharm.">
              <UInput v-model="prefs.jetbrainsProduct" placeholder="idea" list="jb-products" class="w-full" />
              <datalist id="jb-products">
                <option v-for="p in JETBRAINS_PRODUCTS" :key="p" :value="p" />
              </datalist>
            </UFormField>
            <UFormField label="Local server port" name="jetbrainsPort" description="Remote Control plugin.">
              <UInput v-model.number="prefs.jetbrainsPort" type="number" class="w-full" />
            </UFormField>
          </div>
          <UFormField name="jetbrainsHttpUsesRelativePath">
            <div class="flex items-center gap-2">
              <USwitch v-model="prefs.jetbrainsHttpUsesRelativePath" />
              <span class="text-sm">Send a content-root-relative path to the local server</span>
            </div>
          </UFormField>
        </template>

        <template v-if="projectKey">
          <USeparator />
          <p class="text-xs font-medium text-muted uppercase tracking-wider">Override for {{ projectLabel }}</p>
          <UFormField
            label="Workspace root override"
            name="projectRoot"
            description="Use a different local folder for this project (monorepos, multiple checkouts)."
          >
            <UInput v-model="projectRoot" :placeholder="prefs.defaultRoot || '/home/me/this-project'" class="w-full" />
          </UFormField>
          <UFormField
            v-if="showJetbrains"
            label="JetBrains project name"
            name="projectJbName"
            description="The open IDE project name for the jetbrains:// link."
          >
            <UInput v-model="projectJbName" :placeholder="projectLabel" class="w-full" />
          </UFormField>
        </template>

        <UAlert
          v-if="showJetbrains"
          color="neutral"
          variant="soft"
          icon="i-lucide-info"
          title="JetBrains prerequisites"
          description="The jetbrains:// link needs JetBrains Toolbox. The local server needs the IDE Remote Control plugin with 'Allow unsigned requests', and browsers block it when this dashboard is served over HTTPS."
        />

        <div class="flex items-center justify-between pt-1">
          <DocLink to="features/ide-integration">Learn more</DocLink>
          <UButton color="neutral" @click="settingsOpen = false">Done</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
