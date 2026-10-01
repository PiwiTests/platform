---
title: Bug report file format
description: "The .piwibug file Piwi Picker saves for a bug report: a zip archive with the steps, the failing test, the Markdown report, the evidence and the screenshots, and how a reader tells it from any other zip."
lang: en-US
---

# Bug report file format

[Report a bug](/features/report-a-bug) saves a report as one `.piwibug` file with **Download .piwibug**. Piwi Picker's
[Replay](/features/replay-a-bug-report) plays it, and the [desktop app](/features/desktop#importing-local-files)
imports it into a project as a [bug report](/features/bug-reports).

## The archive

A `.piwibug` file is a zip archive, its entries stored without compression:

| Entry | What it holds |
|---|---|
| `mimetype` | `application/vnd.piwi.bug-report+zip`, always the first entry |
| `steps.json` | The steps, as a [steps file](/reference/steps-format) |
| `<title>.spec.ts` | The failing test, named after the report's title, such as `coupon-not-applied.spec.ts` |
| `bug-report.md` | The report as Markdown, in the language Piwi Picker shows |
| `evidence.json` | The evidence and the context; see below |
| `screenshots/<n>-<moment>.png` | Up to three screenshots: `marked` (a step marked as wrong), `finish` or `manual` |

The `mimetype` entry is stored first and uncompressed, as EPUB and OpenDocument files do, so its text sits at a fixed
place at the start of the file. Piwi reads a file by that content, never by its name: renamed to `.zip`, to look
inside or to attach it where only known file types are accepted (a GitHub issue), it opens the same way. A zip
holding `steps.json` and `evidence.json` without the `mimetype` entry is read too.

## evidence.json

```json
{
  "v": 1,
  "context": {
    "origin": "https://staging.acme.test",
    "pageKey": "/checkout",
    "path": "/checkout",
    "browser": "Chrome 141",
    "userAgent": "Mozilla/5.0 …",
    "viewport": { "width": 1280, "height": 720 },
    "time": 1790467200000,
    "extensionVersion": "0.43.0"
  },
  "evidence": {
    "console": [{ "level": "error", "source": "console", "message": "Coupon failed: 500", "page": "/cart", "time": 1790467201000 }],
    "consoleDropped": 0,
    "requests": [{ "method": "POST", "url": "/api/cart/coupon?code=<redacted>", "status": 500, "page": "/cart", "time": 1790467201000 }],
    "requestsDropped": 0,
    "screenshots": [{ "file": "screenshots/1-marked.png", "step": 3, "moment": "marked", "takenAt": 1790467202000 }],
    "screenshotNote": null,
    "outline": "- heading \"Your cart\" [level=1]\n- textbox \"Coupon\": SPRING10"
  }
}
```

| Field | Meaning |
|---|---|
| `context` | The page the report was finished on, the browser, the window's viewport then, the time and the extension's version |
| `console` | Console errors and warnings, uncaught errors and unhandled rejections, at most 100; `consoleDropped` counts the rest |
| `requests` | Requests that failed or answered 400 or more: method, path with query values removed, status; at most 100 |
| `screenshots` | Each screenshot's file, the step it was taken after (0-based) and when |
| `screenshotNote` | Why there is no screenshot, when there is none |
| `outline` | An outline of the page in the YAML form of an ARIA snapshot, built by Piwi Picker, at most 400 lines |

Everything in `evidence.json` is checked when a file is read: a list past its limit is cut, an entry that does not fit
its shape is dropped, and a screenshot is kept only when its name is one the table above allows. The steps are checked
as a [steps file](/reference/steps-format#checks) is, and a file whose steps fail that check is refused.

## Related

- [Report a bug](/features/report-a-bug): recording a report and what it collects
- [Steps file format](/reference/steps-format): the format of `steps.json`
- [Bug reports](/features/bug-reports): what the instance does with a report
