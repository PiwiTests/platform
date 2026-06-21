export type LinkProvider =
  | 'jira'
  | 'github-issue'
  | 'github-pr'
  | 'gitlab-issue'
  | 'gitlab-mr'
  | 'bitbucket'
  | 'confluence'
  | 'slack'
  | 'linear'
  | 'notion'
  | 'generic';

const providerPatterns: { provider: LinkProvider; tests: RegExp[]; keyExtract?: RegExp }[] = [
  {
    provider: 'jira',
    tests: [
      /^https:\/\/([^./]+)\.atlassian\.net\/browse\//i,
      /^https:\/\/[^/]+\/jira\/software\/c\/projects\//i,
      /^https:\/\/[^/]+\/.+\/browse\//i,
    ],
    keyExtract: /\/([A-Z][A-Z0-9_]+-\d+)(?:\?|$|#)/i,
  },
  {
    provider: 'github-issue',
    tests: [/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\//i],
    keyExtract: /\/issues\/(\d+)/,
  },
  {
    provider: 'github-pr',
    tests: [/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\//i],
    keyExtract: /\/pull\/(\d+)/,
  },
  {
    provider: 'gitlab-issue',
    tests: [/^https:\/\/(gitlab\.[^/]+|[^/]+\.gitlab\.io)\/[^/]+\/[^/]+\/-\/issues\//i],
    keyExtract: /\/issues\/(\d+)/,
  },
  {
    provider: 'gitlab-mr',
    tests: [/^https:\/\/(gitlab\.[^/]+|[^/]+\.gitlab\.io)\/[^/]+\/[^/]+\/-\/merge_requests\//i],
    keyExtract: /\/merge_requests\/(\d+)/,
  },
  {
    provider: 'bitbucket',
    tests: [/^https:\/\/bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\//i],
    keyExtract: /\/pull-requests\/(\d+)/,
  },
  {
    provider: 'confluence',
    tests: [/^https:\/\/([^./]+)\.atlassian\.net\/wiki\//i],
  },
  {
    provider: 'slack',
    tests: [/^https:\/\/[^/]+\.slack\.com\//i],
  },
  {
    provider: 'linear',
    tests: [/^https:\/\/linear\.app\//i],
    keyExtract: /\/([A-Za-z]+-\d+)(?:\/|\?|$|#)/,
  },
  {
    provider: 'notion',
    tests: [/^https:\/\/(www\.)?notion\.so\//i],
  },
];

export function detectProvider(url: string): LinkProvider {
  for (const entry of providerPatterns) {
    if (entry.tests.some((r) => r.test(url))) {
      return entry.provider;
    }
  }
  return 'generic';
}

export function extractKey(url: string, provider: LinkProvider): string | null {
  const entry = providerPatterns.find((p) => p.provider === provider);
  if (!entry?.keyExtract) return null;
  const m = entry.keyExtract.exec(url);
  return m?.[1] ?? null;
}

export function getProviderIcon(provider: LinkProvider): string {
  const icons: Record<LinkProvider, string> = {
    jira: 'i-simple-icons-jira',
    'github-issue': 'i-simple-icons-github',
    'github-pr': 'i-simple-icons-github',
    'gitlab-issue': 'i-simple-icons-gitlab',
    'gitlab-mr': 'i-simple-icons-gitlab',
    bitbucket: 'i-simple-icons-bitbucket',
    confluence: 'i-simple-icons-confluence',
    slack: 'i-simple-icons-slack',
    linear: 'i-simple-icons-linear',
    notion: 'i-simple-icons-notion',
    generic: 'i-lucide-link',
  };
  return icons[provider];
}
