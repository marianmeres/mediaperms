# @marianmeres/mediaperms

[![NPM](https://img.shields.io/npm/v/@marianmeres/mediaperms)](https://www.npmjs.com/package/@marianmeres/mediaperms)
[![JSR](https://jsr.io/badges/@marianmeres/mediaperms)](https://jsr.io/@marianmeres/mediaperms)
[![License](https://img.shields.io/npm/l/@marianmeres/mediaperms)](LICENSE)

Framework-agnostic **microphone / camera permission lifecycle manager**. Detects
platform (browser, PWA, iOS/Android WebView), checks and requests permission,
tracks state reactively, and supports native bridge for opening app settings.

Manages one of three kinds:

- `"microphone"`
- `"camera"`
- `"camera-and-microphone"` — both devices via a **single** `getUserMedia`
  call (one OS/browser prompt), with a per-device status breakdown in state

Does **not** own MediaStreams — when `getUserMedia` is called to probe permission,
all tracks are stopped immediately. Your app handles its own stream acquisition once
permission is `granted`.

> Successor of [`@marianmeres/micperms`](https://github.com/marianmeres/micperms)
> (microphone-only) — same battle-tested internals, generalized over the media
> kind. Migration from micperms is a one-line change (see below).

## Installation

```bash
# Deno / JSR
deno add jsr:@marianmeres/mediaperms

# npm
npm install @marianmeres/mediaperms
```

## Usage

```typescript
import { createMediaPerms } from "@marianmeres/mediaperms";

const perms = createMediaPerms("camera"); // or "microphone" | "camera-and-microphone"

// Reactive subscription (Svelte $store compatible)
perms.subscribe((state) => {
	console.log(state.status); // "unknown" | "prompt" | "granted" | "denied" (merged)
	console.log(state.devices); // per-device breakdown, e.g. { camera: { status, observedDenied } }
	console.log(state.platform); // "browser" | "pwa" | "ios-webview" | "android-webview"
	console.log(state.observedDenied); // true once denial has ever been observed
	console.log(state.error?.code); // typed MediaPermsErrorCode union, or undefined
});

// Check current permission (via Permissions API)
await perms.check();

// Request permission (via getUserMedia, tracks released immediately)
await perms.request();

// Smart recheck: query first, fall back to getUserMedia if ambiguous
await perms.recheck();

// Open native app settings (iOS/Android WebView only)
perms.openSettings();

// Reset internal state (clears sticky-denial, error, status -> "unknown")
perms.reset();

// Cleanup (detaches listeners; also makes check/request log a warning)
perms.destroy();
```

Thin wrappers exist for the single kinds:

```typescript
import { createCamPerms, createMicPerms } from "@marianmeres/mediaperms";

const mic = createMicPerms(); // === createMediaPerms("microphone")
const cam = createCamPerms(); // === createMediaPerms("camera")
```

### Migrating from @marianmeres/micperms

```diff
-import { createMicPerms } from "@marianmeres/micperms";
+import { createMicPerms } from "@marianmeres/mediaperms";
```

The instance API is identical; state additionally carries `kind` and the
per-device `devices` map, and type names are prefixed `Media*` instead of
`Mic*`. If you inject a custom adapter, note that `queryPermission` and
`onPermissionChange` now take the device as their first argument.

### The combined kind

Apps that need both camera and microphone (video calls, avatars) should use
the combined kind rather than two separate instances — `request()` issues one
`getUserMedia({ audio: true, video: true })` call, which the browser presents
as a **single prompt** (two sequential prompts are worse UX and two chances
to deny):

```typescript
const perms = createMediaPerms("camera-and-microphone");

perms.subscribe(({ status, devices }) => {
	// merged status: denied > prompt > unknown; granted only when both granted
	console.log(status);
	// per-device detail lets the UI say "mic OK, camera blocked":
	console.log(devices.microphone?.status, devices.camera?.status);
});
```

Combined-kind semantics worth knowing:

- `check()` queries both permission names and merges (see
  [`mergeStatuses`](API.md#mergestatusesstatuses)).
- A **denied** combined `request()` cannot tell which device the user denied —
  both are conservatively marked denied, then a follow-up (non-prompting)
  Permissions-API query splits the per-device statuses wherever that API is
  truthful. The refined reading is applied only if at least one device reads
  `"denied"` — an all-granted reading right after a denial is inconsistent
  (typically an OS-level block) and is discarded; getUserMedia stays the
  ground truth.
- A `NO_DEVICE` error means **at least one** requested device is missing (the
  combined `getUserMedia` call fails as a whole). If you want to degrade to
  mic-only when there is no webcam, handle that at the app layer.

### Configuration

```typescript
const perms = createMediaPerms("microphone", {
	platform: "ios-webview", // override auto-detection
	iosBridgeHandler: "openAppSettings", // iOS bridge handler name
	androidBridgeObject: "Android", // Android bridge object on window
	androidBridgeMethod: "openAppSettings",
	appResumedEvent: "app-resumed", // event fired by native layer on return
	adapter: myCustomAdapter, // injectable for testing
	logger: console, // default: clog("mediaperms")
});
```

## Semantics

- **`getUserMedia()` is the only ground truth.** `check()` wraps
  `navigator.permissions.query({ name: "microphone" | "camera" })`, which is
  not authoritative in mobile WebViews (see below). `request()` wraps
  `getUserMedia()`, which always reflects reality.
- **Sticky denial (per device).** Once any code path — `request()`, `check()`,
  or `onPermissionChange` — has observed `"denied"` for a device, that
  observation is cached —
  `devices[d].observedDenied` becomes `true` and silent `check()` calls will
  not downgrade that device's `status` to `"prompt"` / `"unknown"`. Cleared on
  an observed `"granted"` for that device, by `openSettings()` (user is on
  their way to change the OS setting — clears all devices), or by the explicit
  `reset()` method. `state.observedDenied` is the OR of the per-device flags.
- **Passive triggers never prompt.** Internal listeners for `visibilitychange`,
  `pageshow` (with `event.persisted === true` — bfcache restores), and
  `app-resumed` only call `check()` (silent). They never invoke
  `getUserMedia()`, which would produce an unexpected OS prompt.
- **`recheck()` is an opt-in escalation.** It calls `check()` and, if the
  result is ambiguous (`"prompt"` / `"unknown"`), escalates to `request()`.
  Only your code can trigger it — call it in response to a user gesture, not
  on resume.
- **Concurrent `check()` / `request()` calls coalesce.** Re-entrant calls
  while another is in flight return the same in-flight promise; the
  underlying adapter is invoked once per concurrent batch, and all callers
  observe an identical resolved value.
- **Device/origin errors are typed.** When `getUserMedia` rejects with
  `NotFoundError`, `SecurityError`, or `NotReadableError`, the rejection is
  classified into `state.error.code` (see [`MediaPermsErrorCode`](API.md#mediapermserrorcode))
  and `state.status` is preserved. UIs should check `error` before acting
  on `status`.

## Why the Permissions API is not trusted in WebViews

`navigator.permissions.query({ name: "microphone" | "camera" })` is **not
reliable** in mobile WebViews. Concretely:

- **iOS WKWebView:** the Permissions API is **not implemented**. The adapter's
  `queryPermission()` returns `null` and `check()` preserves the prior status.
- **Android WebView:** the Permissions API **is** present but reports
  `"prompt"` even after the user has OS-denied microphone or camera access
  (and in some Chromium versions, also when the embedder has already granted
  at the `WebChromeClient.onPermissionRequest()` layer). This is **not a
  library bug** — it is a consequence of the W3C Permissions API spec
  permitting a UA to return `"prompt"` when it cannot determine a persistent
  origin-scoped decision, combined with the fact that Android's microphone and
  camera permissions live at the **app** layer, not the web-origin layer the
  Permissions API knows about. The JS runtime literally does not have the
  information, so the API returns its spec-permitted fallback.
- **Desktop Chrome / Firefox / Safari:** the Permissions API is reliable;
  `check()` alone is sufficient to populate UI.

This is why sticky-denial exists: once `getUserMedia()` has produced a
`NotAllowedError` on Android WebView, that observation outranks any
subsequent `"prompt"` from the Permissions API. Without it, the combination
of a lying Permissions API and an auto-`recheck()` on `visibilitychange`
causes an infinite `denied → prompt → denied → prompt → …` loop in Android
WebView (a bug class this library's micperms ancestor fixed the hard way).

## Extras: re-enable guide

A framework-agnostic, pure-DOM multi-step tutorial that explains how to re-enable
microphone and/or camera access after denial. Lives at a subpath so the main entry
stays DOM-free.

```typescript
import { createMediaPerms } from "@marianmeres/mediaperms";
import { createReenableGuide } from "@marianmeres/mediaperms/reenable-guide";

const perms = createMediaPerms("camera");

// when state.observedDenied is true and you want to help the user recover:
const guide = createReenableGuide({
	kind: "camera", // matches the perms instance: copy says "Camera"
	container: document.getElementById("cam-help"),
	onOpenSettings: () => perms.openSettings(), // shown on webview/pwa flavors
	onDone: () => perms.recheck(),
});

// optional: programmatic control
guide.next();
guide.back();
guide.destroy();
```

Auto-detects platform / browser flavor (override via `flavor`), tailors the step
copy to the `kind` and current OS conventions (~2–3 steps), ships built-in English
and Slovak translations (override via `lang`; default `"auto"` reads
`navigator.language`), and follows `html.classList.contains("dark")` for
light/dark theme by default. See [API.md](API.md#extras) for the full surface
and [example/guide.html](example/guide.html) for a live playground (run
`deno task build:example` first).

### Brand wording, built-in art

Want the flavor-correct illustrations and step count but your own copy? Don't
copy the SVGs — pass a `steps` **builder**. The resolved `defaultSteps` already
carry the art, so you override only the text, per flavor, with zero copy/paste:

```typescript
import { createReenableGuide } from "@marianmeres/mediaperms/reenable-guide";

const BROWSER_TEXTS_SK = [
	"Ťuknite na ikonu <b>Informácie</b> v riadku, kde sa zadáva webová adresa.",
	"Vyberte možnosť <b>Povolenia</b>.",
	"<b>Povoľte mikrofón</b> a obnovte stránku.",
];

createReenableGuide({
	kind: "microphone",
	container: document.getElementById("mic-help"),
	lang: "sk",
	steps: ({ flavor, defaultSteps }) =>
		flavor === "desktop" || flavor === "ios-safari" || flavor === "android-chrome"
			? defaultSteps.map((s, i) => ({ ...s, text: BROWSER_TEXTS_SK[i] ?? s.text }))
			: defaultSteps, // webview / pwa keep the library copy + their own art
});
```

A literal `steps` array is still a full replace (text **and** art). For the
simple single-language case there's also a declarative `stepText` map, and
`title` / `subtitle` accept the same `(ctx) => string` builder shape. See
[API.md — Per-flavor step text](API.md#per-flavor-step-text-keep-the-built-in-art).

## API

See [API.md](API.md) for complete API documentation.

## License

[MIT](LICENSE)
