<script setup lang="ts">
import type { FlatOperation, OpenApiSpec } from '~/utils/openapi';

const props = defineProps<{
  item: FlatOperation;
  spec?: OpenApiSpec | null;
}>();

const open = ref(false);

const requiresAuth = computed(() => operationRequiresAuth(props.item.operation, props.spec));
const isPublic = computed(() => operationIsPublic(props.item.operation));
const permissionReq = computed(() => routePermissionRequirement(props.item.operation));
const permissionList = computed(() => permissionReq.value?.permissions.join(' or ') ?? '');

// Who may call the endpoint, in words, shown in the expanded body beside the permission.
const accessLabel = computed(() => {
  if (isPublic.value) return 'Public — no authentication required';
  if (permissionReq.value) return permissionReq.value.holders;
  if (requiresAuth.value) return 'Requires authentication';
  return null;
});

const pathParams = computed(() => props.item.parameters.filter((p) => p.in === 'path'));
const queryParams = computed(() => props.item.parameters.filter((p) => p.in === 'query'));
const headerParams = computed(() => props.item.parameters.filter((p) => p.in === 'header'));

const requestBodyEntries = computed(() =>
  Object.entries(props.item.operation.requestBody?.content ?? {}).map(([contentType, media]) => ({
    contentType,
    schema: resolveSchema(media.schema, props.spec),
  })),
);

const responses = computed(() =>
  Object.entries(props.item.operation.responses ?? {}).map(([status, response]) => ({
    status,
    description: response.description,
    entries: Object.entries(response.content ?? {}).map(([contentType, media]) => ({
      contentType,
      schema: resolveSchema(media.schema, props.spec),
    })),
  })),
);

// Split the path so `{param}` segments can be visually distinguished.
const pathSegments = computed(() =>
  props.item.path.split(/(\{[^}]+\})/g).map((text) => ({ text, isParam: text.startsWith('{') })),
);

function responseColor(status: string): string {
  if (status.startsWith('2')) return 'text-success';
  if (status.startsWith('3')) return 'text-info';
  if (status.startsWith('4')) return 'text-warning';
  if (status.startsWith('5')) return 'text-error';
  return 'text-muted';
}
</script>

<template>
  <div :id="item.anchor" class="border border-default rounded-lg bg-elevated/20 scroll-mt-20">
    <button
      type="button"
      class="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
      :aria-expanded="open"
      @click="open = !open"
    >
      <UBadge
        :color="methodBadgeColor(item.method)"
        variant="subtle"
        class="font-mono uppercase shrink-0 w-16 justify-center"
      >
        {{ item.method }}
      </UBadge>
      <code class="font-mono text-sm text-highlighted break-all">
        <span v-for="(seg, i) in pathSegments" :key="i" :class="seg.isParam ? 'text-warning' : ''">{{ seg.text }}</span>
      </code>
      <span class="text-sm text-muted truncate hidden sm:inline flex-1">{{ item.operation.summary }}</span>
      <UBadge
        v-if="permissionReq?.elevated"
        color="warning"
        variant="subtle"
        size="sm"
        icon="i-lucide-shield"
        class="shrink-0 ml-auto sm:ml-0 font-mono"
        :title="`Requires ${permissionList}: ${permissionReq.holders}`"
      >
        {{ permissionList }}
      </UBadge>
      <UBadge v-else-if="isPublic" color="neutral" variant="subtle" size="sm" class="shrink-0 ml-auto sm:ml-0">
        Public
      </UBadge>
      <UIcon
        v-else-if="requiresAuth"
        name="i-lucide-lock"
        class="size-3.5 text-dimmed shrink-0 ml-auto sm:ml-0"
        title="Requires authentication"
      />
      <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 text-dimmed shrink-0" />
    </button>

    <div v-if="open" class="px-3 pb-3 pt-1 space-y-4 border-t border-default">
      <p v-if="item.operation.summary" class="text-sm font-medium text-highlighted sm:hidden">
        {{ item.operation.summary }}
      </p>
      <p v-if="item.operation.description" class="text-sm text-muted">{{ item.operation.description }}</p>

      <!-- Access: the permission the route declares and who holds it -->
      <div v-if="accessLabel" class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        <UIcon
          :name="permissionReq?.elevated ? 'i-lucide-shield' : 'i-lucide-users'"
          class="size-3.5 text-dimmed shrink-0"
        />
        <span class="text-dimmed">Access</span>
        <code v-if="permissionList" class="font-mono text-highlighted">{{ permissionList }}</code>
        <span class="text-muted font-medium">{{ accessLabel }}</span>
      </div>

      <!-- Parameters -->
      <template
        v-for="group in [
          { label: 'Path parameters', params: pathParams },
          { label: 'Query parameters', params: queryParams },
          { label: 'Header parameters', params: headerParams },
        ]"
        :key="group.label"
      >
        <div v-if="group.params.length" class="space-y-1.5">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-dimmed">{{ group.label }}</h4>
          <div class="space-y-2">
            <div v-for="param in group.params" :key="param.name" class="text-sm">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <code class="font-mono text-primary">{{ param.name }}</code>
                <span class="text-xs text-muted font-mono">{{ schemaTypeLabel(param.schema) }}</span>
                <span v-if="param.required" class="text-xs font-medium text-error">required</span>
              </div>
              <p v-if="param.description" class="text-muted mt-0.5">{{ param.description }}</p>
              <p v-if="param.schema?.enum?.length" class="text-xs text-dimmed mt-0.5">
                Allowed values:
                <span class="font-mono">{{ param.schema.enum.map((v) => JSON.stringify(v)).join(', ') }}</span>
              </p>
            </div>
          </div>
        </div>
      </template>

      <!-- Request body -->
      <div v-if="requestBodyEntries.length" class="space-y-1.5">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Request body</h4>
        <div v-for="entry in requestBodyEntries" :key="entry.contentType" class="space-y-1.5">
          <code class="text-xs text-dimmed font-mono">{{ entry.contentType }}</code>
          <ApiSchema v-if="entry.schema" :schema="entry.schema" :spec="spec" />
        </div>
      </div>

      <!-- Responses -->
      <div v-if="responses.length" class="space-y-1.5">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Responses</h4>
        <div v-for="response in responses" :key="response.status" class="text-sm">
          <div class="flex items-baseline gap-2">
            <code class="font-mono font-semibold" :class="responseColor(response.status)">{{ response.status }}</code>
            <span class="text-muted">{{ response.description }}</span>
          </div>
          <div v-for="entry in response.entries" :key="entry.contentType" class="mt-1 pl-3 border-l border-default">
            <code class="text-xs text-dimmed font-mono">{{ entry.contentType }}</code>
            <ApiSchema v-if="entry.schema" :schema="entry.schema" :spec="spec" class="mt-1" />
          </div>
        </div>
      </div>

      <!-- Interactive console + code samples -->
      <ApiTryIt :item="item" :spec="spec" />
    </div>
  </div>
</template>
