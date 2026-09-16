import type { Ref } from 'vue';
import type { DiagnosisContextCoverage } from '~~/types/api';

/**
 * Derives the one-line SCM status behind the cluster page's "What changed" line —
 * the icon, color, headline and detail describing how the baseline diff resolved
 * (provider, file/patch counts, or why it's unavailable). Takes the
 * cluster-diagnosis `coverage` ref so it works both inside a component (which
 * injects it) and on the page itself (which owns the provided store and cannot
 * inject its own provide).
 */
export function useScmStatusSummary(coverage: Ref<DiagnosisContextCoverage | null>) {
  const scmStatus = computed(() => {
    const scm = coverage.value?.scm;
    if (!scm)
      return { color: 'text-gray-400', icon: 'i-lucide-git-branch', text: 'Git context unavailable', detail: '' };

    if (scm.baseCommitUsed) {
      if (scm.filesCount === 0) {
        return {
          color: 'text-yellow-500',
          icon: 'i-lucide-git-branch-plus',
          text: `Manual baseline ${scm.baseCommitUsed.slice(0, 7)} · fetch failed`,
          detail: 'network error or missing SCM token (check AI settings)',
        };
      }
      const patchNote = scm.patchesOmitted
        ? ', no patches (diff too large)'
        : scm.patchesTruncated
          ? `, ${scm.patchedFilesCount} with patches (some cut)`
          : `, ${scm.patchedFilesCount} with patches`;
      return {
        color: 'text-blue-500',
        icon: 'i-lucide-git-branch-plus',
        text: `Manual baseline ${scm.baseCommitUsed.slice(0, 7)} · ${scm.filesCount} files${patchNote}`,
        detail: scm.hasLastGreen ? 'overrides last passing run baseline' : 'no last passing run',
      };
    }

    if (!scm.hasLastGreen)
      return {
        color: 'text-gray-400',
        icon: 'i-lucide-git-branch',
        text: 'No last passing run',
        detail: 'pick a baseline commit to enable the diff',
      };
    if (!scm.hasCommitRange)
      return {
        color: 'text-gray-400',
        icon: 'i-lucide-git-branch',
        text: 'No commit range',
        detail: 'reporter did not send SCM metadata',
      };
    if (!scm.provider)
      return {
        color: 'text-yellow-500',
        icon: 'i-lucide-git-branch',
        text: 'Unsupported SCM host',
        detail: 'only GitHub, GitLab and Bitbucket are supported',
      };
    if (scm.filesCount === 0)
      return {
        color: 'text-yellow-500',
        icon: 'i-lucide-git-branch',
        text: `${scm.provider} · fetch failed`,
        detail: 'network error or missing SCM token (check AI settings)',
      };
    if (scm.patchesOmitted) {
      return {
        color: 'text-yellow-500',
        icon: 'i-lucide-git-branch',
        text: `${scm.provider} · ${scm.filesCount} files`,
        detail: 'diff too large — file list only, no patches',
      };
    }
    const patchNote = scm.patchesTruncated ? ', some patches cut (budget)' : '';
    const commitNote = scm.commitsCount > 0 ? ` · ${scm.commitsCount} commit${scm.commitsCount > 1 ? 's' : ''}` : '';
    return {
      color: 'text-green-500',
      icon: 'i-lucide-git-branch',
      text: `${scm.provider} · ${scm.filesCount} files · ${scm.patchedFilesCount} with patches${patchNote}${commitNote}`,
      detail: '',
    };
  });

  return { scmStatus };
}
