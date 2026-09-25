---
title: Quality reports
lang: en-US
---

# Quality reports

<Needs reporter />

A **quality report** is a document about the state of one or several projects over a period, written
for a reader who may never open the dashboard. It is not the Playwright HTML report a run carries (the
**run report**).

## Cost of a CI minute

An administrator can give a CI minute a price in **Settings → Performance**: an amount and an ISO 4217
currency, such as 0.008 USD. `PIWI_CI_MINUTE_COST` (`"0.008 USD"`) pins it and makes the setting
read-only. Once set, every wasted-time number is followed by its cost, on the analytics page and in the
quality report; unset, nothing changes and only minutes show. The cost is one value for the instance,
not per project.
