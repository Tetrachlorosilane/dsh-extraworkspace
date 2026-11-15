/**
 * Durable per-session allow-list storage.
 *
 * The plugin uses DSH's own storage-domain data form (`ctx.storageDomain`)
 * instead of writing a private JSON file. The domain is declared once with the
 * `per-record` layout, so each session's allow-list is one inspectable
 * document under `$DSH_HOME/storages/extra_workspaces/sessions/`.
 *
 * Zod is supplied by the DSH installation (it is a dependency of
 * `@deepseek-ai/dsh-storage-domain`). If it cannot be loaded, a small
 * duck-typed schema keeps the domain usable: the storage layer only requires
 * `parse()` on each record schema.
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

let schemaFactory
try {
  const { z } = await import('zod')
  schemaFactory = () => z.object({
    sessionId: z.string().min(1),
    roots: z.array(z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      label: z.string().max(200).optional(),
      enabled: z.boolean(),
      addedAt: z.number(),
    })).max(64),
  })
} catch {
  schemaFactory = () => ({
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('extra-workspaces record must be an object')
      }
      if (typeof value.sessionId !== 'string' || value.sessionId === '') {
        throw new Error('extra-workspaces record.sessionId must be a non-empty string')
      }
      if (!Array.isArray(value.roots)) {
        throw new Error('extra-workspaces record.roots must be an array')
      }
      return value
    },
  })
}

/** Current storage format version. Bump only with a compatible reader. */
export const STORAGE_VERSION = 1

export const extraWorkspaceDomain = defineDomain({
  name: 'extra_workspaces',
  version: STORAGE_VERSION,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    sessions: domainTable(schemaFactory()),
  },
})

/**
 * In-memory fallback used when the profile has no storage domain. The panel
 * still works for the current Host process and reports that configuration is
 * not persisted.
 * @returns {object} store facade.
 */
function memoryStore() {
  const records = new Map()
  return {
    persistent: false,
    async get(sessionId) {
      return records.get(sessionId)
    },
    async put(record) {
      records.set(record.sessionId, record)
    },
    async close() {
      records.clear()
    },
  }
}

/**
 * Open the plugin's domain, or fall back to memory when the profile does not
 * mount `storageDomain` or the domain cannot open. A failed open must not make
 * the whole plugin unavailable: the panel can still apply grants until the
 * Host restarts.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Promise<object>} store facade with `persistent`, `get`, `put`, `close`.
 */
export async function openWorkspaceStore(ctx) {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) {
    ctx.logger?.warn?.('dsh-extraworkspace: storageDomain is not mounted; session configuration will not persist across restarts.')
    return memoryStore()
  }
  try {
    const domain = await facility.open(extraWorkspaceDomain)
    const table = domain.table('sessions')
    return {
      persistent: true,
      async get(sessionId) {
        return table.get(sessionId)
      },
      async put(record) {
        await table.put(record.sessionId, record)
      },
      async close() {
        await domain.close()
      },
    }
  } catch (error) {
    ctx.logger?.warn?.(`dsh-extraworkspace: cannot open the extra_workspaces storage domain; configuration will not persist: ${String(error)}`)
    return memoryStore()
  }
}
