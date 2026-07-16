# API

## Functions

### `createMediaPerms(kind, config?)`

Create a media permission manager instance for the given kind.

**Parameters:**

- `kind` (`MediaPermsKind`) — `"microphone"` | `"camera"` | `"camera-and-microphone"`.
  Throws on an invalid value.
- `config` (`MediaPermsConfig`, optional) — Configuration options

**Returns:** `MediaPerms` — Permission manager instance with reactive state

**Example:**

```typescript
const perms = createMediaPerms("camera-and-microphone");
perms.subscribe((state) => console.log(state.status, state.devices));
await perms.request(); // ONE combined prompt for both devices
perms.destroy();
```

---

### `createMicPerms(config?)` / `createCamPerms(config?)`

Thin convenience wrappers: `createMediaPerms("microphone", config)` and
`createMediaPerms("camera", config)` respectively. `createMicPerms` is a
near-drop-in replacement for `@marianmeres/micperms`' factory of the same
name.

---

### `createDefaultAdapter(kind)`

Create the default browser adapter that uses real browser APIs
(`navigator.permissions` and `navigator.mediaDevices.getUserMedia`). The `kind`
decides the getUserMedia constraints: `{ audio: true }`, `{ video: true }`, or
both (a **single** call — one prompt — for the combined kind). Useful for
consumers who want to wrap or extend the default behavior.

**Returns:** `MediaPermsBrowserAdapter`

**Example:**

```typescript
const defaultAdapter = createDefaultAdapter("camera");
const cam = createMediaPerms("camera", { adapter: defaultAdapter });
```

---

### `devicesForKind(kind)`

The physical device classes a kind spans — what `MediaPermsState.devices` is
keyed by. Throws on an invalid kind.

```typescript
devicesForKind("microphone"); // ["microphone"]
devicesForKind("camera"); // ["camera"]
devicesForKind("camera-and-microphone"); // ["camera", "microphone"]
```

---

### `mergeStatuses(statuses)`

Merge per-device statuses into a single status — the rule behind the combined
kind's merged `state.status`. Precedence: `denied` > `prompt` > `unknown`;
`"granted"` only when **every** device is granted (an empty list yields
`"unknown"`). Exported for consumers combining statuses of separately-managed
instances.

```typescript
mergeStatuses(["granted", "denied"]); // "denied"
mergeStatuses(["granted", "prompt"]); // "prompt"
mergeStatuses(["granted", "granted"]); // "granted"
```

---

### `detectPlatform(config)`

Detect the current platform context. Runs the same detection logic used internally
by `createMediaPerms`. Useful for consumers who need platform info independently.

**Parameters:**

- `config` (`MediaPermsConfig`) — Config with optional `platform` override and bridge object names

**Returns:** `MediaPlatformContext`

Detection order (first match wins):

1. `config.platform` if provided (explicit override)
2. `webkit.messageHandlers` exists → `"ios-webview"`
3. Android bridge object exists → `"android-webview"`
4. Standalone display mode → `"pwa"`
5. Default → `"browser"`

iOS WKWebView is checked before PWA standalone mode because a hosted WKWebView
with native bridges is more specific than display-mode standalone.

---

### `detectBridge(platform, config)`

Detect whether a native bridge is available for opening app settings.

**Parameters:**

- `platform` (`MediaPlatformContext`) — The detected platform
- `config` (`MediaPermsConfig`) — Config with bridge handler/object names

**Returns:** `boolean`

---

## MediaPerms Instance

Returned by `createMediaPerms()`. After `destroy()`, `check()` and `request()` log a
warning and resolve to the current `status` without performing any work.

### `subscribe(cb)`

Subscribe to reactive state changes. Callback fires immediately with current state,
then on every change. Compatible with Svelte's `$store` contract.

**Parameters:**

- `cb` (`(state: MediaPermsState) => void`) — State callback

**Returns:** `() => void` — Unsubscribe function

---

### `get()`

Get the current state snapshot.

**Returns:** `MediaPermsState`

---

### `check()`

Query the current permission status via the Permissions API — one query per
device of the kind, in parallel. Does not trigger a browser prompt. The
resolved (and stored) status is the **merged** per-device status.

Concurrent calls coalesce: re-entrant `check()` while another check is in flight
returns the same in-flight promise. Both callers observe an identical resolved value.

**Returns:** `Promise<MediaPermissionStatus>` — The resolved merged status. A
device whose query returned `null` (Permissions API unsupported — e.g. iOS
WKWebView) keeps its prior status; if **no** device returned a value,
`lastCheckedAt` is unchanged too.

---

### `request()`

Request permission via a single `getUserMedia` call with kind-appropriate
constraints (`{ audio: true }`, `{ video: true }`, or both). May trigger a
browser prompt — for the combined kind, **one** prompt covering both devices.
All tracks are stopped immediately — no stream is held.

Concurrent calls coalesce the same way as `check()`.

If `getUserMedia` rejects with a non-permission error (`NotFoundError`,
`SecurityError`, `NotReadableError`, …), the rejection is classified into a typed
`MediaPermsErrorCode` on `state.error` and `state.status` is preserved
(rather than smeared to `"unknown"`).

Combined-kind detail: a denied combined request cannot tell **which** device
the user denied, so both devices are conservatively marked denied; a follow-up
(non-prompting) Permissions-API query then splits the per-device statuses on
platforms where that API is truthful. The refined reading is applied only when
at least one device reads `"denied"` — an all-granted reading right after a
denial is inconsistent (typically an OS-level block on desktop Chromium, where
site permissions still read granted) and is discarded, keeping the observed
denial. Where the API lies (Android WebView reporting `"prompt"`), the sticky
flags coerce the readings right back to denied — nothing regresses.

**Returns:** `Promise<MediaPermissionStatus>` — `"granted"`, `"denied"`, or the prior
merged `status` when the request errored without producing a permission decision.

---

### `recheck()`

Smart recheck: calls `check()` first. If the merged result is `"unknown"` or
`"prompt"` (ambiguous — common on iOS WKWebView), falls back to `request()` as
a definitive probe.

**Returns:** `Promise<MediaPermissionStatus>`

---

### `openSettings()`

Attempt to open native app settings via the platform bridge.

- iOS: `webkit.messageHandlers[handler].postMessage({})`
- Android: `window[bridgeObject][bridgeMethod]()`
- Browser/PWA: returns `false` (no bridge available)

On success, also clears the sticky `observedDenied` flag of **every** device
(the user is on their way to change the OS setting).

**Returns:** `boolean` — `true` if the bridge call was made, `false` otherwise

---

### `reset()`

Reset internal state to initial values:

- every device's `status` → `"unknown"`, `observedDenied` → `false`
- (therefore merged `status` → `"unknown"`, `observedDenied` → `false`)
- `error` → `null`
- `lastCheckedAt` → `null`

Does **not** detach event listeners (use `destroy()` for that). Safe to call
multiple times. No-op after `destroy()`.

Use this when an app-level signal (e.g., a "try again" button after a context
change) should clear the sticky-denial coercion without recreating the instance.

**Returns:** `void`

---

### `destroy()`

Remove all event listeners and clean up. Safe to call multiple times (idempotent).

---

## Types

### `MediaPermsKind`

```typescript
type MediaPermsKind = "microphone" | "camera" | "camera-and-microphone";
```

### `MediaPermsDevice`

```typescript
type MediaPermsDevice = "microphone" | "camera";
```

### `MediaPermissionStatus`

```typescript
type MediaPermissionStatus = "unknown" | "prompt" | "granted" | "denied";
```

### `MediaPlatformContext`

```typescript
type MediaPlatformContext = "browser" | "pwa" | "ios-webview" | "android-webview";
```

### `MediaPermsState`

```typescript
interface MediaPermsState {
	kind: MediaPermsKind;
	status: MediaPermissionStatus; // merged across devices
	devices: Partial<Record<MediaPermsDevice, MediaPermsDeviceState>>;
	platform: MediaPlatformContext;
	canOpenSettings: boolean;
	busy: boolean;
	observedDenied: boolean; // OR of the per-device flags
	error: MediaPermsError | null;
	lastCheckedAt: number | null;
}

interface MediaPermsDeviceState {
	status: MediaPermissionStatus;
	observedDenied: boolean;
}
```

| Field             | Description                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`            | The kind this instance was created with                                                                                                                                                                    |
| `status`          | Current permission status — merged across the kind's devices (`denied` > `prompt` > `unknown`; `granted` only when all granted)                                                                            |
| `devices`         | Per-device breakdown — exactly the devices of `kind` (one entry for single kinds, both for combined). Lets a UI say "mic OK, camera blocked"                                                               |
| `platform`        | Detected platform context                                                                                                                                                                                  |
| `canOpenSettings` | Whether a native bridge was detected                                                                                                                                                                       |
| `busy`            | `true` while an async operation is in progress                                                                                                                                                             |
| `observedDenied`  | `true` once `"denied"` has been observed for any device; per-device flags coerce ambiguous Permissions-API readings back to `"denied"`. Cleared by an observed `"granted"`, `openSettings()`, or `reset()` |
| `error`           | Last error, or `null`. See [`MediaPermsErrorCode`](#mediapermserrorcode)                                                                                                                                   |
| `lastCheckedAt`   | Timestamp (`Date.now()`) of last successful check/request, or `null`. A check that found the Permissions API unsupported does **not** advance this.                                                        |

### `MediaPermsError`

```typescript
interface MediaPermsError {
	code: MediaPermsErrorCode;
	message: string;
}
```

### `MediaPermsConfig`

```typescript
interface MediaPermsConfig {
	platform?: MediaPlatformContext;
	iosBridgeHandler?: string; // Default: "openAppSettings"
	androidBridgeObject?: string; // Default: "Android"
	androidBridgeMethod?: string; // Default: "openAppSettings"
	appResumedEvent?: string; // Default: "app-resumed"
	adapter?: MediaPermsBrowserAdapter;
	logger?: {
		debug(...args: unknown[]): void;
		warn(...args: unknown[]): void;
		error(...args: unknown[]): void;
	};
}
```

### `MediaPermsBrowserAdapter`

Injectable adapter interface for testing or customization. Query and change
listening are **per device**; requesting probes the instance's whole kind at
once (one `getUserMedia` call → one prompt).

```typescript
interface MediaPermsBrowserAdapter {
	queryPermission(
		device: MediaPermsDevice,
	): Promise<MediaPermissionStatus | null>;
	requestPermission(): Promise<MediaPermissionStatus>;
	supportsPermissionsApi(): boolean;
	onPermissionChange(
		device: MediaPermsDevice,
		cb: (status: MediaPermissionStatus) => void,
	): (() => void) | null;
}
```

| Method                           | Description                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `queryPermission(device)`        | Query one device via Permissions API. Return `null` if unsupported.                                                             |
| `requestPermission()`            | Request via getUserMedia, stop tracks, return result. Throw for device-/origin-level failures so the factory can classify them. |
| `supportsPermissionsApi()`       | Whether Permissions API is available.                                                                                           |
| `onPermissionChange(device, cb)` | Listen for one device's permission changes. Return cleanup fn or `null`.                                                        |

### `MediaPerms`

```typescript
interface MediaPerms {
	subscribe(cb: (state: MediaPermsState) => void): () => void;
	get(): MediaPermsState;
	check(): Promise<MediaPermissionStatus>;
	request(): Promise<MediaPermissionStatus>;
	openSettings(): boolean;
	recheck(): Promise<MediaPermissionStatus>;
	reset(): void;
	destroy(): void;
}
```

---

## Constants

### `MediaPermsErrorCode`

Machine-readable error codes attached to `MediaPermsState.error.code`.

```typescript
const MediaPermsErrorCode = {
	CheckFailed: "CHECK_FAILED",
	RequestFailed: "REQUEST_FAILED",
	NoDevice: "NO_DEVICE",
	InsecureContext: "INSECURE_CONTEXT",
	DeviceBusy: "DEVICE_BUSY",
} as const;

type MediaPermsErrorCode = typeof MediaPermsErrorCode[keyof typeof MediaPermsErrorCode];
```

| Code               | Cause                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------- |
| `CHECK_FAILED`     | `adapter.queryPermission()` threw                                                      |
| `REQUEST_FAILED`   | `adapter.requestPermission()` threw a non-classified error                             |
| `NO_DEVICE`        | `getUserMedia` threw `NotFoundError` / `DevicesNotFoundError` / `OverconstrainedError` |
| `INSECURE_CONTEXT` | `getUserMedia` threw `SecurityError` (insecure origin or policy)                       |
| `DEVICE_BUSY`      | `getUserMedia` threw `NotReadableError` / `TrackStartError`                            |

When a `NO_DEVICE` / `INSECURE_CONTEXT` / `DEVICE_BUSY` error fires, `state.status`
is **preserved** (not flipped to `"unknown"`). UIs should consult `state.error`
before acting on `state.status`. For the combined kind, `NO_DEVICE` means at
least one of the requested devices is missing (the combined call fails as a
whole) — degrading to a single-device flow is an app-layer decision.

---

## Extras

### `createReenableGuide(opts)`

Mount a self-contained, framework-agnostic multi-step tutorial that explains how
the user can re-enable the microphone and/or camera after denial. Lives at the
subpath `@marianmeres/mediaperms/reenable-guide` so the main entry stays DOM-free.

**Import:**

```typescript
import {
	createReenableGuide,
	defaultStepsFor,
	detectFlavor,
	type ReenableGuideFlavor,
	type ReenableGuideOptions,
	type ReenableGuideStepsBuilderContext,
} from "@marianmeres/mediaperms/reenable-guide";
```

**Parameters:** `opts: ReenableGuideOptions`

| Field            | Type                                                                               | Description                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | `MediaPermsKind` — **required**                                                    | Which device flow to explain — decides the built-in copy ("Microphone", "Camera", or both).                                                                                                                                                                                                                                                                    |
| `container`      | `HTMLElement` — **required**                                                       | Parent node. The guide is appended (not replaced).                                                                                                                                                                                                                                                                                                             |
| `platform`       | `MediaPlatformContext` — optional                                                  | Forwarded to `detectPlatform` to seed flavor detection.                                                                                                                                                                                                                                                                                                        |
| `flavor`         | `ReenableGuideFlavor` — optional                                                   | Override flavor directly. Wins over `platform`.                                                                                                                                                                                                                                                                                                                |
| `lang`           | `ReenableGuideLang \| "auto"` — default `"auto"`                                   | Built-in translation. `"auto"` reads `navigator.language`. Falls back to `"en"` if no built-in match.                                                                                                                                                                                                                                                          |
| `steps`          | `ReenableGuideStep[] \| ((ctx) => ReenableGuideStep[])` — optional                 | Step list. An **array** fully replaces text **and** art. A **builder** is called with `{ kind, flavor, lang, defaultSteps }` (the `defaultSteps` already carry the built-in art) and returns the list — the zero-copy way to override only the text per flavor. Wins over `stepText`. See [Per-flavor step text](#per-flavor-step-text-keep-the-built-in-art). |
| `stepText`       | `Partial<Record<ReenableGuideFlavor, (string \| null \| undefined)[]>>` — optional | Declarative per-flavor **text** override, merged by index over the default steps (**art preserved**). `null` / `undefined` / a missing index keeps the built-in copy; entries past the flavor's step count are ignored (clamped). Lang-agnostic. Ignored when `steps` is also set.                                                                             |
| `title`          | `string \| ((ctx) => string)` — optional                                           | Header title override — a string, or a `(ctx) => string` builder called with `{ kind, flavor, lang, defaultText }` for flavor-aware copy. Wins over the `lang` translation. Rendered as **plain text** by the built-in chrome (use the `header` slot for HTML).                                                                                                |
| `subtitle`       | `string \| ((ctx) => string)` — optional                                           | Header subtitle override — a string, or a `(ctx) => string` builder. Wins over the `lang` translation. Plain text in the built-in chrome (see `title`).                                                                                                                                                                                                        |
| `theme`          | `"auto" \| "light" \| "dark"` — default `"auto"`                                   | `"auto"` mirrors `html.classList.contains("dark")` live (MutationObserver).                                                                                                                                                                                                                                                                                    |
| `accent`         | `string` — optional                                                                | Any CSS color; sets `--mpg-accent`.                                                                                                                                                                                                                                                                                                                            |
| `labels`         | `{ back?, next?, done?, openSettings? }`                                           | Per-key button label override (wins over the `lang` translation).                                                                                                                                                                                                                                                                                              |
| `onOpenSettings` | `() => void` — optional                                                            | When set on `*-webview` / `*-pwa` flavors, renders an "Open Settings" CTA.                                                                                                                                                                                                                                                                                     |
| `onDone`         | `() => void` — optional                                                            | Fires when the user taps **Done** on the final step.                                                                                                                                                                                                                                                                                                           |
| `slots`          | `ReenableGuideSlots` — optional                                                    | Render overrides (`header` / `art` / `step` / `button` / `footer`) for skinning the built-in chrome.                                                                                                                                                                                                                                                           |

**Returns:** `ReenableGuide`

```typescript
interface ReenableGuide {
	readonly el: HTMLElement;
	readonly index: number;
	next(): void;
	back(): void;
	goto(i: number): void;
	setTheme(theme: "auto" | "light" | "dark"): void;
	destroy(): void;
}
```

**Flavors:**

```typescript
type ReenableGuideFlavor =
	| "ios-safari"
	| "android-chrome"
	| "desktop"
	| "ios-webview"
	| "android-webview"
	| "ios-pwa"
	| "android-pwa";
```

**Languages:**

```typescript
type ReenableGuideLang = "en" | "sk";

// Inspectable list of all supported codes:
const REENABLE_GUIDE_LANGS: readonly ReenableGuideLang[];
```

The resolved code is also written to the root element's `lang` attribute, so
screen readers can pronounce content correctly. To add a language not in the
built-in set, supply your own `title` / `subtitle` / `labels` / `steps`.

**Example:**

```typescript
import { createMediaPerms } from "@marianmeres/mediaperms";
import { createReenableGuide } from "@marianmeres/mediaperms/reenable-guide";

const perms = createMediaPerms("camera-and-microphone");
const guide = createReenableGuide({
	kind: "camera-and-microphone",
	container: document.getElementById("media-help"),
	onOpenSettings: () => perms.openSettings(),
	onDone: () => perms.recheck(),
});

// later
guide.destroy();
```

#### Per-flavor step text (keep the built-in art)

You often want the library's flavor-correct **art, step count and navigation**
but your **own brand wording**. Don't copy the SVGs — supply a `steps` **builder**
(or the declarative `stepText` map) and the defaults hand you the art for free.

```typescript
const BROWSER_TEXTS_SK = [
	"Ťuknite na ikonu <b>Informácie</b> v riadku, kde sa zadáva webová adresa.",
	"Vyberte možnosť <b>Povolenia</b>.",
	"<b>Povoľte mikrofón</b> a obnovte stránku.",
];
const isBrowser = (f: ReenableGuideFlavor) =>
	f === "desktop" || f === "ios-safari" || f === "android-chrome";

createReenableGuide({
	kind: "microphone",
	container,
	lang: "sk",
	// keep the built-in art, override only the text — per flavor, zero copy:
	steps: ({ flavor, defaultSteps }) =>
		isBrowser(flavor)
			? defaultSteps.map((s, i) => ({ ...s, text: BROWSER_TEXTS_SK[i] ?? s.text }))
			: defaultSteps, // webview / pwa keep the library copy + their own art
	// header copy can be flavor-aware too (plain text — see note below):
	subtitle: ({ flavor, defaultText }) =>
		isBrowser(flavor) ? "Povoľte mikrofón v nastaveniach prehliadača." : defaultText,
});
```

> **Note** — `step.text` (and `stepText`) is rendered as **trusted HTML** (so
> `<b>…</b>` works), but the built-in chrome renders `title` / `subtitle` as
> **plain text**. If you need markup in the header, use the `header` slot (or the
> headless `createReenableGuideController` with your own markup), both of
> which treat the copy as trusted HTML.

The builder receives a resolved `ReenableGuideStepsBuilderContext`:

```typescript
interface ReenableGuideStepsBuilderContext {
	kind: MediaPermsKind; // the guide's kind
	flavor: ReenableGuideFlavor; // resolved (never undefined)
	lang: ReenableGuideLang; // resolved (never "auto")
	defaultSteps: ReenableGuideStep[]; // built-in text + art for this kind/flavor
}
```

For the simple single-language case the declarative `stepText` map is shorter —
it merges strings by index over the defaults and always preserves the art:

```typescript
createReenableGuide({
	kind: "microphone",
	container,
	lang: "sk",
	stepText: {
		desktop: BROWSER_TEXTS_SK,
		"ios-safari": BROWSER_TEXTS_SK,
		"android-chrome": BROWSER_TEXTS_SK,
		// any flavor you omit keeps the built-in copy + art
		// null / undefined at an index keeps that one step's built-in copy
	},
});
```

Notes:

- An **array** `steps` is still a full replace of text **and** art (unchanged).
- `steps` (array or builder) takes precedence over `stepText` if both are set.
- `stepText` clamps to the flavor's default step count; changing the **number**
  of steps stays the domain of the full `steps` array (new steps have no art).
- Both forms run once at resolution time and see the concrete resolved `lang`.

---

### `createReenableGuideController(opts)`

The guide's **headless** state machine: same kind/flavor detection, default
step content, i18n and step navigation as `createReenableGuide` — but with no
DOM. Subscribe for a Svelte-compatible snapshot stream and render the markup
yourself (the built-in DOM factory is itself just one consumer of it).

Takes the same options as `createReenableGuide` minus the DOM-specific ones
(`container` / `theme` / `accent` / `slots`); `kind` is required.

```typescript
const ctrl = createReenableGuideController({ kind: "camera", lang: "sk", onDone });
const unsub = ctrl.subscribe((s) => paint(s)); // fires immediately + on change
ctrl.next();
// ...later
unsub();
ctrl.destroy();
```

The snapshot (`ReenableGuideControllerState`) carries `kind`, `index`, `total`,
`isFirst`, `isLast`, `step`, `steps`, `flavor`, `lang`, `title`, `subtitle`,
`labels` and `hasOpenSettingsCta`.

---

### `defaultStepsFor(kind, flavor, lang)`

Return the library's built-in steps for a kind + flavor + language — the
resolved copy paired with the matching built-in art. This is what the guide
renders absent any override, and what a `steps` builder receives as
`defaultSteps`. Exported for fully-custom renderers (e.g. a native component
on top of `createReenableGuideController`) that want the art + copy without
copying any SVG markup.

**Parameters:**

- `kind` (`MediaPermsKind`) — the kind whose copy to resolve.
- `flavor` (`ReenableGuideFlavor`) — the flavor to resolve.
- `lang` (`ReenableGuideLang`) — a **concrete** language code (not `"auto"`).

**Returns:** `ReenableGuideStep[]` — a fresh array of fresh step objects
(safe to mutate) carrying `{ text, art }`.

```typescript
const steps = defaultStepsFor("camera", "desktop", "en");
// [{ text: "Click the …", art: "<svg …>" }, …]
```

---

### `detectFlavor(opts?)`

Resolve a `ReenableGuideFlavor` from platform context + user agent. Useful if
you want to render your own UI but still benefit from the bucketing logic.

**Parameters:**

- `opts.platform` — optional `MediaPlatformContext` override (forwarded to `detectPlatform`).
- `opts.flavor` — optional explicit override; returned as-is.
- `opts.userAgent` — optional UA string; defaults to `navigator.userAgent`.

**Returns:** `ReenableGuideFlavor`
