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
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { AclGrantManager } from './acl.js'
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

/**
 * Trim a display label to the persisted bound and strip control characters.
 * @param {unknown} value - raw label.
 * @returns {string} a safe label, possibly empty.
 */
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
    this.closed = false
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
      return {
        id: record.id,
        path: record.path,
        label: record.label,
        enabled: record.enabled,
        addedAt: record.addedAt,
        exists,
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
