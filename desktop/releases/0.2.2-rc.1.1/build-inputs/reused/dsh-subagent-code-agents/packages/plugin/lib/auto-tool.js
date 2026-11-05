/**
 * Host-plane policy that contributes the coding-agent tools to every composed
 * runtime root with an unseeded, top-level rc.2 Session header, except excluded
 * presets. `minimal` is always excluded.
 *
 * DSH's shipped preset root has precedence over user roots, so shadowing each
 * built-in preset is both ineffective and update-fragile. Agent-scoped effects
 * are the native lifecycle boundary: registrations are present before the
 * first post-publication turn and are removed with either the agent or this
 * policy plugin.
 */

import z from '@deepseek-ai/schemastery'
import { apply as applyTool, toolNames } from './tool.js'

export const name = 'auto-tool-subagent-code-agents'
export const inject = ['agents', 'agentPresets', 'sessions', 'tools', 'subagents', 'permissionPresets']

export const Config = z.object({
  excludedPresets: z.array(z.string()).default(['minimal']),
  providerPrefix: z.string().default('coding-agent'),
  enableRunInBackground: z.boolean().default(true),
  runRegistryPath: z.string(),
  rolesFile: z.string(),
  roles: z.array(z.object({
    id: z.string(),
    channel: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
    instructions: z.string(),
    allowDelegation: z.boolean().default(true),
    backgroundOnly: z.boolean().default(false),
    executionPermission: z.string(),
  })).default([]),
})

export function presetAllowsAutoTools(presetId, excludedPresets = ['minimal']) {
  return typeof presetId === 'string'
    && presetId.length > 0
    && presetId !== 'minimal'
    && !new Set(excludedPresets).has(presetId)
}

function agentAllowsAutoTools(ctx, agent) {
  try {
    const session = agent?.session
    const header = session?.header
    // rc.2 runtime ownership and durable lineage are independent: a resumed
    // child can be a runtime root. Require BOTH forms of top-level evidence.
    if (typeof agent?.id !== 'string' || agent.id.length === 0
      || session?.id !== agent.id || header?.id !== agent.id
      || header.version !== 4 || header.isSeeded !== false
      || header.parentSession !== undefined || header.origin !== undefined
      || (header.delegationDepth !== undefined && header.delegationDepth !== 0)
      || (agent.options?.subagentDepth !== undefined && agent.options.subagentDepth !== 0)
      || typeof ctx.agents.roots !== 'function'
      || !ctx.agents.roots().includes(agent)) return false

    // rc.2 has no built-in `permission.allowDelegation` service. Honor an
    // explicitly provided compatibility veto without treating a role profile
    // or an absent legacy service as the caller's official permission preset.
    return typeof agent.ctx?.get === 'function'
      && agent.ctx.get('permission')?.allowDelegation !== false
  } catch {
    // An unreadable identity/permission source is not evidence of a root.
    return false
  }
}

function visiblePluginTools(ctx, agent) {
  return toolNames.filter((toolName) => ctx.tools.get(toolName, agent) !== undefined)
}

export const apply = (ctx, config = {}) => {
  const excludedPresets = Array.isArray(config.excludedPresets)
    ? config.excludedPresets
    : ['minimal']
  const injected = {
    agents: ctx.agents,
    sessions: ctx.sessions,
    subagents: ctx.subagents,
    permissionPresets: ctx.permissionPresets,
  }
  const mounted = new Map()
  let stopping = false

  const reconcile = (agent) => {
    if (stopping) return false
    const presetId = ctx.agentPresets.composedPreset(agent.ctx)
    if (!presetAllowsAutoTools(presetId, excludedPresets) || !agentAllowsAutoTools(ctx, agent)) {
      const cleanup = mounted.get(agent)
      mounted.delete(agent)
      cleanup?.()
      return false
    }
    if (mounted.has(agent)) return false

    const existing = visiblePluginTools(ctx, agent)
    if (existing.length > 0) {
      if (existing.length !== toolNames.length) {
        ctx.logger.warn(
          `coding-agent tools: preset "${presetId}" has a partial conflicting tool set (${existing.join(', ')}); automatic mount skipped`,
        )
      } else {
        ctx.logger.debug(`coding-agent tools: preset "${presetId}" already mounts the tool plugin`)
      }
      return false
    }

    // The effect body runs synchronously, matching DSH's own agent-scoped tool
    // policies. This avoids a first-turn race that a deferred child plugin
    // activation could introduce after agent/created. Pass the host plugin's
    // injected service explicitly because agent contexts isolate `subagents`.
    const cleanup = agent.ctx.effect(
      () => applyTool(agent.ctx, config, { ...injected, ownerAgent: agent }),
      'coding-agent-tools.auto-mount()',
    )
    mounted.set(agent, cleanup)
    ctx.logger.debug(`coding-agent tools: auto-mounted for preset "${presetId}"`)
    return true
  }

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      reconcile(agent)
    })
    const stopPresetSelected = ctx.on('agent-preset/selected', (sessionId) => {
      const agent = ctx.agents.get(sessionId)
      if (agent !== undefined) reconcile(agent)
    })
    const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
      const cleanup = mounted.get(agent)
      mounted.delete(agent)
      cleanup?.()
    })

    // Covers hot-loading the bundle while sessions are already live.
    for (const agent of ctx.agents.list()) reconcile(agent)

    return async () => {
      stopping = true
      stopCreated()
      stopPresetSelected()
      stopDisposed()
      const cleanups = [...mounted.values()]
      mounted.clear()
      await Promise.allSettled(cleanups.map((cleanup) => Promise.resolve().then(() => cleanup())))
    }
  }, 'coding-agent-tools.lifecycle()')
}
