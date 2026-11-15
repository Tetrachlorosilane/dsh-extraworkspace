/**
 * dsh-extraworkspace — per-session additional workspaces for DSH on Windows.
 *
 * The Host half owns three things:
 *  - the durable per-session allow-list (`src/store.js`);
 *  - the runtime integration with DSH's sandbox policy and the Windows ACL
 *    backend (`src/manager.js`, `src/acl.js`);
 *  - a small same-origin JSON route for the session-header panel
 *    (`src/http.js`).
 *
 * The Client half (`client.js`) is a plain Module Loader factory; it renders
 * one utility button in `conversation.session.header.utilities` and a modal
 * editor.
 */

import { randomBytes } from 'node:crypto'
import { createHttpController } from './src/http.js'
import { ExtraWorkspaceManager } from './src/manager.js'
import { openWorkspaceStore } from './src/store.js'

const HOST_VERSION = '0.1.1'
const ROUTE_PREFIX = '/dsh-extraworkspace'

/** Cordis services this plugin cannot work without. */
export const inject = ['sessions', 'sandboxPolicy']

/**
 * Activate the Host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Promise<void>} resolution after the initial session scan.
 */
export async function apply(ctx) {
  if (process.platform !== 'win32') {
    ctx.logger?.info?.('dsh-extraworkspace: only the Windows host activates the ACL extension; the row is inert on this platform.')
    return
  }

  const store = await openWorkspaceStore(ctx)
  const manager = new ExtraWorkspaceManager(ctx, store)
  await manager.loadPreferences()
  const token = randomBytes(24).toString('hex')

  ctx.effect(() => async () => {
    try {
      await manager.disposeAll()
    } catch (error) {
      ctx.logger?.warn?.(`dsh-extraworkspace: session cleanup failed: ${String(error)}`)
    }
    try {
      await store.close()
    } catch (error) {
      ctx.logger?.warn?.(`dsh-extraworkspace: storage close failed: ${String(error)}`)
    }
  }, 'dsh-extraworkspace lifecycle')

  ctx.inject(['webServer'], (scope) => {
    const controller = createHttpController({ ctx: scope, manager, token, version: HOST_VERSION })
    scope.effect(
      () => scope.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: controller.handle,
      }),
      'dsh-extraworkspace panel route',
    )
  })

  ctx.on('agent/created', async ({ agent }) => {
    try {
      await manager.attachById(agent.id)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-extraworkspace: could not attach session ${agent.id}: ${String(error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    void manager.detach(agent.id).catch((error) => {
      ctx.logger?.warn?.(`dsh-extraworkspace: could not detach session ${agent.id}: ${String(error)}`)
    })
  })

  ctx.on('workspace/session-archived', ({ sessionId }) => {
    if (ctx.get('forgePanel') === undefined) return
    void manager.archiveSession(sessionId).catch((error) => {
      ctx.logger?.warn?.(`dsh-extraworkspace: archive cleanup failed for ${sessionId}: ${String(error)}`)
    })
  })

  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(
      () => scope.systemPrompt.context({
        name: 'dsh-extraworkspace',
        order: scope.systemPrompt.getContextOrder('SANDBOX_POLICY') + 1,
        text: (context) => {
          try {
            const agent = context?.agent
            const session = agent?.session ?? (agent?.id === undefined ? undefined : ctx.sessions.get(agent.id))
            return session === undefined ? '' : manager.promptFor(session)
          } catch {
            return ''
          }
        },
      }),
      'dsh-extraworkspace prompt context',
    )
  })

  // A plugin reload can land while sessions are already live. Re-materialize
  // their saved allow-lists; attach() is idempotent.
  const agents = ctx.get('agents')?.list() ?? []
  for (const agent of agents) {
    try {
      await manager.attachById(agent.id)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-extraworkspace: could not restore session ${agent.id}: ${String(error)}`)
    }
  }
  ctx.logger?.info?.(`dsh-extraworkspace: ready (${agents.length} live session(s) scanned)`)
}
