/**
 * Read-only Git inspector coverage.
 *
 * These tests create throwaway repositories under the OS temp directory and
 * never touch the user's repositories. They are skipped when Git is not on
 * PATH, so the path-only suite still runs on a bare checkout.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectGit } from '../src/forge/git.js'

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Inspector Test',
      GIT_AUTHOR_EMAIL: 'inspector@example.invalid',
      GIT_COMMITTER_NAME: 'Inspector Test',
      GIT_COMMITTER_EMAIL: 'inspector@example.invalid',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const available = hasGit()

test('reports ordinary directories without failing', { skip: !available }, async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'dsh-xw-inspect-plain-'))
  try {
    const result = await inspectGit(base)
    assert.equal(result.kind, 'directory')
    assert.equal(result.error, undefined)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('reports a repository branch, HEAD, dirtiness, and worktree list', { skip: !available }, async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'dsh-xw-inspect-repo-'))
  try {
    git(base, ['init', '-q', '-b', 'main'])
    git(base, ['config', 'user.name', 'Inspector Test'])
    git(base, ['config', 'user.email', 'inspector@example.invalid'])
    writeFileSync(path.join(base, 'tracked.txt'), 'one\n')
    git(base, ['add', 'tracked.txt'])
    git(base, ['commit', '-q', '-m', 'initial'])

    const clean = await inspectGit(base)
    assert.equal(clean.kind, 'git-repo')
    assert.equal(clean.branch, 'main')
    assert.equal(clean.dirty, 0)
    assert.equal(clean.clean, true)
    assert.equal(clean.worktrees.length, 1)
    assert.match(clean.head ?? '', /^[0-9a-f]+$/u)

    writeFileSync(path.join(base, 'tracked.txt'), 'two\n')
    const dirty = await inspectGit(base)
    assert.equal(dirty.dirty, 1)
    assert.equal(dirty.clean, false)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('distinguishes a linked worktree and reports its common Git directory', { skip: !available }, async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'dsh-xw-inspect-worktree-'))
  try {
    const main = path.join(base, 'main')
    const linked = path.join(main, '.agents', 'worktrees', 'probe')
    mkdirSync(main, { recursive: true })
    git(main, ['init', '-q', '-b', 'main'])
    git(main, ['config', 'user.name', 'Inspector Test'])
    git(main, ['config', 'user.email', 'inspector@example.invalid'])
    git(main, ['commit', '-q', '--allow-empty', '-m', 'initial'])
    git(main, ['worktree', 'add', '-q', '-b', 'probe', linked, 'HEAD'])

    const result = await inspectGit(linked)
    assert.equal(result.kind, 'git-worktree')
    assert.equal(result.branch, 'probe')
    assert.ok(result.commonDir)
    assert.ok(result.gitDir)
    assert.notEqual(result.commonDir.toLowerCase(), result.gitDir.toLowerCase())
    assert.equal(result.worktrees.length, 2)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
