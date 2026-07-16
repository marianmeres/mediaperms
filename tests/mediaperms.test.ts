import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
	createCamPerms,
	createDefaultAdapter,
	createMediaPerms,
	createMicPerms,
	devicesForKind,
	type MediaPermissionStatus,
	type MediaPermsBrowserAdapter,
	type MediaPermsDevice,
	MediaPermsErrorCode,
	type MediaPermsKind,
	type MediaPermsState,
	mergeStatuses,
} from "../src/mediaperms.ts";

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

interface MockAdapter extends MediaPermsBrowserAdapter {
	queryCallCount: number;
	requestCallCount: number;
	setQueryResult(
		device: MediaPermsDevice,
		v: MediaPermissionStatus | null,
	): void;
	setAllQueryResults(v: MediaPermissionStatus | null): void;
	setRequestResult(v: MediaPermissionStatus): void;
	setQueryFn(
		fn: (device: MediaPermsDevice) => Promise<MediaPermissionStatus | null>,
	): void;
}

function createMockAdapter(opts?: {
	initialState?: MediaPermissionStatus;
	supportsPermissions?: boolean;
	requestResult?: MediaPermissionStatus;
}): MockAdapter {
	const supportsPermissions = opts?.supportsPermissions ?? true;
	const initial = supportsPermissions ? (opts?.initialState ?? "prompt") : null;
	const queryResults: Record<MediaPermsDevice, MediaPermissionStatus | null> = {
		microphone: initial,
		camera: initial,
	};
	let requestResult: MediaPermissionStatus = opts?.requestResult ?? "granted";
	let queryFn:
		| ((device: MediaPermsDevice) => Promise<MediaPermissionStatus | null>)
		| null = null;

	const adapter: MockAdapter = {
		queryCallCount: 0,
		requestCallCount: 0,
		queryPermission: (device) => {
			adapter.queryCallCount++;
			if (queryFn) return queryFn(device);
			return Promise.resolve(queryResults[device]);
		},
		requestPermission: () => {
			adapter.requestCallCount++;
			return Promise.resolve(requestResult);
		},
		supportsPermissionsApi: () => supportsPermissions,
		onPermissionChange: () => null,
		setQueryResult: (device, v) => {
			queryResults[device] = v;
		},
		setAllQueryResults: (v) => {
			queryResults.microphone = v;
			queryResults.camera = v;
		},
		setRequestResult: (v) => {
			requestResult = v;
		},
		setQueryFn: (fn) => {
			queryFn = fn;
		},
	};
	return adapter;
}

// ---------------------------------------------------------------------------
// Fake document helpers for visibility/app-resumed tests
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

function installFakeDocument(visibilityState: "visible" | "hidden" = "visible") {
	const target = new EventTarget();
	const fake = {
		visibilityState,
		addEventListener: target.addEventListener.bind(target),
		removeEventListener: target.removeEventListener.bind(target),
		dispatchEvent: target.dispatchEvent.bind(target),
	};
	const prev = _g.document;
	_g.document = fake;
	return {
		dispatch: (type: string) => target.dispatchEvent(new Event(type)),
		restore: () => {
			_g.document = prev;
		},
	};
}

async function waitMicrotasks(n = 3): Promise<void> {
	for (let i = 0; i < n; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Kind helpers
// ---------------------------------------------------------------------------

Deno.test("devicesForKind maps kinds to device lists", () => {
	assertEquals(devicesForKind("microphone"), ["microphone"]);
	assertEquals(devicesForKind("camera"), ["camera"]);
	assertEquals(devicesForKind("camera-and-microphone"), [
		"camera",
		"microphone",
	]);
});

Deno.test("devicesForKind throws on invalid kind", () => {
	assertThrows(() => devicesForKind("webcam" as MediaPermsKind));
});

Deno.test("createMediaPerms throws on invalid kind", () => {
	assertThrows(() =>
		createMediaPerms("webcam" as MediaPermsKind, {
			adapter: createMockAdapter(),
		})
	);
});

Deno.test("mergeStatuses precedence: denied > prompt > unknown > granted", () => {
	assertEquals(mergeStatuses([]), "unknown");
	assertEquals(mergeStatuses(["granted"]), "granted");
	assertEquals(mergeStatuses(["granted", "granted"]), "granted");
	assertEquals(mergeStatuses(["granted", "denied"]), "denied");
	assertEquals(mergeStatuses(["prompt", "denied"]), "denied");
	assertEquals(mergeStatuses(["granted", "prompt"]), "prompt");
	assertEquals(mergeStatuses(["unknown", "prompt"]), "prompt");
	assertEquals(mergeStatuses(["granted", "unknown"]), "unknown");
});

Deno.test("mergeStatuses fails safe (never 'granted') on contract-violating values", () => {
	// A typo'd plain-JS custom adapter must not transmute garbage into the
	// most permissive status.
	assertEquals(mergeStatuses(["blocked" as MediaPermissionStatus]), "unknown");
	assertEquals(
		mergeStatuses([undefined as unknown as MediaPermissionStatus]),
		"unknown",
	);
	assertEquals(
		mergeStatuses(["granted", "blocked" as MediaPermissionStatus]),
		"unknown",
	);
});

// ---------------------------------------------------------------------------
// Basic lifecycle (single kinds)
// ---------------------------------------------------------------------------

Deno.test("initial state is unknown and not busy", () => {
	const mic = createMediaPerms("microphone", { adapter: createMockAdapter() });
	const s = mic.get();
	assertEquals(s.kind, "microphone");
	assertEquals(s.status, "unknown");
	assertEquals(s.busy, false);
	assertEquals(s.error, null);
	assertEquals(s.lastCheckedAt, null);
	assertEquals(s.devices.microphone?.status, "unknown");
	assertEquals(s.devices.camera, undefined);
	mic.destroy();
});

Deno.test("createMicPerms/createCamPerms wrappers pick the right kind", () => {
	const mic = createMicPerms({ adapter: createMockAdapter() });
	assertEquals(mic.get().kind, "microphone");
	assertEquals(Object.keys(mic.get().devices), ["microphone"]);
	mic.destroy();

	const cam = createCamPerms({ adapter: createMockAdapter() });
	assertEquals(cam.get().kind, "camera");
	assertEquals(Object.keys(cam.get().devices), ["camera"]);
	cam.destroy();
});

Deno.test("combined kind tracks both devices", () => {
	const both = createMediaPerms("camera-and-microphone", {
		adapter: createMockAdapter(),
	});
	const s = both.get();
	assertEquals(s.kind, "camera-and-microphone");
	assertEquals(s.devices.camera?.status, "unknown");
	assertEquals(s.devices.microphone?.status, "unknown");
	both.destroy();
});

Deno.test("check() transitions to prompt", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({ initialState: "prompt" }),
	});
	const status = await mic.check();
	assertEquals(status, "prompt");
	assertEquals(mic.get().status, "prompt");
	mic.destroy();
});

Deno.test("check() transitions to granted", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({ initialState: "granted" }),
	});
	const status = await mic.check();
	assertEquals(status, "granted");
	assertEquals(typeof mic.get().lastCheckedAt, "number");
	mic.destroy();
});

Deno.test("check() transitions to denied", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({ initialState: "denied" }),
	});
	const status = await mic.check();
	assertEquals(status, "denied");
	mic.destroy();
});

Deno.test("check() with unsupported Permissions API stays unknown", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({ supportsPermissions: false }),
	});
	const status = await mic.check();
	assertEquals(status, "unknown");
	assertEquals(mic.get().status, "unknown");
	mic.destroy();
});

Deno.test("request() grants permission", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({ requestResult: "granted" }),
	});
	const status = await mic.request();
	assertEquals(status, "granted");
	assertEquals(mic.get().status, "granted");
	mic.destroy();
});

Deno.test("request() denies permission", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({ requestResult: "denied" }),
	});
	const status = await mic.request();
	assertEquals(status, "denied");
	assertEquals(mic.get().status, "denied");
	mic.destroy();
});

Deno.test("recheck() falls back to request when query returns null", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({
			supportsPermissions: false,
			requestResult: "granted",
		}),
	});
	const status = await mic.recheck();
	assertEquals(status, "granted");
	assertEquals(mic.get().status, "granted");
	mic.destroy();
});

Deno.test("recheck() does not escalate to request when check() is conclusive", async () => {
	const adapter = createMockAdapter({ initialState: "denied" });
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	assertEquals(await mic.recheck(), "denied");
	assertEquals(adapter.requestCallCount, 0);
	mic.destroy();
});

Deno.test("combined recheck(): merged denied does not prompt despite one ambiguous device", async () => {
	const adapter = createMockAdapter();
	adapter.setQueryResult("camera", "denied");
	adapter.setQueryResult("microphone", "prompt");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.recheck(), "denied");
	assertEquals(adapter.requestCallCount, 0);
	both.destroy();
});

Deno.test("combined recheck(): ambiguous merged status escalates to a single request", async () => {
	const adapter = createMockAdapter({ requestResult: "granted" });
	adapter.setAllQueryResults("prompt");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.recheck(), "granted");
	assertEquals(adapter.requestCallCount, 1);
	both.destroy();
});

Deno.test("check(): throwing query surfaces CHECK_FAILED, preserves status", async () => {
	const adapter = createMockAdapter();
	adapter.setQueryFn(() => Promise.reject(new Error("boom")));
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	assertEquals(await mic.check(), "unknown"); // prior status preserved
	const s = mic.get();
	assertEquals(s.error?.code, MediaPermsErrorCode.CheckFailed);
	assertEquals(s.error?.message, "boom");
	assertEquals(s.busy, false);
	assertEquals(s.lastCheckedAt, null);
	mic.destroy();
});

Deno.test("combined check(): one throwing query fails the whole check (all-or-nothing)", async () => {
	const adapter = createMockAdapter();
	adapter.setQueryFn((d) =>
		d === "camera"
			? Promise.reject(new Error("cam-boom"))
			: Promise.resolve("granted" as MediaPermissionStatus)
	);
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.check(), "unknown");
	const s = both.get();
	assertEquals(s.error?.code, MediaPermsErrorCode.CheckFailed);
	// the sibling's successful result is discarded — nothing partial committed
	assertEquals(s.devices.microphone?.status, "unknown");
	assertEquals(s.devices.camera?.status, "unknown");
	assertEquals(s.lastCheckedAt, null);
	both.destroy();
});

Deno.test("subscribe() fires immediately with current state", () => {
	const mic = createMediaPerms("microphone", { adapter: createMockAdapter() });
	const states: MediaPermsState[] = [];
	const unsub = mic.subscribe((s) => states.push(s));
	assertEquals(states.length, 1);
	assertEquals(states[0].status, "unknown");
	unsub();
	mic.destroy();
});

Deno.test("platform override via config", () => {
	const mic = createMediaPerms("microphone", {
		platform: "ios-webview",
		adapter: createMockAdapter(),
	});
	assertEquals(mic.get().platform, "ios-webview");
	mic.destroy();
});

Deno.test("canOpenSettings is false for browser platform", () => {
	const mic = createMediaPerms("microphone", {
		platform: "browser",
		adapter: createMockAdapter(),
	});
	assertEquals(mic.get().canOpenSettings, false);
	assertEquals(mic.openSettings(), false);
	mic.destroy();
});

Deno.test("destroy() is idempotent", () => {
	const mic = createMediaPerms("microphone", { adapter: createMockAdapter() });
	mic.destroy();
	mic.destroy();
	// no error thrown — passes
});

Deno.test("busy is false after async operations complete", async () => {
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter({ initialState: "granted" }),
	});
	await mic.check();
	assertEquals(mic.get().busy, false);
	await mic.request();
	assertEquals(mic.get().busy, false);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// Combined kind — merge + per-device breakdown
// ---------------------------------------------------------------------------

Deno.test("combined check(): granted + granted → granted", async () => {
	const adapter = createMockAdapter();
	adapter.setAllQueryResults("granted");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.check(), "granted");
	assertEquals(both.get().devices.camera?.status, "granted");
	assertEquals(both.get().devices.microphone?.status, "granted");
	// one check() queries each device once
	assertEquals(adapter.queryCallCount, 2);
	both.destroy();
});

Deno.test("combined check(): mic granted + cam denied → denied (with breakdown)", async () => {
	const adapter = createMockAdapter();
	adapter.setQueryResult("microphone", "granted");
	adapter.setQueryResult("camera", "denied");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.check(), "denied");
	const s = both.get();
	assertEquals(s.devices.microphone?.status, "granted");
	assertEquals(s.devices.camera?.status, "denied");
	assertEquals(s.devices.camera?.observedDenied, true);
	assertEquals(s.devices.microphone?.observedDenied, false);
	assertEquals(s.observedDenied, true);
	both.destroy();
});

Deno.test("combined check(): granted + prompt → prompt", async () => {
	const adapter = createMockAdapter();
	adapter.setQueryResult("microphone", "granted");
	adapter.setQueryResult("camera", "prompt");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.check(), "prompt");
	both.destroy();
});

Deno.test("combined check(): one device's null query keeps its prior status", async () => {
	const adapter = createMockAdapter();
	adapter.setQueryResult("microphone", "granted");
	adapter.setQueryResult("camera", null);
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.check(), "unknown"); // cam stays unknown → merged unknown
	assertEquals(both.get().devices.microphone?.status, "granted");
	assertEquals(both.get().devices.camera?.status, "unknown");
	// at least one device returned a value → lastCheckedAt advances
	assertEquals(typeof both.get().lastCheckedAt, "number");
	both.destroy();
});

Deno.test("combined request() granted marks both devices granted", async () => {
	const adapter = createMockAdapter({ requestResult: "granted" });
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.request(), "granted");
	assertEquals(both.get().devices.camera?.status, "granted");
	assertEquals(both.get().devices.microphone?.status, "granted");
	// a single getUserMedia probe (one prompt)
	assertEquals(adapter.requestCallCount, 1);
	both.destroy();
});

Deno.test("combined request() denied + truthful query splits per-device statuses", async () => {
	const adapter = createMockAdapter({ requestResult: "denied" });
	// truthful Permissions API: mic actually granted, cam actually denied
	adapter.setQueryResult("microphone", "granted");
	adapter.setQueryResult("camera", "denied");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.request(), "denied");
	const s = both.get();
	// refinement split the conservative both-denied into the real picture
	assertEquals(s.devices.microphone?.status, "granted");
	assertEquals(s.devices.microphone?.observedDenied, false);
	assertEquals(s.devices.camera?.status, "denied");
	assertEquals(s.devices.camera?.observedDenied, true);
	assertEquals(s.status, "denied");
	both.destroy();
});

Deno.test("combined request() denied + lying query keeps both devices denied", async () => {
	const adapter = createMockAdapter({ requestResult: "denied" });
	// Android-WebView-style lie: "prompt" after an OS denial
	adapter.setAllQueryResults("prompt");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.request(), "denied");
	const s = both.get();
	// sticky flags coerce the lying "prompt" right back to denied
	assertEquals(s.devices.microphone?.status, "denied");
	assertEquals(s.devices.camera?.status, "denied");
	assertEquals(s.status, "denied");
	both.destroy();
});

Deno.test("combined request() denied without Permissions API skips refinement", async () => {
	const adapter = createMockAdapter({
		supportsPermissions: false,
		requestResult: "denied",
	});
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.request(), "denied");
	assertEquals(adapter.queryCallCount, 0);
	assertEquals(both.get().devices.camera?.status, "denied");
	assertEquals(both.get().devices.microphone?.status, "denied");
	both.destroy();
});

Deno.test("combined request() denied + all-granted refinement is discarded (OS-level block)", async () => {
	// Desktop Chromium with an OS-level camera/mic block: getUserMedia throws
	// NotAllowedError while the (site-scoped) Permissions API still reads
	// "granted" for both devices. The inconsistent all-granted refinement must
	// not overwrite the observed denial — getUserMedia is the ground truth.
	const adapter = createMockAdapter({ requestResult: "denied" });
	adapter.setAllQueryResults("granted");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.request(), "denied");
	const s = both.get();
	assertEquals(s.devices.camera?.status, "denied");
	assertEquals(s.devices.microphone?.status, "denied");
	assertEquals(s.devices.camera?.observedDenied, true);
	assertEquals(s.devices.microphone?.observedDenied, true);
	assertEquals(s.status, "denied");
	assertEquals(s.error, null);
	both.destroy();
});

Deno.test("combined request() denied + throwing refinement query is swallowed", async () => {
	const adapter = createMockAdapter({ requestResult: "denied" });
	adapter.setQueryFn(() => Promise.reject(new Error("boom")));
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	assertEquals(await both.request(), "denied");
	const s = both.get();
	// refinement was attempted for both devices...
	assertEquals(adapter.queryCallCount, 2);
	// ...but its rejection is best-effort-swallowed, not surfaced as an error
	assertEquals(s.error, null);
	assertEquals(s.devices.camera?.status, "denied");
	assertEquals(s.devices.microphone?.status, "denied");
	assertEquals(s.busy, false);
	assertEquals(s.status, "denied");
	both.destroy();
});

Deno.test("single-kind request() denied never triggers refinement queries", async () => {
	const adapter = createMockAdapter({ requestResult: "denied" });
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	await mic.request();
	assertEquals(adapter.queryCallCount, 0);
	mic.destroy();
});

Deno.test("per-device sticky: one device's flag does not coerce the other", async () => {
	const adapter = createMockAdapter();
	adapter.setQueryResult("camera", "denied");
	adapter.setQueryResult("microphone", "prompt");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	await both.check();
	// cam sticky-denied; mic must remain an honest "prompt"
	assertEquals(both.get().devices.camera?.status, "denied");
	assertEquals(both.get().devices.microphone?.status, "prompt");

	// cam now lies "prompt" → coerced back to denied; mic unaffected
	adapter.setQueryResult("camera", "prompt");
	assertEquals(await both.check(), "denied");
	assertEquals(both.get().devices.camera?.status, "denied");
	assertEquals(both.get().devices.microphone?.status, "prompt");
	both.destroy();
});

// ---------------------------------------------------------------------------
// Android-loop regression tests
// ---------------------------------------------------------------------------

Deno.test("sticky denial survives a lying Permissions API", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	// Lying Permissions API says "prompt" after OS denial
	adapter.setQueryResult("microphone", "prompt");
	const checked = await mic.check();
	assertEquals(checked, "denied");
	assertEquals(mic.get().status, "denied");
	mic.destroy();
});

Deno.test("granted observation clears the sticky denial flag", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	// User granted via OS settings -> query now returns granted
	adapter.setQueryResult("microphone", "granted");
	assertEquals(await mic.check(), "granted");
	// Sticky cleared: a later "prompt" is not coerced back to denied
	adapter.setQueryResult("microphone", "prompt");
	assertEquals(await mic.check(), "prompt");
	mic.destroy();
});

Deno.test("visibilitychange does not escalate to request", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		const mic = createMediaPerms("microphone", {
			platform: "browser",
			adapter,
		});
		await mic.request();
		assertEquals(mic.get().status, "denied");
		const requestsBefore = adapter.requestCallCount;
		const queriesBefore = adapter.queryCallCount;
		// Wait past the passive-debounce window so the handler doesn't skip.
		await new Promise((r) => setTimeout(r, 600));
		fake.dispatch("visibilitychange");
		await waitMicrotasks();
		await new Promise((r) => setTimeout(r, 10));
		assertEquals(adapter.requestCallCount, requestsBefore);
		// check() was attempted (query invoked) at least once
		if (adapter.queryCallCount <= queriesBefore) {
			throw new Error("expected queryPermission to have been called");
		}
		mic.destroy();
	} finally {
		fake.restore();
	}
});

Deno.test("no loop under the Android-lying scenario", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		// Query ALWAYS lies with "prompt"
		adapter.setAllQueryResults("prompt");
		const mic = createMediaPerms("microphone", {
			platform: "browser",
			adapter,
		});
		await mic.request();
		assertEquals(mic.get().status, "denied");
		assertEquals(adapter.requestCallCount, 1);
		// 10 visibility events with tiny delays past debounce window
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 60));
			fake.dispatch("visibilitychange");
			await waitMicrotasks();
		}
		await new Promise((r) => setTimeout(r, 20));
		assertEquals(adapter.requestCallCount, 1);
		assertEquals(mic.get().status, "denied");
		mic.destroy();
	} finally {
		fake.restore();
	}
});

Deno.test("no loop under the Android-lying scenario (combined kind)", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		adapter.setAllQueryResults("prompt");
		const both = createMediaPerms("camera-and-microphone", {
			platform: "browser",
			adapter,
		});
		await both.request();
		assertEquals(both.get().status, "denied");
		assertEquals(adapter.requestCallCount, 1);
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 60));
			fake.dispatch("visibilitychange");
			await waitMicrotasks();
		}
		await new Promise((r) => setTimeout(r, 20));
		assertEquals(adapter.requestCallCount, 1);
		assertEquals(both.get().status, "denied");
		both.destroy();
	} finally {
		fake.restore();
	}
});

Deno.test("re-entrancy guard: concurrent check() calls only query once per device", async () => {
	let resolveQuery: (v: MediaPermissionStatus | null) => void = () => {};
	const adapter = createMockAdapter({ initialState: "prompt" });
	adapter.setQueryFn(
		() =>
			new Promise<MediaPermissionStatus | null>((r) => {
				resolveQuery = r;
			}),
	);
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	const p1 = mic.check();
	const p2 = mic.check();
	resolveQuery("granted");
	const [r1, r2] = await Promise.all([p1, p2]);
	assertEquals(adapter.queryCallCount, 1);
	// Both callers must observe the same resolved value (B2 regression).
	assertEquals(r1, "granted");
	assertEquals(r2, "granted");
	mic.destroy();
});

Deno.test("re-entrancy guard: concurrent request() calls only request once", async () => {
	let resolveRequest: (v: MediaPermissionStatus) => void = () => {};
	const adapter: MediaPermsBrowserAdapter & { requestCallCount: number } = {
		queryPermission: () => Promise.resolve(null),
		requestPermission: () => {
			adapter.requestCallCount++;
			return new Promise<MediaPermissionStatus>((r) => {
				resolveRequest = r;
			});
		},
		supportsPermissionsApi: () => false,
		onPermissionChange: () => null,
		requestCallCount: 0,
	};
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	const p1 = mic.request();
	const p2 = mic.request();
	resolveRequest("granted");
	const [r1, r2] = await Promise.all([p1, p2]);
	assertEquals(adapter.requestCallCount, 1);
	assertEquals(r1, "granted");
	assertEquals(r2, "granted");
	mic.destroy();
});

Deno.test("app-resumed does not escalate to request", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	const requestsBefore = adapter.requestCallCount;
	await new Promise((r) => setTimeout(r, 600));
	_g.dispatchEvent(new Event("app-resumed"));
	await waitMicrotasks();
	await new Promise((r) => setTimeout(r, 10));
	assertEquals(adapter.requestCallCount, requestsBefore);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// B1 — default adapter does not leak onchange after early destroy
// ---------------------------------------------------------------------------

interface FakePermissionStatus {
	state: string;
	onchange: (() => void) | null;
}

function installFakeNavigator() {
	let resolveQuery: ((s: FakePermissionStatus) => void) | null = null;
	let permStatusInstance: FakePermissionStatus | null = null;
	const queryNames: string[] = [];
	const fakePermissions = {
		query: (opts: { name: string }) => {
			queryNames.push(opts?.name);
			return new Promise<FakePermissionStatus>((r) => {
				resolveQuery = r;
			});
		},
	};
	// Deno's `navigator` is a real instance; add `permissions` via
	// defineProperty so the default adapter sees it through `navigator.permissions`.
	const hadPermissions = Object.prototype.hasOwnProperty.call(
		_g.navigator,
		"permissions",
	);
	const prev = hadPermissions ? _g.navigator.permissions : undefined;
	Object.defineProperty(_g.navigator, "permissions", {
		value: fakePermissions,
		configurable: true,
		writable: true,
	});
	return {
		queryNames,
		resolveQuery: (state: string): FakePermissionStatus => {
			permStatusInstance = { state, onchange: null };
			resolveQuery?.(permStatusInstance);
			return permStatusInstance;
		},
		getPermStatus: () => permStatusInstance,
		restore: () => {
			if (hadPermissions) {
				Object.defineProperty(_g.navigator, "permissions", {
					value: prev,
					configurable: true,
					writable: true,
				});
			} else {
				delete _g.navigator.permissions;
			}
		},
	};
}

Deno.test("B1: default adapter onchange does not leak after early destroy", async () => {
	const fakeNav = installFakeNavigator();
	try {
		const adapter = createDefaultAdapter("microphone");
		let cbCalls = 0;
		const cleanup = adapter.onPermissionChange("microphone", () => {
			cbCalls++;
		})!;
		// Destroy BEFORE the navigator.permissions.query promise resolves.
		cleanup();
		// Now resolve.
		const permStatus = fakeNav.resolveQuery("prompt");
		await waitMicrotasks(5);
		// Handler must not have been wired up.
		assertEquals(permStatus.onchange, null);
		// Even if we manually invoke whatever was set, no callback fires.
		permStatus.onchange?.();
		assertEquals(cbCalls, 0);
	} finally {
		fakeNav.restore();
	}
});

Deno.test("B1: default adapter onchange cleanup works in the normal path too", async () => {
	const fakeNav = installFakeNavigator();
	try {
		const adapter = createDefaultAdapter("microphone");
		let cbCalls = 0;
		const cleanup = adapter.onPermissionChange("microphone", () => {
			cbCalls++;
		})!;
		const permStatus = fakeNav.resolveQuery("prompt");
		await waitMicrotasks(5);
		// Handler is wired.
		if (typeof permStatus.onchange !== "function") {
			throw new Error("expected onchange to be wired");
		}
		// Fire it once -> callback fires.
		permStatus.onchange?.();
		assertEquals(cbCalls, 1);
		// Cleanup -> handler detached.
		cleanup();
		assertEquals(permStatus.onchange, null);
	} finally {
		fakeNav.restore();
	}
});

Deno.test("default adapter queries the Permissions API with the device name", async () => {
	const fakeNav = installFakeNavigator();
	try {
		const adapter = createDefaultAdapter("camera");
		const p = adapter.queryPermission("camera");
		fakeNav.resolveQuery("granted");
		assertEquals(await p, "granted");
		assertEquals(fakeNav.queryNames, ["camera"]);
	} finally {
		fakeNav.restore();
	}
});

// ---------------------------------------------------------------------------
// Default adapter getUserMedia constraints per kind
// ---------------------------------------------------------------------------

function installFakeMediaDevices(opts?: { error?: () => unknown }) {
	const calls: MediaStreamConstraints[] = [];
	let stops = 0;
	const fake = {
		getUserMedia: (constraints: MediaStreamConstraints) => {
			calls.push(constraints);
			if (opts?.error) return Promise.reject(opts.error());
			return Promise.resolve({
				getTracks: () => [{ stop: () => stops++ }, { stop: () => stops++ }],
			});
		},
	};
	const hadMediaDevices = Object.prototype.hasOwnProperty.call(
		_g.navigator,
		"mediaDevices",
	);
	const prev = hadMediaDevices ? _g.navigator.mediaDevices : undefined;
	Object.defineProperty(_g.navigator, "mediaDevices", {
		value: fake,
		configurable: true,
		writable: true,
	});
	return {
		calls,
		stops: () => stops,
		restore: () => {
			if (hadMediaDevices) {
				Object.defineProperty(_g.navigator, "mediaDevices", {
					value: prev,
					configurable: true,
					writable: true,
				});
			} else {
				delete _g.navigator.mediaDevices;
			}
		},
	};
}

Deno.test("default adapter getUserMedia constraints match the kind", async () => {
	const fakeMedia = installFakeMediaDevices();
	try {
		assertEquals(
			await createDefaultAdapter("microphone").requestPermission(),
			"granted",
		);
		assertEquals(
			await createDefaultAdapter("camera").requestPermission(),
			"granted",
		);
		assertEquals(
			await createDefaultAdapter("camera-and-microphone")
				.requestPermission(),
			"granted",
		);
		assertEquals(fakeMedia.calls, [
			{ audio: true },
			{ video: true },
			{ audio: true, video: true },
		]);
		// tracks are released immediately (2 fake tracks per acquired stream)
		assertEquals(fakeMedia.stops(), 6);
	} finally {
		fakeMedia.restore();
	}
});

Deno.test("default adapter maps NotAllowedError/PermissionDeniedError to denied", async () => {
	for (const name of ["NotAllowedError", "PermissionDeniedError"]) {
		const fakeMedia = installFakeMediaDevices({
			error: () => new DOMException("nope", name),
		});
		try {
			assertEquals(
				await createDefaultAdapter("microphone").requestPermission(),
				"denied",
			);
		} finally {
			fakeMedia.restore();
		}
	}
});

Deno.test("default adapter re-throws device-/origin-level getUserMedia failures", async () => {
	const fakeMedia = installFakeMediaDevices({
		error: () => new DOMException("no cam", "NotFoundError"),
	});
	try {
		// re-thrown so the factory can classify it (NO_DEVICE etc.)
		await assertRejects(
			() => createDefaultAdapter("camera").requestPermission(),
			DOMException,
		);
	} finally {
		fakeMedia.restore();
	}
});

Deno.test("default adapter re-throws non-DOMException getUserMedia failures", async () => {
	const fakeMedia = installFakeMediaDevices({
		error: () => new Error("weird runtime failure"),
	});
	try {
		await assertRejects(
			() => createDefaultAdapter("microphone").requestPermission(),
			Error,
			"weird runtime failure",
		);
	} finally {
		fakeMedia.restore();
	}
});

// ---------------------------------------------------------------------------
// B3 — onchange + reconcile interplay (sticky flag stays consistent)
// ---------------------------------------------------------------------------

Deno.test("B3: onchange-observed denial keeps sticky flag set across in-flight check", async () => {
	let resolveQuery: (v: MediaPermissionStatus | null) => void = () => {};
	let onchangeCb: ((s: MediaPermissionStatus) => void) | null = null;
	const adapter: MediaPermsBrowserAdapter = {
		queryPermission: () =>
			new Promise<MediaPermissionStatus | null>((r) => {
				resolveQuery = r;
			}),
		requestPermission: () => Promise.resolve("granted"),
		supportsPermissionsApi: () => true,
		onPermissionChange: (_device, cb) => {
			onchangeCb = cb;
			return () => {};
		},
	};
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	const p = mic.check();
	// Onchange fires "denied" mid-flight.
	onchangeCb!("denied");
	// Lying API resolves with "prompt".
	resolveQuery("prompt");
	const result = await p;
	// Sticky flag was set by onchange — check() must coerce "prompt" to "denied".
	assertEquals(result, "denied");
	assertEquals(mic.get().status, "denied");
	assertEquals(mic.get().observedDenied, true);
	mic.destroy();
});

Deno.test("onchange targets only its own device (combined kind)", () => {
	const callbacks: Partial<
		Record<MediaPermsDevice, (s: MediaPermissionStatus) => void>
	> = {};
	const adapter: MediaPermsBrowserAdapter = {
		queryPermission: () => Promise.resolve(null),
		requestPermission: () => Promise.resolve("granted"),
		supportsPermissionsApi: () => true,
		onPermissionChange: (device, cb) => {
			callbacks[device] = cb;
			return () => {};
		},
	};
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	// one listener registered per device
	assert(typeof callbacks.camera === "function");
	assert(typeof callbacks.microphone === "function");
	callbacks.camera!("denied");
	assertEquals(both.get().devices.camera?.status, "denied");
	assertEquals(both.get().devices.microphone?.status, "unknown");
	assertEquals(both.get().status, "denied");
	callbacks.microphone!("granted");
	assertEquals(both.get().devices.microphone?.status, "granted");
	assertEquals(both.get().status, "denied"); // cam still denied
	both.destroy();
});

// ---------------------------------------------------------------------------
// B4 — getUserMedia error classification
// ---------------------------------------------------------------------------

function adapterRejecting(name: string): MediaPermsBrowserAdapter {
	return {
		queryPermission: () => Promise.resolve(null),
		requestPermission: () => Promise.reject(new DOMException("err", name)),
		supportsPermissionsApi: () => false,
		onPermissionChange: () => null,
	};
}

Deno.test("B4: NotFoundError surfaces NO_DEVICE error code, status preserved", async () => {
	const mic = createMediaPerms("microphone", {
		platform: "browser",
		adapter: adapterRejecting("NotFoundError"),
	});
	const result = await mic.request();
	// Status is preserved (initial "unknown") rather than smeared to "unknown" by
	// a swallowed error.
	assertEquals(result, "unknown");
	assertEquals(mic.get().status, "unknown");
	assertEquals(mic.get().error?.code, MediaPermsErrorCode.NoDevice);
	mic.destroy();
});

Deno.test("B4: OverconstrainedError surfaces NO_DEVICE error code", async () => {
	const cam = createMediaPerms("camera", {
		platform: "browser",
		adapter: adapterRejecting("OverconstrainedError"),
	});
	await cam.request();
	assertEquals(cam.get().error?.code, MediaPermsErrorCode.NoDevice);
	cam.destroy();
});

Deno.test("B4: SecurityError surfaces INSECURE_CONTEXT error code", async () => {
	const mic = createMediaPerms("microphone", {
		platform: "browser",
		adapter: adapterRejecting("SecurityError"),
	});
	await mic.request();
	assertEquals(mic.get().error?.code, MediaPermsErrorCode.InsecureContext);
	mic.destroy();
});

Deno.test("B4: NotReadableError surfaces DEVICE_BUSY error code", async () => {
	const mic = createMediaPerms("microphone", {
		platform: "browser",
		adapter: adapterRejecting("NotReadableError"),
	});
	await mic.request();
	assertEquals(mic.get().error?.code, MediaPermsErrorCode.DeviceBusy);
	mic.destroy();
});

Deno.test("B4: unknown DOMException falls back to REQUEST_FAILED", async () => {
	const mic = createMediaPerms("microphone", {
		platform: "browser",
		adapter: adapterRejecting("AbortError"),
	});
	await mic.request();
	assertEquals(mic.get().error?.code, MediaPermsErrorCode.RequestFailed);
	mic.destroy();
});

Deno.test("B4: combined-kind device error preserves per-device statuses", async () => {
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter: adapterRejecting("NotFoundError"),
	});
	const result = await both.request();
	assertEquals(result, "unknown");
	assertEquals(both.get().devices.camera?.status, "unknown");
	assertEquals(both.get().devices.microphone?.status, "unknown");
	assertEquals(both.get().error?.code, MediaPermsErrorCode.NoDevice);
	both.destroy();
});

// ---------------------------------------------------------------------------
// B5 — lastCheckedAt only advances when the API returned a value
// ---------------------------------------------------------------------------

Deno.test("B5: check() with unsupported Permissions API does not advance lastCheckedAt", async () => {
	const mic = createMediaPerms("microphone", {
		platform: "browser",
		adapter: createMockAdapter({ supportsPermissions: false }),
	});
	assertEquals(mic.get().lastCheckedAt, null);
	await mic.check();
	assertEquals(mic.get().lastCheckedAt, null);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// D3 — reset() clears sticky denial, error, and lastCheckedAt
// ---------------------------------------------------------------------------

Deno.test("D3: reset() clears observedDenied, error, status, and lastCheckedAt", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	await mic.request();
	assertEquals(mic.get().status, "denied");
	assertEquals(mic.get().observedDenied, true);
	assertEquals(typeof mic.get().lastCheckedAt, "number");
	mic.reset();
	assertEquals(mic.get().status, "unknown");
	assertEquals(mic.get().observedDenied, false);
	assertEquals(mic.get().error, null);
	assertEquals(mic.get().lastCheckedAt, null);
	// After reset, lying "prompt" is no longer coerced to denied.
	adapter.setQueryResult("microphone", "prompt");
	const checked = await mic.check();
	assertEquals(checked, "prompt");
	mic.destroy();
});

Deno.test("D3: reset() resets every device of the combined kind", async () => {
	const adapter = createMockAdapter({ requestResult: "denied" });
	adapter.setAllQueryResults("prompt");
	const both = createMediaPerms("camera-and-microphone", {
		platform: "browser",
		adapter,
	});
	await both.request();
	assertEquals(both.get().devices.camera?.observedDenied, true);
	assertEquals(both.get().devices.microphone?.observedDenied, true);
	both.reset();
	assertEquals(both.get().devices.camera, {
		status: "unknown",
		observedDenied: false,
	});
	assertEquals(both.get().devices.microphone, {
		status: "unknown",
		observedDenied: false,
	});
	assertEquals(both.get().status, "unknown");
	both.destroy();
});

Deno.test("D3: reset() is a no-op after destroy", () => {
	const mic = createMediaPerms("microphone", { adapter: createMockAdapter() });
	mic.destroy();
	mic.reset();
	mic.reset();
	// no throw — passes
});

// ---------------------------------------------------------------------------
// D4 — post-destroy check()/request() warn instead of silently no-op'ing
// ---------------------------------------------------------------------------

Deno.test("D4: post-destroy check()/request() log warnings", async () => {
	const warnCalls: unknown[][] = [];
	const mic = createMediaPerms("microphone", {
		adapter: createMockAdapter(),
		logger: {
			debug: () => {},
			warn: (...args) => warnCalls.push(args),
			error: () => {},
		},
	});
	mic.destroy();
	await mic.check();
	await mic.request();
	assertEquals(warnCalls.length, 2);
});

// ---------------------------------------------------------------------------
// I1 — pageshow with persisted=true triggers check
// ---------------------------------------------------------------------------

Deno.test("I1: pageshow with persisted=true triggers passive check", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({ initialState: "granted" });
		const mic = createMediaPerms("microphone", {
			platform: "browser",
			adapter,
		});
		const queriesBefore = adapter.queryCallCount;
		await new Promise((r) => setTimeout(r, 600));
		const event = new Event("pageshow");
		Object.defineProperty(event, "persisted", { value: true });
		_g.dispatchEvent(event);
		await waitMicrotasks();
		await new Promise((r) => setTimeout(r, 10));
		if (adapter.queryCallCount <= queriesBefore) {
			throw new Error("expected pageshow to trigger check()");
		}
		mic.destroy();
	} finally {
		fake.restore();
	}
});

Deno.test("I1: pageshow without persisted does NOT trigger passive check", async () => {
	const fake = installFakeDocument("visible");
	try {
		const adapter = createMockAdapter({ initialState: "granted" });
		const mic = createMediaPerms("microphone", {
			platform: "browser",
			adapter,
		});
		const queriesBefore = adapter.queryCallCount;
		await new Promise((r) => setTimeout(r, 600));
		_g.dispatchEvent(new Event("pageshow"));
		await waitMicrotasks();
		await new Promise((r) => setTimeout(r, 10));
		assertEquals(adapter.queryCallCount, queriesBefore);
		mic.destroy();
	} finally {
		fake.restore();
	}
});

// ---------------------------------------------------------------------------
// I3 — observedDenied is exposed in state
// ---------------------------------------------------------------------------

Deno.test("I3: observedDenied reflects denial observations", async () => {
	const adapter = createMockAdapter({
		initialState: "prompt",
		requestResult: "denied",
	});
	const mic = createMediaPerms("microphone", { platform: "browser", adapter });
	assertEquals(mic.get().observedDenied, false);
	await mic.request();
	assertEquals(mic.get().observedDenied, true);
	adapter.setQueryResult("microphone", "granted");
	await mic.check();
	assertEquals(mic.get().observedDenied, false);
	mic.destroy();
});

// ---------------------------------------------------------------------------
// openSettings() bridge call clears sticky denial (iOS path)
// ---------------------------------------------------------------------------

Deno.test("openSettings() (iOS bridge) clears sticky denial and posts message", async () => {
	const calls: unknown[] = [];
	const prevWebkit = _g.webkit;
	_g.webkit = {
		messageHandlers: {
			openAppSettings: {
				postMessage: (msg: unknown) => calls.push(msg),
			},
		},
	};
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		const mic = createMediaPerms("microphone", {
			platform: "ios-webview",
			adapter,
		});
		await mic.request();
		assertEquals(mic.get().observedDenied, true);
		assertEquals(mic.get().canOpenSettings, true);
		const opened = mic.openSettings();
		assertEquals(opened, true);
		assertEquals(calls.length, 1);
		assertEquals(mic.get().observedDenied, false);
		mic.destroy();
	} finally {
		_g.webkit = prevWebkit;
	}
});

Deno.test("openSettings() (Android bridge) clears sticky denial and calls method", async () => {
	let called = 0;
	const prevAndroid = _g.Android;
	_g.Android = { openAppSettings: () => called++ };
	try {
		const adapter = createMockAdapter({
			initialState: "prompt",
			requestResult: "denied",
		});
		const mic = createMediaPerms("microphone", {
			platform: "android-webview",
			adapter,
		});
		await mic.request();
		assertEquals(mic.get().observedDenied, true);
		assertEquals(mic.openSettings(), true);
		assertEquals(called, 1);
		assertEquals(mic.get().observedDenied, false);
		mic.destroy();
	} finally {
		_g.Android = prevAndroid;
	}
});

Deno.test("openSettings() clears sticky denial for every device (combined kind)", async () => {
	let called = 0;
	const prevAndroid = _g.Android;
	_g.Android = { openAppSettings: () => called++ };
	try {
		const adapter = createMockAdapter({ requestResult: "denied" });
		adapter.setAllQueryResults("prompt");
		const both = createMediaPerms("camera-and-microphone", {
			platform: "android-webview",
			adapter,
		});
		await both.request();
		assertEquals(both.get().devices.camera?.observedDenied, true);
		assertEquals(both.get().devices.microphone?.observedDenied, true);
		assertEquals(both.openSettings(), true);
		assertEquals(called, 1);
		assertEquals(both.get().devices.camera?.observedDenied, false);
		assertEquals(both.get().devices.microphone?.observedDenied, false);
		assertEquals(both.get().observedDenied, false);
		both.destroy();
	} finally {
		_g.Android = prevAndroid;
	}
});
