import type { TourCopy } from './copy';

/**
 * The guided tour in French, with exactly the keys of the English (`copy.en.ts`).
 * A `**bold**` dashboard label stays in English, as the screen spells it. The
 * reader is « vous »; a no-break space goes before a colon and inside « », a
 * narrow one before ? ; and !.
 */
export const FR_COPY = {
  ui: {
    launch: 'Visite guidée',
    promptTitle: 'Envie d’une visite guidée ?',
    promptBody:
      'Choisissez votre rôle : la visite vous montre les écrans que vous utiliseriez le plus, sur les données d’exemple de cette démo.',
    roles: 'Votre rôle',
    stopCount: '{count} étapes',
    later: 'Plus tard',
    dismiss: 'Ne plus afficher',
    language: 'Langue',
    next: 'Suivant',
    back: 'Précédent',
    done: 'Terminer',
    progress: '{{current}} sur {{total}}',
    close: 'Quitter la visite',
    docs: 'Documentation (en anglais)',
    finishedTitle: 'Fin de la visite',
    finishedBody: 'Les visites des autres rôles sont dans « Visite guidée », dans le bandeau.',
  },
  profiles: {
    developer: {
      label: 'Développement',
      hint: 'Comprendre un échec, le corriger',
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
      label: 'QA / tests',
      hint: 'Tests instables, lents, manquants',
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
      label: 'Product owner',
      hint: 'La qualité dans le temps, les rapports',
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
      label: 'DevOps / plateforme',
      hint: 'Vitesse de la CI, santé des machines',
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
