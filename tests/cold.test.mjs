import assert from 'node:assert/strict'
import { test } from 'node:test'

import { summarizeColdSession } from '../src/cold.js'

const header = {
  id: 's-cold',
  cwd: 'C:\\work\\project',
  parentSession: 's-parent',
  origin: 'subagent',
  delegationDepth: 1,
  agentPreset: 'standard',
  isSeeded: true,
}

const record = {
  sessionId: 's-cold',
  roots: [
    {
      id: 'r1',
      path: process.cwd(),
      label: 'Workspace',
      enabled: true,
      addedAt: 1,
      kind: 'directory',
      worktrees: [],
    },
  ],
}

test('projects a cold session as read-only with inactive grants', () => {
  const state = summarizeColdSession({
    sessionId: 's-cold',
    header,
    events: [
      { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
      { type: 'approval/policy', data: { policy: 'never' } },
      { type: 'permission/preset', data: { preset: 'workspace-write' } },
    ],
    record,
    supported: true,
    storage: 'persistent',
    forge: true,
    retainWorktreesOnArchive: false,
  })
  assert.equal(state.live, false)
  assert.equal(state.readOnly, true)
  assert.equal(state.mode, 'workspace-write')
  assert.equal(state.approvalPolicy, 'never')
  assert.equal(state.permissionPreset, 'workspace-write')
  assert.equal(state.nativeParentSessionId, 's-parent')
  assert.equal(state.origin, 'subagent')
  assert.equal(state.delegationDepth, 1)
  assert.equal(state.roots[0].status.state, 'inactive')
  assert.equal(state.roots[0].status.fileTools, 'inactive')
  assert.equal(state.roots[0].status.processes, 'inactive')
  assert.equal(state.enabledCount, 1)
})

test('cold state does not invent a sandbox mode without a persisted event', () => {
  const state = summarizeColdSession({
    sessionId: 's-cold',
    header,
    events: [],
    record,
    supported: true,
    storage: 'memory',
    forge: false,
    retainWorktreesOnArchive: false,
  })
  assert.equal(state.mode, null)
  assert.equal(state.approvalPolicy, null)
  assert.equal(state.permissionPreset, null)
  assert.equal(state.storage, 'memory')
  assert.equal(state.forge, false)
})

test('disabled roots stay disabled and absent worktrees are marked missing', () => {
  const state = summarizeColdSession({
    sessionId: 's-cold',
    header,
    events: [],
    record: {
      sessionId: 's-cold',
      roots: [
        {
          id: 'r1',
          path: process.cwd(),
          label: 'Workspace',
          enabled: false,
          addedAt: 1,
          kind: 'git-repo',
          worktrees: [
            {
              id: 'w1',
              path: `${process.cwd()}\\does-not-exist-worktree`,
              branch: 'feat',
              baseCommit: 'abc',
              createdAt: 1,
            },
          ],
        },
      ],
    },
    supported: true,
    storage: 'persistent',
    forge: true,
    retainWorktreesOnArchive: true,
  })
  assert.equal(state.roots[0].status.state, 'disabled')
  assert.equal(state.roots[0].kind, 'git-repo')
  assert.equal(state.roots[0].worktrees[0].state, 'missing')
  assert.equal(state.enabledCount, 0)
  assert.equal(state.retainWorktreesOnArchive, true)
})
