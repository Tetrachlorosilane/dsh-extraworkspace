import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('the browser bundle is valid JavaScript', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', 'client.js'], {
      cwd: root,
      stdio: 'pipe',
    })
  })
})
