# dsh-extraworkspace

Per-session additional workspaces for DeepSeek Harness on Windows.

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

The allow-list is **per session**. It is configured from a panel in the
session header, persisted in the plugin's own storage domain, and restored when
a session is resumed. It is not a global permission and it is not a security
boundary against a hostile project: it is an ergonomic extension of the
accidental-write sandbox.

## Requirements

- DeepSeek Harness Desktop (or Web host) on **Windows**.
- DSH `0.2.2-rc.3` (the ACL backend and storage-domain APIs this plugin uses).
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
  `icacls "S:\path" /grant "%USERNAME%:(OI)(CI)F"`. The ACE is additive and is
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
node tests/paths.test.mjs
```

The package has no build step: the host half is plain ESM and the browser half
is a plain `window.__ModuleLoader__` factory. See [AGENTS.md](AGENTS.md) for the
architecture, the exact DSH APIs used, and the verification checklist.

## License

MIT
