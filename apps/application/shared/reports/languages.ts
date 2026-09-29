/**
 * The quality report languages, English first. A language is its code here and
 * its sentences file (`sentences.<code>.ts`) registered in `REPORT_SENTENCES`:
 * once the code is added, the compiler asks for the file. The request and
 * schedule validation, the MCP tool and the language pickers read this list,
 * which stays free of the sentences so the MCP catalog can list it cheaply.
 */
export const REPORT_LANGUAGES = ['en', 'fr'] as const;

export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

export function isReportLanguage(value: unknown): value is ReportLanguage {
  return typeof value === 'string' && (REPORT_LANGUAGES as readonly string[]).includes(value);
}
