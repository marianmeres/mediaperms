<!--
	Approach (a): reskin the BUILT-IN guide via slots + CSS.

	Works against the published @marianmeres/mediaperms — no library changes
	required. Reuses flavor detection, step count, navigation, dots and the
	lib's own SVG art; only the chrome (header/step/footer) + a CSS override
	are custom.

	Brand copy is supplied via a `steps` BUILDER, so the library's flavor-correct
	art comes for free (no SVG copied into this file) and WebView/PWA keep their
	own art + step count. The close button lives in the `header` slot (the skin
	sets `.mpg { position: relative }` so it can sit top-right).

	This file is reference material — the mediaperms repo itself has no Svelte
	build. Copy it into a Svelte 5 app (e.g. `src/lib/`).
-->
<script module lang="ts">
	const SKIN_ID = "mpg-skin-styles";
	const SKIN_CSS = `
.mpg-skin .mpg {
	width: 100%; max-width: 380px; position: relative;
	border-radius: 14px; border: 1px solid #e3e6ea;
	box-shadow: 0 1px 3px rgba(16,24,40,.06);
	font-family: "Inter", system-ui, -apple-system, sans-serif;
	--mpg-bg: #ffffff; --mpg-fg: #1d2433; --mpg-muted: #9aa1ad;
	--mpg-line: #e3e6ea; --mpg-art-bg: #f4f5f7; --mpg-art-soft: #dfe3e9;
	--mpg-accent-soft: color-mix(in srgb, var(--mpg-accent) 12%, transparent);
}
.mpg-skin .mpg__head { padding: 22px 22px 2px; }
.mpg-skin .skin-title { margin: 0; padding-right: 40px; font-size: 20px; font-weight: 700; letter-spacing: -.01em; color: var(--mpg-fg); }
.mpg-skin .skin-sub { margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: #5b6472; }
.mpg-skin .skin-sub b { font-weight: 700; color: var(--mpg-fg); }
.mpg-skin .skin-close { position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--mpg-accent); background: transparent; color: var(--mpg-accent); display: grid; place-items: center; cursor: pointer; padding: 0; line-height: 0; }
.mpg-skin .mpg__art { height: 150px; border-radius: 12px; }
.mpg-skin .mpg__step { padding: 16px 22px 2px; }
.mpg-skin .skin-caption { font-size: 14px; line-height: 1.55; color: #3b4350; }
.mpg-skin .skin-caption b { font-weight: 700; color: var(--mpg-fg); }
.mpg-skin .mpg__dots { padding: 18px 0 6px; gap: 7px; }
.mpg-skin .mpg__dot { width: 7px; height: 7px; border-radius: 50%; background: #cfd4db; transition: background .2s; }
.mpg-skin .mpg__dot--on { width: 7px; border-radius: 50%; background: #2b3240; }
.mpg-skin .mpg__foot { padding: 14px 22px 22px; }
.mpg-skin .skin-cta { width: 100%; height: 50px; border-radius: 10px; border: 1.5px solid var(--mpg-accent); background: transparent; color: var(--mpg-accent); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; transition: background .15s; }
.mpg-skin .skin-cta:hover { background: color-mix(in srgb, var(--mpg-accent) 8%, transparent); }
.mpg-skin .skin-cta:active { transform: scale(.99); }
`;

	function injectSkin(): void {
		if (typeof document === "undefined" || document.getElementById(SKIN_ID)) return;
		const style = document.createElement("style");
		style.id = SKIN_ID;
		style.textContent = SKIN_CSS;
		document.head.appendChild(style);
	}

	// Slovak brand copy for the BROWSER flow (address bar → menu → toggle).
	// WebView/PWA flavors deliberately keep the library's own copy + art below.
	const BROWSER_TEXTS_SK = [
		"Ťuknite na ikonu <b>Informácie</b> v riadku, kde sa zadáva webová adresa.",
		"Vyberte možnosť <b>Povolenia</b>.",
		"<b>Povoľte mikrofón</b> a obnovte stránku.",
	];

	const isBrowserFlavor = (f: string) =>
		f === "desktop" || f === "ios-safari" || f === "android-chrome";
</script>

<script lang="ts">
	import { onMount } from "svelte";
	import {
		createReenableGuide,
		type ReenableGuideRenderContext,
	} from "@marianmeres/mediaperms/reenable-guide";

	let {
		accent = "#0a7d54",
		onClose,
		onDone,
		onOpenSettings,
	}: {
		accent?: string;
		onClose?: () => void;
		onDone?: () => void;
		onOpenSettings?: () => void;
	} = $props();

	let host: HTMLDivElement;

	function header(ctx: ReenableGuideRenderContext): Node {
		const wrap = document.createElement("div");
		const close = document.createElement("button");
		close.type = "button";
		close.className = "skin-close";
		close.setAttribute("aria-label", "Zavrieť");
		close.innerHTML =
			`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
		close.addEventListener("click", () => onClose?.());

		const h = document.createElement("h2");
		h.className = "skin-title";
		h.textContent = ctx.title;

		const p = document.createElement("p");
		p.className = "skin-sub";
		// step.text is trusted HTML per the lib contract; subtitle is rendered
		// as HTML here only because this component supplies the copy itself
		// (the lib's built-in header escapes it).
		p.innerHTML = ctx.subtitle;

		wrap.append(close, h, p);
		return wrap;
	}

	function step(ctx: ReenableGuideRenderContext): string {
		// caption only — no number badge
		return `<div class="skin-caption">${ctx.step.text}</div>`;
	}

	function footer(ctx: ReenableGuideRenderContext): Node {
		const isSettings = ctx.hasOpenSettingsCta && ctx.isFirst;
		const label = isSettings
			? ctx.labels.openSettings
			: ctx.isLast
				? ctx.labels.done
				: ctx.labels.next;

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "skin-cta";
		btn.textContent = label;
		btn.addEventListener("click", () => {
			if (isSettings) {
				ctx.openSettings();
				ctx.next();
			} else if (ctx.isLast) {
				ctx.done();
			} else {
				ctx.next();
			}
		});
		return btn;
	}

	onMount(() => {
		injectSkin();
		const guide = createReenableGuide({
			kind: "microphone",
			container: host,
			accent,
			// The skin is a fixed light brand card (hardcoded white bg + dark
			// gray text), so pin the theme: with the default "auto", a
			// `html.dark` host would flip the lib's `.mpg[data-theme="dark"]`
			// vars and leave the hardcoded light-theme text unreadable on the
			// dark card. Add dark rules to SKIN_CSS instead if the brand ever
			// ships a dark variant.
			theme: "light",
			lang: "sk",
			title: "Povoľte používanie mikrofónu",
			// flavor-aware subtitle — browser vs in-app settings:
			subtitle: ({ flavor }) =>
				isBrowserFlavor(flavor)
					? "Ak sa chcete s poradkyňou rozprávať, povoľte používanie mikrofónu v <b>nastaveniach prehliadača</b>."
					: "Ak sa chcete s poradkyňou rozprávať, povoľte používanie mikrofónu v <b>nastaveniach aplikácie</b>.",
			labels: { next: "Ďalej", done: "Dokončiť" },
			// Override only the TEXT for browser flavors; the builder's
			// `defaultSteps` already carry the lib's flavor-correct art, so
			// WebView/PWA keep their own copy, art AND step count.
			steps: ({ flavor, defaultSteps }) =>
				isBrowserFlavor(flavor)
					? defaultSteps.map((s, i) => ({
							...s,
							text: BROWSER_TEXTS_SK[i] ?? s.text,
						}))
					: defaultSteps,
			onDone,
			onOpenSettings,
			slots: { header, step, footer },
		});
		return () => guide.destroy();
	});
</script>

<div bind:this={host} class="mpg-skin"></div>
