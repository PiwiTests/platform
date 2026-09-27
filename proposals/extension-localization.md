# Piwi Picker in five languages

A plan to translate the browser extension, Piwi Picker, into French, German, Spanish and Brazilian Portuguese, with
English as the source. The extension has become a tool for testers as well as developers: the bug report asks what
should be on the page and what happened, and the replay tells a developer in sentences whether the bug shows. That text
is written for people who are not necessarily fluent in English, and a French team is its first audience.

**Status.** Proposed 2026-09-27. Nothing is built. Only the store listing is translated today: the manifest summary and
the keyboard shortcut label in `public/_locales/{en,fr}/messages.json`, and the Firefox listing description in
`store/amo-description.{en,fr}.md`. The French listing says so: "L'interface de l'extension est en anglais". No UI
string goes through `chrome.i18n`. Nothing here changes a wire format, the steps format or generated code, so no entry
in [`1.0-stabilization.md`](1.0-stabilization.md) is needed.

**Summary.** Every text the extension shows moves into one catalog per language, the `messages.json` files the browser
already reads for the manifest, behind a typed `t()` helper whose keys come from the English catalog, so a missing or
misspelled key is a type error. The sentences the extension writes about a page (the steps of a bug report, what should
happen, the replay's verdict, the Markdown report) need grammar that a flat catalog cannot express: French and Spanish
articles agree with the noun, German declines them, Portuguese contracts them with the preposition. Those move into a
small phrasebook per language in `packages/core`, the pattern the dashboard's quality reports already follow for English
and French. The extension follows the browser's language by default, and a setting in Options overrides it, since many
developers run an English browser. Whatever the language, the extension never translates what belongs to the page or
to the code: page texts, locators, test ids, `steps.json` and generated specs stay as they are. A check fails the build
on a missing key, a placeholder that differs from English, a missing plural form or a French colon without its
non-breaking space, and a scan of the source fails on text written straight into the UI.

## What changes for the reader

A French tester opens the popup and reads **Choisir un élément**, **Enregistrer des actions**, **Signaler un bug**,
**Rejouer un rapport de bug**. The bug report's steps read:

```
1. Ouvrir /cart
2. Saisir « SPRING10 » dans le champ de texte « Coupon »
3. Cliquer sur le bouton « Apply coupon »
4. L’élément avec le test id `cart-total` devrait afficher « Total: 42 »
```

The page is in English, so its texts ("Coupon", "Apply coupon", "Total: 42") stay in English, quoted the French way.
The developer who replays the report reads **Reproduit : le bug est visible ici** and, below it,
**Étape 4 : attendu « Total: 42 », trouvé « Total: 40 », comme signalé.** The spec the report generates is the same,
character for character, as the one an English report generates.

The finish panel of a bug report offers **Langue du rapport**, set to the interface's language: a French tester who
files into an English-speaking tracker writes the report in English with one choice, and the panel stays in French.

## Languages

| Code (`_locales/`) | Language | Why | Review |
| --- | --- | --- | --- |
| `en` | English | the source and `default_locale` | — |
| `fr` | French | the team using it first | the team, before release |
| `de` | German | a large developer community in Europe, and the longest strings: the layout test language | to find |
| `es` | Spanish | Spain and Latin America: `es` also serves browsers set to `es_419` | to find |
| `pt_BR` | Brazilian Portuguese | one of the largest developer communities on GitHub | to find |

Next candidates, cheap once the machinery exists: `it`, `ja`, `zh_CN`, `pl`. Japanese and Chinese are worth a layout
pass of their own (no spaces to wrap on), and Polish is the first language with the plural forms `few` and `many` in
ordinary counts, which the plural check below already handles. Right-to-left languages are out of scope; the pages
already set `lang` and the panels would need `dir` and logical CSS properties first.

Chrome looks for a message in the exact locale (`pt_PT`), then the language (`pt`), then `default_locale`. So a
Portuguese user in Portugal sees English until a `pt_PT` catalog exists; a `pt` catalog with Brazilian text would reach
them, but AMO and the Chrome Web Store only know `pt-BR` and `pt-PT` for the listing, and a translation that reads
Brazilian in Portugal is worse than a clear choice. Firefox follows the same lookup.

## What is translated, and what never is

| Translated | Never translated |
| --- | --- |
| Every label, button, hint, tooltip, `aria-label`, error and empty state of the popup, the options page and the in-page panels | Texts read from the page: accessible names, visible text, values, URLs, console messages |
| The steps of a bug report in words, its expectations, headings and evidence summary | Locators, test ids, selectors, `steps.json` |
| The replay's HUD, step captions and verdict | Generated specs, their titles' `bug:` prefix, their `test.fail` reason and comments: the spec is identical whoever records it, and it lives in a codebase written in English |
| Stability rule names and explanations, converter warnings (both by their code, see below) | Playwright names written as code: `toHaveText`, `getByRole`, `nth()` |
| Badges (four characters at most), the keyboard shortcut label, the store listings | Product names: Piwi, Piwi Picker, Playwright; the popup's single-key shortcuts, which docs and habits rely on |

Times in the Markdown report stay in ISO form and UTC (`2026-09-27 14:05 UTC`): a report travels to people in other time
zones. Counts and durations shown in the UI use the interface language's number format (`1 234` in French, with a
narrow no-break space).

## How it works

### One catalog per language

The catalogs are the files the browser already reads: `apps/extension/public/_locales/<code>/messages.json`, copied to
`dist/` by the build. `chrome.i18n.getMessage` is synchronous and works in the background worker, the popup, the
options page and content scripts, in Chrome and in Firefox, so no loading step stands between a panel and its text.

The English catalog is the source. Each entry has a `description` for the translator: where the text appears, what it
refers to, how long it may be. The other catalogs repeat the English order, so a diff of two languages lines up.

```json
"replay_stepExpected": {
  "message": "Step $step$: expected $expected$, found $found$.",
  "description": "Replay verdict detail. $expected$ and $found$ are page texts, already quoted by the phrasebook.",
  "placeholders": {
    "step": { "content": "$1", "example": "4" },
    "expected": { "content": "$2", "example": "“Total: 42”" },
    "found": { "content": "$3", "example": "“Total: 40”" }
  }
}
```

Keys are `<surface>_<name>`, the surfaces being the entry points: `popup_`, `options_`, `pick_`, `console_`, `record_`,
`bug_`, `replay_`, `coverage_`, `session_`, `badge_`, with `common_` for the words every panel uses (Copy, Close, Stop).
The browser's rules apply and the check enforces them: ASCII letters, digits and `_`; names compared without case, so
`bug_Title` and `bug_title` collide; at most nine placeholders; `$$` for a literal dollar sign.

Messages are text, never markup: a translated string reaches the page through `textContent` or the panels' escape
helper, and the check rejects `<` in any message. The panels that build HTML in template strings
(`coverage-panel.ts`, `hover-inspect.ts`) escape `t()` like any other value, so a translation can never inject markup
into the page, and AMO's reviewers read escaped values.

The scan of the source found about 460 strings of two words or more (about 2,800 English words) in `src/`,
`popup.html` and `options.html`, most of them in `coverage-panel.ts`, `bug-panel.ts`, the popup, `record-panel.ts`,
`results-panel.ts`, `replay-panel.ts` and `session-panel.ts`. With single words (Copy, Stop, Close), expect 550 to 600
messages, and about 3,500 English words per language to translate and review.

### `t()` and `tn()`

`src/shared/i18n.ts` is the only code that reads messages:

```ts
t('bug_finishTitle');
t('replay_stepExpected', { step: 4, expected: q(expected), found: q(found) });
tn('coverage_elementsReached', count); // picks coverage_elementsReached_one, _other, …
```

- **Typed keys.** `MessageKey` is `keyof` the English catalog, imported as a type with `resolveJsonModule`, so the
  compiler rejects a key that does not exist; the placeholder names of each key are typed the same way. No generated
  file.
- **Plurals.** `chrome.i18n` has none. A counted message has one key per plural category, `_one`, `_other`, and `_few`
  or `_many` where the language uses them; `tn()` picks with `Intl.PluralRules` in the interface language and formats
  the count with `Intl.NumberFormat`. French puts 0 with 1 (`0 élément`), which `Intl.PluralRules('fr')` already knows.
- **Language.** `uiLanguage()` is the override from Options when set, else `chrome.i18n.getUILanguage()`. Panels set
  `lang` on their root inside the shadow DOM: a screen reader then reads a French panel with a French voice on an
  English page, and `hyphens: auto` knows which dictionary to use.
- **HTML pages.** `popup.html` and `options.html` keep their text in the markup for readability, as
  `data-i18n="popup_pickTitle"` (and `data-i18n-title`, `-placeholder`, `-aria-label`); `localizeDocument()` fills
  them at startup and sets `<html lang>`. The markup holds the English text too, so the page reads correctly in a test
  that opens the file directly.

### Choosing another language than the browser's

`chrome.i18n` always follows the browser's interface language, and there is no API to change it for one extension.
Developers often run an English browser, and changing the browser's language to use one extension in French is not a
reasonable ask. Options gets a **Language** setting: "Same as the browser (Français)", then each language by its own
name (English, Français, Deutsch, Español, Português (Brasil)), from `Intl.DisplayNames` with the first letter
capitalized.

When a language is chosen, the background worker reads that catalog from the extension's own package
(`fetch(chrome.runtime.getURL('_locales/fr/messages.json'))`, which an extension page or worker may do) and stores it in
`chrome.storage.local` beside the choice. Each script reads it once at startup (`await initI18n()`, a single storage
read) and `t()` substitutes placeholders itself with the browser's `$name$` rules. The worker refreshes the stored
catalog on `runtime.onInstalled`, so an update never shows last version's texts. The alternative, making
`_locales/` web-accessible so content scripts fetch it, would let every page probe for the extension; storage avoids
that and needs no new permission.

A test runs every English message through both paths, `chrome.i18n.getMessage` and the override's substitution, with
the same arguments, and requires the same text.

### Sentences about the page: a phrasebook per language in core

The step list, the expectations, the evidence summary and the Markdown report are composed from the page's data:
an action, a role, a name, a value. English gets away with concatenation ("Click " + "button" + " \"Apply\""); the other
four languages do not:

| | Click a button | Fill a text field | Choose in a dropdown | Check a checkbox |
| --- | --- | --- | --- | --- |
| en | Click button "Apply coupon" | Fill text field "Coupon" with "SPRING10" | Select "France" in dropdown "Country" | Check checkbox "I agree" |
| fr | Cliquer sur le bouton « Apply coupon » | Saisir « SPRING10 » dans le champ de texte « Coupon » | Choisir « France » dans la liste déroulante « Country » | Cocher la case « I agree » |
| de | Auf den Button „Apply coupon“ klicken | „SPRING10“ in das Textfeld „Coupon“ eingeben | „France“ in der Auswahlliste „Country“ auswählen | Das Kontrollkästchen „I agree“ aktivieren |
| es | Hacer clic en el botón «Apply coupon» | Escribir «SPRING10» en el campo de texto «Coupon» | Elegir «France» en la lista desplegable «Country» | Marcar la casilla «I agree» |
| pt_BR | Clicar no botão “Apply coupon” | Digitar “SPRING10” no campo de texto “Coupon” | Escolher “France” na lista suspensa “Country” | Marcar a caixa de seleção “I agree” |

French needs the article's gender and its elision (`le bouton`, `la case`, `l’image`, `l’onglet`); German needs the
accusative after `auf` and the dative after `in` (`den Button`, `in der Auswahlliste`), from the noun's gender;
Portuguese contracts `em` with the article (`no botão`, `na lista`). Each language also quotes differently, and French
puts a non-breaking space inside `« »` and before `:`, but never inside the page text it quotes.

So `packages/core` gets a phrasebook interface, `BugPhrases`, with one file per language: `bug-phrases.en.ts`,
`bug-phrases.fr.ts`, and so on, registered by language code, the same shape as the dashboard's
`apps/application/shared/reports/sentences.{en,fr}.ts`. A phrasebook holds:

- the role nouns of `role-words.ts` (about 60 roles), each with its gender where the language has them;
- `quote(text)`, `code(text)`, and the article and preposition forms the language's templates need;
- one template per action and per matcher (visible, hidden, enabled, disabled, text, value, name, URL), negated or not;
- the report's headings and labels, the evidence summary with its counts, and "a password (not recorded)".

`describeStepInWords`, `describeExpectation`, `summarizeEvidence`, `renderBugMarkdown` and `roleWord` take the
phrasebook as an optional last argument, English by default, so the dashboard and every existing test are unchanged. A
test lists, for each language, which roles, actions and matchers its phrasebook does not cover, and renders one report
per language through every template.

The rest of the core text the extension shows already has a code to hang a message on: stability findings have a
`LocatorStabilityRuleId` (`stability_rule_<id>_label`, `_description`), and converter warnings have a
`CodegenWarning.code`. Those become catalog messages in the extension; core keeps its English texts for the dashboard
and the CLI. Errors from `parseSteps` stay English inside a translated sentence ("Ce fichier n’est pas un fichier
d’étapes : `steps[3].action` is not a step action"): they name fields of a file format, and translating them would hide
what to search for.

### Typography and formatting

| | Quotes around page text | Before `:` | Numbers |
| --- | --- | --- | --- |
| en | "…" | — | 1,234 |
| fr | « … » with no-break spaces inside | no-break space, as the dashboard's French reports | 1 234 |
| de | „…“ | — | 1.234 |
| es | «…» | — | 1234 |
| pt_BR | “…” | — | 1.234 |

The quotes live in the phrasebook and in the catalogs' messages, never in code, so `replay-core.ts` stops writing
`"${found}"`. The French rules are the ones `sentences.fr.ts` applies: U+00A0 before a colon, U+202F before `;`, `!`
and `?`, and the check rejects an ordinary space in those places.

### Layout

German runs about 30% longer than English, and the popup is 440 px wide with a label and a key hint per tile. The
panels get `overflow-wrap: anywhere` on labels and `hyphens: auto` (which the `lang` attribute makes work), button rows
wrap instead of clipping, and nothing sets a width on a text container. A test opens the popup and each panel in German
and fails when any element's `scrollWidth` exceeds its `clientWidth`, which finds a clipped label without screenshots.

## Checks and tests

**The catalog check** (`tests/unit/locales.test.ts`, beside `store-listing.test.ts`), for every language:

- the same keys as English, no more, none that collide without case;
- the same placeholders as the English message, each used in the text, and no stray `$`;
- every plural category the language uses for counts from 0 to 999,999, per `Intl.PluralRules` (so `_many` is required
  in Polish but not in French, where it only starts at a million);
- no `<` in a message, no empty message, a `description` on every English entry;
- length limits where the browser has them: the summary at 132 characters (already checked), badges at 4;
- the French no-break spaces;
- every language has a phrasebook, and every `_locales/` directory has a store description (already checked).

**No text in code.** `tests/unit/no-hardcoded-text.test.ts` walks `src/` with the TypeScript compiler API and fails on a
string literal with a letter in it assigned to `textContent`, `title`, `placeholder` or `ariaLabel`, passed to
`setAttribute` for `title`, `aria-label` or `placeholder`, or written inside an HTML template, outside `i18n.ts`. The
repository lints with oxlint, which has no selector rule for this, hence a test. While the panels move over, a list of
files not yet migrated keeps it green, and the list only shrinks.

**Pseudo-locale.** `npm run extension:build -- --pseudo` writes an English catalog whose texts are accented, a third
longer and bracketed (`[Ƥîçķ åñ éļéɱéñţ ···]`), placeholders untouched. Loaded in a browser, any plain English text
left on a panel is text that bypasses `t()`, and anything cut off is a layout that will clip in German. It is a
development aid, never shipped.

**Unit tests.** A Vitest setup file installs `chrome.i18n` backed by the English catalog, with a helper to switch
language, so `replay-core.test.ts` and the others keep asserting English texts and can assert French ones.

**End-to-end tests.** The specs that stub `chrome` (`record.spec.ts`, `replay.spec.ts`) add `i18n` to the stub, backed
by the real catalog. The specs that load the real extension run in French by launching Chromium with the environment
variable `LANGUAGE=fr` and the flag `--lang=fr`. Measured on the pinned Chromium on Linux: the flag alone makes
`getMessage` answer in French but leaves `getUILanguage()` at `en-US`; with `LANGUAGE=fr` both agree (`fr`). New
specs: the popup and options in French; the Language setting switching a panel to German without restarting the
browser; a bug report written in French while the interface is English; the layout test above in German.

## Translating, reviewing, keeping up

- **The author of a change writes the English and drafts the other languages in the same pull request.** The check
  fails on a missing key, so no language silently falls back to English. Drafts are cheap for the agents that write
  most changes here, and a draft in the right place beats an English hole.
- **A glossary per language**, `apps/extension/i18n/glossary.<code>.md`, fixes the recurring terms, starting from the
  words the dashboard's French already uses: *locator* stays *locator* (masculine), *run* is *exécution*, *flaky* is
  *instable*, *passed* / *failed* are *réussi* / *en échec*, *test id* stays *test id*, *assertion* is *assertion*,
  *step* is *étape*. The check can then flag a French message that uses *sélecteur* for a locator.
- **Review status** lives in `apps/extension/i18n/README.md`: per language, who reviewed it and at which version. French
  is reviewed by the team before the release that ships it. German, Spanish and Portuguese ship as drafts until a
  native reader reviews them, said as much in their store listings, with an issue template for translation fixes.
- **Plain language while extracting.** Moving 550 strings is the moment to rewrite the technical ones, as was done for
  the bug report's element kinds: the English is fixed first, in the extraction pull request, so the translators
  translate the final text once.
- A hosted translation tool (Weblate reads WebExtension `messages.json` natively) is worth it only when outside
  contributors translate; the files above work with one.

## Store listings and documentation

Each language gets its `extDescription` (132 characters), its `store/amo-description.<code>.md`, and the Chrome Web
Store description entered in the developer dashboard from the same file. `scripts/amo-metadata.mjs` already maps
`pt_BR` to AMO's `pt-BR` and takes every `_locales/` directory. The French AMO description loses its "L'interface de
l'extension est en anglais" paragraph and names the tools as the French interface does. The documentation site stays in
English; `features/extension.md` gains a short **Languages** section (the five languages, the Options setting, what is
never translated) within the page's word budget, and screenshots stay English.

## Plan

**PR 1 — the machinery, the popup and the options page (en, fr).**

- [ ] `src/shared/i18n.ts`: `t`, `tn`, `initI18n`, `uiLanguage`, `localizeDocument`, the placeholder substitution; typed
      keys from `en/messages.json` (`resolveJsonModule` in the extension's `tsconfig.json`).
- [ ] `popup.html`, `src/popup/main.ts`, `options.html`, `src/options/main.ts`, the background's texts and badges
      (the replay's end clears its badge from the replay state, no longer by comparing the badge text with `PLAY`).
- [ ] The Language setting and the stored catalog, refreshed on install and update.
- [ ] `locales.test.ts`, `no-hardcoded-text.test.ts` with the not-yet-migrated list, the Vitest `chrome.i18n` setup,
      the `--pseudo` build, the French e2e launcher (`LANGUAGE=fr`).
- [ ] `apps/extension/i18n/README.md` and `glossary.fr.md`.

**PR 2 — the panels (en, fr).** Pick and hover, the locator console, multi-pick, the lint overlay, assertions, session,
agent context, record, results, test functions, coverage, the bug report, the replay. The largest by far (coverage
alone holds about 95 strings), and the one where the English is rewritten in plain words. It may be split in two, the
picking tools first. The not-yet-migrated list ends empty.

**PR 3 — the phrasebooks (en, fr).** `BugPhrases` in core, English and French; `role-words.ts` folded into them; the
bug report's **Report language** choice; the replay verdict and step captions through the phrasebook; stability rules
and converter warnings by code.

**PR 4 — German, Spanish, Brazilian Portuguese.** Their catalogs, phrasebooks, glossaries, store summaries and
descriptions; the layout pass and test in German; the docs section. Adding a language afterwards is these files and
nothing else.

## Open questions

1. **The five languages.** English, French, German, Spanish and Brazilian Portuguese as proposed, or another set (Italian
   or Japanese instead of one of them)?
2. **The report's language.** Defaulting to the interface's language suits a team that files in its own language; a
   team filing into an English tracker would rather default to English and change it once. A remembered last choice
   covers both; is that enough?
3. **Unreviewed drafts in the stores.** Ship German, Spanish and Portuguese as drafts (marked as such), or hold each
   until a native reader has reviewed it?
4. **The dashboard.** It has English and French for tickets and quality reports only. This plan leaves it alone, but the
   glossaries and the phrasebooks are written so the dashboard could adopt them later.
