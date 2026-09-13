/**
 * French copy — sentence case, proper accents. Mirrors `en.ts` key for key; the
 * `Record<MessageKey, …>` annotation makes a missing or extra key a type error,
 * and a runtime parity test guards it too. French treats 0 and 1 as singular,
 * which `Intl.PluralRules('fr')` already encodes.
 */
import type { MessageKey, MessageValue } from './en';

export const fr: Record<MessageKey, MessageValue> = {
  // En-têtes de section
  'section.whatHappened': "Ce qui s'est passé",
  'section.mostLikely': 'Le plus probable',
  'section.evidence': 'Preuves',
  'section.whatToDo': 'Quoi faire',
  'section.links': 'Liens',
  'section.affectedTests': { one: '{count} test affecté', other: '{count} tests affectés' },

  // Étiquettes de faits
  'fact.errorType': "Type d'erreur",
  'fact.firstSeen': 'Première occurrence',
  'fact.lastSeen': 'Dernière occurrence',
  'fact.occurrences': 'Occurrences',
  'fact.branch': 'Branche',
  'fact.environment': 'Environnement',
  'fact.commit': 'Commit',

  // En-têtes du tableau des tests affectés
  'table.test': 'Test',
  'table.file': 'Fichier',
  'table.owner': 'Propriétaire',

  // Étiquettes en ligne
  'label.rootCause': 'Cause racine',
  'label.failingLocator': 'Localisateur en échec',
  'label.verify': 'Vérifier',
  'label.reproduce': 'Reproduire',

  // Étiquettes de liens
  'link.cluster': "Grappe d'échecs",
  'link.execution': 'Dernière exécution',
  'link.run': 'Série de tests',
  'link.share': 'Rapport partageable',
};
