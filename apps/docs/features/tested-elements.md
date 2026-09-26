---
title: Tested elements
lang: en-US
---

# Tested elements

<Needs reporter extension />

Open a page of your application, and see which of its elements your tests reach, through which
tests, and which buttons, links and fields no test reaches. **Tested elements** is a tool of the
[Piwi Picker extension](./extension), connected to your Piwi instance: open it from the toolbar
popup, or press `T` with the popup open.

It reads the project's [locator index](./locator-usage), the locator chains your tests used in
their steps, and evaluates each chain on the page the way Playwright would: roles and accessible
names, text and label matching, test ids (with the project's `testIdAttribute`), CSS and XPath,
`filter()`, `and()`/`or()`, `nth()`, open shadow roots and same-origin frames. Nothing about the
page is sent to your instance: the index comes down, the matching happens in the tab.

## Reading the overlay

- **Green boxes** are elements tests act on: click, fill, check, select, press.
- **Blue boxes** are elements tests only assert on (`toBeVisible`, `toHaveText`, …).
- **Dashed amber boxes** are visible buttons, links and fields that no test reaches.

Each box carries the number of tests that reach it; **Heatmap** shades the boxes by that number
instead. A dotted border means every locator reaching the element matches several elements on
this page: the test may use it on another page, or in a state where only one of them exists.

Hovering a box shows the locators and tests behind it, clicking pins that card, and each test
links to its page in the dashboard. **Find these locators in Piwi ↗** opens the project's
[Locators page](./locator-usage#the-locators-page) with the element's locators already checked.

The side panel sums up the page: how many of its interactive elements a test reaches, how many
none does, and how many tests have locators resolving here. Its three tabs list the matched
elements, the tests, and the elements no test reaches, each with a filter. A row of the last tab
copies a ranked locator for that element, to start writing its test. The page is re-checked as it
changes, so opening a menu or a dialog adds what the tests reach inside it.

## One element at a time

**Limit to an element**, in the panel, narrows the view to one part of the page: point at it
and click, with `↑` to widen the outline to its container and `↓` to narrow it back. The click
that chooses never reaches the page, so a link or a button is chosen without being followed or
pressed. The boxes, the summary and the three tabs then count only the element and what is
inside it: a form, a card, a menu.

**Around it** lists the tested elements that contain it: a test checking that the product card
is visible reaches the card, not the button inside it, which is a weaker answer. Clicking one
moves the view to that container, **Container ↑** does the same one level up, and **Whole page**
or **Esc** drops the limit.

Picking an element with the extension, while connected, gives the same answer without opening
the overlay: under its ranked locators, the tests that reach the element itself, those that
reach only something inside it, and those that reach only a container around it, each with
the actions they run. **Show tested elements inside it** opens the overlay limited to that
element. **Copy all** copies every ranked locator, one per line, for the
[Locators page](./locator-usage#the-locators-page) of the dashboard.

## Setting it up

1. Connect the extension to your instance and map the application's URLs to its project: see
   [Connecting to a Piwi instance](./extension#connecting-to-a-piwi-instance).
2. Let a few runs arrive. The index fills in from the steps the reporter already sends, with
   Playwright 1.61 or later: see the [requirements](./locator-usage#requirements-and-limits).
3. For projects that set `testIdAttribute` in their Playwright config, the reporter records it
   with each run, and `getByTestId` reads that attribute on the page.

The extension keeps a copy of the index for a minute, then downloads it again in the background;
the panel's **Refresh** downloads it now.

## What it does not tell you

- **Where the test used the locator.** The index keeps the chain, not the page URL of the step, so
  a chain is matched on whatever page you're on. `getByRole('button', { name: 'Save' })` used on
  the settings page also outlines a **Save** button on the profile page. The card lists the call
  sites, so you can check.
- **States the page is not in.** Only what is in the DOM now is matched: a closed menu, another
  step of a wizard, or content behind a login shows once the page shows it.
- **Locators the index skips**: chains cut short, `locator.describe()`, and locators used only
  through getters such as `textContent()`, as listed in the
  [index limits](./locator-usage#requirements-and-limits).
- **Cross-origin frames**, which an extension's page script cannot read, and a few selectors that
  depend on layout (`:left-of()`, `:near()`, …), listed under the panel's **Notes**.
- **While a modal dialog is open**, the browser keeps the rest of the page inert: the boxes stay
  visible, and the panel works again once the dialog closes.

A green box says a test reached the element, not that the test checks what matters about it. Use
it to find what nothing reaches, and to see which tests to read before changing an element.
