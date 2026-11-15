/**
 * Read-only Git inspection for extra workspaces.
 *
 * The inspector runs on the Host with the user's own rights. Reads are not
 * confined by DSH, and every command here is deliberately read-only:
 * `GIT_OPTIONAL_LOCKS=0` and `--no-optional-locks` keep `git status` from
 * refreshing the index. Writes (worktree add/remove, commits by the model)
 * are a different path and go through the Session sandbox policy.
 *
 * This module is companion-only. It is imported lazily by the manager so a
 * profile without the forge bundle never pays for it.
 */

import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Environment entries that would let an inherited shell point Git elsewhere. */
const SCRUBBED_GIT_ENV = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE',
]

/** Read-only command environment shared by every probe. */
function gitEnvironment() {
  const env = { ...process.env }
  for (const key of SCRUBBED_GIT_ENV) delete env[key]
  return {
    ...env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
    LC_ALL: 'C',
  }
}

/**
 * Resolve one path to its physical spelling, without failing the whole probe
 * when Windows cannot reparse it.
 * @param {string} value - absolute path from Git.
 * @returns {string} canonical path when possible.
 */
function canonical(value) {
  try {
    return realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

/**
 * Run one read-only Git command.
 * @param {string} gitCommand - executable or command name.
 * @param {string} directory - working directory for the command.
 * @param {readonly string[]} args - Git arguments.
 * @param {number} timeoutMs - command deadline.
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>} captured result.
 */
async function run(gitCommand, directory, args, timeoutMs) {
  try {
    const result = await execFileAsync(gitCommand, args, {
      cwd: directory,
      encoding: 'utf8',
      env: gitEnvironment(),
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: 0 }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Git executable was not found: ${gitCommand}`)
    }
    const stdout = typeof error?.stdout === 'string' ? error.stdout : ''
    const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
    const exitCode = typeof error?.code === 'number' ? error.code : 1
    return { stdout, stderr, exitCode }
  }
}

/**
 * Parse `git worktree list --porcelain` into compact records.
 * @param {string} output - porcelain output.
 * @returns {Array<object>} worktree records.
 */
function parseWorktrees(output) {
  const records = []
  let current = null
  for (const line of output.split(/\r?\n/u)) {
    if (line === '') {
      if (current !== null) records.push(current)
      current = null
      continue
    }
    if (line.startsWith('worktree ')) {
      if (current !== null) records.push(current)
      current = {
        path: line.slice('worktree '.length),
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      }
      continue
    }
    if (current === null) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace(/^refs\/heads\//u, '')
    else if (line === 'bare') current.bare = true
    else if (line === 'detached') current.detached = true
    else if (line.startsWith('locked')) current.locked = line.slice('locked'.length).trim() || 'locked'
    else if (line.startsWith('prunable')) current.prunable = line.slice('prunable'.length).trim() || 'prunable'
  }
  if (current !== null) records.push(current)
  return records.slice(0, 64)
}

/**
 * Count changed paths from NUL-delimited `git status --porcelain=v1 -z`.
 * @param {string} output - status output.
 * @returns {number} changed entry count.
 */
function countChanges(output) {
  let count = 0
  for (const field of output.split('\0')) {
    if (field === '') continue
    count += 1
    if (count >= 999) break
  }
  return count
}

/**
 * Inspect a directory's Git identity and current state.
 *
 * Non-repository directories resolve to `{ kind: 'directory' }` rather than an
 * error; that is a normal extra workspace. Repository and linked-worktree
 * directories return their canonical roots, branch, HEAD, dirty count, and
 * worktree list.
 *
 * @param {string} directory - absolute physical directory.
 * @param {object} [options] - probe options.
 * @param {string} [options.gitCommand] - Git executable (default `git`).
 * @param {number} [options.timeoutMs] - per-command deadline (default 10 000).
 * @returns {Promise<object>} inspection result.
 */
export async function inspectGit(directory, options = {}) {
  const gitCommand = options.gitCommand ?? process.env.DSH_GIT_COMMAND ?? 'git'
  const timeoutMs = options.timeoutMs ?? 10_000

  const inside = await run(gitCommand, directory, ['rev-parse', '--is-inside-work-tree'], timeoutMs)
  if (inside.exitCode !== 0) {
    if (/not a git repository/iu.test(inside.stderr)) return { kind: 'directory' }
    return {
      kind: 'directory',
      error: inside.stderr.trim() || `git rev-parse exited with ${inside.exitCode}`,
    }
  }
  if (inside.stdout.trim() !== 'true') {
    return { kind: 'directory', bare: true }
  }

  const [top, common, gitDir, branch, head, status, worktrees, upstream] = await Promise.all([
    run(gitCommand, directory, ['rev-parse', '--show-toplevel'], timeoutMs),
    run(gitCommand, directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'], timeoutMs),
    run(gitCommand, directory, ['rev-parse', '--path-format=absolute', '--git-dir'], timeoutMs),
    run(gitCommand, directory, ['symbolic-ref', '--quiet', '--short', 'HEAD'], timeoutMs),
    run(gitCommand, directory, ['rev-parse', '--short', 'HEAD'], timeoutMs),
    run(gitCommand, directory, ['--no-optional-locks', 'status', '--porcelain=v1', '-z'], timeoutMs),
    run(gitCommand, directory, ['worktree', 'list', '--porcelain'], timeoutMs),
    run(gitCommand, directory, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], timeoutMs),
  ])

  const repositoryRoot = top.exitCode === 0 ? canonical(top.stdout.trim()) : canonical(directory)
  const commonDir = common.exitCode === 0 ? canonical(common.stdout.trim()) : null
  const resolvedGitDir = gitDir.exitCode === 0 ? canonical(gitDir.stdout.trim()) : null
  const isWorktree = commonDir !== null && resolvedGitDir !== null
    && commonDir.toLowerCase() !== resolvedGitDir.toLowerCase()

  let ahead = null
  let behind = null
  if (upstream.exitCode === 0) {
    const [left, right] = upstream.stdout.trim().split(/\s+/u)
    if (Number.isSafeInteger(Number(left))) ahead = Number(left)
    if (Number.isSafeInteger(Number(right))) behind = Number(right)
  }

  const dirty = status.exitCode === 0 ? countChanges(status.stdout) : null

  const importantErrors = [top, common, gitDir, status, worktrees]
    .filter((result) => result.exitCode !== 0)
    .map((result) => result.stderr.trim())
    .filter((value) => value !== '')

  return {
    kind: isWorktree ? 'git-worktree' : 'git-repo',
    repositoryRoot,
    commonDir,
    gitDir: resolvedGitDir,
    branch: branch.exitCode === 0 ? branch.stdout.trim() || null : null,
    head: head.exitCode === 0 ? head.stdout.trim() || null : null,
    dirty,
    clean: dirty === null ? null : dirty === 0,
    ahead,
    behind,
    worktrees: worktrees.exitCode === 0 ? parseWorktrees(worktrees.stdout) : [],
    error: importantErrors.length === 0 ? null : importantErrors.join(' | '),
  }
}
