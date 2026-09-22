---
title: Localization
lang: en-US
---

# Localization

Piwi formats every date and time in the browser with the `Intl` API, so how they read follows a
locale (day/month order, 12-hour vs 24-hour time) and which moment they show follows a time zone.
Out of the box dates read in US English (`9/22/2026, 2:30:05 PM`) in the viewer's own time zone.

You can change both, at three levels, and each person can keep their own format.

## Who sets what

- **Each viewer** picks their own format under **Settings → Localization**. It is saved in that
  browser and overrides everything below, for that person only.
- **An administrator** sets the instance default on the same page. Everyone who has not chosen their
  own format gets it.
- **The environment** can pin the instance default with `PIWI_LOCALE` and `PIWI_TIME_ZONE`. Those
  fields then show read-only in the UI, but a viewer can still override the format for their own
  browser.

Precedence, highest first: the per-viewer override, then the env var, then the stored instance
default, then the built-in default (`en-US`, in the viewer's own browser time zone).

## Date and time format

The format follows a [BCP-47](https://en.wikipedia.org/wiki/IETF_language_tag) locale. A few examples
of the same instant:

| Locale  | Formatted                 |
| ------- | ------------------------- |
| `en-US` | `9/22/2026, 2:30:05 PM`   |
| `en-GB` | `22/09/2026, 14:30:05`    |
| `fr-FR` | `22/09/2026 14:30:05`     |
| `de-DE` | `22.09.2026, 14:30:05`    |
| `ja-JP` | `2026/9/22 14:30:05`      |

The settings dropdown lists common locales; `Intl` accepts any valid tag, so an environment value is
not limited to that list. The keyword `auto` follows each viewer's browser.

```bash
PIWI_LOCALE=fr-FR
```

## Time zone

Absolute times are shown in an [IANA](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
time zone. The default, `auto`, uses each viewer's own browser time zone, so a distributed team each
reads times in their local clock. Set a fixed zone when everyone should read the same wall-clock
time (a shared CI region, for example).

```bash
PIWI_TIME_ZONE=Europe/Paris
```

## Reference

`PIWI_LOCALE` and `PIWI_TIME_ZONE` are listed with every other setting in the
[configuration reference](/reference/configuration), and the
[configuration generator](/reference/configuration/generator) can write the block for you.
