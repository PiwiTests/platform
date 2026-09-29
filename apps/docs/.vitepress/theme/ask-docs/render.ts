/**
 * Markdown to HTML for the "Ask the docs" panel: blocks of the docs and text a
 * local model wrote. The renderer emits no raw HTML and no image, sends a link
 * that leaves the site to a new tab, drops a link that points nowhere, and
 * wraps a table so a wide one scrolls inside the panel.
 */
import MarkdownIt from 'markdown-it'

export type Render = (markdown: string) => string

const SITE_PATH = /^\/(?!\/)/
const OUTSIDE = /^(?:https?:|mailto:)/i

export function createRenderer(base: string): Render {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })
  const prefix = base.replace(/\/$/, '')

  // The docs break a line inside a table cell with <br>.
  md.inline.ruler.before('html_inline', 'br', (state: any, silent: boolean) => {
    const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) state.push('hardbreak', 'br', 0)
    state.pos += match[0].length
    return true
  })

  // A link that is neither a path of the site nor an outside address is shown as plain text.
  md.core.ruler.push('ask_links', (state: any) => {
    for (const block of state.tokens) {
      let open: any = null
      for (const child of block.children ?? []) {
        if (child.type === 'link_open') {
          const href = child.attrGet('href') ?? ''
          open = SITE_PATH.test(href) || OUTSIDE.test(href) ? null : child
          if (open) Object.assign(child, { type: 'text', tag: '', content: '', attrs: null, nesting: 0 })
        } else if (child.type === 'link_close' && open) {
          Object.assign(child, { type: 'text', tag: '', content: '', attrs: null, nesting: 0 })
          open = null
        }
      }
    }
  })

  const linkOpen =
    md.renderer.rules.link_open ?? ((tokens: any, at: number, options: any, _env: any, self: any) => self.renderToken(tokens, at, options))
  md.renderer.rules.link_open = (tokens: any, at: number, options: any, env: any, self: any) => {
    const href: string = tokens[at].attrGet('href') ?? ''
    if (SITE_PATH.test(href)) tokens[at].attrSet('href', prefix + href)
    else {
      tokens[at].attrSet('target', '_blank')
      tokens[at].attrSet('rel', 'noopener noreferrer')
    }
    return linkOpen(tokens, at, options, env, self)
  }

  // An image would be a request to whatever address the text names.
  md.renderer.rules.image = (tokens: any, at: number) => md.utils.escapeHtml(tokens[at].content)

  // The panel has its own title: a heading in an answer sits two levels below where it would.
  const heading = (tokens: any, at: number, options: any, _env: any, self: any) => {
    tokens[at].tag = `h${Math.min(6, Number(tokens[at].tag.slice(1)) + 2)}`
    return self.renderToken(tokens, at, options)
  }
  md.renderer.rules.heading_open = heading
  md.renderer.rules.heading_close = heading

  md.renderer.rules.table_open = () => '<div class="ask-table"><table>\n'
  md.renderer.rules.table_close = () => '</table></div>\n'

  return (markdown) => md.render(markdown)
}
