// Browser half of dsh-extraworkspace.
//
// Plain-JS Module Loader factory (no build step): registers one utility button
// in the session header and a modal editor that talks to the Host half over
// one same-origin JSON route. Visible text goes through the Client locale
// service. The component uses only React and ReactDOM from the page's shared
// module table and only --dsw-alias-* theme tokens for chrome colors.
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-extraworkspace',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const BASE = '/dsh-extraworkspace'
    const NS = 'dsh-extraworkspace'

    const EN = {
      buttonLabel: 'Extra workspaces',
      buttonLabelCount: 'Extra workspaces, {count} active',
      buttonTitle: 'Configure extra workspaces for this session',
      title: 'Extra workspaces',
      intro: 'Allow this session to write into additional directories. File tools and new sandboxed commands use the same per-session grant.',
      close: 'Close',
      session: 'Session workspace',
      modeLabel: 'File policy',
      modeReadOnly: 'read-only',
      modeWorkspaceWrite: 'workspace-write',
      modeDanger: 'danger-full-access',
      saved: 'Configured workspaces',
      refresh: 'Refresh',
      loading: 'Loading…',
      enable: 'Enable this workspace',
      disable: 'Disable this workspace',
      empty: 'No extra workspaces yet. Add one below.',
      addTitle: 'Add a workspace',
      pathLabel: 'Directory',
      pathPlaceholder: 'D:\\projects\\shared, \\\\server\\share, /cygdrive/d/..., /mnt/d/..., %USERPROFILE%\\shared',
      labelLabel: 'Label (optional)',
      labelPlaceholder: 'Shared assets',
      browse: 'Browse',
      add: 'Add',
      adding: 'Adding…',
      pathHint: 'The directory must exist and must not be a symlink. Drive roots and Windows system directories are refused.',
      previewTitle: 'Resolved directory',
      previewChecking: 'Checking…',
      duplicate: 'Already configured as “{label}”.',
      warnings: 'Notes',
      badgeDisabled: 'Disabled',
      badgeFiles: 'Files',
      badgeProcesses: 'Processes',
      badgeProcessesError: 'Process error',
      badgeProcessesUnsupported: 'Process grant unavailable',
      badgeFilesError: 'File grant error',
      badgeMissing: 'Missing',
      badgeReadOnlyInactive: 'Inactive (read-only)',
      badgeDanger: 'Sandbox off',
      retry: 'Retry',
      remove: 'Remove',
      confirm: 'Confirm',
      cancel: 'Cancel',
      footer: 'Changes apply to new file operations and new sandboxed commands. Running commands keep their previous permissions. Removing an entry revokes the Windows ACL grant it added.',
      unsupported: 'This host is not Windows; the process grant is unavailable.',
      readOnlyWarning: 'The session is read-only. Extra workspaces are saved and their ACL grants are applied immediately, but writes stay denied until you switch to workspace-write.',
      dangerNotice: 'Danger-full-access is active; the sandbox is not restricting writes and these grants are not needed.',
      memoryWarning: 'The storage domain is unavailable. Configuration is kept only until the Host restarts.',
      loadFailed: 'Could not load the configuration: {error}',
      saveFailed: 'The change failed: {error}',
      addSuccess: 'Added {path}.',
      addPartial: 'Added {path}, but the Windows process grant failed. File tools can write there; sandboxed commands cannot. Use Retry after fixing the directory.',
      removeSuccess: 'Removed {path}.',
      toggleSuccess: 'Updated {path}.',
      retrySuccess: 'Retried {path}.',
      retryFailed: 'Retry failed: {error}',
      enabledSuccess: 'Enabled {path}.',
      disabledSuccess: 'Disabled {path}; its grants were revoked.',
      processGrantFailed: 'The Windows process grant failed.',
      fileGrantFailed: 'The file-tool grant failed.',
      errorNotFound: 'The directory does not exist.',
      errorNotDirectory: 'The path is not a directory.',
      errorSymlink: 'The path is a symbolic link or junction; use the physical directory.',
      errorDriveRoot: 'A drive root cannot be granted.',
      errorProtected: 'This is a protected system or installation directory.',
      errorWorkspace: 'The path is the session workspace, inside it, or contains it.',
      errorUnknownVariable: 'The path contains an unknown environment variable.',
      errorDriveRelative: 'Drive-relative paths such as C:folder are not supported.',
      errorDevicePath: 'Device paths are not supported.',
      errorDuplicate: 'This directory is already configured for the session.',
      errorEntryMissing: 'That workspace entry no longer exists.',
      errorUnauthorized: 'The panel token is invalid; reload the page.',
      errorLocalOnly: 'The panel is available only to local connections.',
      errorApplyFailed: 'The sandbox grant could not be applied.',
      errorTooLarge: 'The request is too large.',
      errorInvalidRequest: 'The request was rejected.',
      errorInternal: 'The host reported an internal error.',
      errorPathInvalid: 'The directory address is invalid.',
      browseUnavailable: 'The host has no directory picker.',
      sessionMissing: 'The session is not available.',
      previewFailed: 'Cannot use this directory: {error}',
      loadFailedShort: 'Configuration unavailable.',
      unknownError: 'Unknown error',
      pathCopied: 'Path copied.',
    }

    const ZH = {
      buttonLabel: '额外工作区',
      buttonLabelCount: '额外工作区，{count} 个已启用',
      buttonTitle: '为此会话配置额外工作区',
      title: '额外工作区',
      intro: '允许此会话写入更多目录。文件工具与新建的沙箱命令使用同一份会话级授权。',
      close: '关闭',
      session: '会话工作区',
      modeLabel: '文件策略',
      modeReadOnly: '只读',
      modeWorkspaceWrite: '工作区可写',
      modeDanger: '完全访问',
      saved: '已配置的工作区',
      refresh: '刷新',
      loading: '读取中…',
      enable: '启用此工作区',
      disable: '停用此工作区',
      empty: '还没有额外工作区，请在下方添加。',
      addTitle: '添加工作区',
      pathLabel: '目录',
      pathPlaceholder: 'D:\\projects\\shared、\\\\server\\share、/cygdrive/d/...、/mnt/d/...、%USERPROFILE%\\shared',
      labelLabel: '显示名称（可选）',
      labelPlaceholder: '共享资源',
      browse: '浏览…',
      add: '添加',
      adding: '正在添加…',
      pathHint: '目录必须存在，且不能是符号链接或联接点。拒绝盘符根目录与 Windows 系统目录。',
      previewTitle: '解析结果',
      previewChecking: '正在检查…',
      duplicate: '已配置为“{label}”。',
      warnings: '提示',
      badgeDisabled: '已停用',
      badgeFiles: '文件',
      badgeProcesses: '进程',
      badgeProcessesError: '进程授权失败',
      badgeProcessesUnsupported: '进程授权不可用',
      badgeFilesError: '文件授权失败',
      badgeMissing: '目录不存在',
      badgeReadOnlyInactive: '未生效（只读）',
      badgeDanger: '沙箱未启用',
      retry: '重试',
      remove: '移除',
      confirm: '确认移除',
      cancel: '取消',
      footer: '更改会应用到新的文件操作与新的沙箱命令；已在运行的命令保持原有权限。移除条目会撤销它添加的 Windows ACL 授权。',
      unsupported: '当前宿主不是 Windows；进程授权不可用。',
      readOnlyWarning: '会话当前为只读。额外工作区会被保存，且 ACL 授权会立即应用，但切换到“工作区可写”前写入仍会被拒绝。',
      dangerNotice: '当前为完全访问；沙箱不再限制写入，这些授权无需生效。',
      memoryWarning: '存储域不可用，本次配置只在宿主重启前有效。',
      loadFailed: '读取配置失败：{error}',
      saveFailed: '更改失败：{error}',
      addSuccess: '已添加 {path}。',
      addPartial: '已添加 {path}，但 Windows 进程授权失败。文件工具可写入，沙箱命令不可写入。修复目录后请点“重试”。',
      removeSuccess: '已移除 {path}。',
      toggleSuccess: '已更新 {path}。',
      retrySuccess: '已重试 {path}。',
      retryFailed: '重试失败：{error}',
      enabledSuccess: '已启用 {path}。',
      disabledSuccess: '已停用 {path}，相关授权已撤销。',
      processGrantFailed: 'Windows 进程授权失败。',
      fileGrantFailed: '文件工具授权失败。',
      errorNotFound: '目录不存在。',
      errorNotDirectory: '该路径不是目录。',
      errorSymlink: '该路径是符号链接或联接点，请使用物理目录。',
      errorDriveRoot: '不能授权整个盘符根目录。',
      errorProtected: '这是受保护的系统目录或安装目录。',
      errorWorkspace: '该路径是会话工作区、位于其中，或包含会话工作区。',
      errorUnknownVariable: '路径包含未知的环境变量。',
      errorDriveRelative: '不支持 C:folder 这类驱动器相对路径。',
      errorDevicePath: '不支持设备路径。',
      errorDuplicate: '该目录已在此会话中配置。',
      errorEntryMissing: '该工作区条目已不存在。',
      errorUnauthorized: '面板令牌无效，请刷新页面。',
      errorLocalOnly: '面板仅允许本机连接。',
      errorApplyFailed: '无法应用沙箱授权。',
      errorTooLarge: '请求内容过大。',
      errorInvalidRequest: '请求被拒绝。',
      errorInternal: '宿主报告了内部错误。',
      errorPathInvalid: '目录地址无效。',
      browseUnavailable: '宿主没有目录选择器。',
      sessionMissing: '会话不可用。',
      previewFailed: '无法使用该目录：{error}',
      loadFailedShort: '配置不可用。',
      unknownError: '未知错误',
      pathCopied: '路径已复制。',
    }

    const CSS = String.raw`
.dsh-xw-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  min-width: 28px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  position: relative;
}
.dsh-xw-button:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-xw-button:focus-visible,
.dsh-xw-btn:focus-visible,
.dsh-xw-icon-btn:focus-visible,
.dsh-xw-switch:focus-visible,
.dsh-xw-input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-xw-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.dsh-xw-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
  backdrop-filter: blur(2px);
}
.dsh-xw-modal {
  width: min(780px, calc(100vw - 32px));
  max-height: min(84vh, 920px);
  overflow: auto;
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-panel, 12px);
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv3, 0 24px 80px rgba(0, 0, 0, 0.35));
  font-size: 13px;
  line-height: 1.5;
}
.dsh-xw-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.dsh-xw-header-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}
.dsh-xw-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-brand-primary);
}
.dsh-xw-title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
}
.dsh-xw-subtitle {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.dsh-xw-session {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin: 14px 0 4px;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-xw-kicker {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.dsh-xw-mono {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}
.dsh-xw-session-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-xw-section {
  margin-top: 18px;
}
.dsh-xw-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.dsh-xw-section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}
.dsh-xw-rows {
  display: grid;
  gap: 8px;
}
.dsh-xw-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-xw-row-main {
  min-width: 0;
  display: grid;
  gap: 3px;
}
.dsh-xw-row-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-weight: 600;
}
.dsh-xw-row-path {
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-xw-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.dsh-xw-empty {
  padding: 14px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  font-size: 12px;
}
.dsh-xw-badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dsh-xw-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.dsh-xw-badge[data-tone="ok"] {
  color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-border-l1));
}
.dsh-xw-badge[data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1));
}
.dsh-xw-badge[data-tone="error"] {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1));
}
.dsh-xw-badge[data-tone="muted"] {
  color: var(--dsw-alias-state-idle-primary);
}
.dsh-xw-error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.dsh-xw-warn {
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.dsh-xw-notice {
  margin-top: 12px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
}
.dsh-xw-notice[data-kind="error"] {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1));
}
.dsh-xw-notice[data-kind="warn"] {
  color: var(--dsw-alias-state-warn-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1));
}
.dsh-xw-notice[data-kind="success"] {
  color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-border-l1));
}
.dsh-xw-notice[data-kind="muted"] {
  color: var(--dsw-alias-label-secondary);
}
.dsh-xw-form {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-xw-field {
  display: grid;
  gap: 5px;
}
.dsh-xw-field-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
}
.dsh-xw-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dsh-xw-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.dsh-xw-input::placeholder {
  color: var(--dsw-alias-label-secondary);
  opacity: 0.9;
}
.dsh-xw-form-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.dsh-xw-hint {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.45;
}
.dsh-xw-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-xw-btn:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-xw-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.dsh-xw-btn-primary {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
  font-weight: 650;
}
.dsh-xw-btn-danger {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-xw-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-xw-icon-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-xw-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.dsh-xw-icon-btn.dsh-xw-danger:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-xw-switch {
  position: relative;
  width: 32px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
  flex: none;
}
.dsh-xw-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  transition: transform 0.15s ease;
}
.dsh-xw-switch[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-xw-switch[aria-checked="true"]::after {
  transform: translateX(14px);
}
.dsh-xw-switch:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-xw-confirm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dsh-xw-preview {
  margin-top: 9px;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  display: grid;
  gap: 3px;
}
.dsh-xw-preview-title {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
}
.dsh-xw-footer {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.55;
}
.dsh-xw-loading {
  padding: 24px 0;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}
@media (max-width: 640px) {
  .dsh-xw-backdrop {
    padding: 8px;
    align-items: flex-end;
  }
  .dsh-xw-modal {
    width: calc(100vw - 16px);
    max-height: 88vh;
    padding: 16px;
    border-radius: 12px;
  }
  .dsh-xw-row {
    flex-direction: column;
  }
  .dsh-xw-row-actions {
    align-self: flex-end;
  }
}
`

    function errorText(error) {
      if (error instanceof Error && error.message) return error.message
      return String(error ?? '')
    }

    const ERROR_KEY_BY_CODE = {
      NOT_FOUND: 'errorNotFound',
      NOT_DIRECTORY: 'errorNotDirectory',
      SYMLINK: 'errorSymlink',
      DRIVE_ROOT: 'errorDriveRoot',
      PROTECTED_SYSTEM_PATH: 'errorProtected',
      INSIDE_WORKSPACE: 'errorWorkspace',
      WORKSPACE_SUBDIRECTORY: 'errorWorkspace',
      UNKNOWN_VARIABLE: 'errorUnknownVariable',
      DRIVE_RELATIVE: 'errorDriveRelative',
      DEVICE_PATH: 'errorDevicePath',
      DUPLICATE: 'errorDuplicate',
      ENTRY_NOT_FOUND: 'errorEntryMissing',
      SESSION_NOT_FOUND: 'sessionMissing',
      UNAUTHORIZED: 'errorUnauthorized',
      LOCAL_ONLY: 'errorLocalOnly',
      APPLY_FAILED: 'errorApplyFailed',
      BODY_TOO_LARGE: 'errorTooLarge',
      INVALID_JSON: 'errorInvalidRequest',
      INVALID_ARGUMENT: 'errorInvalidRequest',
      INTERNAL: 'errorInternal',
      FILE_GRANT_FAILED: 'fileGrantFailed',
      PROCESS_GRANT_FAILED: 'processGrantFailed',
      PATH_ERROR: 'errorPathInvalid',
    }

    function hostErrorText(error, t) {
      const code = error && typeof error === 'object' ? error.code : undefined
      const key = code === undefined ? undefined : ERROR_KEY_BY_CODE[code]
      return key === undefined ? errorText(error) : t(key)
    }

    function statusErrorText(status, t) {
      const code = status && typeof status === 'object' ? status.errorCode : undefined
      const key = code === undefined ? undefined : ERROR_KEY_BY_CODE[code]
      return key === undefined ? (status?.error ?? '') : t(key)
    }

    function basename(path) {
      const value = String(path ?? '')
      const parts = value.split(/[\\/]/)
      return parts[parts.length - 1] || value
    }

    let runtime = null
    let token = ''
    let tokenPromise = null

    async function ensureToken(force = false) {
      if (force) {
        token = ''
        tokenPromise = null
      }
      if (token !== '') return token
      tokenPromise ??= fetch(`${BASE}/bootstrap`, { credentials: 'same-origin' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (typeof payload.token !== 'string' || payload.token === '') throw new Error('The bootstrap response carried no token.')
          token = payload.token
          return token
        })
        .catch((error) => {
          tokenPromise = null
          throw error
        })
      return tokenPromise
    }

    async function requestOnce(path, options) {
      const value = await ensureToken()
      const headers = { 'x-dsh-extraworkspace-token': value }
      let body
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json'
        body = JSON.stringify(options.body)
      }
      let target = `${BASE}${path}`
      if (options.query !== undefined) {
        const query = new URLSearchParams()
        for (const [key, item] of Object.entries(options.query)) {
          if (item !== undefined && item !== null) query.set(key, String(item))
        }
        target += `?${query.toString()}`
      }
      const response = await fetch(target, {
        method: options.method ?? 'GET',
        headers,
        credentials: 'same-origin',
        body,
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        const error = new Error(payload?.error ? String(payload.error) : `HTTP ${response.status}`)
        error.code = payload?.code
        error.status = response.status
        throw error
      }
      return payload
    }

    async function request(path, options = {}) {
      try {
        return await requestOnce(path, options)
      } catch (error) {
        if (error && error.status === 401) {
          token = ''
          tokenPromise = null
          return requestOnce(path, options)
        }
        throw error
      }
    }

    function IconFolder({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }),
        h('path', { d: 'M12 11.5v5M9.5 14h5' }))
    }

    function IconRefresh({ size = 15 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M20 11a8 8 0 1 0-2.34 5.66' }),
        h('path', { d: 'M20 4v7h-7' }))
    }

    function IconTrash({ size = 15 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13' }),
        h('path', { d: 'M10 11v5M14 11v5' }))
    }

    function IconClose({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M6 6l12 12M18 6 6 18' }))
    }

    function IconPlus({ size = 15 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M12 5v14M5 12h14' }))
    }

    function Badge({ tone = 'muted', children }) {
      return h('span', { className: 'dsh-xw-badge', 'data-tone': tone }, children)
    }

    function badgesFor(root, t, mode) {
      const badges = []
      if (!root.enabled) {
        badges.push(h(Badge, { key: 'disabled', tone: 'muted' }, t('badgeDisabled')))
        if (!root.exists) badges.push(h(Badge, { key: 'missing', tone: 'error' }, t('badgeMissing')))
        return badges
      }
      if (!root.exists) {
        badges.push(h(Badge, { key: 'missing', tone: 'error' }, t('badgeMissing')))
        return badges
      }
      if (mode === 'read-only') {
        badges.push(h(Badge, { key: 'read-only', tone: 'warn' }, t('badgeReadOnlyInactive')))
        return badges
      }
      if (mode === 'danger-full-access') {
        badges.push(h(Badge, { key: 'danger', tone: 'muted' }, t('badgeDanger')))
        return badges
      }
      if (root.status.fileTools === 'error') {
        badges.push(h(Badge, { key: 'files-error', tone: 'error' }, t('badgeFilesError')))
      } else if (root.status.fileTools === 'active') {
        badges.push(h(Badge, { key: 'files', tone: 'ok' }, t('badgeFiles')))
      }
      if (root.status.processes === 'active') {
        badges.push(h(Badge, { key: 'processes', tone: 'ok' }, t('badgeProcesses')))
      } else if (root.status.processes === 'error') {
        badges.push(h(Badge, { key: 'processes-error', tone: 'error' }, t('badgeProcessesError')))
      } else if (root.status.processes === 'unsupported') {
        badges.push(h(Badge, { key: 'processes-unsupported', tone: 'muted' }, t('badgeProcessesUnsupported')))
      }
      return badges
    }

    function RootRow({ root, t, mode, busy, confirmRemove, setConfirmRemove, onToggle, onRemove, onRetry }) {
      const showRetry = root.enabled && (root.status.state === 'error' || root.status.state === 'partial' || root.status.state === 'missing')
      const localizedError = root.status.error ? statusErrorText(root.status, t) : ''
      const showRawDetail = root.status.errorCode === 'PROCESS_GRANT_FAILED' || root.status.errorCode === 'FILE_GRANT_FAILED'
      const rawDetail = showRawDetail && root.status.error && localizedError !== root.status.error ? root.status.error : ''
      return h('div', { className: 'dsh-xw-row' },
        h('div', { className: 'dsh-xw-row-main' },
          h('div', { className: 'dsh-xw-row-title' },
            h('span', null, root.label || basename(root.path)),
            h('div', { className: 'dsh-xw-badges' }, ...badgesFor(root, t, mode))),
          h('div', { className: 'dsh-xw-mono dsh-xw-row-path', title: root.path }, root.path),
          root.status.error ? h('div', { className: 'dsh-xw-error' }, localizedError) : null,
          rawDetail !== '' ? h('div', { className: 'dsh-xw-hint' }, rawDetail) : null,
          ...(root.status.warnings ?? []).map((warning, index) => h('div', { key: `warning-${index}`, className: 'dsh-xw-warn' }, warning))),
        h('div', { className: 'dsh-xw-row-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-xw-switch',
            role: 'switch',
            'aria-checked': root.enabled,
            'aria-label': root.label || basename(root.path),
            title: root.enabled ? t('disable') : t('enable'),
            disabled: busy !== '',
            onClick: () => onToggle(root),
          }),
          showRetry ? h('button', {
            type: 'button',
            className: 'dsh-xw-icon-btn',
            title: t('retry'),
            'aria-label': t('retry'),
            disabled: busy !== '',
            onClick: () => onRetry(root),
          }, h(IconRefresh, null)) : null,
          confirmRemove === root.id
            ? h('div', { className: 'dsh-xw-confirm' },
              h('button', {
                type: 'button',
                className: 'dsh-xw-btn dsh-xw-btn-danger',
                disabled: busy !== '',
                onClick: () => onRemove(root),
              }, t('confirm')),
              h('button', {
                type: 'button',
                className: 'dsh-xw-btn',
                disabled: busy !== '',
                onClick: () => setConfirmRemove(''),
              }, t('cancel')))
            : h('button', {
              type: 'button',
              className: 'dsh-xw-icon-btn dsh-xw-danger',
              title: t('remove'),
              'aria-label': t('remove'),
              disabled: busy !== '',
              onClick: () => setConfirmRemove(root.id),
            }, h(IconTrash, null))))
    }

    function Panel(props) {
      const { sessionId } = props
      const t = runtime.t
      const [, forceRender] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => {
        if (runtime.ctx.locale === undefined) return undefined
        return runtime.ctx.locale.subscribe(() => forceRender())
      }, [])

      const [open, setOpen] = React.useState(false)
      const [state, setState] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [input, setInput] = React.useState('')
      const [label, setLabel] = React.useState('')
      const [preview, setPreview] = React.useState(null)
      const [previewBusy, setPreviewBusy] = React.useState(false)
      const [confirmRemove, setConfirmRemove] = React.useState('')
      const dialogRef = React.useRef(null)
      const loadSeq = React.useRef(0)
      const previewSeq = React.useRef(0)

      const load = React.useCallback(async () => {
        if (sessionId === undefined || sessionId === null) return
        const sequence = ++loadSeq.current
        setLoading(true)
        setError('')
        try {
          const next = await request('/state', { query: { sessionId } })
          if (loadSeq.current !== sequence) return
          setState(next)
        } catch (loadError) {
          if (loadSeq.current !== sequence) return
          const unavailable = loadError !== null && typeof loadError === 'object' && loadError.status === 404 && (loadError.code === undefined || loadError.code === null)
          setError(unavailable ? t('unsupported') : t('loadFailed', { error: hostErrorText(loadError, t) }))
        } finally {
          if (loadSeq.current === sequence) setLoading(false)
        }
      }, [sessionId, t])

      React.useEffect(() => {
        setState(null)
        setPreview(null)
        setConfirmRemove('')
        setError('')
        setNotice(null)
      }, [sessionId])

      React.useEffect(() => {
        if (sessionId !== undefined && sessionId !== null) void load()
      }, [sessionId, load])

      React.useEffect(() => {
        if (!open) {
          setConfirmRemove('')
          return undefined
        }
        void load()
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
          document.body.style.overflow = previousOverflow
        }
      }, [open, load])

      React.useEffect(() => {
        if (!open) return undefined
        const previous = document.activeElement
        const node = dialogRef.current
        const focusable = node === null ? [] : Array.from(node.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter((element) => element.offsetParent !== null)
        const pathInput = node === null ? null : node.querySelector('input.dsh-xw-input')
        if (pathInput !== null) pathInput.focus()
        else if (focusable.length > 0) focusable[0].focus()
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
            return
          }
          if (event.key !== 'Tab' || node === null) return
          const current = Array.from(node.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((element) => element.offsetParent !== null)
          if (current.length === 0) return
          const first = current[0]
          const last = current[current.length - 1]
          if (!node.contains(document.activeElement)) {
            event.preventDefault()
            ;(event.shiftKey ? last : first).focus()
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          if (previous !== null && typeof previous.focus === 'function') previous.focus()
        }
      }, [open])

      const runPreview = React.useCallback(async (value) => {
        const trimmed = value.trim()
        if (trimmed === '') {
          setPreview(null)
          setPreviewBusy(false)
          return
        }
        const sequence = ++previewSeq.current
        setPreviewBusy(true)
        try {
          const result = await request('/resolve', { method: 'POST', body: { sessionId, input: trimmed } })
          if (previewSeq.current !== sequence) return
          setPreview({ ok: true, input: trimmed, ...result })
        } catch (previewError) {
          if (previewSeq.current !== sequence) return
          setPreview({ ok: false, input: trimmed, error: hostErrorText(previewError, t) })
        } finally {
          if (previewSeq.current === sequence) setPreviewBusy(false)
        }
      }, [sessionId, t])

      React.useEffect(() => {
        if (!open) {
          previewSeq.current += 1
          setPreviewBusy(false)
          setPreview(null)
          return undefined
        }
        const value = input.trim()
        if (value === '') {
          previewSeq.current += 1
          setPreviewBusy(false)
          setPreview(null)
          return undefined
        }
        const timer = setTimeout(() => { void runPreview(value) }, 450)
        return () => clearTimeout(timer)
      }, [input, open, runPreview])

      const applyResult = React.useCallback((next, successKey, path, addedRoot) => {
        setState(next)
        setError('')
        if (successKey === 'addSuccess' && addedRoot !== undefined && addedRoot.status.processes === 'error') {
          setNotice({ kind: 'warn', text: t('addPartial', { path }) })
        } else {
          setNotice({ kind: 'success', text: t(successKey, { path }) })
        }
      }, [t])

      const add = React.useCallback(async () => {
        const value = input.trim()
        if (value === '') return
        if (preview !== null && (preview.ok === false || preview.duplicate !== null)) return
        loadSeq.current += 1
        setLoading(false)
        setBusy('add')
        setError('')
        setNotice(null)
        const previousIds = new Set((state?.roots ?? []).map((root) => root.id))
        try {
          const next = await request('/add', { method: 'POST', body: { sessionId, input: value, label } })
          const addedRoot = next?.roots?.find((root) => !previousIds.has(root.id))
          previewSeq.current += 1
          setInput('')
          setLabel('')
          setPreview(null)
          setPreviewBusy(false)
          applyResult(next, 'addSuccess', addedRoot?.path ?? value, addedRoot)
        } catch (addError) {
          setError(t('saveFailed', { error: hostErrorText(addError, t) }))
        } finally {
          setBusy('')
        }
      }, [applyResult, input, label, preview, sessionId, state, t])

      const browse = React.useCallback(async () => {
        const uiWorkspace = runtime.ctx.get('uiWorkspace')
        if (uiWorkspace === undefined || typeof uiWorkspace.pickDirectory !== 'function') {
          setError(t('browseUnavailable'))
          return
        }
        setBusy('browse')
        setError('')
        try {
          const picked = await uiWorkspace.pickDirectory()
          if (typeof picked === 'string' && picked !== '') {
            previewSeq.current += 1
            setInput(picked)
            setPreview(null)
            setPreviewBusy(false)
          }
        } catch (browseError) {
          setError(hostErrorText(browseError, t))
        } finally {
          setBusy('')
        }
      }, [t])

      const onToggle = React.useCallback(async (root) => {
        loadSeq.current += 1
        setLoading(false)
        setBusy(root.id)
        setError('')
        try {
          const next = await request('/set-enabled', { method: 'POST', body: { sessionId, id: root.id, enabled: !root.enabled } })
          const updated = next?.roots?.find((item) => item.id === root.id)
          if (!root.enabled && updated !== undefined && updated.status.state === 'partial') {
            setState(next)
            setError('')
            setNotice({ kind: 'warn', text: t('addPartial', { path: root.path }) })
          } else {
            applyResult(next, root.enabled ? 'disabledSuccess' : 'enabledSuccess', root.path)
          }
        } catch (toggleError) {
          setError(t('saveFailed', { error: hostErrorText(toggleError, t) }))
        } finally {
          setBusy('')
        }
      }, [applyResult, sessionId, t])

      const onRemove = React.useCallback(async (root) => {
        loadSeq.current += 1
        setLoading(false)
        setBusy(root.id)
        setError('')
        try {
          const next = await request('/remove', { method: 'POST', body: { sessionId, id: root.id } })
          setConfirmRemove('')
          applyResult(next, 'removeSuccess', root.path)
        } catch (removeError) {
          setError(t('saveFailed', { error: hostErrorText(removeError, t) }))
        } finally {
          setBusy('')
        }
      }, [applyResult, sessionId, t])

      const onRetry = React.useCallback(async (root) => {
        loadSeq.current += 1
        setLoading(false)
        setBusy(root.id)
        setError('')
        try {
          const next = await request('/retry', { method: 'POST', body: { sessionId, id: root.id } })
          const applied = next?.roots?.find((item) => item.id === root.id)
          if (applied !== undefined && applied.status.error) {
            setState(next)
            setNotice({ kind: 'warn', text: t('retryFailed', { error: statusErrorText(applied.status, t) }) })
          } else {
            applyResult(next, 'retrySuccess', root.path)
          }
        } catch (retryError) {
          setError(t('saveFailed', { error: hostErrorText(retryError, t) }))
        } finally {
          setBusy('')
        }
      }, [applyResult, sessionId, t])

      if (sessionId === undefined || sessionId === null) return null

      const count = state?.roots?.filter((root) => root.enabled).length ?? 0
      const previewBlocked = preview !== null && (preview.ok === false || preview.duplicate !== null)
      const modeLabel = state === null
        ? ''
        : state.mode === 'read-only' ? t('modeReadOnly')
          : state.mode === 'danger-full-access' ? t('modeDanger')
            : t('modeWorkspaceWrite')

      const button = h('button', {
        type: 'button',
        className: 'dsh-xw-button',
        title: t('buttonTitle'),
        'aria-label': count > 0 ? t('buttonLabelCount', { count }) : t('buttonLabel'),
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: () => {
          setOpen((value) => !value)
          setError('')
          setNotice(null)
        },
      },
      h(IconFolder, { size: 16 }),
      count > 0 ? h('span', { className: 'dsh-xw-count' }, String(count)) : null)

      if (!open) return button

      const modal = ReactDOM.createPortal(
        h('div', {
          className: 'dsh-xw-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setOpen(false)
          },
        },
        h('div', {
          className: 'dsh-xw-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsh-xw-title',
          'aria-describedby': 'dsh-xw-intro',
          ref: dialogRef,
        },
        h('div', { className: 'dsh-xw-header' },
          h('div', { className: 'dsh-xw-header-main' },
            h('div', { className: 'dsh-xw-mark' }, h(IconFolder, { size: 20 })),
            h('div', null,
              h('h2', { id: 'dsh-xw-title', className: 'dsh-xw-title' }, t('title')),
              h('p', { id: 'dsh-xw-intro', className: 'dsh-xw-subtitle' }, t('intro')))),
          h('button', {
            type: 'button',
            className: 'dsh-xw-icon-btn',
            title: t('close'),
            'aria-label': t('close'),
            onClick: () => setOpen(false),
          }, h(IconClose, null))),

        state !== null
          ? h('div', { className: 'dsh-xw-session' },
            h('span', { className: 'dsh-xw-kicker' }, t('session')),
            h('span', { className: 'dsh-xw-mono dsh-xw-session-path', title: state.cwd }, state.cwd ?? '—'),
            h('span', { className: 'dsh-xw-kicker' }, t('modeLabel')),
            h(Badge, { tone: state.mode === 'workspace-write' ? 'ok' : state.mode === 'read-only' ? 'warn' : 'muted' }, modeLabel))
          : null,

        state !== null && state.supported === false ? h('div', { className: 'dsh-xw-notice', 'data-kind': 'warn' }, t('unsupported')) : null,
        state !== null && state.mode === 'read-only' ? h('div', { className: 'dsh-xw-notice', 'data-kind': 'warn' }, t('readOnlyWarning')) : null,
        state !== null && state.mode === 'danger-full-access' ? h('div', { className: 'dsh-xw-notice', 'data-kind': 'muted' }, t('dangerNotice')) : null,
        state !== null && state.storage === 'memory' ? h('div', { className: 'dsh-xw-notice', 'data-kind': 'warn' }, t('memoryWarning')) : null,

        h('div', { className: 'dsh-xw-section' },
          h('div', { className: 'dsh-xw-section-head' },
            h('h3', { className: 'dsh-xw-section-title' }, t('saved')),
            h('button', {
              type: 'button',
              className: 'dsh-xw-btn',
              onClick: () => { void load() },
              disabled: loading || busy !== '',
            }, h(IconRefresh, null), t('refresh'))),
          state === null
            ? h('div', { className: 'dsh-xw-empty' },
              error !== '' ? t('loadFailedShort') : t('loading'),
              error !== ''
                ? h('button', {
                  type: 'button',
                  className: 'dsh-xw-btn',
                  style: { marginLeft: '8px' },
                  onClick: () => { void load() },
                  disabled: loading,
                }, h(IconRefresh, null), t('refresh'))
                : null)
            : (state?.roots?.length ?? 0) === 0
              ? h('div', { className: 'dsh-xw-empty' }, t('empty'))
              : h('div', { className: 'dsh-xw-rows' },
                ...state.roots.map((root) => h(RootRow, {
                  key: root.id,
                  root,
                  t,
                  mode: state.mode,
                  busy,
                  confirmRemove,
                  setConfirmRemove,
                  onToggle,
                  onRemove,
                  onRetry,
                })))),

        h('div', { className: 'dsh-xw-section' },
          h('div', { className: 'dsh-xw-section-head' },
            h('h3', { className: 'dsh-xw-section-title' }, t('addTitle'))),
          h('div', { className: 'dsh-xw-form' },
            h('label', { className: 'dsh-xw-field' },
              h('span', { className: 'dsh-xw-field-label' }, t('pathLabel')),
              h('div', { className: 'dsh-xw-input-row' },
                h('input', {
                  className: 'dsh-xw-input dsh-xw-mono',
                  value: input,
                  placeholder: t('pathPlaceholder'),
                  spellCheck: false,
                  disabled: state === null || busy !== '',
                  autoComplete: 'off',
                  onChange: (event) => {
                    previewSeq.current += 1
                    setPreviewBusy(false)
                    setInput(event.target.value)
                    setPreview(null)
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void add()
                    }
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'dsh-xw-btn',
                  onClick: () => { void browse() },
                  disabled: state === null || busy !== '',
                }, t('browse')))),
            h('label', { className: 'dsh-xw-field' },
              h('span', { className: 'dsh-xw-field-label' }, t('labelLabel')),
              h('input', {
                className: 'dsh-xw-input',
                value: label,
                placeholder: t('labelPlaceholder'),
                maxLength: 200,
                disabled: state === null || busy !== '',
                onChange: (event) => setLabel(event.target.value),
              })),
            h('div', { className: 'dsh-xw-form-actions' },
              h('button', {
                type: 'button',
                className: 'dsh-xw-btn dsh-xw-btn-primary',
                onClick: () => { void add() },
                disabled: state === null || busy !== '' || input.trim() === '' || previewBlocked,
              }, busy === 'add' ? t('adding') : h(IconPlus, null), busy === 'add' ? null : t('add')),
              h('span', { className: 'dsh-xw-hint' }, t('pathHint')))),
          previewBusy
            ? h('div', { className: 'dsh-xw-preview' }, h('div', { className: 'dsh-xw-preview-title' }, t('previewChecking')))
            : preview === null
              ? null
              : preview.ok
                ? h('div', { className: 'dsh-xw-preview' },
                  h('div', { className: 'dsh-xw-preview-title' }, t('previewTitle')),
                  h('div', { className: 'dsh-xw-mono' }, preview.canonicalPath),
                  preview.duplicate !== null
                    ? h('div', { className: 'dsh-xw-warn' }, t('duplicate', { label: preview.duplicate.label || basename(preview.canonicalPath) }))
                    : null,
                  ...(preview.warnings ?? []).map((warning, index) => h('div', { key: `preview-warning-${index}`, className: 'dsh-xw-warn' }, warning)))
                : h('div', { className: 'dsh-xw-error' }, t('previewFailed', { error: preview.error }))),

        notice !== null
          ? h('div', { className: 'dsh-xw-notice', 'data-kind': notice.kind, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text)
          : null,
        error !== '' ? h('div', { className: 'dsh-xw-notice', 'data-kind': 'error', role: 'alert' }, error) : null,

        h('div', { className: 'dsh-xw-footer' }, t('footer')))),
        document.body,
      )

      return h(React.Fragment, null, button, modal)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'dsh-extraworkspace locale')
        ctx.effect(() => {
          const element = document.createElement('style')
          element.setAttribute('data-dsh-extraworkspace', '')
          element.textContent = CSS
          document.head.appendChild(element)
          return () => element.remove()
        }, 'dsh-extraworkspace styles')
        runtime = { ctx, t: ctx.locale.bind(NS) }
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'dsh-extraworkspace',
          order: 12,
          label: () => runtime.t('buttonLabel'),
        }, Panel))
      },
    }
  },
})
