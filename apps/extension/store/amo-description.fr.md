Piwi Picker trouve le locator à utiliser pour n’importe quel élément de la page que vous consultez. Chaque candidat est classé selon sa stabilité, puis compté sur la page telle qu’elle est, pour que celui en tête ne corresponde qu’à un seul élément. L’extension transforme aussi un parcours que vous faites à la souris, sur plusieurs pages, en test Playwright prêt à lancer.

**Les outils, directement sur la page**

- **Choisir un élément** : les locators classés d’un élément, vérifiés sur la page, à copier seuls, en ligne d’action ou en assertion.
- **Inspecter** : le meilleur locator de l’élément sous le pointeur.
- **Console** : saisissez un locator et voyez ce qu’il trouve à l’instant, avec le verdict du mode strict.
- **Multi-sélection** : le motif commun aux lignes ou aux cartes d’une liste.
- **Contrôle** : les éléments difficiles à cibler dans un test, chacun avec un data-testid suggéré.
- **Assertions** : des lignes expect(...) pour un élément.
- **Session** : des éléments que vous nommez sur plusieurs pages, exportés en page object, en tableau Markdown ou en JSON.
- **Contexte IA** : un bloc qui décrit un élément, à donner à un agent de code.
- **Enregistrer** : clics, saisies et sélections sur les pages d’un site, transformés en test TypeScript. Les mots de passe ne sont jamais enregistrés.

**Privé par défaut**

La sélection et l’enregistrement n’utilisent jamais le réseau. Rien n’est collecté ni envoyé.

**En option : connecter votre instance Piwi**

Piwi est un tableau de bord auto-hébergé pour les résultats de tests Playwright. Une fois l’extension reliée à votre instance (son URL et une clé d’API, dans les réglages), trois outils s’ajoutent : des enregistrements qui appellent vos propres fonctions de test, **Fonctions de test**, qui liste celles utilisables sur la page, et **Éléments testés**, qui met en évidence les éléments que vos tests atteignent. L’extension ne fait que lire votre instance ; un enregistrement n’y est jamais envoyé.

**Autorisations**

- L’onglet affiché, seulement quand vous cliquez sur le bouton de l’extension ou utilisez le raccourci clavier.
- Un seul site, demandé quand vous lancez un enregistrement dessus, pour suivre vos actions d’une page à l’autre. Rien n’est accordé à l’installation.
- L’adresse de votre instance Piwi, demandée quand vous enregistrez une connexion.

Documentation (en anglais) : [piwitests.dev/features/extension](https://piwitests.dev/features/extension)

Piwi n’est ni affilié à Microsoft Corporation, ni approuvé ou soutenu par elle. Playwright est une marque de Microsoft Corporation.
