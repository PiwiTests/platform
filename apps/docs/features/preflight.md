---
title: Locator preflight
description: "Before a push, the test locators your change breaks: a renamed label, a removed test id, a changed translation, with the rewrite applied in place."
lang: en-US
---

# Locator preflight

Renaming a button breaks every test that finds it by its name, and CI tells you twenty minutes later. `piwi preflight`
tells you before you push: it reads your diff, lists the strings it removes or renames, and matches them against every
locator your tests used.

```
$ npx @piwitests/reporter preflight
piwi preflight · Acme Mugs · main · 212 locators from 48 tests · diff against HEAD

2 locators this change breaks
  src/components/CheckoutButton.vue:14   "Pay now" → "Pay"
    getByRole('button', { name: 'Pay now' })         click · 3 tests · likely
      tests/pages/checkout.page.ts:31    → getByRole('button', { name: 'Pay' })
  src/locales/en.json:88                 "Apply coupon" removed (key checkout.coupon.apply)
    getByText('Apply coupon')                        click · 1 test · likely
      tests/coupon.spec.ts:12            no replacement: the string is gone

9 tests reach the changed files · run them: npx @piwitests/reporter preflight --run
Apply the 1 rewrite: npx @piwitests/reporter preflight --fix
```

It needs the reporter and a dashboard that has recorded a run: the locators come from the project's
[locator index](/guide/concepts#locator-index), the chains Playwright reports on every step. Your source never leaves
the machine; preflight downloads the index and compares locally.

## What it reads in a diff

Preflight diffs the working tree against `HEAD` (your uncommitted changes), or against `--base <ref>`. On each changed
line of an application file it reads:

- **attribute values** of the attributes locators use: your test id attribute, `id`, `name`, `aria-label`,
  `placeholder`, `alt`, `title`, `role`, `value`, `label`, in every binding syntax (`title="…"`, `:title="'…'"`,
  `[title]="'…'"`, `title={'…'}`, `title: '…'`);
- **text between tags**, or a markup line that is only text;
- **quoted strings** in code;
- **translation values**: a changed line of a JSON, YAML, `.properties`, `.po` or `.resx` file under a `locales`,
  `locale`, `i18n`, `lang` or `translations` folder, or any `.resx`; and a template whose key changed
  (`t('checkout.pay')` → `t('checkout.payNow')`), resolved through those files, the `--locale` ones first.

A string that disappears is **removed**. When exactly one string of the same kind replaces it in the same hunk (the
same attribute, text for text, the same translation key), the change is a **rename**. Test files are skipped: a change
there edits the locator itself, and the next run records it.

## When a locator breaks

Each call of each chain is compared with the strings of the kind it reads, under Playwright's own rules: substring
and case-insensitive unless `exact: true`, whitespace collapsed, a regular expression tested as written.
`getByRole(…, { name })` reads text, translations, strings and the naming attributes; `getByText` and `hasText` read
text; `getByLabel` also reads `aria-label`; `getByPlaceholder`, `getByAltText` and `getByTitle` read their attribute;
`getByTestId` and `locator('#id')` compare exactly.

A chain breaks when a call matched the old string and does not match the new one. `getByRole('button', { name: 'Pay now' })`
survives `Pay now` → `Pay now!`, and `getByText('Pay')` survives `Pay now` → `Pay`, as they would in Playwright.

Breaks come in two confidence levels. **Likely**: the string was an attribute value, tag text or a translation.
**Possible**: a bare quoted string in code, which common words ("Save", "Next") match in many files. Preflight lists
likely breaks first and folds the possible ones into one line each.

## Fixing the tests

For a rename, each break carries the same chain with the new string; nothing else in the chain changes, and a regular
expression gets no rewrite. `--fix` writes a likely break's rewrite into every call site whose line holds the string,
keeping your quotes, and prints the files it edited. A possible break is never rewritten: its line shows the rewrite to
apply by hand if the text on the page did change. When the string comes from a constant or a helper argument, the call site's line does
not hold it: preflight lists the files that do, to edit by hand.

The index keeps the old chain until your next run records the new one, so after `--fix` the call site shows as
**already rewritten**.

## Running the tests it names

The dashboard's [test selection](/features/test-selection) knows which tests reach the changed files; preflight prints
how many. `--run` runs them, plus the specs of the broken locators, through the same path as `piwi run`: pass
Playwright arguments after `--`.

## In a pre-push hook

Add one line to `.husky/pre-push`. It checks what you are about to push, never fails the push on its own, and works in
Git for Windows' shell too:

```bash
npx @piwitests/reporter preflight --base @{upstream}
```

Add `--strict` to block the push while a likely break is left unfixed.

## Connection and offline use

Preflight reads the dashboard URL, the API key and the project from its flags, the environment
(`PIWI_DASHBOARD_URL`, `PIWI_API_KEY`, `PIWI_PROJECT_NAME`), the `.env` file [`piwi init`](/reference/cli#init)
writes, then the [desktop app](./desktop) when it is running. The API key comes from where the URL came from: a key in
your environment is never sent to a URL a workspace `.env` names. It compares with the default branch's index; `--branch`
picks another. Each index it downloads is kept in `.piwi/locator-index.json`, so with the dashboard unreachable it
runs on the last good copy and says how old it is.

Call sites are relative to the directory the reporter ran in. Preflight resolves them against the nearest
`playwright.config` above the working directory, or `--test-root`: point it at a local checkout of the tests when they
live in another repository. A call site outside the checkout is listed with its rewrite and not edited.

## Limits

- A name built by concatenation or interpolation, or assembled from several elements
  (`<button>Pay <b>now</b></button>`), is not seen. A string defined in one file and rendered from another through a
  variable is found only as a quoted string where it is defined, at *possible*.
- A locator no stored run used is not in the index.
- "No break found" means none in the strings the diff changes, not that none exists.

The flags and exit codes are on the [Piwi CLI](/reference/cli#preflight) page.

## Related

- [Who uses a locator](./locator-usage): the index preflight reads
- [Test selection](./test-selection): which tests reach a changed file
- [Locator healing](./locator-healing): when a locator broke anyway
