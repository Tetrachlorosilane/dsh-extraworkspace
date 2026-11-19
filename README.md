# dsh-extraworkspace

Per-session additional workspaces for DeepSeek Harness on Windows.

Part of the [dsh-plugin](https://github.com/topics/dsh-plugin) topic.

DSH's Windows sandbox confines subprocess writes with a **low-integrity,
write-restricted token** whose only write capabilities are the session
workspace and a private temporary directory. The harness file tools are fenced
by the same policy in process. That protects against accidental writes outside
the project, but it also blocks legitimate cross-directory and cross-drive
work.

This plugin adds a small, explicit allow-list on top of that model:

1. Every configured directory is registered with DSH's own
   `ctx.sandboxPolicy.registerWritableRoot()`, so `write`, `edit`, `apply_patch`,
   delete and move are allowed there.
2. On Windows, the plugin applies the session workspace's deterministic
   low-integrity capability SID, the ambient-delete deny, and the Low mandatory
   label to the directory with the same ACL backend DSH uses. New sandboxed
   `bash` / PowerShell processes therefore get the same write capability.

The allow-list is **per session**. It is configured from the **Extra workspaces**
right-sidebar tab (the session-header folder button opens that tab), persisted in
the plugin's own storage domain, and restored when a session is resumed. It is
not a global permission and it is not a security boundary against a hostile
project: it is an ergonomic extension of the accidental-write sandbox.

## Requirements

- DeepSeek Harness Desktop (or Web host) on **Windows**.
- DSH `0.2.2-rc.5` (the ACL backend and storage-domain APIs this plugin uses).
- The session must run under `workspace-write` for the extra grants to take
  effect. `read-only` still denies every write; `danger-full-access` needs no
  grants.

## Install

From the DSH GUI: **Plugins** → **Add plugin** → choose this directory. Or,
when `plugin_manager` is available in an agent session:

```text
install_bundle with target = <absolute path to this directory>
```

After installation, open a session and click the folder button in the session
header (right-side utilities).

## Use

1. Click the extra-workspaces button in the session header.
2. Paste a directory path or use **Browse**.
3. Click **Add**. The panel shows whether the directory is active for file
   tools and for sandboxed processes.
4. Toggle a directory off to keep the entry but revoke its grants.
5. Remove it to revoke the grants and forget the entry.

If you open an inactive subagent or another persisted-but-not-live Session, the
panel still lists the saved entries but marks them **inactive** and read-only.
Reopen that conversation (make its Agent live) before adding, removing, or
toggling entries; mutations on a cold Session return `SESSION_NOT_LIVE`.

Accepted path forms include:

| Form | Example |
|---|---|
| Windows drive | `D:\projects\shared` |
| Forward slashes | `D:/projects/shared` |
| UNC share | `\\server\share\dir` |
| Extended-length | `\\?\D:\very\long\path` |
| Extended UNC | `\\?\UNC\server\share\dir` |
| Cygwin | `/cygdrive/d/projects/shared` |
| Git Bash / MSYS | `/d/projects/shared` |
| WSL | `/mnt/d/projects/shared` |
| `file:` URI | `file:///D:/projects/shared` |
| Environment variables | `%USERPROFILE%\shared`, `$env:USERPROFILE\shared` |
| Home shorthand | `~/shared` |
| PowerShell provider | `Microsoft.PowerShell.Core\FileSystem::D:\shared` |
| Relative to session cwd | `..\shared` |

Safety rules: the directory must exist, be a directory, not be a symbolic
link or junction, not be a drive root, and not be inside the Windows/Program
Files/ProgramData system trees or the DSH installation. A directory that
contains the session workspace is refused.

## What is and is not persisted

- The allow-list is persisted per session in the `extra_workspaces` storage
  domain (`$DSH_HOME/storages/extra_workspaces/sessions/<session-id>.json`).
- The runtime grants are not persisted by DSH; the plugin recreates them when
  the session resumes or when the plugin is (re)loaded.
- Windows ACL edits are real security-descriptor edits. Removing a workspace
  revokes the capability ACE and the Low label; the plugin also removes the
  ambient-delete deny it added, unless the directory already had an identical
  deny before it was granted.
- Existing processes keep the permissions resolved when they started. Start a
  new command to pick up a changed allow-list.

## Forge companion (optional)

The browser half registers one **Extra workspaces** tab in the right-sidebar
tab strip for every profile. The session-header button always opens that tab;
it is the single configuration surface. If the right-sidebar service is
unavailable, the header button falls back to the inline modal.

The tab always provides the core extra-workspace management: add, remove,
enable/disable, retry, and fix permissions.

When `@deepseek-ai/dsh-experimental-forge-bundle` is active, the tab also shows
the Forge companion section:

- the root workspace and a note that Forge owns its PR review and worktrees;
- each extra workspace with its detected kind (directory, Git repository, or
  linked worktree), branch/HEAD, dirty count, ahead/behind, and worktree list;
- a manual **Refresh status** action. Git inspection is read-only
  (`GIT_OPTIONAL_LOCKS=0`), runs on the Host, and does not need sandbox
  write permission;
- for a Git repository root, **Add worktree** creates a checkout under
  `<repo>/.agents/worktrees/<name>` without changing the Session working
  directory. **Remove** runs a non-force `git worktree remove`; a dirty or
  locked checkout is refused and the branch is always kept;
- **Keep extra worktrees when archiving**, default **off** to match Forge's
  `retainOnArchive: false`: unless it is switched on, archiving removes the
  clean, unlocked worktrees this plugin created that no other live session
  uses, and keeps their branches. A refused removal is retained and logged.

The extra-worktree feature is only available for a repository **root** added as
an extra workspace. A subdirectory or a linked worktree needs the shared Git
directory as a separate grant and is rejected with an explanatory error.

The Git/worktree/archive routes are rejected when Forge is inactive; the core
tab stays usable. The companion adds **no model-facing tools**. The model keeps
the same `bash`/`write` surface and a stable list of approved extra roots;
Forge keeps its `create_worktree` tool for the root workspace. Enabling or
disabling Forge after the page loaded requires a page refresh for the Git
section to appear or leave.

## Limitations

- Windows only. The host row is disabled on other platforms. A custom
  composition that still loads the client half shows the button, but the panel
  reports that the host route is unavailable because no Windows grants exist.
- The process extension is a deliberate use of DSH's internal
  `@deepseek-ai/dsh-sandbox-windows-acl` grant API. It is pinned to the DSH
  release tested here. Re-verify it after a DSH upgrade.
- ACL propagation is eager: adding a very large directory can take seconds
  while the inheritable ACE and label reach every descendant. The panel shows
  a busy state during that time.
- NTFS and ReFS support the process grant. FAT/exFAT has no NTFS security
  descriptor and fails the process grant; file tools may still work, and the
  row is marked **Processes error**.
- This is not a defense against prompt injection, a hostile local process, or
  a user who intentionally broadens the sandbox. It only lets the user widen
  the accidental-write fence for a chosen session.
- Reads were never confined on Windows. This plugin does not change that.
- The panel is local-only: the route accepts loopback peers only, matching the
  Desktop default. A DSH Web host exposed on a LAN address keeps its normal
  authentication for the agent, but the extra-workspaces panel cannot be driven
  from that remote client.
- The panel is per live session. Archived sessions can be resumed, and their
  saved allow-list is restored on resume. A forked or subagent session is a new
  session and starts with an empty allow-list; configure it separately if it
  needs the same directories.

## Troubleshooting

- **Processes error / Win32 5 (access denied)**: the directory DACL does not
  grant your Windows user Full control. The Low label needs `WRITE_OWNER`.
  Click **Fix permissions** in the row (adds an inheritable Full control ACE
  for your user), or run
  `icacls "X:\path" /grant "%USERNAME%:(OI)(CI)F"`. The ACE is additive and is
  not removed automatically. ReFS works; FAT/exFAT cannot take the process
  grant.
- **Directory missing**: reconnect the drive or restore the directory, then
  use **Retry**.
- **Read-only warning**: switch the session to `workspace-write` with the
  composer's permission control.

## Development

```sh
node --check index.js
node --check client.js
node --test tests/*.test.mjs
```

The real archive-cleanup path has a manual integration harness:

1. Install `tests/archive-harness` as a temporary bundle from Plugins.
2. Wait for the harness to archive its scratch Session and write its result.
3. Run `node tests/archive-selftest.mjs`; it asserts the worktree was removed
   and the branch retained.
4. Remove the harness bundle again. It is test-only and is not part of the
   shipped plugin.

The package has no build step: the host half is plain ESM and the browser half
is a plain `window.__ModuleLoader__` factory. See [AGENTS.md](AGENTS.md) for the
architecture, the exact DSH APIs used, and the verification checklist.

## License

MIT
