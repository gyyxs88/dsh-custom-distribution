/** Recover fence languages from the public Chat projection, never toolbar
 * translations (rc.2 calls every unsupported language "Code" / "代码块"). */
import type { AssistantBlock, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

export interface SourceFence {
  language: string
  raw: string
}

export function normalizedFenceBody(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim()
}

/** Conservative top-level fence reader. Track ALL languages and delimiter
 * lengths so a literal dsh-ui example inside a longer code fence is not an
 * instruction. Nested list/quote fences are deliberately left to the host:
 * an uncertain source/DOM correspondence must keep the stock code visible. */
export function sourceFences(text: string): SourceFence[] {
  const out: SourceFence[] = []
  let open: { marker: string; size: number; indent: number; language: string; lines: string[] } | undefined
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (open !== undefined) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (close !== null && close[1]![0] === open.marker && close[1]!.length >= open.size) {
        out.push({ language: open.language, raw: normalizedFenceBody(open.lines.join('\n')) })
        open = undefined
      } else {
        // CommonMark removes up to the opening fence's indentation.
        open.lines.push(line.replace(new RegExp(`^ {0,${open.indent}}`), ''))
      }
      continue
    }
    // Do not search inside container fences or indented code examples.
    if (/^(?: {0,3}(?:>|[-+*] |\d+[.)] ).*| {4,})[\x60~]{3}/.test(line)) return []
    const start = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (start === null) continue
    const info = start[3]!.trim()
    if (start[2]![0] === '`' && info.includes('`')) continue
    open = {
      marker: start[2]![0]!, size: start[2]!.length, indent: start[1]!.length,
      // Match the host renderCode language token, including info suffixes.
      language: /^[\w-]+/.exec(info)?.[0] ?? '', lines: [],
    }
  }
  if (open !== undefined) out.push({ language: open.language, raw: normalizedFenceBody(open.lines.join('\n')) })
  return out
}

/** Only the already-selected session's public Chat source is read. There is
 * no session I/O, event-log traversal, private React state or content cache. */
export function assistantSourceFences(snapshot: unknown, key: string): SourceFence[] | undefined {
  const chat = snapshot as { nodes?: { get?: (key: string) => ConversationViewNode | undefined } } | undefined
  const node = chat?.nodes?.get?.(key)
  if (node?.kind !== 'assistant-step' || node.key !== key) return undefined
  const data = node.data as { blocks?: readonly AssistantBlock[] } | undefined
  if (!Array.isArray(data?.blocks)) return undefined
  return data.blocks.flatMap((block) => block.kind === 'text' ? sourceFences(block.text) : [])
}
