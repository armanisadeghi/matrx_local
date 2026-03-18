/**
 * Type stub for tauri-plugin-macos-permissions-api.
 *
 * This package is macOS-only and declared as an optionalDependency so it is
 * not installed on Linux or Windows build machines. This stub satisfies the
 * TypeScript compiler on all platforms so `tsc --noEmit` passes everywhere.
 *
 * The actual implementation is provided at runtime by the installed npm
 * package on macOS. On other platforms the dynamic `import()` calls in
 * use-permissions.ts are gated behind `isTauri()` checks and will never
 * execute, so the stub functions below are never called.
 */
declare module "tauri-plugin-macos-permissions-api" {
  export function checkMicrophonePermission(): Promise<boolean>;
  export function requestMicrophonePermission(): Promise<boolean>;

  export function checkCameraPermission(): Promise<boolean>;
  export function requestCameraPermission(): Promise<boolean>;

  export function checkScreenRecordingPermission(): Promise<boolean>;
  export function requestScreenRecordingPermission(): Promise<boolean>;

  export function checkAccessibilityPermission(): Promise<boolean>;
  export function requestAccessibilityPermission(): Promise<boolean>;

  export function checkFullDiskAccessPermission(): Promise<boolean>;
  export function requestFullDiskAccessPermission(): Promise<boolean>;

  export function checkInputMonitoringPermission(): Promise<boolean>;
  export function requestInputMonitoringPermission(): Promise<boolean>;
}
