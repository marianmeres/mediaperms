<!--
	Approach (b): fully native Svelte rendering on top of the HEADLESS
	controller (`createReenableGuideController`).

	You own 100% of the markup; the lib supplies flavor detection, default copy
	and step navigation. `fromStore` bridges the controller (which implements
	the Svelte store contract) into runes — no manual subscribe/unsubscribe.

	This file is reference material — the mediaperms repo itself has no Svelte
	build. Copy it into a Svelte 5 app (e.g. `src/lib/`).
-->
<script lang="ts">
	import { untrack } from "svelte";
	import { fromStore } from "svelte/store";
	import type { MediaPermsKind } from "@marianmeres/mediaperms";
	import {
		createReenableGuideController,
		type ReenableGuideFlavor,
		type ReenableGuideLang,
		type ReenableGuideStep,
		type ReenableGuideStepsInput,
		type ReenableGuideStepTextOverride,
		type ReenableGuideTextInput,
	} from "@marianmeres/mediaperms/reenable-guide";

	let {
		kind = "microphone",
		flavor,
		lang = "auto",
		steps,
		stepText,
		title,
		subtitle,
		labels,
		accent = "#0a7d54",
		onClose,
		onDone,
		onOpenSettings,
	}: {
		kind?: MediaPermsKind;
		flavor?: ReenableGuideFlavor;
		lang?: ReenableGuideLang | "auto";
		// array OR a `(ctx) => steps` builder (keeps the built-in art) — see lib docs
		steps?: ReenableGuideStepsInput;
		// declarative per-flavor text override (art preserved); ignored if `steps` set
		stepText?: ReenableGuideStepTextOverride;
		title?: ReenableGuideTextInput;
		subtitle?: ReenableGuideTextInput;
		labels?: { back?: string; next?: string; done?: string; openSettings?: string };
		accent?: string;
		onClose?: () => void;
		onDone?: () => void;
		onOpenSettings?: () => void;
	} = $props();

	// Configured once at mount (kind/flavor/steps don't change mid-life); untrack
	// reads the initial config. Callbacks are wrapped so the latest prop is invoked.
	const ctrl = untrack(() =>
		createReenableGuideController({
			kind,
			flavor,
			lang,
			steps,
			stepText,
			title,
			subtitle,
			labels,
			onDone: () => onDone?.(),
			onOpenSettings: () => onOpenSettings?.(),
		})
	);

	// The controller satisfies the Svelte store contract → bridge it into runes.
	const store = fromStore(ctrl);
	const m = $derived(store.current);

	const primaryLabel = $derived(
		m.hasOpenSettingsCta && m.isFirst
			? m.labels.openSettings
			: m.isLast
				? m.labels.done
				: m.labels.next,
	);

	function primary() {
		if (m.hasOpenSettingsCta && m.isFirst) {
			ctrl.openSettings();
			ctrl.next();
		} else if (m.isLast) {
			ctrl.done();
		} else {
			ctrl.next();
		}
	}

	// The lib's labels cover back/next/done/openSettings only; the close button
	// is this component's own chrome, so localize its a11y label by resolved lang.
	const CLOSE_LABELS: Record<ReenableGuideLang, string> = {
		en: "Close",
		sk: "Zavrieť",
	};

	// art may be an SVG string (default steps) or a live SVGElement (custom).
	function art(node: HTMLElement, value: ReenableGuideStep["art"]) {
		const set = (v: ReenableGuideStep["art"]) => {
			node.replaceChildren();
			if (!v) return;
			if (typeof v === "string") node.innerHTML = v;
			else node.appendChild(v);
		};
		set(value);
		return { update: set };
	}
</script>

<div class="guide" lang={m.lang} style="--accent:{accent}">
	<button class="close" type="button" aria-label={CLOSE_LABELS[m.lang]} onclick={() => onClose?.()}>
		<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
	</button>

	<h2 class="title">{m.title}</h2>
	<!-- step.text is trusted HTML per the lib contract; subtitle is rendered as
	     HTML here only because this component owns the copy (the lib's built-in
	     header escapes it) -->
	<p class="sub">{@html m.subtitle}</p>

	<div class="art" use:art={m.step.art}></div>

	<p class="caption">{@html m.step.text}</p>

	<div class="dots" aria-hidden="true">
		{#each m.steps as _step, idx (idx)}
			<span class="dot" class:on={idx === m.index}></span>
		{/each}
	</div>

	<button class="cta" type="button" onclick={primary}>{primaryLabel}</button>
</div>

<style>
	.guide {
		--mpg-bg: #fff;
		--mpg-fg: #1d2433;
		--mpg-muted: #9aa1ad;
		--mpg-line: #e3e6ea;
		--mpg-art-bg: #f4f5f7;
		--mpg-art-soft: #dfe3e9;
		--mpg-accent: var(--accent);
		--mpg-accent-soft: color-mix(in srgb, var(--accent) 12%, transparent);

		position: relative;
		box-sizing: border-box;
		width: 100%;
		max-width: 380px;
		padding: 22px;
		border: 1px solid var(--mpg-line);
		border-radius: 14px;
		background: var(--mpg-bg);
		color: var(--mpg-fg);
		font-family: "Inter", system-ui, -apple-system, sans-serif;
		-webkit-font-smoothing: antialiased;
	}
	.close {
		position: absolute;
		top: 16px;
		right: 16px;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		line-height: 0;
		border: 1.5px solid var(--accent);
		border-radius: 50%;
		background: transparent;
		color: var(--accent);
		cursor: pointer;
	}
	.title {
		margin: 0 40px 0 0;
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.sub {
		margin: 10px 0 0;
		font-size: 14px;
		line-height: 1.5;
		color: #5b6472;
	}
	.sub :global(b) {
		font-weight: 700;
		color: var(--mpg-fg);
	}
	.art {
		display: grid;
		place-items: center;
		height: 150px;
		margin-top: 16px;
		overflow: hidden;
		border: 1px solid var(--mpg-line);
		border-radius: 12px;
		background: var(--mpg-art-bg);
	}
	.art :global(svg) {
		width: 100%;
		height: 100%;
	}
	.caption {
		margin: 16px 0 0;
		font-size: 14px;
		line-height: 1.55;
		color: #3b4350;
	}
	.caption :global(b) {
		font-weight: 700;
		color: var(--mpg-fg);
	}
	.dots {
		display: flex;
		gap: 7px;
		justify-content: center;
		padding: 18px 0 4px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #cfd4db;
		transition: background 0.2s;
	}
	.dot.on {
		background: #2b3240;
	}
	.cta {
		width: 100%;
		height: 50px;
		margin-top: 16px;
		border: 1.5px solid var(--accent);
		border-radius: 10px;
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: 15px;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s;
	}
	.cta:hover {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.cta:active {
		transform: scale(0.99);
	}

	/* the default-art SVGs use this pulse class (injected as raw markup) */
	:global(.mpg-pulse) {
		transform-box: fill-box;
		transform-origin: center;
		animation: mpg-pulse 1.6s ease-in-out infinite;
	}
	@keyframes mpg-pulse {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.06);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.mpg-pulse) {
			animation: none;
			opacity: 1;
		}
	}
</style>
