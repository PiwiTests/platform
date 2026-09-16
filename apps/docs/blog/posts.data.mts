import { createContentLoader } from 'vitepress'

// Build-time index of blog posts. Every Markdown file in blog/ (except the
// index itself) becomes an entry here, newest first, so blog/index.md renders
// the list without anyone hand-maintaining it. Add a post → it shows up.
export interface BlogPost {
  title: string
  url: string
  date: string
  time: number
  excerpt: string
  author: string
}

declare const data: BlogPost[]
export { data }

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function toDate(value: unknown): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

// American English, spelled-out month. Matches the docs voice.
function formatDate(d: Date | null): string {
  if (!d) return ''
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export default createContentLoader('blog/*.md', {
  transform(raw) {
    return raw
      .filter((page) => page.url !== '/blog/')
      .map((page) => {
        const d = toDate(page.frontmatter.date)
        return {
          title: page.frontmatter.title ?? page.url,
          url: page.url,
          date: formatDate(d),
          time: d ? d.getTime() : 0,
          excerpt: page.frontmatter.excerpt ?? '',
          author: page.frontmatter.author ?? '',
        }
      })
      .sort((a, b) => b.time - a.time)
  },
})
