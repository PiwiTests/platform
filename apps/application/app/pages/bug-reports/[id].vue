<script setup lang="ts">
/**
 * One bug report: what was reported (the steps, what should have happened and
 * what the page showed), where its lifecycle stands, and the failing test to
 * commit. Tabs: Steps, Evidence, Reproductions, Spec.
 */
import type { BugReportDetail } from '#shared/handlers/bug-reports';
import type { DetailTabItem } from '~/components/shared/DetailPageLayout.vue';
import { describeExpectation, expectedSteps } from '@piwitests/core/bug-report';
import { BUG_REPORT_STATUS, capitalize, reproductionPlace, verdictLabel } from '~/utils/bug-reports';

const route = useRoute();
const toast = useToast();
const { canWrite } = useAuth();
const { hasTracker } = useTrackerStatus();
const issueModalOpen = ref(false);
function onIssueCreated() {
  issueModalOpen.value = false;
  void refresh();
}
const reportId = Number(route.params.id);

const { data: report, error, refresh } = await useFetch<BugReportDetail>(`/api/bug-reports/${reportId}`);

useHead(computed(() => ({ title: `${report.value?.title ?? 'Bug report'} — Piwi Dashboard` })));

const EDGE: Record<BugReportDetail['status'], string> = {
  open: 'var(--color-status-failed)',
  'test-committed': 'var(--color-status-didnotrun)',
  'looks-fixed': 'var(--color-status-passed)',
  closed: 'var(--color-status-skipped)',
  dismissed: 'var(--color-status-skipped)',
};

const statusInfo = computed(() => (report.value ? BUG_REPORT_STATUS[report.value.status] : null));

/** The first expectation, the report's claim in one line. */
const claim = computed(() => {
  const r = report.value;
  if (!r) return null;
  const [first] = expectedSteps({ v: 1, steps: r.steps, evidence: r.evidence, context: r.context });
  if (!first) return null;
  return { text: describeExpectation(first.step), actual: first.step.assertion?.actual ?? null, step: first.index };
});

const next = computed(() => {
  const r = report.value;
  if (!r) return '';
  switch (r.status) {
    case 'open':
      return 'Commit the failing test from the Spec tab: it keeps the suite green while the bug exists and follows the fix.';
    case 'test-committed':
      return 'Fix the bug. The test’s next pass while still marked test.fail() moves this report to looks fixed.';
    case 'looks-fixed':
      return 'Remove test.fail() from the test with the fix; its next ordinary pass closes the report.';
    default:
      return '';
  }
});

const lastTry = computed(() => report.value?.reproductionList.at(-1) ?? null);

const TABS = ['steps', 'evidence', 'reproductions', 'spec'];
const activeTab = ref(TABS.includes(String(route.query.tab)) ? String(route.query.tab) : 'steps');
const router = useRouter();
watch(activeTab, (tab) => void router.replace({ query: { ...route.query, tab: tab === 'steps' ? undefined : tab } }));
const tabItems = computed<DetailTabItem[]>(() => [
  { label: 'Steps', icon: 'i-lucide-list-ordered', value: 'steps' },
  { label: 'Evidence', icon: 'i-lucide-paperclip', value: 'evidence' },
  {
    label: `Reproductions (${report.value?.reproductions ?? 0})`,
    icon: 'i-lucide-repeat',
    value: 'reproductions',
  },
  { label: 'Spec', icon: 'i-lucide-file-code', value: 'spec' },
]);

const updating = ref(false);
async function setStatus(status: 'open' | 'dismissed') {
  updating.value = true;
  try {
    await $fetch(`/api/bug-reports/${reportId}`, { method: 'PATCH', body: { status } });
    await refresh();
  } catch {
    toast.add({ title: 'Could not update the report', color: 'error' });
  } finally {
    updating.value = false;
  }
}
</script>

<template>
  <UDashboardPanel id="bug-report">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(report
                ? [
                    { label: report.projectName, to: `/projects/${report.projectId}` },
                    { label: 'Bug reports', to: `/projects/${report.projectId}/bug-reports` },
                  ]
                : []),
              { label: `#${reportId}` },
            ]"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ErrorState v-if="error" class="p-4" text="Could not load this bug report." />
      <DetailPageLayout v-else-if="report" v-model="activeTab" :tab-items="tabItems">
        <template #summary>
          <SituationBlock help="project.bug-reports" :edge="EDGE[report.status]">
            <template #identity>
              <span>Bug report #{{ report.id }}</span>
            </template>
            <template v-if="canWrite" #actions>
              <UButton
                v-if="hasTracker && !report.ticket"
                size="xs"
                icon="i-simple-icons-jira"
                data-shot="bug-report-create-issue"
                @click="issueModalOpen = true"
              >
                Create issue
              </UButton>
              <UButton
                v-if="report.status !== 'dismissed'"
                color="neutral"
                variant="ghost"
                size="xs"
                :loading="updating"
                @click="setStatus('dismissed')"
              >
                Dismiss
              </UButton>
              <UButton v-else color="neutral" variant="ghost" size="xs" :loading="updating" @click="setStatus('open')">
                Reopen
              </UButton>
            </template>
            <template #headline>
              <h1 class="text-lg sm:text-xl font-semibold leading-snug text-highlighted break-words">
                {{ report.title }}
              </h1>
            </template>
            <template v-if="claim" #situation>
              <p data-shot="bug-report-claim">
                <BugPhraseText :text="capitalize(claim.text)" /><template v-if="claim.actual != null"
                  >; the page showed "{{ claim.actual }}"</template
                >.
              </p>
            </template>
            <template #state>
              <p>
                <UBadge :color="statusInfo!.color" variant="subtle" class="mr-1.5">{{ statusInfo!.label }}</UBadge>
                {{ statusInfo!.hint }}
                <template v-if="report.test">
                  The test is
                  <NuxtLink :to="`/test-cases/${report.test.id}`" :class="SENTENCE_LINK_CLASS">{{
                    report.test.title
                  }}</NuxtLink>
                  in <span class="font-mono">{{ report.test.filePath }}</span
                  >.
                </template>
                <template v-if="report.ticket">
                  Filed as
                  <a :href="report.ticket.url" target="_blank" rel="noopener noreferrer" :class="SENTENCE_LINK_CLASS">{{
                    report.ticket.key
                  }}</a
                  ><template v-if="report.ticket.statusText"> ({{ report.ticket.statusText }})</template>.
                </template>
                <template v-if="lastTry">
                  Last try: {{ verdictLabel(lastTry.verdict, lastTry.divergedAt).toLowerCase() }}
                  <template v-if="reproductionPlace(lastTry.origin)">
                    on {{ reproductionPlace(lastTry.origin) }}</template
                  >.
                </template>
              </p>
            </template>
            <template v-if="next" #next>
              <p>{{ next }}</p>
            </template>
            <template #facts>
              <span v-if="report.path" class="font-mono">{{ report.origin ?? '' }}{{ report.path }}</span>
              <template v-if="report.context.browser"> · {{ report.context.browser }}</template>
              <template v-if="report.reportedBy"> · reported by {{ report.reportedBy }}</template>
              · <ClientDate :date="report.createdAt" />
            </template>
          </SituationBlock>
        </template>

        <template #tab-steps>
          <div class="p-4">
            <BugReportSteps :steps="report.steps" />
          </div>
        </template>

        <template #tab-evidence>
          <div class="p-4">
            <BugReportEvidence :report="report" />
          </div>
        </template>

        <template #tab-reproductions>
          <div class="p-4">
            <EmptyState
              v-if="report.reproductionList.length === 0"
              icon="i-lucide-repeat"
              text="Nobody has tried it again yet: Replay in Piwi Picker plays the steps in a developer’s own tab and records what it found here."
            />
            <ul v-else class="divide-y divide-default" data-shot="bug-report-reproductions">
              <li v-for="r in report.reproductionList" :key="r.id" class="py-2">
                <p class="text-sm text-highlighted">
                  {{ verdictLabel(r.verdict, r.divergedAt) }}
                  <template v-if="reproductionPlace(r.origin)"> on {{ reproductionPlace(r.origin) }}</template>
                  <span class="text-muted"> · {{ r.source === 'desktop' ? 'with Playwright' : 'replay' }}</span>
                </p>
                <p class="text-xs text-muted">
                  <template v-if="r.by">{{ r.by }} · </template><ClientDate :date="r.createdAt" />
                  <template v-if="r.runId">
                    · <NuxtLink :to="`/test-runs/${r.runId}`" :class="SENTENCE_LINK_CLASS">run #{{ r.runId }}</NuxtLink>
                  </template>
                </p>
              </li>
            </ul>
          </div>
        </template>

        <template #tab-spec>
          <div class="p-4">
            <BugReportSpec :report-id="report.id" :project-id="report.projectId" />
          </div>
        </template>
      </DetailPageLayout>
      <CreateIssueModal
        v-if="report"
        v-model:open="issueModalOpen"
        entity-type="bug_report"
        :entity-id="report.id"
        @created="onIssueCreated"
        @linked="onIssueCreated"
      />
    </template>
  </UDashboardPanel>
</template>
