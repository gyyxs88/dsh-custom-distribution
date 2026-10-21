import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Kept as a URL so a packed lib/index.js resolves the package-root resource. */
export function loadGenuiSkill() {
  const relative = import.meta.url.endsWith('/src/plugin/skill.ts') ? '../../SKILL.md' : '../SKILL.md'
  const path = fileURLToPath(new URL(relative, import.meta.url))
  const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/u.exec(raw)
  if (match === null) throw new Error('genui: missing skill frontmatter/body')
  const description = /^description: (".*")$/mu.exec(match[1]!)?.[1]
  if (description === undefined || !/^name: genui$/mu.test(match[1]!)) throw new Error('genui: invalid skill metadata')
  return {
    name: 'genui', description: JSON.parse(description) as string,
    content: match[2]!.trim(), source: 'bundled', provider: 'dsh-genui', path,
    invocation: { modelInvocable: true, userInvocable: true },
    resourceBase: { kind: 'directory' as const, path: dirname(path) },
  }
}

export interface GenuiSkills {
  register(skill: ReturnType<typeof loadGenuiSkill>): () => void
}
