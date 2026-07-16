import {
	detectPlatform,
	devicesForKind,
	type MediaPermsKind,
	type MediaPlatformContext,
} from "./mediaperms.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * UI flavor — more specific than {@linkcode MediaPlatformContext}. Splits
 * `browser` and `pwa` into iOS/Android/desktop buckets so the step copy can
 * reflect the actual OS the user is looking at.
 */
export type ReenableGuideFlavor =
	| "ios-safari"
	| "android-chrome"
	| "desktop"
	| "ios-webview"
	| "android-webview"
	| "ios-pwa"
	| "android-pwa";

/**
 * Built-in language codes for the guide. More can be added later without a
 * breaking change.
 */
export type ReenableGuideLang = "en" | "sk";

/** All language codes the guide ships translations for. */
export const REENABLE_GUIDE_LANGS: readonly ReenableGuideLang[] = [
	"en",
	"sk",
];

/** A single tutorial step. */
export interface ReenableGuideStep {
	/** Step copy. HTML allowed — treated as trusted (consumer-supplied). */
	text: string;
	/** Optional illustration. Either inline SVG markup or an SVG element. */
	art?: string | SVGElement;
}

/**
 * Context handed to a {@linkcode ReenableGuideStepsInput} builder. Lets you
 * transform the library's resolved default steps instead of replacing them —
 * the canonical "override the text, keep the built-in art" hook.
 */
export interface ReenableGuideStepsBuilderContext {
	/** The media kind the guide was created for. */
	kind: MediaPermsKind;
	/** Resolved flavor (never undefined). */
	flavor: ReenableGuideFlavor;
	/** Resolved language — already concrete, never `"auto"`. */
	lang: ReenableGuideLang;
	/**
	 * The library's default steps for this `kind` + `flavor` + `lang`, with
	 * both the built-in copy **and** art already resolved. Map over these to
	 * keep the art while overriding `text`.
	 */
	defaultSteps: ReenableGuideStep[];
}

/**
 * The `steps` option. Either:
 *
 * - a literal {@linkcode ReenableGuideStep} list — a **full replace** of
 *   both text and art, or
 * - a **builder** `(ctx) => ReenableGuideStep[]` called with the resolved
 *   {@linkcode ReenableGuideStepsBuilderContext} (whose `defaultSteps`
 *   carry the built-in art), so you can override only the text per flavor
 *   without copying any SVG.
 */
export type ReenableGuideStepsInput =
	| ReenableGuideStep[]
	| ((ctx: ReenableGuideStepsBuilderContext) => ReenableGuideStep[]);

/**
 * Declarative per-flavor **text** override. Each entry is merged by index over
 * the resolved default steps; the built-in **art is always preserved**.
 * `null` / `undefined` / a missing index keeps the default copy, and entries
 * past the flavor's default step count are ignored (clamped). Lang-agnostic —
 * supply strings in whatever language you set. For multi-language consumers
 * prefer the {@linkcode ReenableGuideStepsInput} builder.
 */
export type ReenableGuideStepTextOverride = Partial<
	Record<ReenableGuideFlavor, readonly (string | null | undefined)[]>
>;

/** Context handed to a {@linkcode ReenableGuideTextInput} builder. */
export interface ReenableGuideTextBuilderContext {
	/** The media kind the guide was created for. */
	kind: MediaPermsKind;
	/** Resolved flavor (never undefined). */
	flavor: ReenableGuideFlavor;
	/** Resolved language — already concrete, never `"auto"`. */
	lang: ReenableGuideLang;
	/** The library's default copy for this field (the resolved translation). */
	defaultText: string;
}

/**
 * A header-copy option (`title` / `subtitle`). Either a plain string or a
 * **builder** `(ctx) => string` called with the resolved
 * {@linkcode ReenableGuideTextBuilderContext} for flavor-aware wording.
 */
export type ReenableGuideTextInput =
	| string
	| ((ctx: ReenableGuideTextBuilderContext) => string);

// ---------------------------------------------------------------------------
// Slot types — vanilla equivalent of Svelte snippets / React render props.
// Each slot is `(ctx) => Node | string | void`. Returning a Node mounts it
// as-is, a string is rendered as trusted HTML (matches `step.text`'s
// contract), and nothing (`void` / `undefined` / `null`) falls back to the
// built-in chrome. Slots are called on every render, so they re-run on
// step changes.
// ---------------------------------------------------------------------------

/** Context passed to all slots. */
export interface ReenableGuideRenderContext {
	/** The media kind the guide was created for. */
	kind: MediaPermsKind;
	/** 0-based current step index. */
	index: number;
	/** Total number of steps. */
	total: number;
	isFirst: boolean;
	isLast: boolean;
	/** The current step (text + art). */
	step: ReenableGuideStep;
	flavor: ReenableGuideFlavor;
	lang: ReenableGuideLang;
	title: string;
	subtitle: string;
	labels: {
		back: string;
		next: string;
		done: string;
		openSettings: string;
	};
	/** Whether the platform-specific "Open Settings" CTA applies on step 0. */
	hasOpenSettingsCta: boolean;
	/** Advance one step (clamped). */
	next(): void;
	/** Go back one step (clamped). */
	back(): void;
	/** Jump to a step (clamped). */
	goto(i: number): void;
	/** Fires `onDone`. */
	done(): void;
	/** Fires `onOpenSettings` (if provided). */
	openSettings(): void;
}

/** Context for the per-button slot. */
export interface ReenableGuideButtonContext extends ReenableGuideRenderContext {
	/** Which logical button this is. */
	role: "back" | "next" | "done" | "open-settings";
	/** Resolved label for this role. */
	label: string;
	/** Whether this button should be disabled (only `back` on step 0). */
	disabled: boolean;
	/** Pre-wired click handler — triggers the normal behavior for this role. */
	onClick(): void;
}

/** A slot returns markup, a node, or nothing (= use default). */
export type ReenableGuideSlot<
	C = ReenableGuideRenderContext,
> = (ctx: C) => Node | string | null | undefined | void;

/** Optional render overrides. Each is called on every render. */
export interface ReenableGuideSlots {
	/** Replace the title + subtitle block. */
	header?: ReenableGuideSlot;
	/** Replace the illustration. */
	art?: ReenableGuideSlot;
	/** Replace the step body (number + text). */
	step?: ReenableGuideSlot;
	/**
	 * Replace an individual button. Called once per visible button per render.
	 * Return `void` to keep the default chrome for that button only.
	 */
	button?: ReenableGuideSlot<ReenableGuideButtonContext>;
	/**
	 * Replace the entire footer (the row of buttons). When set, `button` is
	 * not consulted — you own the whole row.
	 */
	footer?: ReenableGuideSlot;
}

/** Configuration for {@linkcode createReenableGuide}. */
export interface ReenableGuideOptions {
	/**
	 * The media kind to explain. Required — decides the built-in copy
	 * ("Microphone", "Camera", or both).
	 */
	kind: MediaPermsKind;

	/** Parent element. Required — the guide is appended to this node. */
	container: HTMLElement;

	/**
	 * Override {@linkcode MediaPlatformContext} detection (forwarded to
	 * {@linkcode detectPlatform}).
	 */
	platform?: MediaPlatformContext;
	/**
	 * Override flavor detection directly. Takes precedence over
	 * {@linkcode ReenableGuideOptions.platform}.
	 */
	flavor?: ReenableGuideFlavor;

	/**
	 * Built-in translation to use. Defaults to `"auto"`, which reads the
	 * primary subtag of `navigator.language` and falls back to `"en"` if no
	 * built-in match is found. Explicit {@linkcode title} /
	 * {@linkcode subtitle} / {@linkcode labels} / {@linkcode steps} always
	 * override the picked translation.
	 */
	lang?: ReenableGuideLang | "auto";

	/**
	 * Step list. Either a literal array (full replace of text **and** art) or
	 * a builder `(ctx) => ReenableGuideStep[]` that transforms the resolved
	 * `ctx.defaultSteps` (which already carry the built-in art) — the
	 * zero-copy way to override only the text per flavor. Takes precedence
	 * over {@linkcode steps}'s declarative sibling {@linkcode stepText}.
	 * See {@linkcode ReenableGuideStepsInput}.
	 */
	steps?: ReenableGuideStepsInput;

	/**
	 * Declarative per-flavor text override, merged by index over the default
	 * steps (art always preserved). Convenience for the common
	 * single-language "just change the words" case; ignored when
	 * {@linkcode steps} is also set. See
	 * {@linkcode ReenableGuideStepTextOverride}.
	 */
	stepText?: ReenableGuideStepTextOverride;

	/**
	 * Override the header title. A string, or a builder `(ctx) => string` for
	 * flavor-aware copy. See {@linkcode ReenableGuideTextInput}.
	 */
	title?: ReenableGuideTextInput;
	/**
	 * Override the header subtitle. A string, or a builder `(ctx) => string`
	 * for flavor-aware copy. See {@linkcode ReenableGuideTextInput}.
	 */
	subtitle?: ReenableGuideTextInput;

	/**
	 * Theme. `"auto"` (default) reads
	 * `document.documentElement.classList.contains("dark")` on mount and
	 * reacts to live changes via a `MutationObserver`.
	 */
	theme?: "auto" | "light" | "dark";
	/** Accent color override (any CSS color). */
	accent?: string;

	/** Localized button labels. */
	labels?: {
		back?: string;
		next?: string;
		done?: string;
		openSettings?: string;
	};

	/**
	 * If provided, an "Open Settings" CTA is rendered on the first step
	 * for `ios-webview` / `android-webview` / `ios-pwa` / `android-pwa`
	 * flavors. Typically wired to `perms.openSettings()`.
	 */
	onOpenSettings?: () => void;
	/** Called when the user presses **Done** on the last step. */
	onDone?: () => void;

	/**
	 * Slot overrides — supply render functions for the regions you want to
	 * customize. Anything not provided falls back to the built-in chrome.
	 * See {@linkcode ReenableGuideSlots}.
	 */
	slots?: ReenableGuideSlots;
}

/** Public API returned by {@linkcode createReenableGuide}. */
export interface ReenableGuide {
	/** Root element (already appended to the configured container). */
	readonly el: HTMLElement;
	/** Current step index (0-based). */
	readonly index: number;
	/** Advance to the next step (no-op past the last step). */
	next(): void;
	/** Go back one step (no-op on the first step). */
	back(): void;
	/** Jump to a specific step. Clamps to `[0, steps.length - 1]`. */
	goto(i: number): void;
	/** Switch theme. */
	setTheme(theme: "auto" | "light" | "dark"): void;
	/**
	 * Remove the root from the DOM and disconnect the theme observer.
	 * Idempotent. The shared `<style>` tag is left in place.
	 */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Flavor detection
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

function isIOSUserAgent(ua: string): boolean {
	if (/iPad|iPhone|iPod/.test(ua)) return true;
	// iPadOS 13+ reports MacIntel — disambiguate via touch points.
	try {
		if (
			_g.navigator?.platform === "MacIntel" &&
			typeof _g.navigator?.maxTouchPoints === "number" &&
			_g.navigator.maxTouchPoints > 1
		) {
			return true;
		}
	} catch {
		// ignore
	}
	return false;
}

function isAndroidUserAgent(ua: string): boolean {
	return /android/i.test(ua);
}

/**
 * Resolve a {@linkcode ReenableGuideFlavor}. If `opts.flavor` is set, it
 * is returned as-is. Otherwise platform is resolved via
 * {@linkcode detectPlatform} and combined with a UA sniff to pick the right
 * bucket.
 */
export function detectFlavor(opts: {
	platform?: MediaPlatformContext;
	flavor?: ReenableGuideFlavor;
	userAgent?: string;
} = {}): ReenableGuideFlavor {
	if (opts.flavor) return opts.flavor;

	const platform = detectPlatform({ platform: opts.platform });
	const ua = opts.userAgent ?? (_g.navigator?.userAgent ?? "");

	if (platform === "ios-webview") return "ios-webview";
	if (platform === "android-webview") return "android-webview";

	const ios = isIOSUserAgent(ua);
	const android = isAndroidUserAgent(ua);

	if (platform === "pwa") {
		if (ios) return "ios-pwa";
		if (android) return "android-pwa";
		return "desktop";
	}

	// platform === "browser"
	if (ios) return "ios-safari";
	if (android) return "android-chrome";
	return "desktop";
}

// ---------------------------------------------------------------------------
// Default step content per flavor. The art is permission-generic (address
// bar, menu, toggle, gear) and shared by all kinds; only the copy carries
// the device noun, via the {device} / {pronoun} tokens below.
// ---------------------------------------------------------------------------

const ART = {
	addressbarIOS:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="40" y="58" width="240" height="42" rx="11" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="51" y="65" width="28" height="28" rx="7" fill="var(--mpg-accent-soft)"/>
			<rect x="58" y="71" width="14" height="16" rx="2.2" fill="none" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="61" y1="76" x2="69" y2="76" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
			<line x1="61" y1="80" x2="69" y2="80" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
			<line x1="61" y1="84" x2="66" y2="84" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
		</g>
		<rect x="92" y="73" width="158" height="12" rx="6" fill="var(--mpg-art-soft)"/>
		<g transform="translate(259 72) scale(0.875)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M65 62 L65 48" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="65" cy="46" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
	addressbarAndroid:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="40" y="58" width="240" height="42" rx="11" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="51" y="65" width="28" height="28" rx="7" fill="var(--mpg-accent-soft)"/>
			<line x1="57" y1="73" x2="73" y2="73" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="68" cy="73" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="57" y1="79" x2="73" y2="79" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="60" cy="79" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="57" y1="85" x2="73" y2="85" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="65" cy="85" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
		</g>
		<rect x="92" y="73" width="158" height="12" rx="6" fill="var(--mpg-art-soft)"/>
		<g transform="translate(259 72) scale(0.875)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M65 62 L65 48" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="65" cy="46" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
	addressbarDesktop:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="28" y="22" width="264" height="92" rx="10" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<line x1="28" y1="48" x2="292" y2="48" stroke="var(--mpg-line)"/>
		<circle cx="44" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<circle cx="58" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<circle cx="72" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<rect x="44" y="66" width="232" height="32" rx="8" fill="var(--mpg-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="52" y="72" width="24" height="20" rx="5" fill="var(--mpg-accent-soft)"/>
			<path d="M59 81 v-3 a5 5 0 0 1 10 0 v3" fill="none" stroke="var(--mpg-accent)" stroke-width="1.5"/>
			<rect x="57" y="81" width="14" height="9" rx="1.6" fill="var(--mpg-accent)"/>
		</g>
		<rect x="86" y="77" width="170" height="10" rx="5" fill="var(--mpg-art-soft)"/>
		<g transform="translate(260 76) scale(0.75)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M64 100 L64 118" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="64" cy="121" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
	menu:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="78" y="22" width="164" height="114" rx="14" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<rect x="94" y="40" width="100" height="9" rx="4.5" fill="var(--mpg-art-soft)"/>
		<rect x="94" y="66" width="120" height="9" rx="4.5" fill="var(--mpg-art-soft)"/>
		<rect x="86" y="86" width="148" height="30" rx="8" fill="var(--mpg-accent-soft)" class="mpg-pulse"/>
		<rect x="94" y="96" width="96" height="10" rx="5" fill="var(--mpg-accent)"/>
		<path d="M214 101l5 5 9-10" stroke="var(--mpg-accent)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`,
	toggle:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="58" y="56" width="204" height="46" rx="12" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<rect x="74" y="74" width="86" height="10" rx="5" fill="var(--mpg-fg)"/>
		<rect x="196" y="69" width="52" height="20" rx="10" fill="#34c759" class="mpg-pulse"/>
		<circle cx="238" cy="79" r="8.5" fill="#fff"/>
	</svg>`,
	gear:
		`<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="110" y="34" width="100" height="100" rx="22" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g transform="translate(160 84)">
			<g class="mpg-pulse">
				<path transform="scale(3.75) translate(-8 -8)" fill="var(--mpg-accent)" fill-rule="evenodd" d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
			</g>
		</g>
	</svg>`,
} as const;

// ---------------------------------------------------------------------------
// Default content tables — art, kind-specific tokens and translated step
// templates are kept separate so adding a language only means adding strings,
// not duplicating SVGs, and adding a kind only means adding token rows.
// ---------------------------------------------------------------------------

const FLAVOR_ART: Record<ReenableGuideFlavor, readonly string[]> = {
	"ios-safari": [ART.addressbarIOS, ART.menu, ART.toggle],
	"android-chrome": [ART.addressbarAndroid, ART.menu, ART.toggle],
	"desktop": [ART.addressbarDesktop, ART.menu, ART.toggle],
	"ios-webview": [ART.gear, ART.toggle],
	"android-webview": [ART.gear, ART.toggle],
	"ios-pwa": [ART.gear, ART.toggle],
	"android-pwa": [ART.gear, ART.menu, ART.toggle],
};

/**
 * The device noun as it appears in OS/browser settings lists, per kind —
 * substituted for the `{device}` token in step templates. Slovak forms are
 * accusative (every template uses the noun as a direct object).
 */
const DEVICE_LABELS: Record<
	ReenableGuideLang,
	Record<MediaPermsKind, string>
> = {
	en: {
		"microphone": "<b>Microphone</b>",
		"camera": "<b>Camera</b>",
		"camera-and-microphone": "<b>Camera</b> and <b>Microphone</b>",
	},
	sk: {
		"microphone": "<b>Mikrofón</b>",
		"camera": "<b>Kameru</b>",
		"camera-and-microphone": "<b>Kameru</b> a <b>Mikrofón</b>",
	},
};

/**
 * The pronoun referring back to `{device}` — substituted for the `{pronoun}`
 * token. Carries number (them/ich for the combined kind) and, in Slovak,
 * grammatical gender (ho = mikrofón, ju = kamera).
 */
const DEVICE_PRONOUNS: Record<
	ReenableGuideLang,
	Record<MediaPermsKind, string>
> = {
	en: {
		"microphone": "it",
		"camera": "it",
		"camera-and-microphone": "them",
	},
	sk: {
		"microphone": "ho",
		"camera": "ju",
		"camera-and-microphone": "ich",
	},
};

interface ChromeButtonTexts {
	back: string;
	next: string;
	done: string;
	openSettings: string;
}

const BUTTON_TEXTS: Record<ReenableGuideLang, ChromeButtonTexts> = {
	en: {
		back: "Back",
		next: "Next",
		done: "Done",
		openSettings: "Open Settings",
	},
	sk: {
		back: "Späť",
		next: "Ďalej",
		done: "Hotovo",
		openSettings: "Otvoriť nastavenia",
	},
};

const HEADER_TEXTS: Record<
	ReenableGuideLang,
	Record<MediaPermsKind, { title: string; subtitle: string }>
> = {
	en: {
		"microphone": {
			title: "Re-enable the microphone",
			subtitle:
				"Microphone access is off. A few quick taps in your device settings turns it back on.",
		},
		"camera": {
			title: "Re-enable the camera",
			subtitle:
				"Camera access is off. A few quick taps in your device settings turns it back on.",
		},
		"camera-and-microphone": {
			title: "Re-enable the camera & microphone",
			subtitle:
				"Camera and microphone access is off. A few quick taps in your device settings turns it back on.",
		},
	},
	sk: {
		"microphone": {
			title: "Povoliť mikrofón",
			subtitle:
				"Prístup k mikrofónu je vypnutý. Stačí pár klikov v nastaveniach zariadenia a znova ho zapnete.",
		},
		"camera": {
			title: "Povoliť kameru",
			subtitle:
				"Prístup ku kamere je vypnutý. Stačí pár klikov v nastaveniach zariadenia a znova ho zapnete.",
		},
		"camera-and-microphone": {
			title: "Povoliť kameru a mikrofón",
			subtitle:
				"Prístup ku kamere a mikrofónu je vypnutý. Stačí pár klikov v nastaveniach zariadenia a znova ho zapnete.",
		},
	},
};

/**
 * Per-flavor step copy templates. `{device}` / `{pronoun}` are replaced with
 * the kind-specific values from {@linkcode DEVICE_LABELS} /
 * {@linkcode DEVICE_PRONOUNS} at resolution time.
 */
const STEP_TEMPLATES: Record<
	ReenableGuideLang,
	Record<ReenableGuideFlavor, readonly string[]>
> = {
	en: {
		"ios-safari": [
			"Tap the <b>page settings</b> icon at the left of the address bar.",
			"Choose <b>Website Settings</b>.",
			"Set {device} to <b>Allow</b>, then reload the page.",
		],
		"android-chrome": [
			"Tap the <b>site info</b> icon at the left of the address bar.",
			"Open <b>Permissions</b>.",
			"Allow {device}, then reload the page.",
		],
		"desktop": [
			"Click the <b>site info</b> icon in the address bar.",
			"Find {device} in the permissions list.",
			"Set {pronoun} to <b>Allow</b>, then reload the page.",
		],
		"ios-webview": [
			"Open the <b>Settings</b> app.",
			"Find this app and turn {device} on.",
		],
		"android-webview": [
			"Open this app's <b>Settings</b>.",
			"Under <b>Permissions</b>, allow {device}.",
		],
		"ios-pwa": [
			"Open <b>Settings → Apps → [this app]</b>.",
			"Turn {device} on.",
		],
		"android-pwa": [
			"Open the device <b>Settings</b>.",
			"Go to <b>Apps → [this app] → Permissions</b>.",
			"Allow {device}.",
		],
	},
	sk: {
		"ios-safari": [
			"Ťuknite na ikonu <b>nastavení stránky</b> vľavo od adresového riadku.",
			"Zvoľte <b>Nastavenia webovej stránky</b>.",
			"Nastavte {device} na <b>Povoliť</b> a obnovte stránku.",
		],
		"android-chrome": [
			"Ťuknite na ikonu <b>info o stránke</b> vľavo od adresového riadku.",
			"Otvorte <b>Povolenia</b>.",
			"Povoľte {device} a obnovte stránku.",
		],
		"desktop": [
			"Kliknite na ikonu <b>info o stránke</b> v adresovom riadku.",
			"Nájdite {device} v zozname povolení.",
			"Nastavte {pronoun} na <b>Povoliť</b> a obnovte stránku.",
		],
		"ios-webview": [
			"Otvorte aplikáciu <b>Nastavenia</b>.",
			"Nájdite túto aplikáciu a zapnite {device}.",
		],
		"android-webview": [
			"Otvorte <b>Nastavenia</b> tejto aplikácie.",
			"V sekcii <b>Povolenia</b> povoľte {device}.",
		],
		"ios-pwa": [
			"Otvorte <b>Nastavenia → Aplikácie → [táto aplikácia]</b>.",
			"Zapnite {device}.",
		],
		"android-pwa": [
			"Otvorte <b>Nastavenia</b> zariadenia.",
			"Prejdite na <b>Aplikácie → [táto aplikácia] → Povolenia</b>.",
			"Povoľte {device}.",
		],
	},
};

function fillTokens(
	template: string,
	kind: MediaPermsKind,
	lang: ReenableGuideLang,
): string {
	return template
		.replaceAll("{device}", DEVICE_LABELS[lang][kind])
		.replaceAll("{pronoun}", DEVICE_PRONOUNS[lang][kind]);
}

/**
 * Resolve a {@linkcode ReenableGuideLang}. If `input` is an explicit
 * supported code, returns it. If `"auto"` or omitted, reads
 * `navigator.language`'s primary subtag and matches against the built-in
 * table. Falls back to `"en"`.
 */
function resolveLang(
	input?: ReenableGuideLang | "auto",
): ReenableGuideLang {
	if (input && input !== "auto") {
		return input in STEP_TEMPLATES ? input : "en";
	}
	try {
		const tag = (_g.navigator?.language ?? "en").toLowerCase();
		const primary = tag.split("-")[0];
		if (primary in STEP_TEMPLATES) return primary as ReenableGuideLang;
	} catch {
		// ignore
	}
	return "en";
}

/**
 * The library's built-in steps for a given kind + flavor + language — the
 * resolved default copy paired with the matching built-in art. This is what
 * the guide renders when no `steps` / `stepText` override is supplied, and
 * what a {@linkcode ReenableGuideStepsInput} builder receives as
 * `defaultSteps`.
 *
 * Exposed for fully-custom renderers (e.g. a native Svelte/React component on
 * top of {@linkcode createReenableGuideController}) that want the art +
 * copy for an arbitrary flavor without copying any SVG markup. `lang` must be
 * a concrete code (resolve `"auto"` via {@linkcode detectFlavor}'s companion
 * detection first — the controller does this for you).
 *
 * A fresh array of fresh step objects is returned on every call, so callers
 * may mutate the result freely.
 */
export function defaultStepsFor(
	kind: MediaPermsKind,
	flavor: ReenableGuideFlavor,
	lang: ReenableGuideLang,
): ReenableGuideStep[] {
	const arts = FLAVOR_ART[flavor];
	const texts = STEP_TEMPLATES[lang][flavor];
	return texts.map((text, i) => ({
		text: fillTokens(text, kind, lang),
		art: arts[i],
	}));
}

const FLAVORS_WITH_SETTINGS_CTA: ReadonlySet<ReenableGuideFlavor> = new Set([
	"ios-webview",
	"android-webview",
	"ios-pwa",
	"android-pwa",
]);

// ---------------------------------------------------------------------------
// Headless controller — the guide's state machine + resolved content, with
// NO DOM. This is the seam for fully-custom rendering: drive it from any
// framework (Svelte/React/Vue) or vanilla and own 100% of the markup. The
// built-in `createReenableGuide` chrome is itself just one consumer of it.
// ---------------------------------------------------------------------------

/** Options for {@linkcode createReenableGuideController}. */
export interface ReenableGuideControllerOptions {
	/** The media kind to explain. Required — decides the built-in copy. */
	kind: MediaPermsKind;
	/** Override {@linkcode MediaPlatformContext} detection. */
	platform?: MediaPlatformContext;
	/** Override flavor detection directly. Takes precedence over `platform`. */
	flavor?: ReenableGuideFlavor;
	/** Built-in translation to use. Defaults to `"auto"`. */
	lang?: ReenableGuideLang | "auto";
	/**
	 * Step list — a literal array (full replace) or a builder transforming the
	 * resolved `ctx.defaultSteps` (keeps the built-in art). Wins over
	 * {@linkcode stepText}. See {@linkcode ReenableGuideStepsInput}.
	 */
	steps?: ReenableGuideStepsInput;
	/**
	 * Declarative per-flavor text override, merged by index over the defaults
	 * (art preserved). Ignored when {@linkcode steps} is set. See
	 * {@linkcode ReenableGuideStepTextOverride}.
	 */
	stepText?: ReenableGuideStepTextOverride;
	/** Override the header title (string or `(ctx) => string` builder). */
	title?: ReenableGuideTextInput;
	/** Override the header subtitle (string or `(ctx) => string` builder). */
	subtitle?: ReenableGuideTextInput;
	/** Localized button labels. */
	labels?: {
		back?: string;
		next?: string;
		done?: string;
		openSettings?: string;
	};
	/** Fired by {@linkcode ReenableGuideController.openSettings}. */
	onOpenSettings?: () => void;
	/** Fired by {@linkcode ReenableGuideController.done}. */
	onDone?: () => void;
}

/**
 * Immutable view-model snapshot. Carries both the reactive bits (`index`,
 * `isFirst`, `isLast`, `step`) and the resolved static config so a renderer
 * can read everything from one object.
 */
export interface ReenableGuideControllerState {
	/** The media kind the guide was created for. */
	kind: MediaPermsKind;
	/** 0-based current step index. */
	index: number;
	/** Total number of steps. */
	total: number;
	isFirst: boolean;
	isLast: boolean;
	/** The current step (text + art). */
	step: ReenableGuideStep;
	/** All resolved steps. */
	steps: readonly ReenableGuideStep[];
	flavor: ReenableGuideFlavor;
	lang: ReenableGuideLang;
	title: string;
	subtitle: string;
	labels: {
		back: string;
		next: string;
		done: string;
		openSettings: string;
	};
	/** Whether the platform-specific "Open Settings" CTA applies on step 0. */
	hasOpenSettingsCta: boolean;
}

/** Headless controller returned by {@linkcode createReenableGuideController}. */
export interface ReenableGuideController {
	/** Current step index (0-based). */
	readonly index: number;
	readonly kind: MediaPermsKind;
	readonly flavor: ReenableGuideFlavor;
	readonly lang: ReenableGuideLang;
	readonly steps: readonly ReenableGuideStep[];
	/** Current view-model snapshot. */
	get(): ReenableGuideControllerState;
	/** Advance one step (clamped). */
	next(): void;
	/** Go back one step (clamped). */
	back(): void;
	/** Jump to a step (clamped). */
	goto(i: number): void;
	/** Fire `onDone`. */
	done(): void;
	/** Fire `onOpenSettings` (if provided). */
	openSettings(): void;
	/**
	 * Svelte-compatible store contract: `run` is called immediately with the
	 * current snapshot and again after every step change. Returns an
	 * unsubscribe function.
	 */
	subscribe(
		run: (state: ReenableGuideControllerState) => void,
	): () => void;
	/** Drop all subscribers. Idempotent. */
	destroy(): void;
}

interface ResolvedGuideConfig {
	kind: MediaPermsKind;
	flavor: ReenableGuideFlavor;
	lang: ReenableGuideLang;
	steps: ReenableGuideStep[];
	title: string;
	subtitle: string;
	labels: { back: string; next: string; done: string; openSettings: string };
	showSettingsCta: boolean;
}

/**
 * Resolve the final step list from the raw `steps` / `stepText` options for an
 * already-resolved kind + flavor + lang. Precedence: a `steps` builder, then a
 * `steps` array (both a full replace), then the declarative `stepText` map
 * merged by index over the defaults (art preserved, extras clamped), then the
 * built-in defaults.
 */
function resolveSteps(
	opts: ReenableGuideControllerOptions,
	kind: MediaPermsKind,
	flavor: ReenableGuideFlavor,
	lang: ReenableGuideLang,
): ReenableGuideStep[] {
	// A `steps` builder/array wins over the declarative `stepText` map.
	if (typeof opts.steps === "function") {
		const out = opts.steps({
			kind,
			flavor,
			lang,
			defaultSteps: defaultStepsFor(kind, flavor, lang),
		});
		if (!Array.isArray(out)) {
			throw new Error(
				"createReenableGuide: `steps` builder must return an array",
			);
		}
		return out;
	}
	if (opts.steps !== undefined) return opts.steps;

	// Declarative per-flavor text override: merge by index over the defaults.
	// `null` / `undefined` / a missing index keeps the built-in copy; mapping
	// over `defaultSteps` naturally clamps any extra entries.
	const texts = opts.stepText?.[flavor];
	if (texts && texts.length) {
		return defaultStepsFor(kind, flavor, lang).map((step, i) => {
			const text = texts[i];
			return text == null ? step : { ...step, text };
		});
	}

	return defaultStepsFor(kind, flavor, lang);
}

/** Resolve a header-copy field (`title` / `subtitle`) — string or builder. */
function resolveText(
	input: ReenableGuideTextInput | undefined,
	kind: MediaPermsKind,
	flavor: ReenableGuideFlavor,
	lang: ReenableGuideLang,
	defaultText: string,
): string {
	if (typeof input === "function") {
		return input({ kind, flavor, lang, defaultText });
	}
	return input ?? defaultText;
}

/**
 * Resolve kind, flavor, language, step list, header copy, labels and the
 * settings-CTA flag from raw options. Shared by the controller and the
 * built-in DOM factory so resolution lives in exactly one place.
 */
function resolveGuideConfig(
	opts: ReenableGuideControllerOptions,
): ResolvedGuideConfig {
	const kind = opts.kind;
	devicesForKind(kind); // throws early on a missing/invalid kind
	const flavor = detectFlavor({
		platform: opts.platform,
		flavor: opts.flavor,
	});
	const lang = resolveLang(opts.lang);
	const header = HEADER_TEXTS[lang][kind];
	const buttons = BUTTON_TEXTS[lang];

	const steps = resolveSteps(opts, kind, flavor, lang);
	if (steps.length === 0) {
		throw new Error("createReenableGuide: `steps` must not be empty");
	}

	return {
		kind,
		flavor,
		lang,
		steps,
		title: resolveText(opts.title, kind, flavor, lang, header.title),
		subtitle: resolveText(opts.subtitle, kind, flavor, lang, header.subtitle),
		labels: {
			back: opts.labels?.back ?? buttons.back,
			next: opts.labels?.next ?? buttons.next,
			done: opts.labels?.done ?? buttons.done,
			openSettings: opts.labels?.openSettings ?? buttons.openSettings,
		},
		showSettingsCta: !!opts.onOpenSettings &&
			FLAVORS_WITH_SETTINGS_CTA.has(flavor),
	};
}

/**
 * Create the guide's headless state machine: same flavor detection, default
 * step content, i18n and step navigation as {@linkcode createReenableGuide}
 * — but with no DOM. Subscribe for a Svelte-compatible snapshot stream and
 * render the markup yourself.
 *
 * ```ts
 * const ctrl = createReenableGuideController({ kind: "camera", lang: "sk", onDone });
 * const unsub = ctrl.subscribe((s) => paint(s));
 * ctrl.next();
 * // ...later
 * unsub();
 * ```
 */
export function createReenableGuideController(
	opts: ReenableGuideControllerOptions,
): ReenableGuideController {
	const cfg = resolveGuideConfig(opts);
	const last = cfg.steps.length - 1;
	let i = 0;
	let destroyed = false;
	const subs = new Set<(s: ReenableGuideControllerState) => void>();

	function snapshot(): ReenableGuideControllerState {
		return {
			kind: cfg.kind,
			index: i,
			total: cfg.steps.length,
			isFirst: i === 0,
			isLast: i === last,
			step: cfg.steps[i],
			steps: cfg.steps,
			flavor: cfg.flavor,
			lang: cfg.lang,
			title: cfg.title,
			subtitle: cfg.subtitle,
			labels: cfg.labels,
			hasOpenSettingsCta: cfg.showSettingsCta,
		};
	}

	function setIndex(n: number): void {
		if (destroyed) return;
		const clamped = Math.max(0, Math.min(last, n | 0));
		if (clamped !== i) {
			i = clamped;
			const s = snapshot();
			for (const run of subs) run(s);
		}
	}

	return {
		get index() {
			return i;
		},
		get kind() {
			return cfg.kind;
		},
		get flavor() {
			return cfg.flavor;
		},
		get lang() {
			return cfg.lang;
		},
		get steps() {
			return cfg.steps;
		},
		get: snapshot,
		next() {
			setIndex(i + 1);
		},
		back() {
			setIndex(i - 1);
		},
		goto(n: number) {
			setIndex(n);
		},
		done() {
			opts.onDone?.();
		},
		openSettings() {
			opts.onOpenSettings?.();
		},
		subscribe(run) {
			run(snapshot());
			subs.add(run);
			return () => {
				subs.delete(run);
			};
		},
		destroy() {
			destroyed = true;
			subs.clear();
		},
	};
}

// ---------------------------------------------------------------------------
// Styles (injected once into document head). The `mpg` prefix ("media perms
// guide") intentionally matches @marianmeres/micperms' guide classes, so any
// CSS skin written for that package keeps working here.
// ---------------------------------------------------------------------------

const STYLE_ID = "mpg-styles";

const STYLE_CSS = `
.mpg {
	--mpg-bg: #ffffff;
	--mpg-fg: #1c1c1e;
	--mpg-muted: #8a8a8e;
	--mpg-accent: #007aff;
	--mpg-accent-soft: #007aff1a;
	--mpg-line: #e5e5ea;
	--mpg-art-bg: #f7f7fa;
	--mpg-art-soft: #e8e8ed;
	--mpg-radius: 16px;
	--mpg-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;

	width: 340px; max-width: 100%;
	background: var(--mpg-bg); color: var(--mpg-fg);
	border-radius: var(--mpg-radius);
	box-shadow: 0 12px 40px -8px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.04);
	overflow: hidden; font-family: var(--mpg-font);
	-webkit-font-smoothing: antialiased;
}
.mpg[data-theme="dark"] {
	--mpg-bg: #1c1c1e;
	--mpg-fg: #f2f2f7;
	--mpg-muted: #8e8e93;
	--mpg-line: #38383a;
	--mpg-art-bg: #2c2c2e;
	--mpg-art-soft: #3a3a3c;
	box-shadow: 0 12px 40px -8px rgba(0,0,0,.6), 0 0 0 .5px rgba(255,255,255,.06);
}
.mpg__head { padding: 20px 20px 4px; }
.mpg__title { font-size: 18px; font-weight: 600; letter-spacing: -.01em; margin: 0; }
.mpg__sub { font-size: 13.5px; color: var(--mpg-muted); margin: 6px 0 0; line-height: 1.45; }
.mpg__stage { padding: 14px 20px 4px; }
.mpg__art {
	height: 158px; border-radius: 12px; background: var(--mpg-art-bg);
	border: 1px solid var(--mpg-line); display: grid; place-items: center;
	overflow: hidden; position: relative;
}
.mpg__art svg { width: 100%; height: 100%; }
.mpg__step { padding: 14px 20px 4px; }
.mpg__step-default { display: flex; gap: 10px; align-items: flex-start; }
.mpg__num {
	flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%;
	background: var(--mpg-accent); color: #fff; font-size: 12.5px; font-weight: 600;
	display: grid; place-items: center; margin-top: 1px;
}
.mpg__text { font-size: 14.5px; line-height: 1.5; }
.mpg__text b { font-weight: 600; }
.mpg__dots { display: flex; gap: 6px; justify-content: center; padding: 14px 0 4px; }
.mpg__dot {
	width: 6px; height: 6px; border-radius: 50%; background: var(--mpg-line);
	transition: background .2s, width .2s;
}
.mpg__dot--on { background: var(--mpg-accent); width: 18px; border-radius: 3px; }
.mpg__foot { padding: 12px 20px 18px; }
.mpg__foot-default { display: flex; gap: 10px; }
.mpg__btn {
	flex: 1; height: 44px; border-radius: 11px; border: 0; cursor: pointer;
	font-family: inherit; font-size: 15px; font-weight: 600;
	transition: opacity .15s, transform .05s;
}
.mpg__btn:active { transform: scale(.985); }
.mpg__btn--ghost { background: transparent; color: var(--mpg-accent); }
.mpg__btn--ghost:disabled { color: var(--mpg-muted); opacity: .4; cursor: default; }
.mpg__btn--solid { background: var(--mpg-accent); color: #fff; }
.mpg-pulse {
	transform-box: fill-box; transform-origin: center;
	animation: mpgPulse 1.6s ease-in-out infinite;
}
@keyframes mpgPulse {
	0%, 100% { opacity: .35; transform: scale(1); }
	50% { opacity: 1; transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) {
	.mpg-pulse { animation: none; opacity: 1; }
}
`;

function ensureStyles(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE_CSS;
	document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a re-enable guide for the given media kind. Mounts a self-contained,
 * framework-agnostic multi-step tutorial into the configured container and
 * returns a handle for controlling it programmatically.
 *
 * Step copy auto-tailors to the `kind` and the detected
 * {@linkcode ReenableGuideFlavor} (override via `flavor` or `steps`). Theme
 * defaults to `"auto"` which mirrors
 * `document.documentElement.classList.contains("dark")` live.
 */
export function createReenableGuide(
	opts: ReenableGuideOptions,
): ReenableGuide {
	if (!opts?.container) {
		throw new Error(
			"createReenableGuide: `container` is required",
		);
	}
	if (typeof document === "undefined") {
		throw new Error(
			"createReenableGuide: requires a DOM environment",
		);
	}

	ensureStyles();

	// All resolution + navigation lives in the headless controller; this
	// factory is "just" its DOM renderer.
	const ctrl = createReenableGuideController({
		kind: opts.kind,
		platform: opts.platform,
		flavor: opts.flavor,
		lang: opts.lang,
		steps: opts.steps,
		stepText: opts.stepText,
		title: opts.title,
		subtitle: opts.subtitle,
		labels: opts.labels,
		onOpenSettings: opts.onOpenSettings,
		onDone: opts.onDone,
	});

	const { lang, steps } = ctrl;

	// --- build DOM ---

	const root = document.createElement("div");
	root.className = "mpg";
	root.lang = lang;
	if (opts.accent) root.style.setProperty("--mpg-accent", opts.accent);

	// Skeleton: each slot-able region is an empty host populated by the
	// render path (either a user slot or the built-in default).
	root.innerHTML = `
		<div class="mpg__head" data-head></div>
		<div class="mpg__stage"><div class="mpg__art" data-art></div></div>
		<div class="mpg__step" data-step></div>
		<div class="mpg__dots" data-dots></div>
		<div class="mpg__foot" data-foot></div>
	`;

	const $head = root.querySelector("[data-head]") as HTMLElement;
	const $art = root.querySelector("[data-art]") as HTMLElement;
	const $step = root.querySelector("[data-step]") as HTMLElement;
	const $dotsHost = root.querySelector("[data-dots]") as HTMLElement;
	const $foot = root.querySelector("[data-foot]") as HTMLElement;

	const dots = steps.map(() => {
		const d = document.createElement("span");
		d.className = "mpg__dot";
		$dotsHost.appendChild(d);
		return d;
	});

	const slots = opts.slots ?? {};

	let destroyed = false;
	let themeObserver: MutationObserver | null = null;

	function mountInto(
		host: HTMLElement,
		out: Node | string | null | undefined | void,
	): boolean {
		if (out == null) return false;
		host.replaceChildren();
		if (typeof out === "string") host.innerHTML = out;
		else host.appendChild(out as Node);
		return true;
	}

	function appendSlotOutput(host: HTMLElement, out: Node | string): void {
		if (typeof out === "string") {
			const tpl = document.createElement("template");
			tpl.innerHTML = out;
			host.appendChild(tpl.content);
		} else {
			host.appendChild(out);
		}
	}

	function buildCtx(): ReenableGuideRenderContext {
		// `...snap` carries kind/index/total/isFirst/isLast/step/flavor/lang/
		// title/subtitle/labels/hasOpenSettingsCta; navigation delegates to
		// the controller (which re-renders us via the subscription).
		const snap = ctrl.get();
		return {
			...snap,
			next() {
				if (destroyed) return;
				ctrl.next();
			},
			back() {
				if (destroyed) return;
				ctrl.back();
			},
			goto(n: number) {
				if (destroyed) return;
				ctrl.goto(n);
			},
			done() {
				ctrl.done();
			},
			openSettings() {
				ctrl.openSettings();
			},
		};
	}

	function renderHeader(ctx: ReenableGuideRenderContext): void {
		if (slots.header && mountInto($head, slots.header(ctx))) return;
		$head.replaceChildren();
		const h = document.createElement("h2");
		h.className = "mpg__title";
		h.textContent = ctx.title;
		const p = document.createElement("p");
		p.className = "mpg__sub";
		p.textContent = ctx.subtitle;
		$head.append(h, p);
	}

	function renderArt(ctx: ReenableGuideRenderContext): void {
		if (slots.art && mountInto($art, slots.art(ctx))) return;
		$art.replaceChildren();
		const art = ctx.step.art;
		if (!art) return;
		if (typeof art === "string") $art.innerHTML = art;
		else $art.appendChild(art);
	}

	function renderStep(ctx: ReenableGuideRenderContext): void {
		if (slots.step && mountInto($step, slots.step(ctx))) return;
		$step.replaceChildren();
		const wrap = document.createElement("div");
		wrap.className = "mpg__step-default";
		const num = document.createElement("div");
		num.className = "mpg__num";
		num.textContent = String(ctx.index + 1);
		const text = document.createElement("div");
		text.className = "mpg__text";
		text.innerHTML = ctx.step.text;
		wrap.append(num, text);
		$step.appendChild(wrap);
	}

	function buttonContexts(
		ctx: ReenableGuideRenderContext,
	): ReenableGuideButtonContext[] {
		const primaryRole: ReenableGuideButtonContext["role"] =
			ctx.hasOpenSettingsCta && ctx.isFirst
				? "open-settings"
				: ctx.isLast
				? "done"
				: "next";
		const primaryLabel = primaryRole === "open-settings"
			? ctx.labels.openSettings
			: primaryRole === "done"
			? ctx.labels.done
			: ctx.labels.next;
		const primaryClick = () => {
			if (destroyed) return;
			if (primaryRole === "open-settings") {
				ctx.openSettings();
				// advance so the user sees the next step
				ctx.next();
				return;
			}
			if (primaryRole === "done") {
				ctx.done();
				return;
			}
			ctx.next();
		};
		const backClick = () => {
			if (destroyed) return;
			ctx.back();
		};
		return [
			{
				...ctx,
				role: "back",
				label: ctx.labels.back,
				disabled: ctx.isFirst,
				onClick: backClick,
			},
			{
				...ctx,
				role: primaryRole,
				label: primaryLabel,
				disabled: false,
				onClick: primaryClick,
			},
		];
	}

	function renderDefaultButton(
		b: ReenableGuideButtonContext,
	): HTMLButtonElement {
		const el = document.createElement("button");
		el.type = "button";
		el.className = b.role === "back"
			? "mpg__btn mpg__btn--ghost"
			: "mpg__btn mpg__btn--solid";
		el.textContent = b.label;
		el.disabled = b.disabled;
		el.dataset.role = b.role;
		el.addEventListener("click", b.onClick);
		return el;
	}

	function renderFooter(ctx: ReenableGuideRenderContext): void {
		if (slots.footer && mountInto($foot, slots.footer(ctx))) return;
		$foot.replaceChildren();
		const wrap = document.createElement("div");
		wrap.className = "mpg__foot-default";
		for (const b of buttonContexts(ctx)) {
			if (slots.button) {
				const out = slots.button(b);
				if (out != null) {
					appendSlotOutput(wrap, out as Node | string);
					continue;
				}
			}
			wrap.appendChild(renderDefaultButton(b));
		}
		$foot.appendChild(wrap);
	}

	function render(): void {
		const ctx = buildCtx();
		renderHeader(ctx);
		renderArt(ctx);
		renderStep(ctx);
		dots.forEach((d, n) => d.classList.toggle("mpg__dot--on", n === ctx.index));
		renderFooter(ctx);
	}

	// --- theme ---

	function applyThemeAttr(isDark: boolean): void {
		root.dataset.theme = isDark ? "dark" : "light";
	}

	function resolveAuto(): boolean {
		try {
			return document.documentElement.classList.contains("dark");
		} catch {
			return false;
		}
	}

	function setTheme(theme: "auto" | "light" | "dark"): void {
		if (themeObserver) {
			themeObserver.disconnect();
			themeObserver = null;
		}
		if (theme === "auto") {
			applyThemeAttr(resolveAuto());
			if (typeof MutationObserver !== "undefined") {
				themeObserver = new MutationObserver(() => {
					applyThemeAttr(resolveAuto());
				});
				themeObserver.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["class"],
				});
			}
		} else {
			applyThemeAttr(theme === "dark");
		}
	}

	setTheme(opts.theme ?? "auto");
	// Subscribe fires immediately → initial render; later step changes
	// (via the API or button clicks) re-render through the same path.
	const unsubscribeCtrl = ctrl.subscribe(() => {
		if (!destroyed) render();
	});
	opts.container.appendChild(root);

	const api: ReenableGuide = {
		el: root,
		get index() {
			return ctrl.index;
		},
		next() {
			if (destroyed) return;
			ctrl.next();
		},
		back() {
			if (destroyed) return;
			ctrl.back();
		},
		goto(n: number) {
			if (destroyed) return;
			ctrl.goto(n);
		},
		setTheme,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			unsubscribeCtrl();
			ctrl.destroy();
			if (themeObserver) {
				themeObserver.disconnect();
				themeObserver = null;
			}
			if (root.parentNode) root.parentNode.removeChild(root);
		},
	};

	return api;
}
