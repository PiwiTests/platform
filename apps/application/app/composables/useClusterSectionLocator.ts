import type { InjectionKey } from 'vue';

/**
 * Lets a citation (a clue's, the Most likely line's, the diagnosis result's)
 * reveal the evidence it names. Both failure pages provide the implementation
 * over their evidence card and sections; other consumers get a no-op default.
 */
export interface ClusterSectionLocator {
  /** Whether this page can reveal the evidence of a section id. */
  canLocate: (sectionId: string) => boolean;
  /**
   * Reveal the evidence for this section id; with `index`, the one entry of its
   * list a clue cites (a request, a console entry), which the evidence card marks.
   */
  open: (sectionId: string, index?: number) => void;
}

export const clusterSectionLocatorKey: InjectionKey<ClusterSectionLocator> = Symbol('clusterSectionLocator');

export function useClusterSectionLocator(): ClusterSectionLocator {
  return inject(clusterSectionLocatorKey, { canLocate: () => false, open: () => {} });
}
