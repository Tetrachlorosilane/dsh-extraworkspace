import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { resolveWorkspaceInput, WorkspacePathError } from '../src/paths.js'

const workspace = realpathSyncSafe(process.cwd())
const root = mkdtempSync(path.join(tmpdir(), 'dsh-xw-test-'))

/** Resolve a path the way the plugin does when the path must already exist. */
function realpathSyncSafe(value) {
  try {
    return realpathSync.native(value)
  } catch {
    return value
  }
}

function makeDir(name) {
  const directory = path.join(root, name)
  mkdirSync(directory, { recursive: true })
  return directory
}

function expectCode(input, code) {
  assert.throws(
    () => resolveWorkspaceInput(input, { sessionCwd: workspace, workspaceRoot: workspace }),
    (error) => {
      assert.ok(error instanceof WorkspacePathError, `expected WorkspacePathError, got ${String(error)}`)
      assert.equal(error.code, code, error.message)
      return true
    },
  )
}

test.after(() => {
  rmSync(root, { recursive: true, force: true })
})

test('accepts an absolute drive path and returns its physical identity', () => {
  const directory = makeDir('plain')
  const parsed = resolveWorkspaceInput(directory, { sessionCwd: workspace, workspaceRoot: workspace })
  assert.equal(parsed.canonicalPath.toLowerCase(), realpathSyncSafe(directory).toLowerCase())
  assert.equal(parsed.name, 'plain')
})

test('accepts forward slashes, quotes, and a trailing separator', () => {
  const directory = makeDir('forward')
  const parsed = resolveWorkspaceInput(`"${directory.replaceAll('\\', '/')}\\"`, { sessionCwd: workspace, workspaceRoot: workspace })
  assert.equal(parsed.canonicalPath.toLowerCase(), realpathSyncSafe(directory).toLowerCase())
})

test('accepts a path relative to the session working directory', () => {
  const directory = makeDir('relative')
  const relative = path.relative(workspace, directory)
  const parsed = resolveWorkspaceInput(relative, { sessionCwd: workspace, workspaceRoot: workspace })
  assert.equal(parsed.canonicalPath.toLowerCase(), realpathSyncSafe(directory).toLowerCase())
})

test('accepts a file URI', () => {
  const directory = makeDir('uri')
  const parsed = resolveWorkspaceInput(pathToFileURL(directory).href, { sessionCwd: workspace, workspaceRoot: workspace })
  assert.equal(parsed.canonicalPath.toLowerCase(), realpathSyncSafe(directory).toLowerCase())
})

test('accepts environment variables in percent and PowerShell spellings', () => {
  const name = `env-${process.pid}`
  const directory = path.join(process.env.TEMP ?? tmpdir(), name)
  mkdirSync(directory, { recursive: true })
  try {
    const percent = resolveWorkspaceInput(`%TEMP%\\${name}`, { sessionCwd: workspace, workspaceRoot: workspace })
    assert.equal(percent.canonicalPath.toLowerCase(), realpathSyncSafe(directory).toLowerCase())
    const ps = resolveWorkspaceInput(`$env:TEMP\\${name}`, { sessionCwd: workspace, workspaceRoot: workspace })
    assert.equal(ps.canonicalPath.toLowerCase(), realpathSyncSafe(directory).toLowerCase())
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('converts Cygwin and WSL drive spellings', (t) => {
  const directory = makeDir('cross-shell')
  const physical = realpathSyncSafe(directory)
  const parsedPath = path.win32.parse(physical)
  if (parsedPath.root.startsWith('\\\\')) {
    t.skip('UNC paths have no cygdrive/WSL spelling')
    return
  }
  const drive = parsedPath.root.charAt(0).toLowerCase()
  const rest = physical.slice(parsedPath.root.length).replaceAll('\\', '/')
  const cygwin = resolveWorkspaceInput(`/cygdrive/${drive}/${rest}`, { sessionCwd: workspace, workspaceRoot: workspace })
  assert.equal(cygwin.canonicalPath.toLowerCase(), physical.toLowerCase())
  const wsl = resolveWorkspaceInput(`/mnt/${drive}/${rest}`, { sessionCwd: workspace, workspaceRoot: workspace })
  assert.equal(wsl.canonicalPath.toLowerCase(), physical.toLowerCase())
  const msys = resolveWorkspaceInput(`/${drive}/${rest}`, { sessionCwd: workspace, workspaceRoot: workspace })
  assert.equal(msys.canonicalPath.toLowerCase(), physical.toLowerCase())
})

test('rejects a missing directory', () => {
  expectCode(path.join(root, 'missing-directory'), 'NOT_FOUND')
})

test('rejects a regular file', () => {
  const file = path.join(root, 'a-file.txt')
  writeFileSync(file, 'x')
  expectCode(file, 'NOT_DIRECTORY')
})

test('rejects a drive root', () => {
  expectCode('C:\\', 'DRIVE_ROOT')
})

test('rejects the session workspace itself and its subdirectories', () => {
  expectCode(workspace, 'WORKSPACE_SUBDIRECTORY')
  expectCode(path.join(workspace, 'tests'), 'WORKSPACE_SUBDIRECTORY')
})

test('rejects a directory that contains the session workspace', () => {
  expectCode(path.dirname(workspace), 'INSIDE_WORKSPACE')
})

test('rejects a protected Windows system directory', () => {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  expectCode(systemRoot, 'PROTECTED_SYSTEM_PATH')
})

test('rejects unknown environment variables instead of treating them literally', () => {
  expectCode('%DSH_XW_VARIABLE_THAT_DOES_NOT_EXIST%\\shared', 'UNKNOWN_VARIABLE')
})

test('rejects drive-relative paths', () => {
  expectCode('C:relative-folder', 'DRIVE_RELATIVE')
})

test('rejects a junction or symbolic link when one can be created', (t) => {
  const target = makeDir('symlink-target')
  const link = path.join(root, 'symlink-link')
  try {
    symlinkSync(target, link, 'junction')
  } catch {
    t.skip('this host cannot create a junction in the test directory')
    return
  }
  expectCode(link, 'SYMLINK')
})
