/**
 * Read-only projection for a persisted Session that has no live Agent.
 *
 * A cold Session is still a first-class conversation: DSH can open its history,
 * but `ctx.sessions.get()` has no entry and no file/process grants can exist.
 * The panel must therefore show the saved allow-list as `inactive` and refuse
 * mutations instead of returning a misleading 404. This module is pure except
 * for an existence check on each saved directory.
 */

import { existsSync } from 'node:fs'

/**
 * Find the last event of one log-only type.
 * @param {readonly object[]} events - replay-validated session events.
 * @param {string} type - event type.
 * @returns {object|undefined} last event payload.
 */
function lastData(events, type) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== null && typeof event === 'object' && event.type === type) {
      return event.data !== null && typeof event.data === 'object' ? event.data : undefined
    }
  }
  return undefined
}

/**
 * Project a cold Session plus its durable allow-list into the panel state.
 * @param {object} input - detached cold-session inputs.
 * @param {string} input.sessionId - session identity.
 * @param {object} input.header - detached `SessionHeader`.
 * @param {readonly object[]} input.events - complete replay-validated log.
 * @param {{sessionId: string, roots: object[]}} input.record - normalized durable record.
 * @param {boolean} input.supported - whether this platform supports process grants.
 * @param {'persistent'|'memory'} input.storage - storage mode.
 * @param {boolean} input.forge - whether the Forge companion is mounted.
 * @param {boolean} input.retainWorktreesOnArchive - current archive preference.
 * @returns {object} panel state with `live:false` and `readOnly:true`.
 */
export function summarizeColdSession(input) {
  const { sessionId, header, events, record, supported, storage, forge, retainWorktreesOnArchive } = input
  const mode = lastData(events, 'sandbox/mode')?.mode ?? null
  const approvalPolicy = lastData(events, 'approval/policy')?.policy ?? null
  const permissionPreset = lastData(events, 'permission/preset')?.preset ?? null
  const roots = record.roots.map((entry) => {
    const exists = existsSync(entry.path)
    return {
      id: entry.id,
      path: entry.path,
      label: entry.label,
      enabled: entry.enabled,
      addedAt: entry.addedAt,
      exists,
      kind: entry.kind ?? 'directory',
      git: null,
      worktrees: (entry.worktrees ?? []).map((worktree) => ({
        id: worktree.id,
        path: worktree.path,
        branch: worktree.branch,
        baseCommit: worktree.baseCommit,
        createdAt: worktree.createdAt,
        state: existsSync(worktree.path) ? 'unknown' : 'missing',
      })),
      status: {
        state: entry.enabled ? 'inactive' : 'disabled',
        fileTools: 'inactive',
        processes: supported ? 'inactive' : 'unsupported',
        error: null,
        errorCode: null,
        warnings: [],
      },
    }
  })
  const cwd = typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : null
  return {
    version: 1,
    sessionId,
    live: false,
    readOnly: true,
    supported,
    storage,
    mode,
    approvalPolicy,
    permissionPreset,
    workspaceRoot: cwd,
    cwd,
    nativeParentSessionId: header.parentSession ?? null,
    origin: header.origin ?? null,
    delegationDepth: header.delegationDepth ?? 0,
    agentPreset: header.agentPreset ?? null,
    isSeeded: header.isSeeded === true,
    roots,
    enabledCount: roots.filter((root) => root.enabled).length,
    forge,
    retainWorktreesOnArchive,
    gitCheckedAt: null,
  }
}
