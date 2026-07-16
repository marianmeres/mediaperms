import { createClog } from "@marianmeres/clog";
import { createStore } from "@marianmeres/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * What the permission manager manages. The combined
 * `"camera-and-microphone"` kind requests both devices in a **single**
 * `getUserMedia` call (one OS/browser prompt) and tracks a per-device
 * status breakdown in {@linkcode MediaPermsState.devices}.
 */
export type MediaPermsKind = "microphone" | "camera" | "camera-and-microphone";

/** A single physical device class tracked by the manager. */
export type MediaPermsDevice = "microphone" | "camera";

/** Media permission status. */
export type MediaPermissionStatus = "unknown" | "prompt" | "granted" | "denied";

/** Detected platform context. */
export type MediaPlatformContext =
	| "browser"
	| "pwa"
	| "ios-webview"
	| "android-webview";

/**
 * Machine-readable error codes attached to {@linkcode MediaPermsState.error}.
 *
 * - `CHECK_FAILED` — `adapter.queryPermission()` threw.
 * - `REQUEST_FAILED` — `adapter.requestPermission()` threw a non-classified error.
 * - `NO_DEVICE` — getUserMedia threw `NotFoundError` / `DevicesNotFoundError` /
 *   `OverconstrainedError`. No matching input device is available; `status` is
 *   preserved. For the combined kind this means **at least one** of the
 *   requested devices is missing (a single `getUserMedia({ audio, video })`
 *   call fails as a whole).
 * - `INSECURE_CONTEXT` — getUserMedia threw `SecurityError`. Origin is not
 *   secure or a Permissions-Policy blocks the API. `status` is preserved.
 * - `DEVICE_BUSY` — getUserMedia threw `NotReadableError` / `TrackStartError`.
 *   Hardware is held by another consumer (notably common for cameras, which
 *   are exclusive-access on some OSes). `status` is preserved.
 */
export const MediaPermsErrorCode = {
	CheckFailed: "CHECK_FAILED",
	RequestFailed: "REQUEST_FAILED",
	NoDevice: "NO_DEVICE",
	InsecureContext: "INSECURE_CONTEXT",
	DeviceBusy: "DEVICE_BUSY",
} as const;
export type MediaPermsErrorCode =
	typeof MediaPermsErrorCode[keyof typeof MediaPermsErrorCode];

/** Error attached to {@linkcode MediaPermsState.error}. */
export interface MediaPermsError {
	/** Machine-readable error code. See {@linkcode MediaPermsErrorCode}. */
	code: MediaPermsErrorCode;
	/** Human-readable error message (typically forwarded from underlying API). */
	message: string;
}

/** Per-device slice of {@linkcode MediaPermsState}. */
export interface MediaPermsDeviceState {
	/** Current (coerced) permission status of this device. */
	status: MediaPermissionStatus;
	/**
	 * `true` once any code path has observed `"denied"` for this device.
	 * Cleared by an observed `"granted"` for this device, by
	 * {@linkcode MediaPerms.openSettings}, or by {@linkcode MediaPerms.reset}.
	 */
	observedDenied: boolean;
}

/** Reactive state of the media permission manager. */
export interface MediaPermsState {
	/** The kind this instance was created with. */
	kind: MediaPermsKind;
	/**
	 * Current permission status. For the combined kind this is the **merged**
	 * per-device status (precedence: `denied` > `prompt` > `unknown`;
	 * `granted` only when every device is granted). See
	 * {@linkcode mergeStatuses}.
	 */
	status: MediaPermissionStatus;
	/**
	 * Per-device status breakdown. Contains exactly the devices relevant to
	 * `kind` (see {@linkcode devicesForKind}) — one entry for the single
	 * kinds, both for `"camera-and-microphone"`. Lets a UI say "microphone
	 * OK, camera blocked" when the merged `status` alone cannot.
	 */
	devices: Partial<Record<MediaPermsDevice, MediaPermsDeviceState>>;
	/** Detected platform context. */
	platform: MediaPlatformContext;
	/** Whether a native bridge for opening app settings was detected. */
	canOpenSettings: boolean;
	/** `true` while an async operation (check/request) is in progress. */
	busy: boolean;
	/**
	 * `true` once any relevant device has observed `"denied"` from
	 * getUserMedia or the Permissions API (the OR of the per-device flags in
	 * {@linkcode MediaPermsState.devices}).
	 *
	 * While a device's flag is set, ambiguous incoming statuses (`"prompt"` /
	 * `"unknown"`) for that device are coerced to `"denied"` to mitigate the
	 * lying Android-WebView Permissions API.
	 */
	observedDenied: boolean;
	/** Last error, or `null`. See {@linkcode MediaPermsErrorCode}. */
	error: MediaPermsError | null;
	/**
	 * Timestamp (`Date.now()`) of last successful check/request, or `null`.
	 * "Successful" means the underlying API returned a value — a `check()`
	 * that found the Permissions API unsupported does not count.
	 */
	lastCheckedAt: number | null;
}

/**
 * Abstraction over browser permission APIs. Injectable for testing or
 * custom behavior. The default implementation wraps `navigator.permissions`
 * and `navigator.mediaDevices.getUserMedia`.
 *
 * Adapter contract for `requestPermission()`: it probes the instance's whole
 * kind at once (one `getUserMedia` call — for the combined kind that is
 * `{ audio: true, video: true }`, a single prompt). Return `"granted"` /
 * `"denied"` / `"prompt"` / `"unknown"` for known outcomes; throw for
 * device-/origin-level failures (no device, insecure origin, hardware
 * busy). The factory inspects thrown `DOMException` instances and
 * classifies them via {@linkcode MediaPermsErrorCode}.
 */
export interface MediaPermsBrowserAdapter {
	/** Query one device via Permissions API. Return `null` if API is unsupported. */
	queryPermission(
		device: MediaPermsDevice,
	): Promise<MediaPermissionStatus | null>;
	/** Request via getUserMedia, immediately release stream. Return result. */
	requestPermission(): Promise<MediaPermissionStatus>;
	/** Whether the Permissions API is available. */
	supportsPermissionsApi(): boolean;
	/** Listen for Permissions API `onchange` of one device. Return cleanup fn, or `null` if unsupported. */
	onPermissionChange(
		device: MediaPermsDevice,
		cb: (status: MediaPermissionStatus) => void,
	): (() => void) | null;
}

/** Configuration for {@linkcode createMediaPerms}. */
export interface MediaPermsConfig {
	/** Override auto-detection of the platform context. */
	platform?: MediaPlatformContext;
	/** iOS `webkit.messageHandlers` handler name. Default: `"openAppSettings"`. */
	iosBridgeHandler?: string;
	/** Android bridge object name on `window`. Default: `"Android"`. */
	androidBridgeObject?: string;
	/** Android bridge method name. Default: `"openAppSettings"`. */
	androidBridgeMethod?: string;
	/** Event name fired by native layer on return from settings. Default: `"app-resumed"`. */
	appResumedEvent?: string;
	/** Injectable adapter for testing. Uses real browser APIs when omitted. */
	adapter?: MediaPermsBrowserAdapter;
	/** Console-compatible logger. Default: `@marianmeres/clog` instance named `"mediaperms"`. */
	logger?: {
		debug(...args: unknown[]): void;
		warn(...args: unknown[]): void;
		error(...args: unknown[]): void;
	};
}

/** Public API returned by {@linkcode createMediaPerms}. */
export interface MediaPerms {
	/** Subscribe to reactive state changes. Fires immediately with current state. */
	subscribe(cb: (state: MediaPermsState) => void): () => void;
	/** Get the current state snapshot. */
	get(): MediaPermsState;
	/** Query permission status via Permissions API. Does not trigger a prompt. */
	check(): Promise<MediaPermissionStatus>;
	/** Request permission via getUserMedia. May trigger a prompt. Tracks released immediately. */
	request(): Promise<MediaPermissionStatus>;
	/** Attempt to open native app settings via platform bridge. Returns `true` if call was made. */
	openSettings(): boolean;
	/** Smart recheck: `check()` first, fall back to `request()` if ambiguous. */
	recheck(): Promise<MediaPermissionStatus>;
	/**
	 * Reset internal state to initial values: every device's `status` →
	 * `"unknown"`, `error` → `null`, `lastCheckedAt` → `null`, and the
	 * sticky per-device `observedDenied` flags → `false`. Does not detach
	 * event listeners (use {@linkcode destroy} for that). Safe to call
	 * multiple times.
	 */
	reset(): void;
	/** Remove all event listeners. Safe to call multiple times. */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Kind helpers
// ---------------------------------------------------------------------------

/**
 * The physical device classes a {@linkcode MediaPermsKind} spans — what
 * {@linkcode MediaPermsState.devices} is keyed by. Throws on an invalid kind
 * (useful early feedback for plain-JS consumers).
 */
export function devicesForKind(
	kind: MediaPermsKind,
): readonly MediaPermsDevice[] {
	switch (kind) {
		case "microphone":
			return ["microphone"];
		case "camera":
			return ["camera"];
		case "camera-and-microphone":
			return ["camera", "microphone"];
	}
	throw new Error(
		`mediaperms: invalid kind "${kind}" — expected "microphone" | "camera" | "camera-and-microphone"`,
	);
}

/**
 * Merge per-device statuses into a single status. Precedence:
 * `denied` > `prompt` > `unknown`; `"granted"` only when **every** device is
 * granted. Rationale: any denial is terminal-worst, any pending prompt means
 * user action is still required, and any unknown means the whole cannot be
 * claimed granted.
 */
export function mergeStatuses(
	statuses: readonly MediaPermissionStatus[],
): MediaPermissionStatus {
	if (!statuses.length) return "unknown";
	if (statuses.includes("denied")) return "denied";
	if (statuses.includes("prompt")) return "prompt";
	if (statuses.includes("unknown")) return "unknown";
	// Explicit every-check (not a fall-through) so a contract-violating
	// value from a plain-JS custom adapter fails safe as "unknown" instead
	// of fail-open as "granted".
	return statuses.every((s) => s === "granted") ? "granted" : "unknown";
}

// ---------------------------------------------------------------------------
// Default logger
// ---------------------------------------------------------------------------

const DEFAULT_LOGGER = createClog("mediaperms");

// ---------------------------------------------------------------------------
// Default browser adapter
// ---------------------------------------------------------------------------

/**
 * Create the default browser adapter that wraps `navigator.permissions` and
 * `navigator.mediaDevices.getUserMedia`. The `kind` decides the getUserMedia
 * constraints (`{ audio }`, `{ video }`, or both — the combined kind is a
 * **single** call, i.e. one prompt). Useful for consumers who want to extend
 * or wrap the default behavior.
 */
export function createDefaultAdapter(
	kind: MediaPermsKind,
): MediaPermsBrowserAdapter {
	const constraints: MediaStreamConstraints = {
		...(kind !== "camera" ? { audio: true } : {}),
		...(kind !== "microphone" ? { video: true } : {}),
	};

	function supportsPermissionsApi(): boolean {
		return (
			typeof navigator !== "undefined" &&
			typeof navigator.permissions?.query === "function"
		);
	}

	async function queryPermission(
		device: MediaPermsDevice,
	): Promise<MediaPermissionStatus | null> {
		try {
			if (!supportsPermissionsApi()) return null;
			const result = await navigator.permissions.query({
				name: device as PermissionName,
			});
			return result.state as MediaPermissionStatus;
		} catch {
			return null;
		}
	}

	async function requestPermission(): Promise<MediaPermissionStatus> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
			return "granted";
		} catch (e: unknown) {
			if (e instanceof DOMException) {
				const name = e.name;
				if (
					name === "NotAllowedError" ||
					name === "PermissionDeniedError"
				) {
					return "denied";
				}
				// Re-throw so the factory can classify NotFoundError /
				// SecurityError / NotReadableError into a typed error.
			}
			throw e;
		}
	}

	function onPermissionChange(
		device: MediaPermsDevice,
		cb: (status: MediaPermissionStatus) => void,
	): (() => void) | null {
		if (!supportsPermissionsApi()) return null;
		let permStatus: PermissionStatus | null = null;
		let canceled = false;
		const handler = (): void => {
			if (canceled || !permStatus) return;
			cb(permStatus.state as MediaPermissionStatus);
		};
		navigator.permissions
			.query({ name: device as PermissionName })
			.then((result: PermissionStatus) => {
				if (canceled) {
					// Cleanup ran before the query resolved. Make sure the
					// freshly-resolved PermissionStatus carries no handler
					// so the listener does not leak.
					result.onchange = null;
					return;
				}
				permStatus = result;
				result.onchange = handler;
			})
			.catch(() => {});
		return (): void => {
			canceled = true;
			if (permStatus) permStatus.onchange = null;
		};
	}

	return {
		queryPermission,
		requestPermission,
		supportsPermissionsApi,
		onPermissionChange,
	};
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

// Dynamic global access (webkit, Android, custom bridge object names) plus
// graceful absence in non-DOM runtimes. The `any` cast is the pragmatic
// alternative to a brittle ambient declaration.
// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

/**
 * Detect the current platform context. Returns `config.platform` if set
 * (explicit override), otherwise auto-detects by checking for iOS
 * `webkit.messageHandlers`, Android bridge object, PWA standalone mode,
 * or falls back to `"browser"`.
 *
 * Note: iOS WKWebView (`webkit.messageHandlers`) is checked before PWA
 * standalone mode. A hosted WKWebView with native bridges is more
 * specific than display-mode standalone — the PWA branch is a fallback
 * for standalone web apps without a native host.
 */
export function detectPlatform(config: MediaPermsConfig): MediaPlatformContext {
	if (config.platform) return config.platform;

	try {
		if (_g.webkit?.messageHandlers) return "ios-webview";
	} catch {
		// ignore
	}

	try {
		if (_g[config.androidBridgeObject ?? "Android"]) {
			return "android-webview";
		}
	} catch {
		// ignore
	}

	try {
		if (
			_g.matchMedia?.("(display-mode: standalone)").matches ||
			_g.navigator?.standalone === true
		) {
			return "pwa";
		}
	} catch {
		// ignore
	}

	return "browser";
}

// ---------------------------------------------------------------------------
// Bridge detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a native bridge is available for opening app settings.
 * Checks for iOS `webkit.messageHandlers[handler]` or Android
 * `window[bridgeObject][bridgeMethod]`.
 */
export function detectBridge(
	platform: MediaPlatformContext,
	config: MediaPermsConfig,
): boolean {
	const iosBridgeHandler = config.iosBridgeHandler ?? "openAppSettings";
	const androidBridgeObject = config.androidBridgeObject ?? "Android";
	const androidBridgeMethod = config.androidBridgeMethod ?? "openAppSettings";

	try {
		if (platform === "ios-webview") {
			return !!_g.webkit?.messageHandlers?.[iosBridgeHandler];
		}
		if (platform === "android-webview") {
			return (
				typeof _g[androidBridgeObject]?.[androidBridgeMethod] ===
					"function"
			);
		}
	} catch {
		// ignore
	}

	return false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Classify a thrown `getUserMedia` failure into a {@linkcode MediaPermsErrorCode}.
 * Distinguishes "permission was denied" (handled at the adapter level by
 * returning `"denied"`) from device-/origin-level failures that ought to
 * surface separately so UI can react accordingly.
 */
function classifyRequestError(e: unknown): MediaPermsErrorCode {
	if (e instanceof DOMException) {
		const name = e.name;
		if (
			name === "NotFoundError" ||
			name === "DevicesNotFoundError" ||
			name === "OverconstrainedError"
		) {
			return MediaPermsErrorCode.NoDevice;
		}
		if (name === "SecurityError") {
			return MediaPermsErrorCode.InsecureContext;
		}
		if (name === "NotReadableError" || name === "TrackStartError") {
			return MediaPermsErrorCode.DeviceBusy;
		}
	}
	return MediaPermsErrorCode.RequestFailed;
}

type DeviceMap = Partial<Record<MediaPermsDevice, MediaPermsDeviceState>>;

/**
 * Record an observation for one device. Mutates (a copy of) the sticky
 * `observedDenied` flag: `"granted"` clears it, `"denied"` sets it,
 * ambiguous values leave it alone.
 */
function observeDevice(
	dev: MediaPermsDeviceState,
	incoming: MediaPermissionStatus,
): MediaPermsDeviceState {
	if (incoming === "granted" && dev.observedDenied) {
		return { ...dev, observedDenied: false };
	}
	if (incoming === "denied" && !dev.observedDenied) {
		return { ...dev, observedDenied: true };
	}
	return dev;
}

/**
 * Pure read: project an incoming status through one device's sticky-denial
 * flag. While `observedDenied` is set, `"prompt"` and `"unknown"` are
 * coerced to `"denied"` (Android-WebView lying-API mitigation).
 */
function coerceStatus(
	dev: MediaPermsDeviceState,
	incoming: MediaPermissionStatus,
): MediaPermissionStatus {
	if (
		dev.observedDenied &&
		(incoming === "prompt" || incoming === "unknown")
	) {
		return "denied";
	}
	return incoming;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a media permission manager instance for the given `kind`. Detects
 * the platform, sets up reactive state via `@marianmeres/store`, and
 * registers event listeners for permission changes (per device), app resume,
 * page show (bfcache), and visibility changes.
 *
 * The returned instance does **not** own MediaStreams — when `getUserMedia`
 * is called to probe permission, all tracks are stopped immediately.
 *
 * For the combined `"camera-and-microphone"` kind, `request()` issues a
 * **single** `getUserMedia({ audio: true, video: true })` call — one prompt
 * — and the state tracks a per-device breakdown in `state.devices`.
 */
export function createMediaPerms(
	kind: MediaPermsKind,
	config?: MediaPermsConfig,
): MediaPerms {
	const deviceKinds = devicesForKind(kind); // throws on invalid kind
	const cfg: MediaPermsConfig = { ...config };
	const iosBridgeHandler = cfg.iosBridgeHandler ?? "openAppSettings";
	const androidBridgeObject = cfg.androidBridgeObject ?? "Android";
	const androidBridgeMethod = cfg.androidBridgeMethod ?? "openAppSettings";
	const appResumedEvent = cfg.appResumedEvent ?? "app-resumed";
	const log = cfg.logger ?? DEFAULT_LOGGER;

	const platform = detectPlatform(cfg);
	const adapter = cfg.adapter ?? createDefaultAdapter(kind);
	const canOpenSettings = detectBridge(platform, cfg);

	const initialDevices: DeviceMap = {};
	for (const d of deviceKinds) {
		initialDevices[d] = { status: "unknown", observedDenied: false };
	}

	const store = createStore<MediaPermsState>({
		kind,
		status: "unknown",
		devices: initialDevices,
		platform,
		canOpenSettings,
		busy: false,
		observedDenied: false,
		error: null,
		lastCheckedAt: null,
	});

	let destroyed = false;
	const cleanups: (() => void)[] = [];

	// In-flight promise caches: re-entrant callers receive the in-flight
	// promise so all callers observe a consistent resolved value (and the
	// underlying adapter is invoked only once per concurrent batch).
	let inFlightCheck: Promise<MediaPermissionStatus> | null = null;
	let inFlightRequest: Promise<MediaPermissionStatus> | null = null;

	const MIN_PASSIVE_INTERVAL_MS = 500;

	// --- per-device bookkeeping ---

	/**
	 * Apply an incoming status to one device: observe (sticky bookkeeping),
	 * then coerce (pure projection). Returns a new device map.
	 */
	function applyIncoming(
		devices: DeviceMap,
		device: MediaPermsDevice,
		incoming: MediaPermissionStatus,
	): DeviceMap {
		const prev = devices[device]!;
		const observed = observeDevice(prev, incoming);
		const status = coerceStatus(observed, incoming);
		if (observed === prev && status === prev.status) return devices;
		return { ...devices, [device]: { ...observed, status } };
	}

	/**
	 * Single store-write path: update the device map via `updater`, then
	 * derive the merged `status` and the OR'd `observedDenied` from it —
	 * one atomic emission, no intermediate states.
	 */
	function commitDevices(
		updater: (devices: DeviceMap) => DeviceMap,
		extra: Partial<
			Omit<MediaPermsState, "devices" | "status" | "observedDenied" | "kind">
		> = {},
	): void {
		store.update((s) => {
			const devices = updater(s.devices);
			return {
				...s,
				...extra,
				devices,
				status: mergeStatuses(
					deviceKinds.map((d) => devices[d]!.status),
				),
				observedDenied: deviceKinds.some(
					(d) => devices[d]!.observedDenied,
				),
			};
		});
	}

	function clearObservedDenied(): void {
		if (!store.get().observedDenied) return;
		commitDevices((devices) => {
			const next: DeviceMap = {};
			for (const d of deviceKinds) {
				const dev = devices[d]!;
				next[d] = dev.observedDenied ? { ...dev, observedDenied: false } : dev;
			}
			return next;
		});
	}

	// --- event listeners ---

	for (const device of deviceKinds) {
		const permCleanup = adapter.onPermissionChange(
			device,
			(status: MediaPermissionStatus): void => {
				if (destroyed) return;
				commitDevices(
					(devices) => applyIncoming(devices, device, status),
					{ lastCheckedAt: Date.now() },
				);
			},
		);
		if (permCleanup) cleanups.push(permCleanup);
	}

	function shouldSkipPassive(): boolean {
		const last = store.get().lastCheckedAt ?? 0;
		return Date.now() - last < MIN_PASSIVE_INTERVAL_MS;
	}

	if (typeof _g.addEventListener === "function") {
		const handleAppResumed = (): void => {
			if (destroyed || shouldSkipPassive()) return;
			check();
		};
		_g.addEventListener(appResumedEvent, handleAppResumed);
		cleanups.push(() => _g.removeEventListener(appResumedEvent, handleAppResumed));

		// pageshow with `persisted === true` indicates a bfcache restore
		// (notably on iOS Safari after a Settings round-trip, where
		// `visibilitychange` is unreliable).
		const handlePageshow = (e: Event): void => {
			if (destroyed) return;
			// deno-lint-ignore no-explicit-any
			if (!(e as any).persisted) return;
			if (shouldSkipPassive()) return;
			check();
		};
		_g.addEventListener("pageshow", handlePageshow);
		cleanups.push(() => _g.removeEventListener("pageshow", handlePageshow));
	}

	if (typeof _g.document !== "undefined") {
		const handleVisibility = (): void => {
			if (destroyed) return;
			if (_g.document.visibilityState !== "visible") return;
			if (shouldSkipPassive()) return;
			check();
		};
		_g.document.addEventListener("visibilitychange", handleVisibility);
		cleanups.push(() =>
			_g.document.removeEventListener(
				"visibilitychange",
				handleVisibility,
			)
		);
	}

	// --- methods ---

	function check(): Promise<MediaPermissionStatus> {
		if (destroyed) {
			log.warn("mediaperms: check() called after destroy() — no-op");
			return Promise.resolve(store.get().status);
		}
		if (inFlightCheck) return inFlightCheck;
		inFlightCheck = (async (): Promise<MediaPermissionStatus> => {
			store.update((s) => ({ ...s, busy: true, error: null }));
			try {
				const results = await Promise.all(
					deviceKinds.map((d) => adapter.queryPermission(d)),
				);
				const anyValue = results.some((r) => r !== null);
				commitDevices(
					(devices) => {
						let next = devices;
						deviceKinds.forEach((d, i) => {
							const r = results[i];
							if (r !== null) next = applyIncoming(next, d, r);
						});
						return next;
					},
					{
						busy: false,
						...(anyValue ? { lastCheckedAt: Date.now() } : {}),
					},
				);
				return store.get().status;
			} catch (e: unknown) {
				const message = e instanceof Error
					? e.message
					: "Permission check failed";
				log.error("mediaperms check failed", e);
				store.update((s) => ({
					...s,
					busy: false,
					error: {
						code: MediaPermsErrorCode.CheckFailed,
						message,
					},
				}));
				return store.get().status;
			} finally {
				inFlightCheck = null;
			}
		})();
		return inFlightCheck;
	}

	function request(): Promise<MediaPermissionStatus> {
		if (destroyed) {
			log.warn("mediaperms: request() called after destroy() — no-op");
			return Promise.resolve(store.get().status);
		}
		if (inFlightRequest) return inFlightRequest;
		inFlightRequest = (async (): Promise<MediaPermissionStatus> => {
			store.update((s) => ({ ...s, busy: true, error: null }));
			try {
				const result = await adapter.requestPermission();
				commitDevices(
					(devices) => {
						let next = devices;
						for (const d of deviceKinds) {
							next = applyIncoming(next, d, result);
						}
						return next;
					},
					{ busy: false, lastCheckedAt: Date.now() },
				);
				// Combined-kind refinement: a denied combined getUserMedia
				// cannot tell WHICH device the user denied — conservatively,
				// all devices were just marked denied above. A follow-up
				// (non-prompting) Permissions-API query splits the per-device
				// statuses on platforms where that API is truthful; where it
				// lies ("prompt" after denial), the sticky flags coerce the
				// readings right back to "denied", so nothing regresses.
				//
				// Consistency guard: the refinement is applied only when at
				// least one device reads "denied". getUserMedia is the ground
				// truth — an all-granted (or granted/null) reading right after
				// a denial means the Permissions API cannot see the real
				// blocker (typically an OS-level camera/mic block on desktop
				// Chromium, where site permissions still read "granted").
				// Committing that would flip status to "granted" for a capture
				// that just failed — keep the conservative denial instead.
				if (
					result === "denied" &&
					deviceKinds.length > 1 &&
					adapter.supportsPermissionsApi()
				) {
					try {
						const refined = await Promise.all(
							deviceKinds.map((d) => adapter.queryPermission(d)),
						);
						if (refined.some((r) => r === "denied")) {
							commitDevices((devices) => {
								let next = devices;
								deviceKinds.forEach((d, i) => {
									const r = refined[i];
									if (r !== null) {
										next = applyIncoming(next, d, r);
									}
								});
								return next;
							});
						}
					} catch {
						// best-effort refinement only
					}
				}
				return store.get().status;
			} catch (e: unknown) {
				const code = classifyRequestError(e);
				const message = e instanceof Error
					? e.message
					: "Permission request failed";
				log.error("mediaperms request failed", e);
				store.update((s) => ({
					...s,
					busy: false,
					error: { code, message },
				}));
				return store.get().status;
			} finally {
				inFlightRequest = null;
			}
		})();
		return inFlightRequest;
	}

	function openSettings(): boolean {
		if (!canOpenSettings) return false;
		try {
			if (platform === "ios-webview") {
				_g.webkit.messageHandlers[iosBridgeHandler].postMessage({});
				// User is on their way to change OS settings — clear sticky
				// denial so a genuine "granted" or "prompt" can be observed
				// on return.
				clearObservedDenied();
				return true;
			}
			if (platform === "android-webview") {
				_g[androidBridgeObject][androidBridgeMethod]();
				clearObservedDenied();
				return true;
			}
		} catch (e) {
			log.error("mediaperms openSettings failed", e);
		}
		return false;
	}

	async function recheck(): Promise<MediaPermissionStatus> {
		const status = await check();
		if (status === "unknown" || status === "prompt") {
			return await request();
		}
		return status;
	}

	function reset(): void {
		if (destroyed) return;
		commitDevices(
			() => {
				const next: DeviceMap = {};
				for (const d of deviceKinds) {
					next[d] = { status: "unknown", observedDenied: false };
				}
				return next;
			},
			{ error: null, lastCheckedAt: null },
		);
	}

	function destroy(): void {
		if (destroyed) return;
		destroyed = true;
		cleanups.forEach((fn) => fn());
		cleanups.length = 0;
	}

	return {
		subscribe: store.subscribe.bind(store),
		get: store.get.bind(store),
		check,
		request,
		openSettings,
		recheck,
		reset,
		destroy,
	};
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Create a microphone permission manager — a thin wrapper for
 * `createMediaPerms("microphone", config)`. Near-drop-in replacement for
 * `@marianmeres/micperms`' factory of the same name (the state additionally
 * carries `kind` and the per-device `devices` breakdown).
 */
export function createMicPerms(config?: MediaPermsConfig): MediaPerms {
	return createMediaPerms("microphone", config);
}

/**
 * Create a camera permission manager — a thin wrapper for
 * `createMediaPerms("camera", config)`.
 */
export function createCamPerms(config?: MediaPermsConfig): MediaPerms {
	return createMediaPerms("camera", config);
}
