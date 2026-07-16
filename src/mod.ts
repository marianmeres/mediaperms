/**
 * Framework-agnostic microphone / camera permission lifecycle manager.
 *
 * The default entrypoint of `@marianmeres/mediaperms`. Re-exports the whole
 * public API: {@linkcode createMediaPerms} plus its {@linkcode MediaPerms}
 * handle, the reactive {@linkcode MediaPermsState} shape, the
 * {@linkcode MediaPermsKind} / {@linkcode MediaPermissionStatus} /
 * {@linkcode MediaPlatformContext} unions, the typed
 * {@linkcode MediaPermsErrorCode} codes, platform helpers like
 * {@linkcode detectPlatform} / {@linkcode devicesForKind}, and the pluggable
 * adapter contract.
 *
 * Detects the platform (browser, PWA, iOS/Android WebView), checks and
 * requests permission, tracks status reactively (Svelte `$store`-compatible),
 * and can open native app settings via a bridge. It never owns a MediaStream —
 * tracks opened to probe permission are stopped immediately.
 *
 * The "re-enable guide" UI helper ships as a separate entrypoint,
 * `@marianmeres/mediaperms/reenable-guide`.
 *
 * ```ts
 * import { createMediaPerms } from "@marianmeres/mediaperms";
 *
 * const perms = createMediaPerms("camera");
 * perms.subscribe((state) => console.log(state.status));
 * await perms.request();
 * ```
 *
 * @module
 */

export * from "./mediaperms.ts";
