# @marianmeres/mediaperms — Agent Guide

## Quick Reference

- **Stack**: Deno, TypeScript
- **Runtime dependencies**: `@marianmeres/store` (reactive store with Svelte-compatible `.subscribe()`), `@marianmeres/clog` (default logger, overridable via the `logger` option)
- **Test**: `deno task test` | **Build example**: `deno task build:example`
- **Lineage**: generalized successor of `@marianmeres/micperms` (microphone-only,
  kept alive for BC). Same internals, parameterized by media kind.

## Project Structure

```
/src
  mod.ts               — Public exports (re-exports mediaperms.ts)
  mediaperms.ts        — Core implementation (~880 lines, mostly JSDoc)
  reenable-guide.ts    — Extras: pure-DOM tutorial, subpath export
/tests
  mediaperms.test.ts        — Unit tests with mock adapter
  reenable-guide.test.ts    — Headless controller + copy resolution tests
  reenable-guide-dom.test.ts — DOM factory tests (deno-dom)
/example
  index.html           — Vanilla JS demo page (core, kind switcher)
  guide.html           — Playground for the tutorial extras
  svelte/              — Reference Svelte 5 components (not built here)
/scripts
  build-npm.ts         — NPM package build script
```

## What This Library Does

Manages **media (microphone / camera) permission lifecycle only**: detect
platform, check/request permission state, track state reactively, support
native bridge for opening settings.

An instance is created for one of three kinds:

- `"microphone"` → probes `getUserMedia({ audio: true })`
- `"camera"` → probes `getUserMedia({ video: true })`
- `"camera-and-microphone"` → probes both in **one** call (one prompt) and
  tracks a per-device breakdown in `state.devices`

Does NOT own MediaStreams. When `getUserMedia` is called to probe permission,
all tracks are stopped immediately.

## Key Concepts

| Concept                | Description                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Kind / devices**     | `MediaPermsKind` spans 1–2 `MediaPermsDevice`s (`devicesForKind`). State is tracked per device, merged for display. |
| **Merged status**      | `mergeStatuses`: `denied` > `prompt` > `unknown`; `granted` only when all devices granted                           |
| **Adapter pattern**    | `MediaPermsBrowserAdapter` abstracts browser APIs; inject mock for testing. Query/onchange are per device.          |
| **Platform detection** | Auto-detects: `browser`, `pwa`, `ios-webview`, `android-webview`                                                    |
| **Bridge detection**   | Checks for iOS `webkit.messageHandlers` or Android JS interface                                                     |
| **Reactive state**     | `@marianmeres/store` powers `subscribe()` (Svelte `$store` compatible)                                              |

## Public API

| Export                            | Type    | Purpose                                               |
| --------------------------------- | ------- | ----------------------------------------------------- |
| `createMediaPerms(kind, config?)` | Factory | Main entry point, returns `MediaPerms` instance       |
| `createMicPerms(config?)`         | Factory | Wrapper for `createMediaPerms("microphone", …)`       |
| `createCamPerms(config?)`         | Factory | Wrapper for `createMediaPerms("camera", …)`           |
| `createDefaultAdapter(kind)`      | Factory | Real browser adapter (Permissions API + getUserMedia) |
| `devicesForKind(kind)`            | Helper  | Kind → device list; throws on invalid kind            |
| `mergeStatuses(statuses)`         | Helper  | Per-device statuses → merged status                   |
| `detectPlatform(config)`          | Helper  | Returns `MediaPlatformContext`                        |
| `detectBridge(platform, config)`  | Helper  | Returns `boolean`                                     |
| `MediaPermsErrorCode`             | Const   | Frozen object of typed `state.error.code` values      |

### Extras subpath (`@marianmeres/mediaperms/reenable-guide`)

| Export                                | Type    | Purpose                                                                                                                                                                                                                                     |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createReenableGuide(opts)`           | Factory | Mounts a pure-DOM multi-step tutorial into a host container; kind/flavor/theme aware. `kind` is required.                                                                                                                                   |
| `createReenableGuideController(opts)` | Factory | **Headless** state machine (no DOM): resolved steps/i18n/kind/flavor + `next/back/goto/done/openSettings` + Svelte-compatible `subscribe`. Render the markup yourself (Svelte/React/vanilla). The DOM factory is itself one consumer of it. |
| `detectFlavor(opts?)`                 | Helper  | Returns `ReenableGuideFlavor` (iOS/Android/desktop × browser/PWA/WebView).                                                                                                                                                                  |
| `defaultStepsFor(kind, flavor, lang)` | Helper  | The library's built-in steps (resolved copy + built-in art) for a kind + flavor + concrete lang. What a `steps` builder receives as `defaultSteps`.                                                                                         |

> Slots vs. headless: `createReenableGuide` already takes `slots`
> (`header`/`art`/`step`/`button`/`footer`) + `accent` + CSS-var overrides for
> skinning the built-in chrome. Reach for `createReenableGuideController` only
> when you want to own 100% of the DOM (e.g. a native Svelte component) while
> keeping kind/flavor detection, default copy and navigation.

> Per-flavor brand copy (keep the built-in art): `steps` accepts either an
> array (full replace) **or** a builder
> `({ kind, flavor, lang, defaultSteps }) => ReenableGuideStep[]` — map over
> `defaultSteps` (which carry the art) to override only the text, per flavor,
> with zero SVG copying. A declarative `stepText` map
> (`Partial<Record<flavor, (string|null)[]>>`, merged by index, art preserved,
> ignored if `steps` is set) is the single-language shorthand.
> `title`/`subtitle` likewise accept a `(ctx) => string` builder. Resolution
> lives once in `resolveGuideConfig` (`resolveSteps`/`resolveText`), so the
> controller and the DOM factory both benefit.

> i18n internals: step copy is stored as per-flavor **templates** with
> `{device}` / `{pronoun}` tokens, substituted per kind via `DEVICE_LABELS` /
> `DEVICE_PRONOUNS` (Slovak forms are accusative; pronouns carry gender and
> number). Adding a language = adding template + token rows; adding a kind =
> adding token rows only. The SVG art is permission-generic and shared by all
> kinds.

### MediaPerms instance methods

| Method           | Returns           | Description                                                                           |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `subscribe(cb)`  | `() => void`      | Reactive subscription (fires immediately)                                             |
| `get()`          | `MediaPermsState` | Current state snapshot (incl. `kind` + per-device `devices`)                          |
| `check()`        | `Promise<status>` | Query via Permissions API (all devices, parallel). Concurrent calls coalesce.         |
| `request()`      | `Promise<status>` | Request via getUserMedia (one call, stops tracks). Concurrent calls coalesce.         |
| `recheck()`      | `Promise<status>` | `check()` then fallback to `request()` if merged status ambiguous                     |
| `openSettings()` | `boolean`         | Call native bridge to open app settings; clears sticky `observedDenied` (all devices) |
| `reset()`        | `void`            | Reset all device statuses, `error`, `lastCheckedAt`, sticky flags (keeps listeners)   |
| `destroy()`      | `void`            | Cleanup all listeners (idempotent). Subsequent `check()`/`request()` log warns.       |

## Critical Conventions

1. All core implementation lives in `src/mediaperms.ts` — single-file library
2. Use `globalThis` not `window` (Deno compatibility)
3. Tests use injectable `adapter` — never depend on real browser APIs (the
   default-adapter tests are the only exception; they install a fake
   `navigator.permissions` / `navigator.mediaDevices` via `Object.defineProperty`)
4. `getUserMedia` is permission-probing only — always stop tracks immediately
5. Adapters return `"granted"` / `"denied"` for known permission outcomes;
   they THROW for device-/origin-level failures (no device, insecure origin,
   hardware busy). The factory inspects thrown `DOMException`s and classifies
   them via `MediaPermsErrorCode`. Do not swallow these into `"unknown"`.
6. `check()` and `request()` each cache an in-flight promise so concurrent
   callers receive the same resolved value. Do not bypass this with manual
   `busy`-flag inspection — use the cache.
7. Sticky `observedDenied` is tracked **per device** in the reactive store
   (single source of truth). `observeDevice()` mutates the flag,
   `coerceStatus()` is the pure projection; `applyIncoming()` composes them
   and `commitDevices()` is the single store-write path that re-derives the
   merged `status` + OR'd `observedDenied`. Keep the observe/coerce split —
   do not re-merge them.
8. Merged `status` and top-level `observedDenied` are ALWAYS derived from the
   per-device map inside `commitDevices()` — never write them directly.
9. Combined-kind denial refinement (the post-`"denied"` per-device re-query in
   `request()`) is best-effort and non-prompting. Do not remove it — without
   it a combined denial permanently smears both devices as denied even on
   truthful platforms. It is skipped for single kinds and when the
   Permissions API is unsupported, and its result is **discarded unless at
   least one device reads `"denied"`** — an all-granted reading right after a
   getUserMedia denial is inconsistent (typically an OS-level block on desktop
   Chromium, where site permissions still read "granted") and must not
   overwrite the observed denial. getUserMedia is the ground truth.
10. Format: tabs, 90-char line width, 4-space indent width (`deno fmt`)

## Before Making Changes

- [ ] Read `src/mediaperms.ts` for current implementation
- [ ] Check existing patterns and types
- [ ] Run `deno task test`
- [ ] Follow formatting: `deno fmt`

## Platform Quirks (iOS WKWebView)

- `navigator.permissions.query({ name: "microphone" | "camera" })` may throw or return unreliable results
- `getUserMedia` returns `NotAllowedError` without prompting unless native app implements `WKUIDelegate` with `decisionHandler(.grant)` — the delegate's capture type is `.microphone`, `.camera`, or `.cameraAndMicrophone` (matching this library's combined kind)
- Deep-link URI schemes are silently swallowed; only `webkit.messageHandlers` bridge works
- Recovery requires native layer to fire custom `app-resumed` event

## Platform Quirks (Android WebView)

- **Lying Permissions API.** After the user denies the OS prompt,
  `navigator.permissions.query({ name: "microphone" | "camera" }).state`
  returns `"prompt"` (not `"denied"`), while `getUserMedia` correctly rejects
  with `NotAllowedError`. `getUserMedia` is the only ground truth. This
  applies to microphone and camera identically.
- **Sticky denial mitigation.** `createMediaPerms` tracks per-device
  `observedDenied` flags, set whenever any observation reports `"denied"` for
  a device — `requestPermission()`, the `onPermissionChange` callback, or
  `check()`'s Permissions-API query (the last only fires on truthful
  platforms; the lying Android WebView API never reports `"denied"`, which is
  why `requestPermission()` is the trigger that matters here). While set,
  `check()` coerces that device's incoming `"prompt"` / `"unknown"` from the
  Permissions API back to `"denied"`. Cleared on a `"granted"` observation
  for that device, on `openSettings()` (user is on their way to change the OS
  setting — clears all devices), and by the explicit `reset()` method. Do not
  remove without an alternative — it is what prevents the Android denial loop.
- **Passive triggers must never call `getUserMedia`.** The internal
  `visibilitychange`, `pageshow` (with `event.persisted === true`), and
  `app-resumed` handlers call `check()` only. `getUserMedia` rejection on
  Android can transiently flip document visibility — combined with
  auto-escalation this used to fuel an unbounded loop (in the micperms
  ancestor). `recheck()` (which does escalate) remains opt-in for explicit
  consumer code.
- **Re-entrancy / debounce.** `check()` and `request()` cache the in-flight
  promise so re-entrant callers receive the same resolved value (the adapter
  is invoked once per concurrent batch). Passive handlers also skip if a
  check ran within `MIN_PASSIVE_INTERVAL_MS` (500ms).
- Recovery from denial requires the native layer to fire the configured
  `appResumedEvent` (default `"app-resumed"`) after `openSettings()` returns
  the user to the app.

## Combined-Kind Caveats

- A denied combined `getUserMedia({ audio, video })` gives no per-device
  detail; the library conservatively marks both denied, then refines via a
  non-prompting Permissions-API query (see convention 9).
- `NotFoundError` for the combined kind means at least one device is missing
  (e.g. desktop without a webcam) even if the other exists and is granted.
  Falling back to a single-device flow is the consumer's decision — the
  library reports `NO_DEVICE` and preserves statuses.
- On iOS, the combined kind maps to a single `.cameraAndMicrophone`
  `WKUIDelegate` decision; on Android, the embedder may still show two OS
  permission dialogs, but the web layer sees one getUserMedia resolution.
