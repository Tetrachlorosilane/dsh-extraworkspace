# AGENTS.md — dsh-extraworkspace

This file is the working contract for anyone (human or agent) changing this
plugin. Read it before editing. The user-facing behavior lives in
[README.md](README.md); this document records architecture, the exact DSH
contracts used, verification steps, and the pitfalls that already cost time.

## 1. What this plugin is for

DSH on Windows confines subprocess file effects with a **low-integrity,
write-restricted token** (`@deepseek-ai/dsh-sandbox-windows-acl`). The token's
restricting SIDs include one deterministic workspace capability
(`workspaceWriteSid(canonicalWorkspaceRoot)`) plus a random private-temp
capability. The built-in provider grants the workspace capability to the
session workspace tree only, and `dsh-fs-sandbox` fences file tools in-process
to the same policy. That boundary protects against accidental writes, but it
also blocks legitimate cross-directory and cross-drive work.

This plugin adds a **per-session, user-edited allow-list**:

1. `ctx.sandboxPolicy.registerWritableRoot(session, dir)` → file tools.
2. `AclWriteGrant.create(workspaceWriteSid(workspaceRoot)).add(dir)` → the
   same capability for new low-integrity processes.

The list is edited from a modal panel opened by a button in
`conversation.session.header.utilities` and persisted in the
`extra_workspaces` storage domain.

Non-goals: prompt-injection defense, hostile-local-process defense, read
confinement, or replacing DSH's sandbox. This is an ergonomic extension of the
accidental-write fence.

## 2. Runtime facts pinned by the current implementation

Verified against DSH `0.2.2-rc.3` on Windows (Desktop profile):

| Fact | Value / contract |
|---|---|
| Process sandbox package | `@deepseek-ai/dsh-sandbox-windows-acl` |
| Workspace SID | `workspaceWriteSid(canonicalWorkspaceRoot)` → `S-1-4-x-y` |
| ACL grant API | `AclWriteGrant.create(sid)`, `.add(path, standing?)`, `.dispose()` |
| Grant fields | capability allow ACE (`W,D,DC`), world `FILE_DELETE_CHILD` deny, Low mandatory label |
| File-tool API | `ctx.sandboxPolicy.registerWritableRoot(session, absolutePath)` → disposer |
| Policy resolver | `ctx.sandboxPolicy.resolve({ session })` → `{ mode, workspaceRoot, additionalWritableRoots, sessionId }` |
| Canonicalization | `canonicalPath(path)` in `@deepseek-ai/dsh-sandbox` (`realpathSync.native`) |
| Session lookup | `ctx.sessions.get(id)`, live agents via `ctx.get('agents')?.list()` |
| Agent lifecycle | serial `agent/created`, emit `agent/disposed` |
| Persistence | `ctx.storageDomain.open(extraWorkspaceDomain)`; domain `extra_workspaces`, table `sessions`, `per-record` layout |
| Client slot | `conversation.session.header.utilities` (list, session scope, id/order/label registration) |
| Client bridge | one same-origin JSON route `/dsh-extraworkspace/*` registered through `ctx.webServer` |
| Client locale | `ctx.locale.register(NS, { en, zh })`, `ctx.locale.bind(NS)` |

Important: on Windows the built-in `additionalWritableRoots` path **does not**
extend process permissions. The ACL grant in `src/acl.js` is the extension that
closes that gap. If DSH changes the token's restricting-SID list or the ACL
grant shape, this plugin must be re-verified; do not assume compatibility
across unrelated DSH releases.

## 3. File map

```
index.js                 Host entry: lifecycle, agent events, route, prompt context
src/paths.js             Path intake: drive/UNC/Cygwin/MSYS/WSL/URI/env/relative; safety checks
src/acl.js               Ref-counted Windows ACL grants; exact deny cleanup via Windows PowerShell
src/store.js             storage-domain declaration + memory fallback
src/manager.js           Per-session orchestration, serialized mutations, public panel state
src/http.js              Host JSON route, token, body limit, error mapping
client.js                Plain Module Loader factory: header button + modal editor
locale/{en,zh}.json      Plugin Manager display metadata
docs/DETAIL.md           Plugin Manager detail page
tests/paths.test.mjs     Node test runner coverage for path parsing/safety
```

There is no build step. `package.json` has `"type": "module"`; `index.js`,
`src/*.js`, and `client.js` are loaded directly.

## 4. Host lifecycle

`index.js` exports `inject = ['sessions', 'sandboxPolicy']`, so Cordis waits for
those services. `apply(ctx)`:

1. Returns early off Windows. The bundle patch also disables the row off
   Windows; the early return is defense in depth.
2. Opens the storage domain (falls back to memory and warns).
3. Creates one `ExtraWorkspaceManager` and one process token.
4. Registers a cleanup effect: `manager.disposeAll()` then `store.close()`.
5. Injects `webServer` and registers the prefix route.
6. Listens to `agent/created` (attach/restore) and `agent/disposed` (release).
7. Scans already-live agents so a plugin reload adopts running sessions.
8. Injects `systemPrompt` and contributes a per-session note when the session
   has active roots.

`attach()` is idempotent and serialized per session. Every mutation
(add/remove/toggle/retry) runs on the session's promise chain. Do not call
`registerWritableRoot` or ACL code outside that chain: a slow ACL propagation
must not race a removal.

## 5. Why both grants are required

- **File tools** run in-process through `dsh-fs-sandbox`. Its fence checks
  `SandboxExecutionPolicy.additionalWritableRoots`, populated by
  `registerWritableRoot`. Without this, `write`/`edit` deny even when the OS ACL
  would allow the write.
- **Bash / PowerShell** run in a child process. The Windows runner receives
  only `--workspace` and a private temp dir; it ignores extra roots. The child's
  token carries the workspace capability SID, so granting that SID on the extra
  directory lets the same token write there. Without this, the ACL denies even
  when the file-tool fence would allow it.

Both are applied for every enabled entry. If the process grant fails, the file
grant is kept and the row is marked `partial`; the user can retry. This is
deliberate: a FAT/exFAT or permission problem should not silently remove the
file-tool capability.

## 6. ACL lifecycle details (read before touching `src/acl.js`)

- One shared entry per `(workspaceSid, lowercased path)`. Sessions on the same
  workspace and same extra directory share one ACE; ref-counting prevents one
  session's removal from revoking another's grant.
- `AclWriteGrant.add(path, false)` is revocable. `dispose()` removes the
  capability ACE and clears the Low label only when no foreign capability grant
  remains (DSH's `revokeWrite` behavior).
- The grant also adds `Everyone:(CI)(DENY)(DC)`. DSH's revoke path does **not**
  remove that deny. `src/acl.js` remembers whether the directory already had
  the exact deny before the first grant and, if not, removes only the exact
  rule via a Windows PowerShell `FileSystemAccessRule` round-trip. Do not
  replace this with `icacls /remove:d *S-1-1-0`: that removes every Everyone
  deny, including pre-existing ones.
- If the deny inspection fails, the manager treats the deny as pre-existing and
  leaves it. Conservative residue is better than removing a user's security
  control.
- ACL propagation is eager and can take seconds on large trees. The panel shows
  a busy state; do not add a short timeout around `grant.add()`.
- Removing an entry is not instant for already-running processes only in the
  sense that their token is already minted; the ACL edit is immediate for new
  opens. Documented in the UI footer.

## 7. Persistence

`src/store.js` declares:

```
domain: extra_workspaces
version: 1
layout: per-record
tables: sessions
```

Record shape:

```json
{
  "sessionId": "session-...",
  "roots": [
    {
      "id": "uuid",
      "path": "D:\\projects\\shared",
      "label": "Shared assets",
      "enabled": true,
      "addedAt": 1760000000000
    }
  ]
}
```

- Zod is imported bare. DSH supplies it because it is in
  `@deepseek-ai/dsh-storage-domain`'s dependency closure. If the import
  fails, `src/store.js` falls back to a duck-typed schema with `parse()`, which
  is the only method the domain layer calls at runtime. Do not add a local zod
  dependency without checking for duplicate-schema issues.
- `invalidRecords: 'backup-and-skip'` requires the `per-record` layout; keep
  both. A corrupt session document is backed up and skipped, not fatal.
- If `storageDomain` is absent or the open fails, the plugin runs with an
  in-memory store and the panel shows a persistence warning. Do not make the
  whole plugin fail on storage absence.
- Records are intentionally not deleted when a session is archived or an agent
  is disposed. They are tiny and are needed when the session resumes. A future
  cleanup command can reap records for deleted sessions.

## 8. Path intake rules (`src/paths.js`)

Accepted: drive paths (`D:\`, `D:/`), UNC (`\\server\share`, `\\?\UNC\...`),
extended-length (`\\?\D:\...`), Cygwin `/cygdrive/d/...`, Git Bash `/d/...`,
WSL `/mnt/d/...`, `file:` URIs, `%VAR%`, `$env:VAR`, `${env:VAR}`, bare known
environment names (`$HOME`, `$USERPROFILE`, …), `~`, PowerShell
`Microsoft.PowerShell.Core\FileSystem::...`, and relative paths against the
session working directory.

Refused: empty, NUL/CR/LF, drive-relative (`C:foo`), device paths (`\\.\`),
global-root device paths, missing paths, non-directories, symlinks/junctions,
non-physical aliases (`realpath` differs), drive roots, Windows/Program
Files/ProgramData/system trees, and paths equal to or inside the session
workspace. A directory that contains the workspace is refused.

Do not loosen these checks to “make it easier”: the ACL grant is a real
security-descriptor mutation on a directory tree, and a symlink or root grant
turns an accidental-write fence into a broad one. Add a test in
`tests/paths.test.mjs` for every new form or rejection.

## 9. HTTP route (`src/http.js`)

- Prefix: `/dsh-extraworkspace`; all responses `application/json`,
  `cache-control: no-store`.
- `GET /bootstrap` returns `{ token, version, platform, supported }` without
  auth. The page then sends `x-dsh-extraworkspace-token` on every request.
- Body limit 128 KiB; invalid JSON is 400.
- Routes: `GET /state?sessionId`, `POST /resolve`, `POST /add`,
  `POST /remove`, `POST /set-enabled`, `POST /retry`.
- Errors map from `WorkspacePathError`, `WorkspaceConflictError`,
  `WorkspaceEntryNotFoundError`, `SessionNotFoundError`, and `HttpError`.
- The token is per Host process. The Client retries once after a 401, which
  covers a Host restart. The bootstrap response is same-origin only; no CORS
  headers are set.
- This route exists because a static Client plugin cannot use the dynamic
  package-private `host.call` bridge. Do not replace it with a dynamic Cordis
  package just to call Host methods; that changes the plugin's lifecycle and
  security model.

## 10. Client (`client.js`)

- Plain `window.__ModuleLoader__.load({ id, factory })`; the module id must
  equal the package name.
- Registers one entry in `conversation.session.header.utilities`
  (`id: dsh-extraworkspace`, `order: 12`).
- Uses only `react` and `react-dom` from the shared module table. No Harness
  Client package is imported.
- Modal is rendered with `ReactDOM.createPortal` to `document.body`; the
  header clips overflow, so an inline popover is not an option.
- Styles are one plugin-owned `<style>` element inserted in `apply` and removed
  by its effect. All chrome colors use `--dsw-alias-*` tokens. Literal colors
  are not used.
- Visible text goes through the `dsh-extraworkspace` locale namespace. Keep
  `EN` and `ZH` complete when adding a key; the metadata files are separate.
- Accessibility: dialog role, `aria-modal`, labelled title, Escape close, Tab
  trap, focus restore, `aria-live` notices, switch `role="switch"` with
  `aria-checked`.
- `applyResult` in the panel distinguishes a newly added root by comparing
  previous ids (the Host returns the canonical path, not the raw input).

## 11. Verification checklist

Before handing a change back:

1. `node --check index.js client.js src/*.js`
2. `node tests/paths.test.mjs` (all tests)
3. Validate `package.json` and locale JSON parse:
   `node -e "JSON.parse(require('fs').readFileSync('package.json')); ..."`
4. Install the bundle with `plugin_manager` (local directory target).
5. Confirm the Host row is active with `cordis_inspect_query`
   (`Config.listConfigs` filtered by name) and the Client slot has the
   `dsh-extraworkspace` occupant.
6. In the running Web GUI, open a session, click the header button, add a
   directory outside the workspace, and verify:
   - the file-tool grant works (`write` a file there);
   - the row shows **Files** and **Processes**;
   - the modal reads correctly in light and dark themes.
7. Remove the test directory and confirm the file-tool write is denied again.
8. If testing the process grant, run `tests/acl-selftest.mjs` (manual; creates
   and cleans temp directories) or a small `AclSandbox` probe. Do not claim
   the process extension works from UI green badges alone.
9. Run one UI/UX review subagent per the DSH verification guidance, then fix
   substantiated issues.

## 12. Known pitfalls

- **Bare imports are supplied by DSH's profile resolver.** Do not add
  `node_modules` copies of `@deepseek-ai/*` packages. `zod` is supplied through
  the installation dependency closure; a local copy can shadow it.
- **`ctx.sandboxPolicy.registerWritableRoot` is effect-owned by the policy
  service, not the plugin.** Keep its disposer and call it on session detach /
  plugin unload. Do not rely on plugin unload alone.
- **The workspace SID must be derived from the policy's canonical workspace
  root.** Use `this.workspaceRoot(session)` (which calls
  `canonicalPath(sandboxPolicy.resolve(...).workspaceRoot)`), not
  `session.header.cwd` directly. A spelling mismatch mints a different SID and
  the grant will not match the child token.
- **Changing the session working directory must be re-verified.** The current
  implementation resolves the policy root at apply time and on every
  `publicState()` call; if DSH makes `workingDirectory.set` change the
  effective root, a re-attach/retry is needed for already-granted roots. Test
  this before claiming support.
- **Do not add a new session event type.** Per the DSH plugin practices, use
  the storage domain for plugin-owned data. The allow-list is not a session
  log concern and must not be replayed from events.
- **Do not write the profile's `cordis.patch.yml` or `package.json`.** The
  bundle patch is installed by Plugin Manager; user config belongs in the
  user's patch layer.
- **PowerShell helper quoting.** The directory always travels through
  `DshXwPath`; never interpolate it into the command string.
- **ACL cleanup on plugin reload.** Existing grants are standing edits; if the
  plugin crashes before revoking, the next install recreates/uses them
  idempotently. A stale grant for a directory removed while the plugin was
  down remains until the entry is added again and removed, or cleaned manually.
  This is a known limitation; do not hide it in the UI.

## 13. Change log

- `0.1.0` — initial implementation: per-session allow-list, file-tool
  registration, Windows ACL process extension, header modal, storage domain,
  path compatibility, docs, tests.
