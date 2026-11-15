/**
 * Temporary integration harness for the real archive-cleanup path.
 *
 * This is a test-only bundle. Install it with Plugin Manager, wait for the
 * result file, then remove the bundle again. It is not part of the shipped
 * plugin and is not loaded by the profile patch.
 *
 * It creates a scratch Git repository, a real live Session through
 * `ctx.sessions.create`, adds the repository as an extra workspace through the
 * plugin's HTTP API, creates a worktree, archives the Session through
 * `ctx.workspaceRegistry.archiveSession`, and checks that the worktree was
 * removed while the branch survived.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const inject = ['sessions', 'workspaceRegistry']

const TEMP_ROOT = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : tmpdir()
const RESULT_FILE = path.join(TEMP_ROOT, 'xw-archive-selftest-result.json')
const BASE_URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:50609'

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Archive Harness',
      GIT_AUTHOR_EMAIL: 'archive@example.invalid',
      GIT_COMMITTER_NAME: 'Archive Harness',
      GIT_COMMITTER_EMAIL: 'archive@example.invalid',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Build a scratch repository with one committed file and LF checkout semantics.
 * @returns {{ base: string, repo: string, sessionDir: string }} temporary paths.
 */
function makeRepository() {
  const base = mkdtempSync(path.join(tmpdir(), 'xw-archive-selftest-'))
  const repo = path.join(base, 'repo')
  const sessionDir = path.join(base, 'session')
  execFileSync('mkdir', [sessionDir], { stdio: 'ignore' })
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'ignore' })
  git(repo, ['config', 'user.name', 'Archive Harness'])
  git(repo, ['config', 'user.email', 'archive@example.invalid'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-q', '-m', 'initial'])
  return { base, repo, sessionDir }
}

/**
 * Call the plugin's loopback route.
 * @param {string} route - path after the plugin prefix.
 * @param {object} [body] - POST body; omitted for GET.
 * @returns {Promise<{ status: number, json: object | null }>} response.
 */
async function api(route, body) {
  const bootstrapResponse = await fetch(`${BASE_URL}/dsh-extraworkspace/bootstrap`)
  const bootstrapText = await bootstrapResponse.text()
  let bootstrap
  try { bootstrap = JSON.parse(bootstrapText) } catch {
    throw new Error(`bootstrap returned ${bootstrapResponse.status}: ${bootstrapText.slice(0, 200)}`)
  }
  if (typeof bootstrap.token !== 'string') throw new Error(`bootstrap has no token: ${bootstrapText.slice(0, 200)}`)
  const headers = { 'x-dsh-extraworkspace-token': bootstrap.token }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${BASE_URL}/dsh-extraworkspace${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  if (json === null) throw new Error(`${route} returned ${response.status}: ${text.slice(0, 200)}`)
  return { status: response.status, json }
}

/**
 * Run the archive-cleanup integration scenario and write its result.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Promise<void>} resolution after the result file is written.
 */
async function run(ctx) {
  const { base, repo, sessionDir } = makeRepository()
  const result = { ok: false, base, repo }
  try {
    result.baseUrl = BASE_URL
    result.step = 'create-session'
    const session = ctx.sessions.create(undefined, { meta: { cwd: sessionDir } })
    result.sessionId = session.id
    result.step = 'add'
    const added = await api('/add', { sessionId: session.id, input: repo, label: 'Archive selftest' })
    if (added.status !== 200) throw new Error(`add failed: ${added.status} ${JSON.stringify(added.json)}`)
    const entry = added.json.roots.find((root) => root.label === 'Archive selftest')
    if (entry === undefined) throw new Error('added entry missing')
    result.step = 'refresh'
    const refreshed = await api(`/state?sessionId=${encodeURIComponent(session.id)}&refresh=1`)
    if (refreshed.status !== 200) throw new Error(`refresh failed: ${refreshed.status}`)
    result.step = 'add-worktree'
    const created = await api('/add-worktree', { sessionId: session.id, entryId: entry.id, name: 'probe', from: 'HEAD' })
    if (created.status !== 200) throw new Error(`worktree add failed: ${created.status} ${JSON.stringify(created.json)}`)
    const worktree = created.json.roots.find((root) => root.id === entry.id)?.worktrees?.at(-1)
    if (worktree === undefined) throw new Error('worktree record missing')
    result.worktree = worktree.path
    result.branch = worktree.branch
    result.existedBeforeArchive = existsSync(worktree.path)
    if (!result.existedBeforeArchive) throw new Error('worktree does not exist before archive')

    result.step = 'archive'
    await ctx.workspaceRegistry.archiveSession(session.id, { stopActivity: true })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && existsSync(worktree.path)) await sleep(250)
    result.existedAfterArchive = existsSync(worktree.path)
    result.branchAfterArchive = git(repo, ['branch', '--list', worktree.branch]).trim()
    result.ok = result.existedBeforeArchive === true
      && result.existedAfterArchive === false
      && result.branchAfterArchive.includes(worktree.branch)
  } catch (error) {
    result.error = error instanceof Error ? error.stack ?? error.message : String(error)
  } finally {
    writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`)
    try { rmSync(base, { recursive: true, force: true }) } catch {}
  }
}

/**
 * Start the harness in the background; the plugin stays mounted while it runs.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  void run(ctx).catch((error) => {
    ctx.logger?.warn?.(`xw-archive-harness: ${String(error)}`)
  })
  ctx.logger?.info?.(`xw-archive-harness: start; result will be ${RESULT_FILE}`)
}
