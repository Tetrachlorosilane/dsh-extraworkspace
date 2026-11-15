/**
 * Extra-workspace worktree operations.
 *
 * A worktree created here belongs to an extra repository root and lives under
 * that root's `.agents/worktrees/` pool. It is deliberately **not** entered:
 * the Session working directory stays where it was, and the model/user target
 * the new checkout through `bash.workdir` or absolute paths. This is the
 * opposite of Forge's root-workspace `create_worktree`, which changes cwd.
 *
 * The manager owns grants, records, and serialization; this module owns name
 * validation, directory allocation, and the Git argv.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ForgeCommandError, runGit } from './run.js'

/** Default pool directory, matching Forge's root-workspace convention. */
export const WORKTREE_POOL = '.agents/worktrees'

/**
 * Validate a relative worktree name without relying on Git's branch grammar.
 * @param {string} value - candidate branch/directory name.
 * @returns {boolean} whether every segment is relative and non-special.
 */
export function validWorktreeName(value) {
  return value.length > 0 && !value.includes('\\') && !value.includes(':')
    && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
    && !value.startsWith('-')
}

/**
 * Generate the same shape Forge uses for automatic names.
 * @param {string} sessionId - Session id, normally containing a UUID.
 * @returns {string} generated branch/directory name.
 */
export function generatedWorktreeName(sessionId) {
  const match = /[0-9a-f]{8}-[0-9a-f]{4}/iu.exec(sessionId)
  const head = match === null ? randomBytes(4).toString('hex') : match[0].slice(0, 8).toLowerCase()
  return `dsh-${head}-${randomBytes(2).toString('hex')}`
}

/**
 * Build the canonical checkout path for a name without creating it.
 * @param {string} repositoryRoot - absolute repository root.
 * @param {string} name - validated relative name.
 * @returns {{ pool: string, destination: string }} absolute paths.
 */
export function worktreePaths(repositoryRoot, name) {
  if (!validWorktreeName(name)) throw new ForgeCommandError('WORKTREE_NAME_INVALID', `Invalid worktree name: ${name}`)
  const pool = path.join(repositoryRoot, '.agents', 'worktrees')
  const destination = path.join(pool, ...name.split('/'))
  const relative = path.relative(pool, destination)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ForgeCommandError('WORKTREE_PATH_INVALID', `Worktree path leaves the pool: ${destination}`)
  }
  return { pool, destination }
}

/**
 * Allocate a checkout directory exclusively. Host-side directory creation is
 * safe here because the caller validated the repository root and applied the
 * ACL grant first; the new directory inherits the root's capability ACE.
 * @param {string} pool - pool directory.
 * @param {string} destination - checkout directory.
 * @returns {void}
 */
export function allocateWorktreeDirectory(pool, destination) {
  if (existsSync(destination)) throw new ForgeCommandError('WORKTREE_EXISTS', `The worktree path already exists: ${destination}`)
  const poolExisted = existsSync(pool)
  mkdirSync(path.dirname(pool), { recursive: true })
  if (!poolExisted) {
    mkdirSync(pool)
    try {
      writeFileSync(path.join(pool, '.gitignore'), '*\n', { flag: 'wx' })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  mkdirSync(destination)
}

/**
 * Create one worktree and check out its files without changing the Session
 * working directory.
 * @param {object} options - creation inputs.
 * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin context.
 * @param {object} options.session - live Session.
 * @param {string} options.repositoryRoot - extra Git repository root.
 * @param {string} [options.name] - branch/directory name.
 * @param {string} [options.from] - local revision; defaults to HEAD.
 * @param {AbortSignal} [options.signal] - cancellation.
 * @returns {Promise<{ id: string, path: string, branch: string, baseCommit: string, createdAt: number }>} created record.
 */
export async function createWorktree({ ctx, session, repositoryRoot, name, from, signal }) {
  const branch = name === undefined || name === '' ? generatedWorktreeName(session.id) : name
  if (!validWorktreeName(branch)) throw new ForgeCommandError('WORKTREE_NAME_INVALID', `Invalid worktree name: ${branch}`)
  if (from === '') throw new ForgeCommandError('WORKTREE_REVISION_INVALID', 'A worktree base revision is required.')
  const revision = from === undefined ? 'HEAD' : from
  const { pool, destination } = worktreePaths(repositoryRoot, branch)

  const check = await runGit(ctx, session, repositoryRoot, ['check-ref-format', `refs/heads/${branch}`], {
    allowedExitCodes: [0, 1],
    signal,
  })
  if (check.exitCode !== 0) throw new ForgeCommandError('WORKTREE_NAME_INVALID', `Git rejected the branch name: ${branch}`)

  const base = await runGit(ctx, session, repositoryRoot, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], { signal })
  const baseCommit = base.stdout.trim()
  if (!/^[0-9a-f]{40,64}$/iu.test(baseCommit)) {
    throw new ForgeCommandError('WORKTREE_REVISION_INVALID', `Cannot resolve a local commit for ${revision}.`)
  }
  if (existsSync(destination)) throw new ForgeCommandError('WORKTREE_EXISTS', `The worktree path already exists: ${destination}`)
  const existing = await runGit(ctx, session, repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowedExitCodes: [0, 1],
    signal,
  })
  if (existing.exitCode === 0) throw new ForgeCommandError('WORKTREE_BRANCH_EXISTS', `The branch already exists: ${branch}`)

  allocateWorktreeDirectory(pool, destination)
  try {
    await runGit(ctx, session, repositoryRoot, [
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false',
      'worktree', 'add', '--no-checkout', '-b', branch, '--', destination, baseCommit,
    ], { signal, timeoutMs: 300_000 })
    await runGit(ctx, session, destination, [
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false',
      'reset', '--hard', '--no-recurse-submodules', baseCommit,
    ], { signal, timeoutMs: 300_000 })
  } catch (error) {
    throw new ForgeCommandError(
      'WORKTREE_CREATE_FAILED',
      `Could not finish worktree ${branch} at ${destination}. The branch and checkout may be retained. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, path: destination },
    )
  }
  return { id: randomUUID(), path: destination, branch, baseCommit, createdAt: Date.now() }
}

/**
 * Remove one worktree without force; the branch stays. Git refuses dirty,
 * locked, or currently checked-out targets, which is the desired behavior.
 * @param {object} options - removal inputs.
 * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin context.
 * @param {object} options.session - live Session.
 * @param {string} options.repositoryRoot - extra Git repository root.
 * @param {string} options.path - worktree path.
 * @param {AbortSignal} [options.signal] - cancellation.
 * @returns {Promise<void>} resolution after Git removed the checkout.
 */
export async function removeWorktree({ ctx, session, repositoryRoot, path: worktreePath, signal }) {
  await runGit(ctx, session, repositoryRoot, ['worktree', 'remove', '--', worktreePath], { signal, timeoutMs: 300_000 })
}
