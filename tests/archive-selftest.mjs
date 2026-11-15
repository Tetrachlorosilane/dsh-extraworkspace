/**
 * Read the result of the real archive-cleanup harness.
 *
 * Run this after installing `tests/archive-harness` as a bundle and letting the
 * harness archive its scratch Session:
 *
 *   node tests/archive-selftest.mjs
 *
 * The harness writes its result to the OS temp directory and removes its
 * scratch repository. This script only validates and prints that result; it
 * does not mutate any Session.
 */

import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const tempRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : tmpdir()
const resultPath = path.join(tempRoot, 'xw-archive-selftest-result.json')
if (!existsSync(resultPath)) {
  console.error(`No archive-selftest result at ${resultPath}.`)
  console.error('Install tests/archive-harness with Plugin Manager, wait for it to run, then try again.')
  process.exit(2)
}
const result = JSON.parse(readFileSync(resultPath, 'utf8'))
console.log(JSON.stringify(result, null, 2))
if (result.ok !== true) {
  console.error('archive-selftest: FAILED')
  process.exit(1)
}
console.log('archive-selftest: OK (worktree removed, branch retained)')
