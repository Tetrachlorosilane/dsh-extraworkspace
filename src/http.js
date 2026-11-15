/**
 * The Host HTTP surface for the session-header panel.
 *
 * A static Client plugin cannot call Host services directly (the package-private
 * `host.call` bridge belongs to dynamic Cordis packages). It therefore uses one
 * same-origin JSON route, the same pattern the bundled external plugins use.
 * The route is loopback-only because the Host Web server is loopback by
 * default; a process-lifetime token prevents a page from another origin from
 * driving mutations even though bootstrap itself is unauthenticated.
 */

import { timingSafeEqual } from 'node:crypto'
import { messageOf, WorkspacePathError } from './paths.js'
import {
  SessionNotFoundError,
  WorkspaceConflictError,
  WorkspaceEntryNotFoundError,
} from './manager.js'

const PREFIX = '/dsh-extraworkspace'
const MAX_BODY_BYTES = 128 * 1024

/**
 * Whether a socket peer is the local machine. The panel edits real Windows
 * ACLs, so the route accepts only loopback peers even though DSH's Web carrier
 * may be configured to listen on a LAN address. This keeps an unauthenticated
 * bootstrap token from making the route remotely usable; remote DSH Web
 * deployments keep their normal authentication for the agent, but cannot drive
 * this local-permission panel.
 * @param {string | undefined} address - `req.socket.remoteAddress`.
 * @returns {boolean} loopback verdict.
 */
function isLoopbackPeer(address) {
  if (address === undefined || address === '') return false
  if (address === '::1') return true
  if (address.startsWith('127.')) return true
  if (address.startsWith('::ffff:127.')) return true
  return false
}

/** One HTTP-facing failure with an explicit status. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

/**
 * Read and decode one bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<Record<string, unknown>>} decoded object.
 */
async function readJsonBody(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'The request body is too large.')
    chunks.push(chunk)
  }
  if (bytes === 0) return {}
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'The request body is not valid JSON.')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_BODY', 'The request body must be a JSON object.')
  }
  return value
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON-serializable payload.
 * @returns {void}
 */
function sendJson(res, status, payload) {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Build the route handler.
 * @param {object} options - controller inputs.
 * @param {object} options.ctx - plugin context that owns the webServer.
 * @param {import('./manager.js').ExtraWorkspaceManager} options.manager - session manager.
 * @param {string} options.token - process-lifetime API token.
 * @param {string} options.version - plugin version for the bootstrap payload.
 * @returns {{ handle: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> }} controller.
 */
export function createHttpController({ ctx, manager, token, version }) {
  const tokenBuffer = Buffer.from(token, 'utf8')

  /**
   * Reject a request that did not present the process token.
   * @param {import('node:http').IncomingMessage} req - request.
   * @returns {void}
   */
  function requireToken(req) {
    const header = req.headers['x-dsh-extraworkspace-token']
    if (typeof header !== 'string') throw new HttpError(401, 'UNAUTHORIZED', 'Missing API token.')
    const supplied = Buffer.from(header, 'utf8')
    if (supplied.length !== tokenBuffer.length || !timingSafeEqual(supplied, tokenBuffer)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid API token.')
    }
  }

  /**
   * Read a required string field.
   * @param {Record<string, unknown>} body - decoded body.
   * @param {string} key - field name.
   * @returns {string} value.
   */
  function requiredString(body, key) {
    const value = body[key]
    if (typeof value !== 'string' || value === '') throw new HttpError(400, 'INVALID_ARGUMENT', `The ${key} field must be a non-empty string.`)
    return value
  }

  /**
   * Dispatch one same-origin panel request.
   * @param {import('node:http').IncomingMessage} req - request.
   * @param {import('node:http').ServerResponse} res - response.
   * @returns {Promise<void>} resolution after the response is written.
   */
  async function handle(req, res) {
    try {
      if (!isLoopbackPeer(req.socket.remoteAddress)) {
        throw new HttpError(403, 'LOCAL_ONLY', 'The extra-workspaces panel is available only to local connections.')
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(PREFIX)) throw new HttpError(404, 'NOT_FOUND', 'Unknown route.')
      const route = url.pathname.slice(PREFIX.length) || '/'

      if (route === '/bootstrap' && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(res, 200, {
          token,
          version,
          platform: process.platform,
          supported: process.platform === 'win32',
        })
        return
      }

      requireToken(req)

      if (route === '/state' && req.method === 'GET') {
        const sessionId = url.searchParams.get('sessionId')
        if (sessionId === null || sessionId === '') throw new HttpError(400, 'INVALID_ARGUMENT', 'sessionId is required.')
        await manager.attachById(sessionId)
        sendJson(res, 200, manager.publicState(sessionId))
        return
      }

      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for this operation.')
      const body = await readJsonBody(req)
      const sessionId = requiredString(body, 'sessionId')

      if (route === '/resolve') {
        const input = requiredString(body, 'input')
        sendJson(res, 200, await manager.preview(sessionId, input))
        return
      }

      if (route === '/add') {
        const input = requiredString(body, 'input')
        const label = typeof body.label === 'string' ? body.label : ''
        sendJson(res, 200, await manager.add(sessionId, input, label))
        return
      }

      if (route === '/remove') {
        const id = requiredString(body, 'id')
        sendJson(res, 200, await manager.remove(sessionId, id))
        return
      }

      if (route === '/set-enabled') {
        const id = requiredString(body, 'id')
        if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'INVALID_ARGUMENT', 'enabled must be a boolean.')
        sendJson(res, 200, await manager.setEnabled(sessionId, id, body.enabled))
        return
      }

      if (route === '/retry') {
        const id = requiredString(body, 'id')
        sendJson(res, 200, await manager.retry(sessionId, id))
        return
      }

      throw new HttpError(404, 'NOT_FOUND', 'Unknown route.')
    } catch (error) {
      if (res.writableEnded) return
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, code: error.code })
        return
      }
      if (error instanceof WorkspacePathError) {
        sendJson(res, 400, { error: error.message, code: error.code, path: error.path ?? null })
        return
      }
      if (error instanceof WorkspaceConflictError) {
        sendJson(res, 409, { error: error.message, code: error.code })
        return
      }
      if (error instanceof WorkspaceEntryNotFoundError) {
        sendJson(res, 404, { error: error.message, code: error.code })
        return
      }
      if (error instanceof SessionNotFoundError) {
        sendJson(res, 404, { error: error.message, code: error.code })
        return
      }
      ctx.logger?.warn?.(`dsh-extraworkspace: panel request failed: ${String(error)}\n${error instanceof Error && error.stack ? error.stack : ''}`)
      sendJson(res, 500, { error: `Internal error: ${messageOf(error)}`, code: 'INTERNAL' })
    }
  }

  return { handle }
}
