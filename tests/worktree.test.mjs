/**
 * Pure worktree name/path coverage. Creating real checkouts is covered by the
 * manual API probe because it needs a live DSH sandbox and ACL grant.
 */

import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatedWorktreeName, validWorktreeName, worktreePaths } from '../src/forge/worktree.js'

test('accepts relative branch names and rejects traversal/absolute shapes', () => {
  assert.equal(validWorktreeName('fix-login'), true)
  assert.equal(validWorktreeName('feature/login'), true)
  assert.equal(validWorktreeName(''), false)
  assert.equal(validWorktreeName('-danger'), false)
  assert.equal(validWorktreeName('../escape'), false)
  assert.equal(validWorktreeName('feature\\login'), false)
  assert.equal(validWorktreeName('C:repo'), false)
  assert.equal(validWorktreeName('feature//login'), false)
})

test('places a checkout under the repository .agents/worktrees pool', () => {
  const repo = path.join('D:', 'repo')
  const result = worktreePaths(repo, 'feature/login')
  assert.equal(result.pool, path.join(repo, '.agents', 'worktrees'))
  assert.equal(result.destination, path.join(result.pool, 'feature', 'login'))
})

test('refuses a path that escapes the pool', () => {
  assert.throws(() => worktreePaths('D:/repo', '../escape'), /Invalid worktree name/u)
})

test('generates one Forge-shaped fallback name', () => {
  const name = generatedWorktreeName('session-6b1f02c4-0000-4000-8000-000000000000')
  assert.match(name, /^dsh-6b1f02c4-[0-9a-f]{4}$/u)
})
