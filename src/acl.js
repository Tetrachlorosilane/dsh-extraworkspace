/**
 * Windows ACL grant management for extra workspaces.
 *
 * DSH's Windows sandbox mints a low-integrity, write-restricted token whose
 * restricting SIDs include one deterministic workspace capability
 * (`workspaceWriteSid(canonicalWorkspaceRoot)`). The built-in provider grants
 * that capability to the workspace tree only. This module grants the SAME
 * capability SID to a user-selected extra directory, using the exact
 * `AclWriteGrant` implementation DSH uses for its own workspace and temp
 * grants. A new confined child therefore resolves the same capability on the
 * extra directory and can write there.
 *
 * The grant also adds DSH's ambient-delete deny and Low mandatory label. The
 * deny is removed on revoke only when the directory did not already carry an
 * identical deny and no other capability-SID grant remains; the label is
 * cleared by `AclWriteGrant.dispose()` when no foreign capability grant
 * remains. DSH 0.2.2-rc.5 keeps workspace grants standing, so the second check
 * protects a directory that is also a DSH workspace. Together these checks keep
 * a removed extra workspace from silently retaining sandbox write authority.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

let aclModulePromise
let aclModuleError

/**
 * Load the installed Windows ACL backend lazily. The package is Windows-only,
 * and the plugin stays inert elsewhere, so a top-level import would make the
 * module fail to load on non-Windows hosts.
 * @returns {Promise<typeof import('@deepseek-ai/dsh-sandbox-windows-acl') | undefined>} the module, or undefined off Windows.
 */
async function loadAclModule() {
  if (process.platform !== 'win32') return undefined
  if (aclModuleError !== undefined) throw aclModuleError
  aclModulePromise ??= import('@deepseek-ai/dsh-sandbox-windows-acl').catch((error) => {
    aclModuleError = error
    throw error
  })
  return aclModulePromise
}

/** Absolute Windows PowerShell used for exact deny inspection/removal. */
function powershellExecutable() {
  const systemRoot = process.env.SystemRoot
  if (systemRoot !== undefined && systemRoot !== '') {
    return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }
  return 'powershell.exe'
}

/**
 * Run one bounded Windows PowerShell command. The path travels through an
 * environment variable, never through command-line quoting.
 * @param {string} script - PowerShell source.
 * @param {Record<string, string>} env - extra environment entries.
 * @returns {string} trimmed standard output.
 */
function runPowerShell(script, env) {
  const result = spawnSync(
    powershellExecutable(),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 1_048_576,
    },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = `${result.stderr || ''}`.trim() || `powershell exited with ${String(result.status)}`
    throw new Error(`PowerShell ACL helper failed: ${detail}`)
  }
  return `${result.stdout || ''}`.trim()
}

/**
 * Report whether the directory already carries DSH's exact ambient-delete
 * deny: `Everyone`, Deny, `FILE_DELETE_CHILD` (0x40), container inheritance,
 * no propagation. On any inspection failure this returns true, which makes
 * revocation conservative (never remove a deny the plugin cannot prove it
 * added).
 * @param {string} directory - absolute directory path.
 * @returns {Promise<boolean>} true when the exact deny is present.
 */
async function hasPreexistingEveryoneDeleteDeny(directory) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:DshXwPath
$acl = Get-Acl -LiteralPath $target
$everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$matches = @($acl.Access | Where-Object {
  $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
  $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $everyone.Value -and
  (($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles) -ne 0) -and
  (($_.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ContainerInherit) -ne 0) -and
  $_.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None
})
if ($matches.Count -gt 0) { '1' } else { '0' }
`
  try {
    const output = runPowerShell(script, { DshXwPath: directory })
    return output === '1'
  } catch {
    return true
  }
}

/**
 * Report whether the directory still carries any capability-SID allow ACE.
 *
 * DSH 0.2.2-rc.5 deliberately makes workspace grants standing: the
 * per-workspace SID's ACE is the cross-session reuse cache and is never
 * revoked. If this plugin's grant is removed from a directory that is also a
 * DSH workspace (or carries another plugin's capability grant), the shared
 * ambient-delete deny and Low label must stay. On any inspection failure this
 * returns true, which is the conservative answer.
 * @param {string} directory - absolute directory path.
 * @returns {Promise<boolean>} true when another capability grant may remain.
 */
async function hasAnyCapabilityGrant(directory) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:DshXwPath
$acl = Get-Acl -LiteralPath $target
foreach ($rule in $acl.Access) {
  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
  try {
    $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  } catch {
    continue
  }
  if ($sid -like 'S-1-4-*') { '1'; exit 0 }
}
'0'
`
  try {
    const output = runPowerShell(script, { DshXwPath: directory })
    return output === '1'
  } catch {
    return true
  }
}

/**
 * Remove DSH's ambient-delete deny from the directory.
 *
 * `icacls /remove:d` is deliberate: the ACL produced by the grant merge is not
 * always canonical, so .NET's `FileSystemAccessRule` round-trip throws
 * "ACL is not in canonical form", and `Set-Acl` also asks for
 * `SeSecurityPrivilege` once any SACL is present. `icacls` edits the DACL
 * through the native APIs, handles the non-canonical shape, and needs only the
 * owner's `WRITE_DAC`. It removes every `Everyone` deny on the directory, which
 * is why the caller first verifies that no identical deny existed before the
 * plugin granted the directory, and that no other capability grant remains.
 * DSH 0.2.2-rc.5 keeps workspace grants standing, so that second check is
 * required for coexistence.
 * @param {string} directory - absolute directory path.
 * @returns {Promise<void>} resolution after the DACL is written.
 */
async function removeEveryoneDeleteDeny(directory) {
  if (!existsSync(directory)) return
  const result = spawnSync('icacls', [directory, '/remove:d', '*S-1-1-0'], {
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 1_048_576,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || ''}`.trim() || `icacls exited with ${String(result.status)}`
    throw new Error(`icacls could not remove the plugin's Everyone deny on ${directory}: ${detail}`)
  }
}

/**
 * Grant the signed-in Windows user an inheritable Full control ACE on one
 * directory. DSH's Low-label write needs `WRITE_OWNER`, and many secondary
 * volumes grant the user only `Modify` through `Authenticated Users`; the
 * owner-implicit rights do not include `WRITE_OWNER`. This is an additive DACL
 * edit (existing ACEs, denies, owner, and inheritance stay intact) and is
 * only called from the panel's explicit "Fix permissions" confirmation.
 * @param {string} directory - absolute directory path.
 * @returns {Promise<string>} the current user's SID that was granted.
 */
export async function grantCurrentUserFullControl(directory) {
  if (!existsSync(directory)) throw new Error(`The directory no longer exists: ${directory}`)
  const sid = runPowerShell('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value', {}).trim()
  if (!/^S-1-5-\d+(?:-\d+)+$/u.test(sid)) {
    throw new Error(`Could not determine the current user's SID (PowerShell returned ${JSON.stringify(sid)}).`)
  }
  const result = spawnSync('icacls', [directory, '/grant', `*${sid}:(OI)(CI)F`], {
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 1_048_576,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || ''}`.trim() || `icacls exited with ${String(result.status)}`
    throw new Error(`Could not grant Full control to the current user on ${directory}: ${detail}`)
  }
  return sid
}

/**
 * Shared ref-counted grant table for one Host process.
 *
 * The unit of authority is `(workspace capability SID, physical directory)`.
 * Two sessions that share the same workspace and add the same extra directory
 * share one ACE; removing it from one session decrements the count, and the
 * last release revokes the ACE. Two sessions on different workspaces derive
 * different SIDs and therefore receive independent ACEs on the same directory.
 */
export class AclGrantManager {
  constructor(logger) {
    this.logger = logger
    /** @type {Map<string, { grant: import('@deepseek-ai/dsh-sandbox-windows-acl').AclWriteGrant, refs: number, path: string, pathKey: string }>} */
    this.entries = new Map()
    /** @type {Map<string, { path: string, keys: Set<string>, preexistingDeny: boolean }>} */
    this.pathStates = new Map()
    this.disposed = false
  }

  /**
   * Grant one extra directory for one workspace's capability SID.
   * @param {string} workspaceRoot - physical workspace root (already canonical).
   * @param {string} extraDirectory - physical extra directory (already canonical).
   * @returns {Promise<{ release: () => Promise<void> }>} an idempotent handle.
   */
  async acquire(workspaceRoot, extraDirectory) {
    if (this.disposed) throw new Error('The ACL grant manager is already disposed.')
    const acl = await loadAclModule()
    if (acl === undefined) throw new Error('The Windows ACL sandbox backend is not available on this platform.')
    const workspaceSid = acl.workspaceWriteSid(workspaceRoot)
    const pathKey = extraDirectory.toLowerCase()
    const key = `${workspaceSid.toLowerCase()}\0${pathKey}`

    let entry = this.entries.get(key)
    if (entry === undefined) {
      let pathState = this.pathStates.get(pathKey)
      if (pathState === undefined) {
        const preexistingDeny = await hasPreexistingEveryoneDeleteDeny(extraDirectory)
        pathState = { path: extraDirectory, keys: new Set(), preexistingDeny }
        this.pathStates.set(pathKey, pathState)
      }
      const grant = acl.AclWriteGrant.create(workspaceSid)
      try {
        grant.add(extraDirectory, false)
      } catch (error) {
        try {
          grant.dispose()
        } catch (cleanupError) {
          this.logger?.warn?.(`dsh-extraworkspace: grant rollback failed for ${extraDirectory}: ${String(cleanupError)}`)
        }
        throw error
      }
      entry = { grant, refs: 0, path: extraDirectory, pathKey }
      this.entries.set(key, entry)
      pathState.keys.add(key)
    }
    entry.refs += 1
    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        await this.#release(key)
      },
    }
  }

  /**
   * Release one acquisition. The last release revokes the capability ACE and,
   * when this plugin added it, the ambient-delete deny.
   * @param {string} key - internal entry key.
   * @returns {Promise<void>} resolution after cleanup.
   */
  async #release(key) {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.refs -= 1
    if (entry.refs > 0) return
    this.entries.delete(key)

    const failures = []
    try {
      entry.grant.dispose()
    } catch (error) {
      failures.push(error)
    }
    const pathState = this.pathStates.get(entry.pathKey)
    if (pathState !== undefined) {
      pathState.keys.delete(key)
      if (pathState.keys.size === 0) {
        this.pathStates.delete(entry.pathKey)
        if (!pathState.preexistingDeny) {
          try {
            if (!(await hasAnyCapabilityGrant(entry.path))) {
              await removeEveryoneDeleteDeny(entry.path)
            }
          } catch (error) {
            failures.push(error)
          }
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to revoke the extra-workspace grant on ${entry.path}`)
    }
  }

  /**
   * Revoke every grant this manager owns. Used on plugin unload; failures are
   * logged rather than thrown into Cordis teardown.
   * @returns {Promise<void>} resolution after best-effort cleanup.
   */
  async disposeAll() {
    if (this.disposed) return
    this.disposed = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    const failures = []
    for (const entry of entries) {
      try {
        entry.grant.dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const pathState of this.pathStates.values()) {
      if (pathState.preexistingDeny) continue
      try {
        if (!(await hasAnyCapabilityGrant(pathState.path))) {
          await removeEveryoneDeleteDeny(pathState.path)
        }
      } catch (error) {
        failures.push(error)
      }
    }
    this.pathStates.clear()
    for (const failure of failures) {
      this.logger?.warn?.(`dsh-extraworkspace: ACL cleanup failed: ${String(failure)}`)
    }
  }
}
