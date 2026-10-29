import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { linkMentions } from '@shared/docs'
import type { AppData } from '@shared/types'

// Markdown to sanitised HTML for the doc preview. Raw HTML in the source survives only if it is safe.
// Images and other media are dropped: inline images are deferred, and remote loads would leak to third parties.
export function renderMarkdown(body: string, data: AppData): string {
  const html = marked.parse(linkMentions(body, data), { async: false })
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'img', 'video', 'audio', 'source', 'picture', 'link', 'meta', 'base'] })
}
