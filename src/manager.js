/**
 * Per-session allow-list orchestration.
 *
 * One `SessionState` owns the runtime grants for one live session. Every
 * mutation runs on that session's private promise chain, so a slow ACL
 * propagation cannot interleave with a remove or a toggle. The durable record
 * is updated only after the runtime grant succeeded (or, for a process-only
 * failure, after the file grant succeeded and the row is marked partial).
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { AclGrantManager, grantCurrentUserFullControl } from './acl.js'
import { inspectGit } from './forge/git.js'
import { createWorktree, removeWorktree } from './forge/worktree.js'
import { messageOf, resolveWorkspaceInput, WorkspacePathError } from './paths.js'

/** A session id that no live Session owns. */
export class SessionNotFoundError extends Error {
  constructor(sessionId) {
    super(`No live session has id ${JSON.stringify(sessionId)}.`)
    this.name = 'SessionNotFoundError'
    this.code = 'SESSION_NOT_FOUND'
  }
}

/** A requested allow-list entry does not exist. */
export class WorkspaceEntryNotFoundError extends Error {
  constructor(id) {
    super(`No extra workspace has id ${JSON.stringify(id)}.`)
    this.name = 'WorkspaceEntryNotFoundError'
    this.code = 'ENTRY_NOT_FOUND'
  }
}

/** A path is already configured for this session. */
export class WorkspaceConflictError extends Error {
  constructor(path) {
    super(`The directory is already configured for this session: ${path}`)
    this.name = 'WorkspaceConflictError'
    this.code = 'DUPLICATE'
  }
}

/** The explicit ACL repair could not be applied. */
export class PermissionRepairError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'PermissionRepairError'
    this.code = 'PERMISSION_REPAIR_FAILED'
  }
}

/**
 * Trim a display label to the persisted bound and strip control characters.
 * @param {unknown} value - raw label.
 * @returns {string} a safe label, possibly empty.
 */
function cleanKind(value) {
  return value === 'git-repo' || value === 'git-worktree' || value === 'directory' ? value : undefined
}

/**
 * Rebuild the persisted Git identity of one extra root.
 * @param {unknown} value - raw Git record.
 * @returns {{ repositoryRoot: string, commonDir: string | null, gitDir: string | null, isRepositoryRoot?: boolean } | undefined} normalized Git record.
 */
function cleanGit(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (typeof value.repositoryRoot !== 'string' || value.repositoryRoot === '') return undefined
  return {
    repositoryRoot: value.repositoryRoot,
    commonDir: typeof value.commonDir === 'string' && value.commonDir !== '' ? value.commonDir : null,
    gitDir: typeof value.gitDir === 'string' && value.gitDir !== '' ? value.gitDir : null,
    ...typeof value.isRepositoryRoot === 'boolean' ? { isRepositoryRoot: value.isRepositoryRoot } : {},
  }
}

/**
 * Rebuild the persisted worktree records of one extra root.
 * @param {unknown} value - raw worktree list.
 * @returns {Array<object>} valid worktree records.
 */
function cleanWorktrees(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const candidate of value.slice(0, 64)) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (typeof candidate.id !== 'string' || candidate.id === '' || seen.has(candidate.id)) continue
    if (typeof candidate.path !== 'string' || candidate.path === '') continue
    if (typeof candidate.branch !== 'string' || candidate.branch === '') continue
    if (typeof candidate.baseCommit !== 'string' || candidate.baseCommit === '') continue
    seen.add(candidate.id)
    result.push({
      id: candidate.id,
      path: candidate.path,
      branch: candidate.branch,
      baseCommit: candidate.baseCommit,
      createdAt: typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : Date.now(),
    })
  }
  return result
}

function cleanLabel(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 200)
}

/**
 * Rebuild a trusted record from whatever the storage layer returned. The
 * domain schema already validates shapes; this keeps the runtime safe when the
 * memory fallback or an older record is present.
 * @param {string} sessionId - owning session.
 * @param {unknown} record - stored value.
 * @returns {{ sessionId: string, roots: Array<object> }} normalized record.
 */
function normalizeRecord(sessionId, record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { sessionId, roots: [] }
  }
  const roots = []
  const seenIds = new Set()
  const seenPaths = new Set()
  const candidates = Array.isArray(record.roots) ? record.roots : []
  for (const candidate of candidates.slice(0, 64)) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (typeof candidate.id !== 'string' || candidate.id === '' || seenIds.has(candidate.id)) continue
    if (typeof candidate.path !== 'string' || candidate.path === '') continue
    const pathKey = candidate.path.toLowerCase()
    if (seenPaths.has(pathKey)) continue
    seenIds.add(candidate.id)
    seenPaths.add(pathKey)
    roots.push({
      id: candidate.id,
      path: candidate.path,
      label: cleanLabel(candidate.label),
      enabled: candidate.enabled !== false,
      addedAt: typeof candidate.addedAt === 'number' && Number.isFinite(candidate.addedAt) ? candidate.addedAt : Date.now(),
      ...cleanKind(candidate.kind) === undefined ? {} : { kind: cleanKind(candidate.kind) },
      ...cleanGit(candidate.git) === undefined ? {} : { git: cleanGit(candidate.git) },
      ...Array.isArray(candidate.worktrees) && candidate.worktrees.length > 0 ? { worktrees: cleanWorktrees(candidate.worktrees) } : {},
    })
  }
  return { sessionId, roots }
}

/**
 * One live session's runtime state.
 * @typedef {object} SessionState
 * @property {object} session - live DSH Session.
 * @property {{ sessionId: string, roots: Array<object> }} record - durable projection.
 * @property {Map<string, object>} applied - root id → applied grant record.
 * @property {Map<string, object>} gitStatus - root id → last read-only Git inspection.
 * @property {number} gitCheckedAt - epoch milliseconds of the last Git refresh, or 0.
 * @property {Promise<unknown>} chain - serialized operation tail.
 */

export class ExtraWorkspaceManager {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context with sessions, sandboxPolicy, and logging.
   * @param {object} store - durable store facade.
   */
  constructor(ctx, store) {
    this.ctx = ctx
    this.store = store
    this.acl = new AclGrantManager(ctx.logger)
    /** @type {Map<string, SessionState>} */
    this.states = new Map()
    /** @type {Map<string, Promise<unknown>>} */
    this.repoLocks = new Map()
    this.closed = false
    this.retainWorktreesOnArchive = false
  }

  /**
   * Load the persisted archive preference. The default is false, matching
   * Forge's retainOnArchive default: archive reclaims plugin-created worktrees.
   * @returns {Promise<void>} resolution after the best-effort read.
   */
  async loadPreferences() {
    try {
      const preferences = await this.store.getPreferences()
      this.retainWorktreesOnArchive = preferences?.retainWorktreesOnArchive === true
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-extraworkspace: cannot read the archive preference: ${String(error)}`)
    }
  }

  /**
   * Persist the archive preference and update the public state.
   * @param {boolean} retain - whether archived sessions keep extra worktrees.
   * @returns {Promise<void>} resolution after persistence.
   */
  async setRetainWorktreesOnArchive(retain) {
    if (this.ctx.get('forgePanel') === undefined) {
      throw new WorkspacePathError('FORGE_DISABLED', 'The forge bundle is not active; extra-worktree settings are unavailable.')
    }
    this.retainWorktreesOnArchive = retain === true
    await this.store.putPreferences({ id: 'global', retainWorktreesOnArchive: this.retainWorktreesOnArchive })
  }

  /**
   * Resolve a live Session or throw the HTTP-friendly not-found error.
   * @param {string} sessionId - session identity from the panel.
   * @returns {object} live Session.
   */
  requireSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new SessionNotFoundError(sessionId)
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) throw new SessionNotFoundError(sessionId)
    return session
  }

  /**
   * Load a session's durable record and materialize its grants. Idempotent;
   * concurrent callers share the same loading chain.
   * @param {object} session - live Session.
   * @returns {Promise<SessionState>} attached state.
   */
  async attach(session) {
    if (this.closed) throw new Error('The extra-workspace manager is closed.')
    let state = this.states.get(session.id)
    if (state !== undefined) {
      await state.chain
      return state
    }
    /** @type {SessionState} */
    state = {
      session,
      record: { sessionId: session.id, roots: [] },
      applied: new Map(),
      gitStatus: new Map(),
      gitCheckedAt: 0,
      chain: Promise.resolve(),
    }
    this.states.set(session.id, state)
    this.#enqueue(state, async () => {
      const stored = await this.store.get(session.id)
      state.record = normalizeRecord(session.id, stored)
      for (const record of state.record.roots) {
        const applied = await this.#applyRoot(state, record)
        state.applied.set(record.id, applied)
      }
    })
    await state.chain
    return state
  }

  /**
   * Attach by id, used by the Host event listeners.
   * @param {string} sessionId - live session identity.
   * @returns {Promise<SessionState>} attached state.
   */
  async attachById(sessionId) {
    return this.attach(this.requireSession(sessionId))
  }

  /**
   * Serialize worktree mutations across sessions that share one repository.
   * The session chain already orders one Session; this lock orders the shared
   * Git metadata directory across Sessions.
   * @template T
   * @param {string} key - canonical common Git directory or repository root.
   * @param {() => Promise<T>} operation - mutation to run at its slot.
   * @returns {Promise<T>} the operation's result.
   */
  #withRepoLock(key, operation) {
    const previous = this.repoLocks.get(key) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.repoLocks.set(key, tail)
    void tail.finally(() => {
      if (this.repoLocks.get(key) === tail) this.repoLocks.delete(key)
    })
    return run
  }

  /**
   * Serialize one operation on a session's chain.
   * @template T
   * @param {SessionState} state - session state.
   * @param {() => Promise<T>} operation - operation to run at its slot.
   * @returns {Promise<T>} the operation's result.
   */
  #enqueue(state, operation) {
    const run = state.chain.then(operation)
    state.chain = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Effective working directory for relative path input.
   * @param {object} session - live Session.
   * @returns {string} absolute directory.
   */
  sessionCwd(session) {
    const workingDirectory = this.ctx.get('workingDirectory')
    if (workingDirectory !== undefined) {
      try {
        const current = workingDirectory.get(session)
        if (typeof current === 'string' && current !== '') return current
      } catch {
        // Fall through to the immutable header.
      }
    }
    if (typeof session.header.cwd === 'string' && session.header.cwd !== '') return session.header.cwd
    return this.ctx.sandboxPolicy.workspaceRoot
  }

  /**
   * Physical workspace root the sandbox policy will enforce for this session.
   * @param {object} session - live Session.
   * @returns {string} canonical workspace root.
   */
  workspaceRoot(session) {
    return canonicalPath(this.ctx.sandboxPolicy.resolve({ session }).workspaceRoot)
  }

  /**
   * Apply one record's file and process grants. Never throws for a bad path;
   * it returns a status the panel renders and the add path can refuse.
   * @param {SessionState} state - owning session state.
   * @param {object} record - allow-list entry.
   * @returns {Promise<object>} applied record with `status`.
   */
  async #applyRoot(state, record) {
    /** @type {{ state: string, fileTools: string, processes: string, error?: string, errorCode?: string, warnings: string[] }} */
    const status = { state: 'inactive', fileTools: 'inactive', processes: process.platform === 'win32' ? 'inactive' : 'unsupported', warnings: [] }
    if (!record.enabled) {
      status.state = 'disabled'
      return { record, status }
    }

    let parsed
    try {
      parsed = resolveWorkspaceInput(record.path, {
        sessionCwd: this.sessionCwd(state.session),
        workspaceRoot: this.workspaceRoot(state.session),
      })
    } catch (error) {
      status.state = error instanceof WorkspacePathError && error.code === 'NOT_FOUND' ? 'missing' : 'error'
      status.errorCode = error instanceof WorkspacePathError ? error.code : 'PATH_ERROR'
      status.error = messageOf(error)
      return { record, status }
    }
    status.warnings = parsed.warnings

    let registrationDispose
    try {
      registrationDispose = this.ctx.sandboxPolicy.registerWritableRoot(state.session, parsed.canonicalPath)
      status.fileTools = 'active'
    } catch (error) {
      status.state = 'error'
      status.errorCode = 'FILE_GRANT_FAILED'
      status.error = messageOf(error)
      return { record, status }
    }

    let aclHandle
    if (process.platform === 'win32') {
      try {
        aclHandle = await this.acl.acquire(this.workspaceRoot(state.session), parsed.canonicalPath)
        status.processes = 'active'
        status.state = 'active'
      } catch (error) {
        status.processes = 'error'
        status.state = 'partial'
        status.errorCode = 'PROCESS_GRANT_FAILED'
        status.error = messageOf(error)
      }
    } else {
      status.state = 'active'
    }

    return {
      record: {
        ...record,
        path: parsed.canonicalPath,
        label: record.label || parsed.name,
      },
      registrationDispose,
      aclHandle,
      status,
    }
  }

  /**
   * Dispose one applied record's runtime grants, aggregating cleanup failures.
   * @param {object} applied - applied record.
   * @returns {Promise<void>} resolution after cleanup.
   */
  async #disposeApplied(applied) {
    const failures = []
    if (typeof applied.registrationDispose === 'function') {
      try {
        applied.registrationDispose()
      } catch (error) {
        failures.push(error)
      }
    }
    if (applied.aclHandle !== undefined) {
      try {
        await applied.aclHandle.release()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const failure of failures) {
      this.ctx.logger?.warn?.(`dsh-extraworkspace: failed to release a grant for ${applied.record?.path ?? 'a workspace'}: ${String(failure)}`)
    }
  }

  /**
   * Add one directory to a session's allow-list.
   * @param {string} sessionId - live session identity.
   * @param {string} input - user-supplied path.
   * @param {string} [label] - optional display label.
   * @returns {Promise<object>} the updated public session state.
   */
  async add(sessionId, input, label) {
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    return this.#enqueue(state, async () => {
      const parsed = resolveWorkspaceInput(input, {
        sessionCwd: this.sessionCwd(session),
        workspaceRoot: this.workspaceRoot(session),
      })
      if (state.record.roots.some((root) => root.path.toLowerCase() === parsed.canonicalPath.toLowerCase())) {
        throw new WorkspaceConflictError(parsed.canonicalPath)
      }
      if (state.record.roots.length >= 64) {
        throw new WorkspacePathError('LIMIT_REACHED', 'A session can configure at most 64 extra workspaces.')
      }
      const record = {
        id: randomUUID(),
        path: parsed.canonicalPath,
        label: cleanLabel(label) || parsed.name,
        enabled: true,
        addedAt: Date.now(),
      }
      const applied = await this.#applyRoot(state, record)
      if (applied.status.fileTools !== 'active') {
        await this.#disposeApplied(applied)
        throw new WorkspacePathError('APPLY_FAILED', applied.status.error || 'The sandbox grant could not be applied.')
      }
      const previous = state.record
      const next = { ...state.record, roots: [...state.record.roots, applied.record] }
      state.record = next
      state.applied.set(applied.record.id, applied)
      state.gitStatus.delete(applied.record.id)
      try {
        await this.store.put(next)
      } catch (error) {
        state.record = previous
        state.applied.delete(applied.record.id)
        await this.#disposeApplied(applied)
        throw error
      }
      return this.publicState(sessionId)
    })
  }

  /**
   * Remove one entry and revoke its grants.
   * @param {string} sessionId - live session identity.
   * @param {string} id - entry id.
   * @returns {Promise<object>} the updated public session state.
   */
  async remove(sessionId, id) {
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    return this.#enqueue(state, async () => {
      const index = state.record.roots.findIndex((root) => root.id === id)
      if (index === -1) throw new WorkspaceEntryNotFoundError(id)
      const applied = state.applied.get(id)
      if (applied !== undefined) {
        await this.#disposeApplied(applied)
        state.applied.delete(id)
      }
      state.gitStatus.delete(id)
      const next = { ...state.record, roots: state.record.roots.filter((root) => root.id !== id) }
      state.record = next
      await this.store.put(next)
      return this.publicState(sessionId)
    })
  }

  /**
   * Enable or disable one entry without forgetting it.
   * @param {string} sessionId - live session identity.
   * @param {string} id - entry id.
   * @param {boolean} enabled - desired state.
   * @returns {Promise<object>} the updated public session state.
   */
  async setEnabled(sessionId, id, enabled) {
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    return this.#enqueue(state, async () => {
      const index = state.record.roots.findIndex((root) => root.id === id)
      if (index === -1) throw new WorkspaceEntryNotFoundError(id)
      const current = state.record.roots[index]
      if (current.enabled === enabled) return this.publicState(sessionId)

      const previousApplied = state.applied.get(id)
      if (!enabled) {
        if (previousApplied !== undefined) {
          await this.#disposeApplied(previousApplied)
          state.applied.delete(id)
        }
        state.gitStatus.delete(id)
        const next = { ...state.record, roots: state.record.roots.map((root) => root.id === id ? { ...root, enabled: false } : root) }
        state.record = next
        await this.store.put(next)
        return this.publicState(sessionId)
      }

      const record = { ...current, enabled: true }
      const applied = await this.#applyRoot(state, record)
      if (applied.status.fileTools !== 'active') {
        await this.#disposeApplied(applied)
        throw new WorkspacePathError('APPLY_FAILED', applied.status.error || 'The sandbox grant could not be applied.')
      }
      state.applied.set(id, applied)
      state.gitStatus.delete(id)
      const next = { ...state.record, roots: state.record.roots.map((root) => root.id === id ? applied.record : root) }
      state.record = next
      await this.store.put(next)
      return this.publicState(sessionId)
    })
  }

  /**
   * Re-validate and reapply one entry, refreshing its path spelling and
   * error status.
   * @param {string} sessionId - live session identity.
   * @param {string} id - entry id.
   * @returns {Promise<object>} the updated public session state.
   */
  async retry(sessionId, id) {
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    return this.#enqueue(state, async () => {
      const index = state.record.roots.findIndex((root) => root.id === id)
      if (index === -1) throw new WorkspaceEntryNotFoundError(id)
      const current = state.record.roots[index]
      if (!current.enabled) {
        throw new WorkspacePathError('DISABLED', 'Enable the entry before retrying it.')
      }
      const previousApplied = state.applied.get(id)
      if (previousApplied !== undefined) {
        await this.#disposeApplied(previousApplied)
        state.applied.delete(id)
      }
      const applied = await this.#applyRoot(state, current)
      state.applied.set(id, applied)
      state.gitStatus.delete(id)
      if (applied.status.fileTools === 'active') {
        const next = { ...state.record, roots: state.record.roots.map((root) => root.id === id ? applied.record : root) }
        state.record = next
        await this.store.put(next)
      }
      return this.publicState(sessionId)
    })
  }


  /**
   * Explicitly grant the signed-in user Full control on one entry's physical
   * directory, then reapply the sandbox grant. Used only from the panel's
   * "Fix permissions" confirmation; the ACE is additive and is not revoked
   * when the entry is removed.
   * @param {string} sessionId - live session identity.
   * @param {string} id - entry id.
   * @returns {Promise<object>} the updated public session state.
   */
  async repairPermissions(sessionId, id) {
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    return this.#enqueue(state, async () => {
      const index = state.record.roots.findIndex((root) => root.id === id)
      if (index === -1) throw new WorkspaceEntryNotFoundError(id)
      const current = state.record.roots[index]
      if (!current.enabled) {
        throw new WorkspacePathError('DISABLED', 'Enable the entry before repairing it.')
      }
      const parsed = resolveWorkspaceInput(current.path, {
        sessionCwd: this.sessionCwd(session),
        workspaceRoot: this.workspaceRoot(session),
      })
      try {
        await grantCurrentUserFullControl(parsed.canonicalPath)
      } catch (error) {
        throw new PermissionRepairError(messageOf(error), error)
      }
      const previousApplied = state.applied.get(id)
      if (previousApplied !== undefined) {
        await this.#disposeApplied(previousApplied)
        state.applied.delete(id)
      }
      const applied = await this.#applyRoot(state, { ...current, path: parsed.canonicalPath })
      state.applied.set(id, applied)
      state.gitStatus.delete(id)
      if (applied.status.fileTools === 'active') {
        const next = { ...state.record, roots: state.record.roots.map((root) => root.id === id ? applied.record : root) }
        state.record = next
        await this.store.put(next)
      }
      return this.publicState(sessionId)
    })
  }

  /**
   * Validate a path without applying it, for the panel's live preview.
   * @param {string} sessionId - live session identity.
   * @param {string} input - user-supplied path.
   * @returns {Promise<object>} normalized address and duplicate flag.
   */
  async preview(sessionId, input) {
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    const parsed = resolveWorkspaceInput(input, {
      sessionCwd: this.sessionCwd(session),
      workspaceRoot: this.workspaceRoot(session),
    })
    const duplicate = state.record.roots.find((root) => root.path.toLowerCase() === parsed.canonicalPath.toLowerCase())
    return { ...parsed, duplicate: duplicate === undefined ? null : { id: duplicate.id, label: duplicate.label } }
  }

  /**
   * Reclaim plugin-created extra worktrees when their Session is archived.
   * Only clean, registered, unlocked checkouts are removed; the branch and its
   * commits stay. The default is auto-clean, matching Forge's retainOnArchive
   * default; the tab switch turns it off.
   * @param {string} sessionId - archived Session id.
   * @returns {Promise<void>} resolution after the best-effort cleanup.
   */
  async archiveSession(sessionId) {
    if (this.retainWorktreesOnArchive) return
    if (this.ctx.get('forgePanel') === undefined) return
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return
    const state = this.states.get(sessionId)
    if (state === undefined) return
    const cleanup = this.#enqueue(state, async () => {
      let changed = false
      for (const record of state.record.roots) {
        if (record.kind !== 'git-repo' || record.git?.isRepositoryRoot !== true) continue
        if (state.applied.get(record.id)?.status.processes !== 'active') continue
        const remaining = []
        for (const worktree of record.worktrees ?? []) {
          const usedElsewhere = [...this.states.entries()].some(([otherId, other]) =>
            otherId !== sessionId && other.record.roots.some((otherRoot) =>
              (otherRoot.worktrees ?? []).some((otherWorktree) => path.win32.normalize(otherWorktree.path).toLowerCase() === path.win32.normalize(worktree.path).toLowerCase())))
          if (usedElsewhere) {
            remaining.push(worktree)
            continue
          }
          if (!existsSync(worktree.path)) {
            changed = true
            continue
          }
          try {
            const inspection = await inspectGit(worktree.path)
            const normalized = path.win32.normalize(worktree.path).toLowerCase()
            const listed = (inspection.worktrees ?? []).find((entry) => path.win32.normalize(entry.path).toLowerCase() === normalized)
            if (inspection.error != null || inspection.dirty !== 0 || listed?.locked) {
              remaining.push(worktree)
              continue
            }
            await this.#withRepoLock(record.git.commonDir ?? record.git.repositoryRoot, () => removeWorktree({
              ctx: this.ctx,
              session,
              repositoryRoot: record.git.repositoryRoot,
              path: worktree.path,
            }))
            changed = true
          } catch (error) {
            this.ctx.logger?.warn?.(`dsh-extraworkspace: archive cleanup kept ${worktree.path}: ${String(error)}`)
            remaining.push(worktree)
          }
        }
        if ((record.worktrees ?? []).length !== remaining.length) {
          record.worktrees = remaining
          changed = true
        }
      }
      if (changed) await this.store.put(state.record)
    })
    state.archiveCleanup = cleanup.catch((error) => {
      this.ctx.logger?.warn?.(`dsh-extraworkspace: archive cleanup failed for ${sessionId}: ${String(error)}`)
    })
    await state.archiveCleanup
  }

  /**
   * Re-inspect the Git state of every enabled extra workspace. This is a
   * read-only Host operation; it is only offered when the forge companion is
   * mounted, because the companion tab is the only consumer.
   * @param {string} sessionId - live session identity.
   * @returns {Promise<object>} the updated public state.
   */
  async refreshGit(sessionId) {
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    if (this.ctx.get('forgePanel') === undefined) return this.publicState(sessionId)
    return this.#enqueue(state, async () => {
      let changed = false
      for (const record of state.record.roots) {
        if (!record.enabled) {
          state.gitStatus.delete(record.id)
          continue
        }
        try {
          const inspection = await inspectGit(record.path)
          state.gitStatus.set(record.id, inspection)
          if (inspection.kind === 'git-repo' || inspection.kind === 'git-worktree') {
            const git = {
              repositoryRoot: inspection.repositoryRoot,
              commonDir: inspection.commonDir,
              gitDir: inspection.gitDir,
              isRepositoryRoot: inspection.isRepositoryRoot === true,
            }
            if (record.kind !== inspection.kind || JSON.stringify(record.git) !== JSON.stringify(git)) {
              record.kind = inspection.kind
              record.git = git
              changed = true
            }
          } else if (record.kind !== 'directory' || record.git !== undefined) {
            record.kind = 'directory'
            delete record.git
            changed = true
          }
        } catch (error) {
          state.gitStatus.set(record.id, { kind: 'directory', error: messageOf(error) })
        }
      }
      if (changed) await this.store.put(state.record)
      state.gitCheckedAt = Date.now()
      return this.publicState(sessionId)
    })
  }

  /**
   * Re-read one entry's Git state after a worktree mutation so the response
   * shows the new checkout immediately.
   * @param {object} state - attached session state.
   * @param {object} record - extra workspace record.
   * @returns {Promise<void>} resolution after the best-effort inspection.
   */
  async #inspectOne(state, record) {
    try {
      state.gitStatus.set(record.id, await inspectGit(record.path))
    } catch (error) {
      state.gitStatus.set(record.id, { kind: 'directory', error: messageOf(error) })
    }
    state.gitCheckedAt = Date.now()
  }

  /**
   * Resolve one extra entry that is an actual Git repository root and whose
   * process grant is active. Worktrees are only created for repository roots:
   * a linked-worktree entry's common Git directory is a separate grant, and a
   * subdirectory entry does not own the shared metadata.
   * @param {object} state - attached session state.
   * @param {string} entryId - extra workspace id.
   * @returns {{ record: object }} the validated entry.
   * @throws {WorkspacePathError|WorkspaceEntryNotFoundError} when the entry cannot host a worktree.
   */
  #worktreeEntry(state, entryId) {
    const record = state.record.roots.find((root) => root.id === entryId)
    if (record === undefined) throw new WorkspaceEntryNotFoundError(entryId)
    if (!record.enabled) throw new WorkspacePathError('DISABLED', 'Enable the entry before creating a worktree.')
    if (record.kind !== 'git-repo') {
      throw new WorkspacePathError(
        'WORKTREE_NOT_REPO',
        'Worktrees can be created only for an extra workspace that is a Git repository root. Add the repository root instead of a subdirectory or linked worktree.',
      )
    }
    if (record.git?.isRepositoryRoot !== true) {
      throw new WorkspacePathError(
        'WORKTREE_NOT_REPO_ROOT',
        'The extra workspace is inside a Git repository but is not its root. Add the repository root to create worktrees.',
      )
    }
    const applied = state.applied.get(record.id)
    if (applied?.status.processes !== 'active') {
      throw new WorkspacePathError(
        'WORKTREE_PERMISSION',
        'The extra repository needs an active Windows process grant before a worktree can be created. Use Retry or Fix permissions.',
      )
    }
    return { record }
  }

  /**
   * Create an extra worktree without changing the Session working directory.
   * @param {string} sessionId - live session identity.
   * @param {string} entryId - extra repository entry id.
   * @param {{ name?: string, from?: string }} request - branch/directory name and local base revision.
   * @returns {Promise<object>} the updated public state.
   */
  async addWorktree(sessionId, entryId, request = {}) {
    if (this.ctx.get('forgePanel') === undefined) {
      throw new WorkspacePathError('FORGE_DISABLED', 'The forge bundle is not active; extra-worktree management is unavailable.')
    }
    const session = this.requireSession(sessionId)
    await this.refreshGit(sessionId)
    const state = await this.attach(session)
    return this.#enqueue(state, async () => {
      const { record } = this.#worktreeEntry(state, entryId)
      if ((record.worktrees ?? []).length >= 64) {
        throw new WorkspacePathError('LIMIT_REACHED', 'An extra repository can record at most 64 worktrees.')
      }
      const created = await this.#withRepoLock(record.git.commonDir ?? record.git.repositoryRoot, () => createWorktree({
        ctx: this.ctx,
        session,
        repositoryRoot: record.git.repositoryRoot,
        name: typeof request.name === 'string' ? request.name : undefined,
        from: typeof request.from === 'string' ? request.from : undefined,
      }))
      record.worktrees = [...(record.worktrees ?? []), created]
      await this.store.put(state.record)
      await this.#inspectOne(state, record)
      return this.publicState(sessionId)
    })
  }

  /**
   * Remove one worktree created by this plugin without force. The branch and
   * its commits stay; dirty, locked, or missing checkouts are refused by Git.
   * @param {string} sessionId - live session identity.
   * @param {string} entryId - extra repository entry id.
   * @param {string} worktreeId - persisted worktree record id.
   * @returns {Promise<object>} the updated public state.
   */
  async removeWorktree(sessionId, entryId, worktreeId) {
    if (this.ctx.get('forgePanel') === undefined) {
      throw new WorkspacePathError('FORGE_DISABLED', 'The forge bundle is not active; extra-worktree management is unavailable.')
    }
    const session = this.requireSession(sessionId)
    const state = await this.attach(session)
    return this.#enqueue(state, async () => {
      const { record } = this.#worktreeEntry(state, entryId)
      const worktrees = record.worktrees ?? []
      const worktree = worktrees.find((candidate) => candidate.id === worktreeId)
      if (worktree === undefined) throw new WorkspaceEntryNotFoundError(worktreeId)
      const relative = path.relative(record.path, worktree.path).split(path.sep).join('/')
      if (path.isAbsolute(relative) || relative === '' || relative.startsWith('../') || !relative.startsWith('.agents/worktrees/')) {
        throw new WorkspacePathError('WORKTREE_PATH_INVALID', `The worktree is not inside the configured pool: ${worktree.path}`)
      }
      await this.#withRepoLock(record.git.commonDir ?? record.git.repositoryRoot, () => removeWorktree({
        ctx: this.ctx,
        session,
        repositoryRoot: record.git.repositoryRoot,
        path: worktree.path,
      }))
      record.worktrees = worktrees.filter((candidate) => candidate.id !== worktreeId)
      await this.store.put(state.record)
      await this.#inspectOne(state, record)
      return this.publicState(sessionId)
    })
  }

  /**
   * Build the panel's serializable state.
   * @param {string} sessionId - live session identity.
   * @returns {object} public state.
   */
  publicState(sessionId) {
    const session = this.requireSession(sessionId)
    const state = this.states.get(sessionId)
    if (state === undefined) throw new Error(`Session ${sessionId} is not attached.`)
    const policy = this.ctx.sandboxPolicy.resolve({ session })
    const roots = state.record.roots.map((record) => {
      const applied = state.applied.get(record.id)
      const exists = existsSync(record.path)
      const status = applied?.status ?? {
        state: record.enabled ? 'unknown' : 'disabled',
        fileTools: 'inactive',
        processes: record.enabled ? (process.platform === 'win32' ? 'inactive' : 'unsupported') : 'inactive',
        warnings: [],
      }
      const inspection = state.gitStatus.get(record.id) ?? null
      const pathKey = (value) => path.win32.normalize(value).toLowerCase()
      const listed = new Map((inspection?.worktrees ?? []).map((worktree) => [pathKey(worktree.path), worktree]))
      const worktrees = (record.worktrees ?? []).map((worktree) => {
        const existsWorktree = existsSync(worktree.path)
        const entry = listed.get(pathKey(worktree.path))
        const stateValue = !existsWorktree
          ? 'missing'
          : entry?.locked
            ? 'locked'
            : entry === undefined
              ? 'unregistered'
              : 'present'
        return {
          id: worktree.id,
          path: worktree.path,
          branch: worktree.branch,
          baseCommit: worktree.baseCommit,
          createdAt: worktree.createdAt,
          state: stateValue,
        }
      })
      return {
        id: record.id,
        path: record.path,
        label: record.label,
        enabled: record.enabled,
        addedAt: record.addedAt,
        exists,
        kind: inspection?.kind ?? record.kind ?? 'directory',
        git: inspection,
        worktrees,
        status: {
          state: exists ? status.state : (record.enabled ? 'missing' : 'disabled'),
          fileTools: exists ? status.fileTools : 'inactive',
          processes: exists ? status.processes : 'inactive',
          error: status.error ?? null,
          errorCode: status.errorCode ?? null,
          warnings: status.warnings ?? [],
        },
      }
    })
    return {
      version: 1,
      sessionId,
      supported: process.platform === 'win32',
      storage: this.store.persistent ? 'persistent' : 'memory',
      mode: policy.mode,
      workspaceRoot: canonicalPath(policy.workspaceRoot),
      cwd: this.sessionCwd(session),
      roots,
      enabledCount: roots.filter((root) => root.enabled).length,
      forge: this.ctx.get('forgePanel') !== undefined,
      retainWorktreesOnArchive: this.retainWorktreesOnArchive,
      gitCheckedAt: state.gitCheckedAt > 0 ? state.gitCheckedAt : null,
    }
  }

  /**
   * Model-visible note for the sessions that actually have active extra
   * workspaces. Registered as a system-prompt context; returning an empty
   * string contributes nothing.
   * @param {object} session - live Session.
   * @returns {string} context text or an empty string.
   */
  promptFor(session) {
    const state = this.states.get(session.id)
    if (state === undefined) return ''
    const active = state.record.roots
      .filter((record) => record.enabled && state.applied.get(record.id)?.status.fileTools === 'active')
      .map((record) => record.path)
    if (active.length === 0) return ''
    const mode = this.ctx.sandboxPolicy.resolve({ session }).mode
    if (mode !== 'workspace-write') {
      return `Extra workspaces (dsh-extraworkspace): ${JSON.stringify(active)}. They are configured but inactive because the current file policy is ${mode}.`
    }
    return `Extra workspaces (dsh-extraworkspace): ${JSON.stringify(active)}. The DSH file tools may write there; on Windows this plugin also grants new sandboxed bash/PowerShell commands the same write capability. Commands started before the grant keep their previous permissions.`
  }

  /**
   * Release one session's grants; the durable record stays for a future
   * resume.
   * @param {string} sessionId - session identity.
   * @returns {Promise<void>} resolution after cleanup.
   */
  async detach(sessionId) {
    const state = this.states.get(sessionId)
    if (state === undefined) return
    if (state.archiveCleanup !== undefined) await state.archiveCleanup
    await state.chain
    for (const applied of state.applied.values()) {
      await this.#disposeApplied(applied)
    }
    state.applied.clear()
    this.states.delete(sessionId)
  }

  /**
   * Release every session and every shared ACL grant. Called from the plugin
   * effect's cleanup.
   * @returns {Promise<void>} resolution after best-effort cleanup.
   */
  async disposeAll() {
    if (this.closed) return
    this.closed = true
    for (const stateId of [...this.states.keys()]) {
      await this.detach(stateId)
    }
    await this.acl.disposeAll()
  }
}
