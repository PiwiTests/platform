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
  'link.dashboard': 'Ouvrir dans Piwi',

  // Commentaires de politique (réécrits dans le ticket, dans sa langue)
  'comment.fixLanded':
    'Correctif appliqué dans la série #{run} (commit {commit}, {verification}) — tous les tests affectés sont passés.',
  'comment.fixLanded.noCommit':
    'Correctif appliqué dans la série #{run} ({verification}) — tous les tests affectés sont passés.',
  'verification.diagnosisVerified': 'diagnostic vérifié',
  'verification.stoppedFailing': 'a cessé d’échouer',
  'comment.regressed': 'Régression dans la série #{run} — le correctif n’a pas tenu.',
  'comment.stillFailing': {
    one: 'Toujours en échec — +{count} occurrence sur {runs} séries depuis la dernière note, dernière série #{latest}.',
    other:
      'Toujours en échec — +{count} occurrences sur {runs} séries depuis la dernière note, dernière série #{latest}.',
  },
  'comment.mergedInto': 'Cet échec a été fusionné dans {key} — le suivi se poursuit là-bas.',
  'comment.absorbed': '{key} a été absorbé dans ce ticket — ses échecs sont suivis ici désormais.',
};
