import type { TourCopy } from './copy';

/**
 * The guided tour in Spanish, with exactly the keys of the English (`copy.en.ts`).
 * A `**bold**` dashboard label stays in English, as the screen spells it. The
 * reader is «tú»; a question or an exclamation opens with ¿ or ¡.
 */
export const ES_COPY = {
  ui: {
    launch: 'Visita guiada',
    promptTitle: '¿Hacemos una visita guiada?',
    promptBody:
      'Elige tu rol y la visita te mostrará las pantallas que más usarías, con los datos de ejemplo de esta demo.',
    roles: 'Tu rol',
    stopCount: '{count} paradas',
    later: 'Más tarde',
    dismiss: 'No volver a mostrar',
    language: 'Idioma',
    next: 'Siguiente',
    back: 'Anterior',
    done: 'Terminar',
    progress: '{{current}} de {{total}}',
    close: 'Salir de la visita',
    docs: 'Documentación (en inglés)',
    finishedTitle: 'Fin de la visita',
    finishedBody: 'Las visitas de los demás roles están en «Visita guiada», en la barra superior.',
  },
  profiles: {
    developer: {
      label: 'Desarrollo',
      hint: 'Entender un fallo y arreglarlo',
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
      label: 'QA / pruebas',
      hint: 'Tests inestables, lentos, ausentes',
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
      hint: 'La calidad en el tiempo e informes',
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
      label: 'DevOps / plataforma',
      hint: 'Velocidad de la CI y salud de las máquinas',
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
