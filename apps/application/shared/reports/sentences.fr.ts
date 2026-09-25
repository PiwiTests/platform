import type { MetricId } from '#shared/analytics/metrics';
import type { AnalyticsProgress, AnalyticsRisks, VerdictFacts } from '#shared/analytics/types';
import { passRateDirection } from './verdict';
import type { ValueFormatter } from './format';
import type { ReportSentences } from './sentences';

const plural = (n: number, one: string, many: string) => (n <= 1 ? one : many);

const METRIC_LABELS: Partial<Record<MetricId, [label: string, definition: string]>> = {
  'test-pass-rate': [
    'Taux de réussite des tests',
    'Tests réussis divisés par tests exécutés, sommés sur les exécutions de la période.',
  ],
  'run-success-rate': ['Taux de succès des exécutions', 'Part des exécutions terminées dont le statut est réussi.'],
  runs: ['Exécutions', 'Exécutions terminées dans la période.'],
  'suite-size': ['Taille de la suite', 'Le plus grand nombre de tests rapporté par une exécution de la période.'],
  'flaky-occurrences': [
    'Occurrences instables',
    'Tests réussis seulement après une nouvelle tentative, sommés sur les exécutions de la période.',
  ],
  'flaky-tests': [
    'Tests instables',
    'Tests distincts réussis seulement après une nouvelle tentative au moins une fois dans la période.',
  ],
  'wasted-ci-minutes': [
    'Minutes de CI perdues',
    'Minutes passées dans des étapes d’attente plus minutes d’exécution de tentatives terminées en échec ou en dépassement de délai.',
  ],
  'wasted-ci-cost': [
    'Coût de la CI perdue',
    'Minutes de CI perdues multipliées par le coût configuré d’une minute de CI.',
  ],
  'ci-time': ['Temps de CI', 'Somme des durées des exécutions de la période.'],
  'new-regressions': [
    'Nouvelles régressions',
    'Exécutions d’un test en échec après avoir réussi lors de l’exécution précédente.',
  ],
  'newly-flaky': ['Nouvellement instables', 'Exécutions d’un test devenu instable lors de cette exécution.'],
  'average-run-duration': ['Durée moyenne d’une exécution', 'Somme des durées des exécutions divisée par leur nombre.'],
  'average-p90-test-duration': [
    'Durée p90 moyenne des tests',
    'Somme du 90e centile des durées de test de chaque exécution, divisée par le nombre d’exécutions.',
  ],
  'open-failure-causes': [
    'Causes d’échec ouvertes',
    'Groupes d’échecs ouverts et non mis en veille à la fin de la période.',
  ],
  'failure-causes-opened': ['Causes d’échec apparues', 'Groupes d’échecs créés dans la période.'],
  'failure-causes-fixed': [
    'Causes d’échec corrigées',
    'Groupes d’échecs dont le correctif est arrivé dans la période.',
  ],
  'median-time-to-fix': [
    'Délai médian de correction',
    'Délai médian entre le premier échec et le correctif, sur les groupes d’échecs corrigés dans la période.',
  ],
  'oldest-open-failure-cause': ['Plus ancienne cause ouverte', 'Âge du plus ancien groupe d’échecs ouvert.'],
  'fixes-that-held': [
    'Correctifs tenus',
    'Groupes d’échecs corrigés dans la période et sans régression depuis, sur les groupes corrigés.',
  ],
  'quarantine-debt': ['Dette de quarantaine', 'Tests en quarantaine.'],
};

const TITLES: Record<string, string> = {
  'Where things stand': 'Où en sont les choses',
  'Where the pain is': 'Où ça fait mal',
  'Which way it is going': 'Dans quelle direction',
  'What is being done': 'Ce qui est fait',
  Detail: 'Détail',
  Trends: 'Tendances',
  'The state of the projects in scope, against the comparison period.':
    'L’état des projets couverts, par rapport à la période de comparaison.',
  'Movement over the period.': 'L’évolution sur la période.',
  'Fixes, triage and the risks still open.': 'Correctifs, tri et risques encore ouverts.',
  'What is costing the most time and attention.': 'Ce qui coûte le plus de temps et d’attention.',
  'Regressions and CI time over the period.': 'Régressions et temps de CI sur la période.',
  'Browsers and shared endpoints.': 'Navigateurs et points de terminaison partagés.',
  'The state of every project right now.': 'L’état de chaque projet en ce moment.',
  'What is costing you the most time and attention.': 'Ce qui vous coûte le plus de temps et d’attention.',
  'Movement over the selected period.': 'L’évolution sur la période choisie.',
  'Breakdowns to reach for once you know what you are chasing.': 'Les détails, une fois la piste trouvée.',
  Verdict: 'Verdict',
  'Headline numbers': 'Chiffres clés',
  'Pass rate over time': 'Taux de réussite dans le temps',
  'What changed': 'Ce qui a changé',
  Insights: 'Constats',
  Risks: 'Risques',
  'Portfolio health': 'Santé du portefeuille',
  'Pass rate heatmap': 'Carte de chaleur du taux de réussite',
  'Failure clusters': 'Groupes d’échecs',
  'Flakiest tests': 'Tests les plus instables',
  'Wasted CI time': 'Temps de CI perdu',
  'Regression velocity': 'Rythme des régressions',
  'CI time': 'Temps de CI',
  'Browser matrix': 'Matrice des navigateurs',
  'Slow endpoints': 'Points de terminaison lents',
};

function branchText(facts: VerdictFacts): string {
  const { kind, branches } = facts.branch;
  if (kind === 'any') return 'sur toutes les branches';
  if (branches.length === 1) return `sur ${branches[0]}`;
  if (kind === 'default') return 'sur les branches par défaut';
  return `sur ${branches.join(', ')}`;
}

function comparisonText(facts: VerdictFacts): string {
  if (facts.comparison === 'year') return 'un an plus tôt';
  if (facts.comparison === 'custom') return 'la période de comparaison';
  return 'la période précédente';
}

function verdict(facts: VerdictFacts, f: ValueFormatter): string {
  if (facts.runs === 0 || facts.passRate === null) {
    return 'Aucune exécution n’a été enregistrée pour ce périmètre sur la période.';
  }
  const rate = f.value(facts.passRate, 'percent', 1);
  const where = branchText(facts);
  const direction = passRateDirection(facts);
  const points = facts.passRateDelta === null ? '' : f.number(Math.abs(facts.passRateDelta), 1);
  const fixed =
    facts.fixed > 0
      ? `, et ${facts.fixed} ${plural(facts.fixed, 'cause d’échec a été corrigée', 'causes d’échec ont été corrigées')}`
      : '';
  let first: string;
  if (direction === 'up') {
    first = `La suite se porte mieux que ${comparisonText(facts)} : le taux de réussite ${where} a gagné ${points} points pour atteindre ${rate}${fixed}.`;
  } else if (direction === 'down') {
    first = `La suite se porte moins bien que ${comparisonText(facts)} : le taux de réussite ${where} a perdu ${points} points pour tomber à ${rate}${fixed}.`;
  } else if (facts.previousPassRate !== null) {
    first = `La suite est stable : le taux de réussite ${where} est de ${rate}, comme ${comparisonText(facts)}${fixed}.`;
  } else {
    first = `Le taux de réussite ${where} est de ${rate}${fixed}.`;
  }
  const rest: string[] = [];
  if (facts.open > 0) {
    rest.push(`${facts.open} ${plural(facts.open, 'cause d’échec reste ouverte', 'causes d’échec restent ouvertes')}.`);
  }
  if (facts.wastedMinutes >= 1) {
    const cost = facts.wastedCost
      ? ` (${f.value(facts.wastedCost.amount, 'money', 2, facts.wastedCost.currency)})`
      : '';
    rest.push(`Les tentatives en échec et les attentes ont coûté ${f.minutes(facts.wastedMinutes)} de CI${cost}.`);
  }
  return [first, ...rest].join(' ');
}

function progress(p: AnalyticsProgress): string[] {
  const lines: string[] = [];
  if (p.fixed > 0) {
    const held =
      p.held === p.fixed
        ? p.fixed === 1
          ? 'le correctif a tenu'
          : 'tous ont tenu'
        : `${p.held} ${plural(p.held, 'a tenu', 'ont tenu')}`;
    lines.push(`${p.fixed} ${plural(p.fixed, 'cause d’échec corrigée', 'causes d’échec corrigées')} ; ${held}.`);
  } else {
    lines.push('Aucune cause d’échec n’a été corrigée sur la période.');
  }
  if (p.assigned > 0 || p.withTicket > 0) {
    lines.push(
      `${p.assigned} ${plural(p.assigned, 'cause ouverte est attribuée', 'causes ouvertes sont attribuées')}, ${p.withTicket} ${plural(p.withTicket, 'a un ticket', 'ont un ticket')}.`,
    );
  }
  if (p.releasedFromQuarantine > 0 || p.quarantined > 0) {
    lines.push(
      `${p.releasedFromQuarantine} ${plural(p.releasedFromQuarantine, 'test sorti', 'tests sortis')} de quarantaine, ${p.quarantined} ${plural(p.quarantined, 'mis', 'mis')} en quarantaine.`,
    );
  }
  if (p.healPullRequests > 0) {
    lines.push(
      `${p.healPullRequests} ${plural(p.healPullRequests, 'pull request de réparation automatique ouverte', 'pull requests de réparation automatique ouvertes')}.`,
    );
  }
  return lines;
}

function risks(r: AnalyticsRisks, f: ValueFormatter): string[] {
  const lines: string[] = [];
  for (const m of r.worsening) {
    const change = f.delta({ unit: m.unit, delta: m.delta, deltaPct: m.deltaPct, precision: 1 });
    const label = METRIC_LABELS[m.metric]?.[0] ?? m.label;
    lines.push(`${label} évolue dans le mauvais sens : ${f.value(m.value, m.unit, 1)} (${change}).`);
  }
  for (const p of r.failingProjects) {
    lines.push(`${p.name} a échoué à ses ${p.streak} dernières exécutions d’affilée.`);
  }
  for (const c of r.oldestOpen) {
    const owner = c.assignee ? `, attribuée à ${c.assignee}` : ', non attribuée';
    lines.push(`« ${c.title} » (${c.projectName}) est ouverte depuis ${f.value(c.ageDays, 'days', 0)}${owner}.`);
  }
  if (r.quarantine.count > 0) {
    const oldest =
      r.quarantine.oldestDays !== null ? `, le plus ancien depuis ${f.value(r.quarantine.oldestDays, 'days', 0)}` : '';
    lines.push(
      `${r.quarantine.count} ${plural(r.quarantine.count, 'test est', 'tests sont')} en quarantaine${oldest}.`,
    );
  }
  return lines;
}

export const FR_SENTENCES: ReportSentences = {
  labels: {
    qualityReport: 'Rapport qualité',
    period: 'Période',
    comparedWith: 'Comparée à',
    noComparison: 'Sans comparaison',
    projects: 'Projets',
    allProjects: 'Tous les projets',
    branchPolicy: 'Branches',
    defaultBranch: 'La branche par défaut de chaque projet, plus les exécutions sans branche connue',
    allBranches: 'Toutes les branches',
    branches: 'Branches',
    fullRunsOnly: 'Exécutions complètes seulement',
    allRuns: 'Exécutions complètes et partielles',
    testFilter: 'Tests',
    definitions: 'Définitions',
    limits: 'Limites',
    generated: 'Généré le',
    generatedBy: 'Généré par Piwi',
    openInPiwi: 'Ouvrir dans Piwi',
    dashboard: 'Tableau de bord',
    noData: 'Rien à montrer sur cette période.',
    previous: 'Précédent',
    metric: 'Indicateur',
    value: 'Valeur',
    change: 'Évolution',
    date: 'Date',
    unavailable: 'Ce widget n’est plus disponible.',
    daysAreUtc: 'Les jours sont en UTC.',
  },
  verdict,
  progress,
  risks,
  metricLabel: (id, fallback) => METRIC_LABELS[id]?.[0] ?? fallback,
  metricDefinition: (id, fallback) => METRIC_LABELS[id]?.[1] ?? fallback,
  title: (text) => TITLES[text] ?? text,
  reportTitle: (scope, period) => `${scope}, ${period}`,
  projectCount: (n) => `${n} ${plural(n, 'projet', 'projets')}`,
  testFilterLimit: (start) =>
    start
      ? `Le filtre de tests compte les exécutions conservées, qui commencent le ${start}.`
      : 'Le filtre de tests compte les exécutions conservées, qui ne remontent pas plus loin que la rétention.',
  identityLimit:
    'Les listes de tests et le nombre de tests instables ne remontent pas plus loin que la rétention des exécutions.',
};
