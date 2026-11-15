/**
 * Confined Git execution for extra-workspace worktree mutations.
 *
 * This is the write path, deliberately separate from the read-only inspector
 * in `git.js`. It uses only public DSH services (`ctx.subprocess`,
 * `ctx.sandbox`, `ctx.sandboxPolicy`) rather than importing the experimental
 * worktree runtime internals. Windows process confinement still ignores
 * `additionalWritableRoots`, so the manager must have applied the extra root's
 * ACL grant before calling this module.
 */

/** Environment entries that would let an inherited shell point Git elsewhere. */
const SCRUBBED_GIT_ENV = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE',
]

/** A Git write that could not run, or ran with an unexpected status. */
export class ForgeCommandError extends Error {
  /**
   * @param {string} code - stable machine-readable code.
   * @param {string} message - human-readable failure.
   * @param {Record<string, unknown>} [details] - optional context.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ForgeCommandError'
    this.code = code
    Object.assign(this, details)
  }
}

/**
 * Build the child environment: remove inherited Git selectors, keep prompts
 * and lazy fetches off, and leave the rest of the user's ambient environment.
 * @returns {NodeJS.ProcessEnv} child environment.
 */
function gitEnvironment() {
  const env = { ...process.env }
  for (const key of SCRUBBED_GIT_ENV) delete env[key]
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_LFS_SKIP_SMUDGE: '1',
    LC_ALL: 'C',
  }
}

/**
 * Combine a caller signal with a deadline. The timer is always cleared.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @param {number} timeoutMs - command deadline.
 * @param {string} label - label used in the timeout failure.
 * @returns {{ signal: AbortSignal, dispose: () => void }} control pair.
 */
function deadline(signal, timeoutMs, label) {
  const controller = new AbortController()
  let timer
  const onAbort = () => controller.abort(signal?.reason ?? new Error(`${label} aborted`))
  if (signal !== undefined) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  timer = setTimeout(() => controller.abort(new ForgeCommandError('FORGE_TIMEOUT', `${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Read one collected stream completely.
 * @param {import('@deepseek-ai/dsh-subprocess').SubprocessOutputReader | undefined} reader - collected reader.
 * @returns {string} captured text.
 */
function readCollected(reader) {
  if (reader === undefined) return ''
  const output = reader.readFrom(0)
  if (output.lossy) throw new ForgeCommandError('FORGE_OUTPUT_TOO_LARGE', 'Git output exceeded the configured limit.')
  return output.text
}

/**
 * Run one Git command under the Session's sandbox policy.
 *
 * `read-only` sessions are rejected up front: the caller is trying to mutate a
 * worktree, and the sandbox would deny it anyway. `workspace-write` and
 * `danger-full-access` run the command, with the former confined.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} session - live Session.
 * @param {string} cwd - Git working directory.
 * @param {readonly string[]} args - Git arguments after the executable.
 * @param {object} [options] - command options.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {number} [options.timeoutMs] - command deadline (default 300 000).
 * @param {number} [options.graceMs] - termination grace (default 3 000).
 * @param {readonly number[]} [options.allowedExitCodes] - accepted statuses (default `[0]`).
 * @param {number} [options.maxBytes] - per-stream capture limit (default 65 536).
 * @param {string} [options.gitCommand] - Git executable (default `git`).
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>} captured command result.
 * @throws {ForgeCommandError} when the command is unavailable, timed out, or exits with an unaccepted status.
 */
export async function runGit(ctx, session, cwd, args, options = {}) {
  const subprocess = ctx.get('subprocess')
  const sandbox = ctx.get('sandbox')
  if (subprocess === undefined || sandbox === undefined) {
    throw new ForgeCommandError('FORGE_UNAVAILABLE', 'The subprocess or sandbox service is not mounted; extra worktrees cannot be created.')
  }
  const policy = ctx.sandboxPolicy.resolve({ session })
  if (policy.mode === 'read-only') {
    throw new ForgeCommandError('FORGE_READ_ONLY', 'The session is read-only; extra worktrees cannot be created.')
  }
  const control = deadline(options.signal, options.timeoutMs ?? 300_000, 'Git command')
  const maxBytes = options.maxBytes ?? 65_536
  const gitCommand = options.gitCommand ?? process.env.DSH_GIT_COMMAND ?? 'git'
  try {
    const program = await subprocess.resolveExecutable(gitCommand, undefined, control.signal)
    const command = [program, ...args]
    const wrapped = policy.mode === 'danger-full-access'
      ? command
      : (await sandbox.confine(command, { ...policy, mode: policy.mode }, control.signal)).argv
    control.signal.throwIfAborted()
    const child = subprocess.spawn({
      argv: wrapped,
      cwd,
      env: gitEnvironment(),
      signal: control.signal,
      graceMs: options.graceMs ?? 3_000,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes },
        stderr: { maxBytes },
      },
    })
    try {
      const outcome = await child.done
      control.signal.throwIfAborted()
      const stdout = readCollected(child.collected.stdout)
      const stderr = readCollected(child.collected.stderr)
      const allowed = options.allowedExitCodes ?? [0]
      if (outcome.exitCode === null || !allowed.includes(outcome.exitCode)) {
        throw new ForgeCommandError(
          'FORGE_COMMAND_FAILED',
          `Git ${args[0] ?? ''} exited with ${outcome.signal ?? outcome.exitCode}: ${stderr.trim() || 'no output'}`,
          { exitCode: outcome.exitCode, stderr },
        )
      }
      return { stdout, stderr, exitCode: outcome.exitCode }
    } finally {
      child.terminate()
      await child.waitForExit()
    }
  } catch (error) {
    if (error instanceof ForgeCommandError) throw error
    if (control.signal.aborted) {
      const reason = control.signal.reason
      if (reason instanceof ForgeCommandError) throw reason
      throw new ForgeCommandError('FORGE_ABORTED', `Git ${args[0] ?? ''} was aborted: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
    throw new ForgeCommandError('FORGE_FAILED', `Git ${args[0] ?? ''} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    control.dispose()
  }
}
