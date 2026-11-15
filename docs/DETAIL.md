# Extra workspaces

DSH on Windows runs sandboxed commands under a **low-integrity,
write-restricted token**. Only the session workspace and a private temporary
directory carry the token's write capability. Harness file tools are fenced by
the same policy in process. The result is a strong guard against accidental
writes — and an equally strong block on legitimate cross-directory or
cross-drive work.

This plugin adds an explicit, per-session allow-list on top of that model.

## What it does

- Registers each configured directory with DSH's own
  `ctx.sandboxPolicy.registerWritableRoot()`, so `write`, `edit`,
  `apply_patch`, delete and move are allowed there.
- On Windows, applies the session workspace's deterministic low-integrity
  capability SID, the ambient-delete deny, and the Low mandatory label to the
  directory with DSH's ACL backend. New sandboxed `bash` and PowerShell
  processes can therefore write there too.
- Persists the allow-list per session in the `extra_workspaces` storage domain
  and restores it when the session resumes or the plugin reloads.

## Use

1. Open a session.
2. Click the folder button in the session header (right-side utilities).
3. Paste a directory path or choose one with **Browse**.
4. Click **Add**. The row shows whether file tools and sandboxed processes are
   active.
5. Toggle a row to disable it without forgetting it; use **Retry** after fixing
   a missing or inaccessible directory; use **Remove** to revoke the grants and
   forget the entry.

The session must be in `workspace-write` for extra grants to take effect.
`read-only` saves the list but keeps it inactive. `danger-full-access` needs no
grants.

## Accepted path forms

Windows drive paths, forward slashes, UNC shares, extended-length paths,
Cygwin `/cygdrive/...`, Git Bash `/d/...`, WSL `/mnt/d/...`, `file:` URIs,
`%VAR%`, `$env:VAR`, `~`, PowerShell provider paths, and paths relative to the
session working directory.

The directory must exist, be a directory, and not be a symbolic link or
junction. Drive roots, Windows system trees, Program Files, ProgramData, and
the DSH installation are refused. A directory that contains the session
workspace is refused.

## Behavior and limits

- New file operations and new confined commands use the updated allow-list.
  Commands already running keep the permissions resolved when they started.
- ACL propagation is eager: adding a very large directory can take seconds
  while the inheritable ACE and label reach every descendant.
- FAT/exFAT has no NTFS security descriptor; the file grant can still work, but
  the process grant fails. The row is marked **Processes error** and can be
  retried after moving the directory to NTFS.
- Removing an entry revokes the capability ACE and the Low label, and removes
  the ambient-delete deny the plugin added unless an identical deny already
  existed.
- This is an extension of DSH's accidental-write sandbox. It is not a defense
  against prompt injection, a hostile local process, or a user intentionally
  widening the sandbox, and it does not restrict reads (Windows never did).
- The panel is local-only: the Host route accepts loopback peers only. The
  Desktop default is loopback; a remotely exposed Web host cannot drive it.
- Forked and subagent sessions are new sessions: configure their own list.
  Resumed sessions restore their saved list.

## Forge companion (optional)

When `@deepseek-ai/dsh-experimental-forge-bundle` is enabled, an
**Extra workspaces** tab is added to the same right-sidebar tab strip as
Forge. Forge keeps the root workspace; this tab manages extra roots.

- Each extra root shows its detected kind, branch/HEAD, dirty count,
  ahead/behind, and worktrees.
- A repository root can create a worktree under
  `<repo>/.agents/worktrees/<name>` without changing the Session working
  directory. Remove uses a non-force `git worktree remove` and keeps the
  branch; dirty or locked checkouts are refused.
- **Keep extra worktrees when archiving** is off by default, matching Forge's
  archive cleanup. Unless enabled, archiving removes clean, unlocked,
  unreferenced worktrees created here and keeps their branches.
- The tab and these routes are unavailable when Forge is disabled; in that
  case the old session-header panel remains. When Forge is active, the old
  header button is hidden so there is one UI. No new model tools are added.

## Troubleshooting

- **Processes error / Win32 5**: the directory's DACL does not grant your
  Windows user Full control; the Low label needs `WRITE_OWNER`. Use **Fix
  permissions** in the row, which adds an inheritable Full control ACE for
  your user and reapplies the grant. The ACE is additive and stays if you
  later remove the entry. ReFS works; FAT/exFAT has no NTFS security descriptor
  and cannot take the process grant.
- **Directory missing**: reconnect the drive or restore the directory, then
  use **Retry**.
- **Read-only warning**: switch the session to `workspace-write` with the
  composer's permission control.
- **No button**: the session has ended, or the Host row is disabled (the Host
  is not Windows).
