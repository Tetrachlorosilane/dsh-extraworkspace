/**
 * Manual end-to-end probe for the Windows process grant.
 *
 * This is NOT part of `node tests/paths.test.mjs`: it creates real low-integrity
 * children and mutates ACLs on temporary directories. Run it explicitly under
 * the DSH runtime, where the installation anchor is known:
 *
 *   ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" tests/acl-selftest.mjs
 *
 * It proves the central assumption of the plugin: a token minted for workspace
 * W, whose workspace capability SID is W-SID, can write into an extra directory
 * after the plugin grants W-SID there — and cannot write into an unrelated
 * directory.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const installDir = process.env.DSH_INSTALL_DIR
if (installDir === undefined || installDir === '') {
  throw new Error('DSH_INSTALL_DIR is not set; run this probe inside a DSH shell.')
}

const installRequire = createRequire(path.join(installDir, 'package.json'))
const aclEntry = installRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl')
const acl = await import(pathToFileURL(aclEntry).href)
const { AclSandbox, AclWriteGrant, tempWriteSid, workspaceWriteSid } = acl

const base = mkdtempSync(path.join(tmpdir(), 'dsh-xw-acl-selftest-'))
const workspace = path.join(base, 'workspace')
const extra = path.join(base, 'extra')
const third = path.join(base, 'third')
const privateTemp = path.join(base, 'private-temp')
for (const directory of [workspace, extra, third, privateTemp]) mkdirSync(directory)

const workspaceRoot = realpathSync.native(workspace)
const extraRoot = realpathSync.native(extra)
const thirdRoot = realpathSync.native(third)
const tempRoot = realpathSync.native(privateTemp)
const workspaceSid = workspaceWriteSid(workspaceRoot)
const tempSid = tempWriteSid(tempRoot)

console.log(`workspace: ${workspaceRoot}`)
console.log(`extra:     ${extraRoot}`)
console.log(`third:     ${thirdRoot}`)
console.log(`sid:       ${workspaceSid}`)

const sandbox = new AclSandbox({
  writableDirs: [workspaceRoot],
  tempDir: tempRoot,
  writeSid: workspaceSid,
  tempWriteSid: tempSid,
  mode: 'workspace-write',
})
let extraGrant
let failures = 0

/**
 * Run one redirection write under the confined token.
 * @param {string} target - directory to write into.
 * @param {string} name - file name.
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, file: string }>} result.
 */
async function confinedWrite(target, name) {
  const file = path.join(target, name)
  const child = sandbox.spawn({
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `echo ok>${file}`],
    cwd: workspaceRoot,
  })
  const result = await child.wait()
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
    file,
  }
}

/**
 * Remove the exact Everyone deny that `AclWriteGrant` leaves behind.
 * @param {string} directory - target directory.
 */
function removeGrantDeny(directory) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:DshXwPath
$acl = Get-Acl -LiteralPath $path
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'),
  [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles,
  [System.Security.AccessControl.InheritanceFlags]::ContainerInherit,
  [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Deny)
if ($acl.RemoveAccessRule($rule)) { Set-Acl -LiteralPath $path -AclObject $acl }
`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, DshXwPath: directory },
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) console.warn(`warning: deny cleanup failed for ${directory}: ${result.stderr}`)
}

try {
  await sandbox.init()
  extraGrant = AclWriteGrant.create(workspaceSid)
  extraGrant.add(extraRoot, false)

  const workspaceWrite = await confinedWrite(workspaceRoot, 'workspace.txt')
  console.log(`workspace write: exit=${workspaceWrite.exitCode} exists=${existsSync(workspaceWrite.file)}`)
  if (workspaceWrite.exitCode !== 0 || !existsSync(workspaceWrite.file)) failures += 1

  const extraWrite = await confinedWrite(extraRoot, 'extra.txt')
  console.log(`extra write:     exit=${extraWrite.exitCode} exists=${existsSync(extraWrite.file)}`)
  if (extraWrite.exitCode !== 0 || !existsSync(extraWrite.file)) {
    failures += 1
    console.error(extraWrite.stderr)
  }

  const thirdWrite = await confinedWrite(thirdRoot, 'third.txt')
  const thirdWrote = existsSync(thirdWrite.file)
  console.log(`third write:     exit=${thirdWrite.exitCode} exists=${thirdWrote} (expected: denied)`)
  if (thirdWrite.exitCode === 0 || thirdWrote) {
    failures += 1
    console.error('The confined child wrote outside every granted root.')
  }
} finally {
  try {
    extraGrant?.dispose()
  } catch (error) {
    console.warn(`warning: extra grant dispose failed: ${String(error)}`)
  }
  try {
    sandbox.dispose()
  } catch (error) {
    console.warn(`warning: sandbox dispose failed: ${String(error)}`)
  }
  removeGrantDeny(extraRoot)
  try {
    rmSync(base, { recursive: true, force: true })
  } catch (error) {
    console.warn(`warning: temp cleanup failed for ${base}: ${String(error)}`)
  }
}

if (failures > 0) {
  console.error(`acl-selftest: FAILED (${failures} assertion(s))`)
  process.exitCode = 1
} else {
  console.log('acl-selftest: OK')
}
