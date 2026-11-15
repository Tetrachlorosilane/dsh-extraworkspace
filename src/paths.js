/**
 * Path intake for the per-session extra-workspaces panel.
 *
 * The panel accepts a directory address in whatever shape a Windows user is
 * likely to copy from an Explorer address bar, a Git Bash prompt, WSL, a
 * PowerShell provider, a `file:` URI, or an environment-variable expression.
 * This module normalizes all of them to one physical Windows directory and
 * rejects the ambiguous or unsafe shapes before any sandbox grant is touched.
 *
 * The final identity is `realpathSync.native()` on the normalized path, which
 * is exactly what `@deepseek-ai/dsh-sandbox`'s `canonicalPath()` and the
 * Windows ACL workspace SID derivation use. Keeping the same identity is what
 * makes a grant target the directory the sandbox will actually resolve.
 */

import { lstatSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const win32 = path.win32

/** A path the panel must refuse, with a stable machine-readable code. */
export class WorkspacePathError extends Error {
  /**
   * @param {string} code - stable code consumed by the HTTP layer and the UI.
   * @param {string} message - human-readable explanation.
   * @param {Record<string, unknown>} [details] - optional structured context.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'WorkspacePathError'
    this.code = code
    Object.assign(this, details)
  }
}

/** Environment names that may be expanded without a `%`/`$env:` marker. */
const BARE_ENV_NAMES = new Set([
  'home',
  'userprofile',
  'homedrive',
  'homepath',
  'temp',
  'tmp',
  'systemroot',
  'windir',
  'programfiles',
  'programfiles(x86)',
  'programdata',
  'appdata',
  'localappdata',
])

/**
 * Case-insensitive environment lookup. Windows environment names are
 * case-insensitive; `process.env` preserves the case used at launch.
 * @param {string} name - variable name.
 * @returns {string | undefined} its value, or undefined when unset/empty.
 */
function envValue(name) {
  const key = name.trim()
  if (key === '') return undefined
  const lower = key.toLowerCase()
  for (const [candidate, value] of Object.entries(process.env)) {
    if (candidate.toLowerCase() === lower && value !== undefined && value !== '') return value
  }
  return undefined
}

/**
 * Expand the variable spellings a Windows user can paste. An unknown
 * `%NAME%` or `$env:NAME` is an error rather than a literal path: silently
 * keeping it produces a confusing "not found" later.
 * @param {string} input - raw path text.
 * @returns {string} text with variables expanded.
 */
function expandEnvironment(input) {
  let result = input
  result = result.replace(/%([^%\r\n]+)%/g, (match, name) => {
    const value = envValue(name)
    if (value === undefined) throw new WorkspacePathError('UNKNOWN_VARIABLE', `Unknown environment variable %${name}%`)
    return value
  })
  result = result.replace(/\$\{env:([^}\r\n]+)\}/gi, (match, name) => {
    const value = envValue(name)
    if (value === undefined) throw new WorkspacePathError('UNKNOWN_VARIABLE', `Unknown environment variable $env:${name}`)
    return value
  })
  result = result.replace(/\$env:([A-Za-z_][A-Za-z0-9_()]*)/gi, (match, name) => {
    const value = envValue(name)
    if (value === undefined) throw new WorkspacePathError('UNKNOWN_VARIABLE', `Unknown environment variable $env:${name}`)
    return value
  })
  result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_()]*)\}/g, (match, name) => {
    const value = envValue(name)
    if (value === undefined) throw new WorkspacePathError('UNKNOWN_VARIABLE', `Unknown environment variable ${name}`)
    return value
  })
  result = result.replace(/\$(HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TEMP|TMP|SYSTEMROOT|WINDIR|PROGRAMFILES|PROGRAMDATA|APPDATA|LOCALAPPDATA)\b/gi, (match, name) => {
    if (!BARE_ENV_NAMES.has(name.toLowerCase())) return match
    const value = envValue(name)
    if (value === undefined) throw new WorkspacePathError('UNKNOWN_VARIABLE', `Unknown environment variable $${name}`)
    return value
  })
  return result
}

/**
 * Remove one pair of matching outer quotes, and tolerate a stray trailing
 * quote copied from a shell example.
 * @param {string} input - raw path text.
 * @returns {string} unquoted text.
 */
function stripOuterQuotes(input) {
  let result = input.trim()
  const first = result[0]
  if ((first === '"' || first === "'" || first === '`') && result.length >= 2 && result.endsWith(first)) {
    result = result.slice(1, -1).trim()
  }
  if ((result.startsWith('"') && !result.includes('"', 1)) || (result.startsWith("'") && !result.includes("'", 1))) {
    result = result.slice(1).trim()
  }
  if ((result.endsWith('"') && !result.includes('"', 0)) || (result.endsWith("'") && !result.includes("'", 0))) {
    result = result.slice(0, -1).trim()
  }
  return result
}

/**
 * Convert a Cygwin `/cygdrive/<drive>/...` path to a drive path.
 * @param {string} input - path text.
 * @returns {string} converted text, or the original when it is not a Cygwin path.
 */
function convertCygwin(input) {
  const match = /^\/cygdrive\/([a-zA-Z])(?:\/(.*))?$/u.exec(input)
  if (match === null) return input
  const [, drive, rest = ''] = match
  return `${drive.toUpperCase()}:\\${rest.replaceAll('/', '\\')}`
}

/**
 * Convert a WSL `/mnt/<drive>/...` path to a drive path.
 * @param {string} input - path text.
 * @returns {string} converted text, or the original when it is not a WSL mount path.
 */
function convertWsl(input) {
  const match = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/u.exec(input)
  if (match === null) return input
  const [, drive, rest = ''] = match
  return `${drive.toUpperCase()}:\\${rest.replaceAll('/', '\\')}`
}

/**
 * Convert a Git Bash / MSYS `/<drive>/...` path to a drive path. Only a
 * single-letter first segment qualifies, so `/usr`, `/opt` and `/tmp` are not
 * mistaken for drives.
 * @param {string} input - path text.
 * @returns {string} converted text, or the original when it is not an MSYS path.
 */
function convertMsys(input) {
  const match = /^\/([a-zA-Z])(?:\/(.*))?$/u.exec(input)
  if (match === null) return input
  const [, drive, rest = ''] = match
  return `${drive.toUpperCase()}:\\${rest.replaceAll('/', '\\')}`
}

/**
 * Normalize extended-length and forward-slash UNC spellings.
 * @param {string} input - path text.
 * @returns {string} normalized text.
 */
function normalizeUnc(input) {
  let result = input
  if (/^\\\\\?\\UNC\\/iu.test(result)) {
    result = `\\\\${result.slice(8)}`
  } else if (/^\\\\\?\\/u.test(result)) {
    result = result.slice(4)
  } else if (/^\/\/[^/]/u.test(result)) {
    result = `\\\\${result.slice(2).replaceAll('/', '\\')}`
  }
  return result
}

/**
 * True when `child` is `parent` or lies below it, ignoring case. Both paths
 * must be absolute.
 * @param {string} parent - absolute parent.
 * @param {string} child - absolute candidate.
 * @returns {boolean} containment verdict.
 */
export function isInsideDirectory(parent, child) {
  if (parent === '' || child === '') return false
  const relative = win32.relative(parent.toLowerCase(), child.toLowerCase())
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${win32.sep}`) && !win32.isAbsolute(relative))
}

/**
 * Directories the panel refuses without an override. These are system trees
 * where a write grant is almost never the user's intent and can break the
 * machine; the list uses the configured environment first, then the standard
 * Windows locations.
 * @returns {string[]} absolute system directories.
 */
function protectedSystemRoots() {
  const candidates = [
    process.env.SystemRoot,
    process.env.windir,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.DSH_INSTALL_DIR,
    process.execPath === undefined ? undefined : path.dirname(process.execPath),
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
  ]
  const roots = []
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue
    try {
      roots.push(win32.resolve(candidate))
    } catch {
      // An unusable environment entry contributes no protection.
    }
  }
  return roots
}

/**
 * Validate one directory and return its physical identity plus UI warnings.
 *
 * @param {string} raw - user-supplied directory address.
 * @param {object} options - resolution context.
 * @param {string} options.sessionCwd - absolute session working directory used for relative paths.
 * @param {string} [options.workspaceRoot] - physical session workspace root, if known.
 * @param {boolean} [options.allowSystemDirectories] - reserved for future explicit override; defaults false.
 * @returns {{
 *   input: string,
 *   path: string,
 *   canonicalPath: string,
 *   name: string,
 *   warnings: string[],
 * }} the normalized address.
 * @throws {WorkspacePathError} when the address is malformed, missing, a symlink, or protected.
 */
export function resolveWorkspaceInput(raw, options) {
  const { sessionCwd, workspaceRoot } = options
  if (typeof raw !== 'string') {
    throw new WorkspacePathError('INVALID_INPUT', 'The directory address must be a string.')
  }
  if (raw.length > 32_767) {
    throw new WorkspacePathError('TOO_LONG', 'The directory address exceeds the Windows path limit.')
  }
  if (/[\0\r\n]/u.test(raw)) {
    throw new WorkspacePathError('INVALID_CHARACTER', 'The directory address contains a NUL or line break.')
  }
  if (sessionCwd === undefined || !win32.isAbsolute(sessionCwd)) {
    throw new WorkspacePathError('NO_SESSION_CWD', 'The session has no absolute working directory to resolve against.')
  }

  let input = stripOuterQuotes(raw)
  if (input === '') throw new WorkspacePathError('EMPTY', 'Enter a directory path.')

  // PowerShell's provider-qualified file path.
  input = input.replace(/^Microsoft\.PowerShell\.Core\\FileSystem::/iu, '')

  // `file:` URIs carry their own drive/UNC semantics.
  if (/^file:/iu.test(input)) {
    try {
      input = fileURLToPath(input)
    } catch (error) {
      throw new WorkspacePathError('INVALID_URI', `Cannot decode the file URI: ${String(error)}`)
    }
  }

  input = expandEnvironment(input)
  if (input === '~' || input.startsWith('~/') || input.startsWith('~\\')) {
    input = `${homedir()}${input.slice(1)}`
  }

  input = convertCygwin(input)
  input = convertWsl(input)
  input = convertMsys(input)
  input = normalizeUnc(input)

  if (/^\\\\\.\\/u.test(input)) {
    throw new WorkspacePathError('DEVICE_PATH', 'Device paths such as \\\\.\\C: are not supported; choose a normal directory path.')
  }
  if (/^\\\\\?\\GLOBALROOT/iu.test(input)) {
    throw new WorkspacePathError('DEVICE_PATH', 'Global-root device paths are not supported; choose a normal directory path.')
  }
  if (/^[a-zA-Z]:(?![\\/])/u.test(input)) {
    throw new WorkspacePathError(
      'DRIVE_RELATIVE',
      'Drive-relative paths such as C:folder are ambiguous. Use an absolute path such as C:\\folder.',
    )
  }

  let absolute = win32.isAbsolute(input) ? win32.normalize(input) : win32.resolve(sessionCwd, input)
  if (!win32.isAbsolute(absolute)) {
    throw new WorkspacePathError('NOT_ABSOLUTE', `The address did not resolve to an absolute path: ${absolute}`)
  }
  const root = win32.parse(absolute).root
  // Trailing separators are a spelling, not an identity. Keep the root's own
  // separator (C:\ or \\server\share\) and drop the rest.
  if (absolute.length > root.length && /[\\/]+$/u.test(absolute)) {
    absolute = absolute.replace(/[\\/]+$/u, '')
  }
  if (root === absolute) {
    throw new WorkspacePathError('DRIVE_ROOT', `Refusing to grant an entire drive root (${absolute}). Choose a directory inside it.`)
  }

  let pathInfo
  try {
    pathInfo = lstatSync(absolute)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new WorkspacePathError('NOT_FOUND', `The directory does not exist: ${absolute}`, { path: absolute })
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new WorkspacePathError('ACCESS_DENIED', `Windows denied access to the directory: ${absolute}`, { path: absolute })
    }
    throw new WorkspacePathError('INSPECTION_FAILED', `Cannot inspect the directory: ${String(error)}`, { path: absolute })
  }
  if (pathInfo.isSymbolicLink()) {
    throw new WorkspacePathError(
      'SYMLINK',
      `The address is a symbolic link or junction (${absolute}). Use the physical target directory instead.`,
      { path: absolute },
    )
  }
  if (!pathInfo.isDirectory()) {
    throw new WorkspacePathError('NOT_DIRECTORY', `The address is not a directory: ${absolute}`, { path: absolute })
  }

  let canonicalPath
  try {
    canonicalPath = realpathSync.native(absolute)
  } catch (error) {
    throw new WorkspacePathError('REALPATH_FAILED', `Cannot resolve the physical directory: ${String(error)}`, { path: absolute })
  }
  if (!statSync(canonicalPath).isDirectory()) {
    throw new WorkspacePathError('NOT_DIRECTORY', `The resolved target is not a directory: ${canonicalPath}`, { path: canonicalPath })
  }
  if (canonicalPath.toLowerCase() !== absolute.toLowerCase()) {
    throw new WorkspacePathError(
      'PHYSICAL_PATH_REQUIRED',
      `Use the physical directory path ${JSON.stringify(canonicalPath)}; aliases and symlinked paths are not accepted.`,
      { path: canonicalPath },
    )
  }

  const warnings = []
  if (workspaceRoot !== undefined && workspaceRoot !== '') {
    if (canonicalPath.toLowerCase() === workspaceRoot.toLowerCase()) {
      throw new WorkspacePathError(
        'WORKSPACE_SUBDIRECTORY',
        `${canonicalPath} is the session workspace itself; no extra grant is needed.`,
        { path: canonicalPath },
      )
    }
    if (isInsideDirectory(canonicalPath, workspaceRoot)) {
      throw new WorkspacePathError(
        'INSIDE_WORKSPACE',
        `${canonicalPath} contains the session workspace. Choose a directory that does not contain the workspace, or use the workspace itself without an extra grant.`,
        { path: canonicalPath },
      )
    }
    if (isInsideDirectory(workspaceRoot, canonicalPath)) {
      throw new WorkspacePathError(
        'WORKSPACE_SUBDIRECTORY',
        `${canonicalPath} is already inside the session workspace (${workspaceRoot}); no extra grant is needed.`,
        { path: canonicalPath },
      )
    }
    if (win32.parse(canonicalPath).root.toLowerCase() !== win32.parse(workspaceRoot).root.toLowerCase()) {
      warnings.push(`This directory is on a different drive (${win32.parse(canonicalPath).root}).`)
    }
  }

  for (const systemRoot of protectedSystemRoots()) {
    if (isInsideDirectory(systemRoot, canonicalPath)) {
      throw new WorkspacePathError(
        'PROTECTED_SYSTEM_PATH',
        `${canonicalPath} is inside the protected system directory ${systemRoot}. Choose a project or user directory.`,
        { path: canonicalPath },
      )
    }
  }
  if (/^[a-zA-Z]:\\Users\\[^\\]+$/u.test(canonicalPath)) {
    warnings.push('This is an entire user-profile directory. Prefer a project subdirectory.')
  }
  if (canonicalPath.startsWith('\\\\')) {
    warnings.push('This is a network (UNC) directory; ACL propagation and availability depend on the server.')
  }
  if (canonicalPath.length > 240) {
    warnings.push('The path is long; some tools and ACL operations may behave differently.')
  }

  return {
    input: raw,
    path: absolute,
    canonicalPath,
    name: win32.basename(canonicalPath),
    warnings,
  }
}

/**
 * Human-readable message for any thrown path error.
 * @param {unknown} error - caught value.
 * @returns {string} its message.
 */
export function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
