import type { TourCopy } from './copy';

/**
 * The guided tour in German, with exactly the keys of the English (`copy.en.ts`).
 * A `**bold**` dashboard label stays in English, as the screen spells it. The
 * reader is „Sie“; quotes are „…“.
 */
export const DE_COPY = {
  ui: {
    launch: 'Geführte Tour',
    promptTitle: 'Möchten Sie eine geführte Tour machen?',
    promptBody:
      'Wählen Sie Ihre Rolle: Die Tour zeigt Ihnen die Ansichten, die Sie am häufigsten nutzen würden, mit den Beispieldaten dieser Demo.',
    roles: 'Ihre Rolle',
    stopCount: '{count} Stationen',
    later: 'Später',
    dismiss: 'Nicht mehr anzeigen',
    language: 'Sprache',
    next: 'Weiter',
    back: 'Zurück',
    done: 'Fertig',
    progress: '{{current}} von {{total}}',
    close: 'Tour beenden',
    docs: 'Dokumentation (auf Englisch)',
    finishedTitle: 'Ende der Tour',
    finishedBody: 'Die Touren der anderen Rollen finden Sie unter „Geführte Tour“ in der Leiste oben.',
  },
  profiles: {
    developer: {
      label: 'Entwicklung',
      hint: 'Fehler verstehen und beheben',
      stops: {
        failure: { title: '', body: '' },
        evidence: { title: '', body: '' },
        locator: { title: '', body: '' },
        diagnosis: { title: '', body: '' },
        mcp: { title: '', body: '' },
        simulate: { title: '', body: '' },
      },
    },
    qa: {
      label: 'QA / Testing',
      hint: 'Instabile, langsame, fehlende Tests',
      stops: {
        inbox: { title: '', body: '' },
        flaky: { title: '', body: '' },
        suspects: { title: '', body: '' },
        lab: { title: '', body: '' },
        slow: { title: '', body: '' },
        gaps: { title: '', body: '' },
      },
    },
    product: {
      label: 'Product Owner',
      hint: 'Qualität im Zeitverlauf, Berichte',
      stops: {
        health: { title: '', body: '' },
        analytics: { title: '', body: '' },
        dashboards: { title: '', body: '' },
        reports: { title: '', body: '' },
        issue: { title: '', body: '' },
        personas: { title: '', body: '' },
      },
    },
    platform: {
      label: 'DevOps / Plattform',
      hint: 'CI-Tempo und Gesundheit der Maschinen',
      stops: {
        timeline: { title: '', body: '' },
        leaks: { title: '', body: '' },
        incident: { title: '', body: '' },
        alerts: { title: '', body: '' },
        setup: { title: '', body: '' },
        simulate: { title: '', body: '' },
      },
    },
  },
} satisfies TourCopy;
