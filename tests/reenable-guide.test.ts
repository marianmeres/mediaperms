import { assert, assertEquals, assertThrows } from "@std/assert";
import type { MediaPermsKind } from "../src/mediaperms.ts";
import {
	createReenableGuideController,
	defaultStepsFor,
	REENABLE_GUIDE_LANGS,
	type ReenableGuideFlavor,
	type ReenableGuideStep,
	type ReenableGuideStepsBuilderContext,
} from "../src/reenable-guide.ts";

const STEPS: ReenableGuideStep[] = [
	{ text: "one" },
	{ text: "two" },
	{ text: "three" },
];

const ALL_KINDS: readonly MediaPermsKind[] = [
	"microphone",
	"camera",
	"camera-and-microphone",
];

const ALL_FLAVORS: readonly ReenableGuideFlavor[] = [
	"ios-safari",
	"android-chrome",
	"desktop",
	"ios-webview",
	"android-webview",
	"ios-pwa",
	"android-pwa",
];

Deno.test("controller: resolves config + initial snapshot", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	const s = c.get();
	assertEquals(s.kind, "microphone");
	assertEquals(s.index, 0);
	assertEquals(s.total, 3);
	assert(s.isFirst);
	assert(!s.isLast);
	assertEquals(s.flavor, "desktop");
	assertEquals(s.lang, "en");
	assertEquals(s.step.text, "one");
	assert(!s.hasOpenSettingsCta);
});

Deno.test("controller: missing/invalid kind throws", () => {
	assertThrows(() =>
		// deno-lint-ignore no-explicit-any
		createReenableGuideController({ flavor: "desktop", lang: "en" } as any)
	);
	assertThrows(() =>
		createReenableGuideController({
			kind: "webcam" as MediaPermsKind,
			flavor: "desktop",
			lang: "en",
		})
	);
});

Deno.test("controller: next/back/goto clamp", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	c.back();
	assertEquals(c.index, 0); // clamp low
	c.next();
	assertEquals(c.index, 1);
	c.next();
	c.next();
	assertEquals(c.index, 2); // clamp high
	assert(c.get().isLast);
	c.goto(0);
	assertEquals(c.index, 0);
	c.goto(99);
	assertEquals(c.index, 2);
});

Deno.test("controller: subscribe fires immediately, on change, never after unsub", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	const seen: number[] = [];
	const unsub = c.subscribe((s) => seen.push(s.index));
	assertEquals(seen, [0]); // immediate
	c.next();
	assertEquals(seen, [0, 1]);
	c.goto(1); // no actual change → no fire
	assertEquals(seen, [0, 1]);
	unsub();
	c.next();
	assertEquals(seen, [0, 1]); // silent after unsub
});

Deno.test("controller: done/openSettings invoke callbacks + settings CTA flag", () => {
	let done = 0;
	let settings = 0;
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "ios-webview",
		lang: "en",
		steps: STEPS,
		onDone: () => done++,
		onOpenSettings: () => settings++,
	});
	// ios-webview + onOpenSettings → CTA applies
	assert(c.get().hasOpenSettingsCta);
	c.done();
	assertEquals(done, 1);
	c.openSettings();
	assertEquals(settings, 1);
});

Deno.test("controller: settings CTA requires the onOpenSettings callback", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "ios-webview",
		lang: "en",
		steps: STEPS,
	});
	assert(!c.get().hasOpenSettingsCta);
});

Deno.test("controller: generates default steps when none provided", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
	});
	const s = c.get();
	assertEquals(s.total, 3); // desktop ships 3 default steps
	assert(s.title.length > 0);
	assert(typeof s.step.art === "string");
});

Deno.test("controller: empty steps throws", () => {
	let threw = false;
	try {
		createReenableGuideController({
			kind: "microphone",
			flavor: "desktop",
			lang: "en",
			steps: [],
		});
	} catch {
		threw = true;
	}
	assert(threw);
});

Deno.test("controller: destroy stops notifications", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: STEPS,
	});
	const seen: number[] = [];
	c.subscribe((s) => seen.push(s.index));
	c.destroy();
	c.next();
	assertEquals(seen, [0]); // only the immediate fire; destroy() froze it
});

// ---------------------------------------------------------------------------
// Kind-aware copy — device labels, pronouns, headers, exhaustive resolution.
// ---------------------------------------------------------------------------

Deno.test("defaultStepsFor: microphone copy names the Microphone", () => {
	const en = defaultStepsFor("microphone", "desktop", "en");
	assert(en[1].text.includes("<b>Microphone</b>"));
	assert(!en[1].text.includes("Camera"));
	const sk = defaultStepsFor("microphone", "desktop", "sk");
	assert(sk[1].text.includes("<b>Mikrofón</b>"));
});

Deno.test("defaultStepsFor: camera copy names the Camera", () => {
	const en = defaultStepsFor("camera", "desktop", "en");
	assert(en[1].text.includes("<b>Camera</b>"));
	assert(!en[1].text.includes("Microphone"));
	const sk = defaultStepsFor("camera", "desktop", "sk");
	// Slovak accusative
	assert(sk[1].text.includes("<b>Kameru</b>"));
});

Deno.test("defaultStepsFor: combined copy names both devices", () => {
	const en = defaultStepsFor("camera-and-microphone", "desktop", "en");
	assert(en[1].text.includes("<b>Camera</b> and <b>Microphone</b>"));
	const sk = defaultStepsFor("camera-and-microphone", "desktop", "sk");
	assert(sk[1].text.includes("<b>Kameru</b> a <b>Mikrofón</b>"));
});

Deno.test("defaultStepsFor: pronoun agrees with kind and language", () => {
	// desktop's last step uses the pronoun
	assert(
		defaultStepsFor("microphone", "desktop", "en")[2].text
			.includes("Set it to"),
	);
	assert(
		defaultStepsFor("camera-and-microphone", "desktop", "en")[2].text
			.includes("Set them to"),
	);
	// Slovak: gender (ho = mikrofón, ju = kamera) and number (ich)
	assert(
		defaultStepsFor("microphone", "desktop", "sk")[2].text
			.includes("Nastavte ho na"),
	);
	assert(
		defaultStepsFor("camera", "desktop", "sk")[2].text
			.includes("Nastavte ju na"),
	);
	assert(
		defaultStepsFor("camera-and-microphone", "desktop", "sk")[2].text
			.includes("Nastavte ich na"),
	);
});

Deno.test("defaultStepsFor: no unresolved {tokens} in any kind × flavor × lang", () => {
	for (const kind of ALL_KINDS) {
		for (const flavor of ALL_FLAVORS) {
			for (const lang of REENABLE_GUIDE_LANGS) {
				for (const step of defaultStepsFor(kind, flavor, lang)) {
					assert(
						!step.text.includes("{"),
						`unresolved token in ${kind}/${flavor}/${lang}: ${step.text}`,
					);
					assert(step.text.length > 0);
				}
			}
		}
	}
});

Deno.test("defaultStepsFor: art is kind-agnostic (same SVG across kinds)", () => {
	const mic = defaultStepsFor("microphone", "desktop", "en");
	const cam = defaultStepsFor("camera", "desktop", "en");
	const both = defaultStepsFor("camera-and-microphone", "desktop", "en");
	assertEquals(mic[0].art, cam[0].art);
	assertEquals(mic[0].art, both[0].art);
});

Deno.test("controller: title/subtitle reflect the kind", () => {
	const mic = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
	}).get();
	assertEquals(mic.title, "Re-enable the microphone");

	const cam = createReenableGuideController({
		kind: "camera",
		flavor: "desktop",
		lang: "en",
	}).get();
	assertEquals(cam.title, "Re-enable the camera");
	assert(cam.subtitle.startsWith("Camera access is off."));

	const bothSk = createReenableGuideController({
		kind: "camera-and-microphone",
		flavor: "desktop",
		lang: "sk",
	}).get();
	assertEquals(bothSk.title, "Povoliť kameru a mikrofón");
	assert(bothSk.subtitle.includes("ku kamere a mikrofónu"));
});

// ---------------------------------------------------------------------------
// Per-flavor step text override — `steps` builder, `stepText` map, header
// builders, exported `defaultStepsFor`.
// ---------------------------------------------------------------------------

Deno.test("defaultStepsFor: returns built-in copy + art per flavor/lang", () => {
	const en = defaultStepsFor("microphone", "desktop", "en");
	assertEquals(en.length, 3); // desktop ships 3 steps
	assert(typeof en[0].art === "string");
	assert((en[0].art as string).includes("<svg"));
	assert(en[0].text.length > 0);

	// webview ships a different step count + art set
	assertEquals(defaultStepsFor("microphone", "ios-webview", "en").length, 2);

	// switching language changes the copy, never the art
	const sk = defaultStepsFor("microphone", "desktop", "sk");
	assertEquals(sk.length, 3);
	assertEquals(sk[0].art, en[0].art); // same art string
	assert(sk[0].text !== en[0].text); // different copy

	// a fresh array of fresh step objects is returned each call: mutating one
	// call's result must not leak into another (the documented mutate-safe
	// contract the `steps` builder relies on when consumers spread/edit).
	const a = defaultStepsFor("microphone", "desktop", "en");
	const b = defaultStepsFor("microphone", "desktop", "en");
	assert(a !== b); // distinct arrays
	assert(a[0] !== b[0]); // distinct step objects
	a[0].text = "MUTATED";
	assert(b[0].text !== "MUTATED"); // isolated
});

Deno.test("steps builder: overrides text, keeps built-in art", () => {
	let seenKind: string | undefined;
	let seenFlavor: string | undefined;
	let seenLang: string | undefined;
	let seenDefaultArt: unknown;
	const c = createReenableGuideController({
		kind: "camera",
		flavor: "desktop",
		lang: "en",
		steps: (ctx: ReenableGuideStepsBuilderContext) => {
			seenKind = ctx.kind;
			seenFlavor = ctx.flavor;
			seenLang = ctx.lang;
			seenDefaultArt = ctx.defaultSteps[0].art;
			return ctx.defaultSteps.map((s, i) => ({ ...s, text: `custom ${i}` }));
		},
	});
	const s = c.get();
	assertEquals(s.total, 3);
	assertEquals(s.steps.map((x) => x.text), ["custom 0", "custom 1", "custom 2"]);
	// art preserved from the defaults
	assertEquals(s.steps[0].art, defaultStepsFor("camera", "desktop", "en")[0].art);
	// ctx carried resolved values + art-bearing defaults
	assertEquals(seenKind, "camera");
	assertEquals(seenFlavor, "desktop");
	assertEquals(seenLang, "en");
	assert(typeof seenDefaultArt === "string");
});

Deno.test('steps builder: receives a concrete lang, never "auto"', () => {
	let seenLang: unknown;
	createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "auto",
		steps: (ctx) => {
			seenLang = ctx.lang;
			return ctx.defaultSteps;
		},
	});
	assert(seenLang === "en" || seenLang === "sk");
});

Deno.test("steps builder: branches on flavor (browser text vs webview defaults)", () => {
	const BROWSER = ["b0", "b1", "b2"];
	const isBrowser = (f: ReenableGuideFlavor) =>
		f === "desktop" || f === "ios-safari" || f === "android-chrome";
	const make = (flavor: ReenableGuideFlavor) =>
		createReenableGuideController({
			kind: "microphone",
			flavor,
			lang: "sk",
			steps: (ctx) =>
				isBrowser(ctx.flavor)
					? ctx.defaultSteps.map((s, i) => ({
						...s,
						text: BROWSER[i] ?? s.text,
					}))
					: ctx.defaultSteps,
		});
	// browser flavor → overridden text, art kept
	const d = make("desktop").get();
	assertEquals(d.steps.map((x) => x.text), ["b0", "b1", "b2"]);
	assert(typeof d.steps[0].art === "string");
	// webview flavor → library defaults untouched (different count + art)
	const w = make("ios-webview").get();
	assertEquals(w.total, 2);
	assertEquals(
		w.steps.map((x) => x.text),
		defaultStepsFor("microphone", "ios-webview", "sk").map((x) => x.text),
	);
});

Deno.test("steps builder: a changed step count drives total/last/clamp", () => {
	// grow: 3 desktop defaults → 4 steps
	const grown = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: (ctx) => [...ctx.defaultSteps, { text: "extra" }],
	});
	assertEquals(grown.get().total, 4);
	grown.goto(99);
	assertEquals(grown.index, 3); // clamps to the builder's count, not the defaults'
	assert(grown.get().isLast);
	assertEquals(grown.get().step.text, "extra");

	// shrink: 3 desktop defaults → 2 steps
	const shrunk = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: (ctx) => ctx.defaultSteps.slice(0, 2),
	});
	assertEquals(shrunk.get().total, 2);
	shrunk.goto(99);
	assertEquals(shrunk.index, 1);
	assert(shrunk.get().isLast);
});

Deno.test("steps array: full replace, no art injected", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: [{ text: "only" }],
	});
	const s = c.get();
	assertEquals(s.total, 1);
	assertEquals(s.step.text, "only");
	assertEquals(s.step.art, undefined); // array form does NOT inject art
});

Deno.test("steps builder: returning an empty array throws", () => {
	let threw = false;
	try {
		createReenableGuideController({
			kind: "microphone",
			flavor: "desktop",
			lang: "en",
			steps: () => [],
		});
	} catch {
		threw = true;
	}
	assert(threw);
});

Deno.test("steps builder: returning a non-array throws", () => {
	let threw = false;
	try {
		createReenableGuideController({
			kind: "microphone",
			flavor: "desktop",
			lang: "en",
			// deno-lint-ignore no-explicit-any
			steps: (() => null) as any,
		});
	} catch {
		threw = true;
	}
	assert(threw);
});

Deno.test("stepText: merges text by index, preserves art, null/undefined keeps default", () => {
	const defaults = defaultStepsFor("microphone", "desktop", "en");
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		stepText: { desktop: ["brand 0", null, undefined] },
	});
	const s = c.get();
	assertEquals(s.total, 3);
	assertEquals(s.steps[0].text, "brand 0");
	assertEquals(s.steps[1].text, defaults[1].text); // null → keep
	assertEquals(s.steps[2].text, defaults[2].text); // undefined → keep
	// art always preserved
	assertEquals(s.steps[0].art, defaults[0].art);
	assertEquals(s.steps[1].art, defaults[1].art);
});

Deno.test("stepText: extra entries past the default count are clamped", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "ios-webview", // 2 default steps
		lang: "en",
		stepText: { "ios-webview": ["a", "b", "c", "d"] },
	});
	const s = c.get();
	assertEquals(s.total, 2); // clamped to the default count
	assertEquals(s.steps.map((x) => x.text), ["a", "b"]);
});

Deno.test("stepText: a missing flavor key leaves defaults untouched", () => {
	const defaults = defaultStepsFor("microphone", "desktop", "en");
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		stepText: { "ios-safari": ["x", "y", "z"] }, // not the active flavor
	});
	assertEquals(
		c.get().steps.map((x) => x.text),
		defaults.map((x) => x.text),
	);
});

Deno.test("steps wins over stepText when both are provided", () => {
	// array form
	const a = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: [{ text: "from steps" }],
		stepText: { desktop: ["from stepText", "x", "y"] },
	});
	assertEquals(a.get().total, 1);
	assertEquals(a.get().step.text, "from steps");
	// builder form
	const b = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		steps: (ctx) => ctx.defaultSteps.map((s) => ({ ...s, text: "B" })),
		stepText: { desktop: ["from stepText", "x", "y"] },
	});
	assertEquals(b.get().steps.map((x) => x.text), ["B", "B", "B"]);
});

Deno.test("title/subtitle builders: kind- and flavor-aware + receive defaultText", () => {
	let seenDefault: string | undefined;
	const c = createReenableGuideController({
		kind: "camera",
		flavor: "android-webview",
		lang: "en",
		title: (ctx) => `T:${ctx.kind}:${ctx.flavor}`,
		subtitle: (ctx) => {
			seenDefault = ctx.defaultText;
			return `S:${ctx.lang}`;
		},
	});
	const s = c.get();
	assertEquals(s.title, "T:camera:android-webview");
	assertEquals(s.subtitle, "S:en");
	// defaultText is the built-in kind-specific chrome subtitle
	assert(typeof seenDefault === "string" && seenDefault.startsWith("Camera"));
});

Deno.test("title string: plain override still wins over the translation", () => {
	const c = createReenableGuideController({
		kind: "microphone",
		flavor: "desktop",
		lang: "en",
		title: "Custom Title",
	});
	assertEquals(c.get().title, "Custom Title");
});
