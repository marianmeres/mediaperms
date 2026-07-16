import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { createReenableGuide } from "../src/reenable-guide.ts";

// ---------------------------------------------------------------------------
// DOM-backed tests for the `createReenableGuide` *factory* (the controller
// tests in reenable-guide.test.ts cover resolution; these cover that the
// factory actually forwards `kind` / `steps` / `stepText` into the rendered
// DOM and that the art branch handles both SVG strings and live SVGElements).
// deno-dom supplies a real-enough document; the guide is otherwise
// framework-agnostic.
// ---------------------------------------------------------------------------

// deno-dom (0.1.x) ships a partial DOM — `replaceChildren` / `append` are not
// implemented. The guide uses them on plain elements; polyfill them onto the
// shared node prototype for the test process. Idempotent and test-only.
// deno-lint-ignore no-explicit-any
function patchDom(doc: any): void {
	const probe = doc.createElement("div");
	let proto = Object.getPrototypeOf(probe);
	while (
		proto && !Object.prototype.hasOwnProperty.call(proto, "appendChild")
	) {
		proto = Object.getPrototypeOf(proto);
	}
	const target = proto ?? Object.getPrototypeOf(probe);
	// deno-lint-ignore no-explicit-any
	const toNode = (n: any, ownerDoc: any) =>
		typeof n === "string" ? ownerDoc.createTextNode(n) : n;
	if (typeof target.replaceChildren !== "function") {
		// deno-lint-ignore no-explicit-any
		target.replaceChildren = function (...nodes: any[]) {
			while (this.firstChild) this.removeChild(this.firstChild);
			for (const n of nodes) this.appendChild(toNode(n, this.ownerDocument));
		};
	}
	if (typeof target.append !== "function") {
		// deno-lint-ignore no-explicit-any
		target.append = function (...nodes: any[]) {
			for (const n of nodes) this.appendChild(toNode(n, this.ownerDocument));
		};
	}
}

function withDocument(fn: (doc: Document) => void): void {
	const doc = new DOMParser().parseFromString(
		"<!DOCTYPE html><html><head></head><body></body></html>",
		"text/html",
	) as unknown as Document;
	patchDom(doc);
	// deno-lint-ignore no-explicit-any
	(globalThis as any).document = doc;
	try {
		fn(doc);
	} finally {
		// deno-lint-ignore no-explicit-any
		delete (globalThis as any).document;
	}
}

Deno.test("factory: stepText reaches the rendered DOM and art is preserved", () => {
	withDocument((doc) => {
		const container = doc.createElement("div") as unknown as HTMLElement;
		const guide = createReenableGuide({
			kind: "microphone",
			container,
			flavor: "desktop", // 3 default steps, all with built-in SVG art
			lang: "en",
			theme: "light",
			stepText: { desktop: ["FACTORY STEP", null, null] },
		});

		const text = guide.el.querySelector(".mpg__text");
		assert(text, "step text host should render");
		assertEquals(text!.innerHTML, "FACTORY STEP"); // stepText reached the DOM

		const art = guide.el.querySelector("[data-art]");
		assert(art, "art host should render");
		assert(
			art!.innerHTML.includes("<svg"),
			"built-in art must survive a stepText override",
		);

		guide.destroy();
	});
});

Deno.test("factory: kind decides the rendered default copy", () => {
	withDocument((doc) => {
		const container = doc.createElement("div") as unknown as HTMLElement;
		const guide = createReenableGuide({
			kind: "camera",
			container,
			flavor: "desktop",
			lang: "en",
			theme: "light",
		});

		const title = guide.el.querySelector(".mpg__title");
		assert(title);
		assertEquals(title!.textContent, "Re-enable the camera");

		guide.goto(1); // desktop step 2 names the device
		const text = guide.el.querySelector(".mpg__text");
		assert(text!.innerHTML.includes("<b>Camera</b>"));

		guide.destroy();
	});
});

Deno.test("factory: a live (non-string) art element is mounted as a node, not stringified", () => {
	withDocument((doc) => {
		// Build a real <svg> element (deno-dom lacks createElementNS) — exercises
		// renderArt's `else $art.appendChild(art)` branch for SVGElement art.
		const holder = doc.createElement("div");
		holder.innerHTML = '<svg data-marker="yes"></svg>';
		const svg = (holder.firstElementChild ??
			holder.children[0]) as unknown as SVGElement;
		assert(svg, "should parse an <svg> element");

		const container = doc.createElement("div") as unknown as HTMLElement;
		const guide = createReenableGuide({
			kind: "microphone",
			container,
			flavor: "desktop",
			lang: "en",
			theme: "light",
			steps: [{ text: "x", art: svg }],
		});

		const art = guide.el.querySelector("[data-art]");
		assert(art);
		assert(
			art!.querySelector('svg[data-marker="yes"]'),
			"the live element should be appended as-is",
		);
		assert(
			!(art!.textContent ?? "").includes("[object"),
			"the element must not be coerced to a string",
		);

		guide.destroy();
	});
});

Deno.test("factory: dot count tracks the resolved (builder-changed) step count", () => {
	withDocument((doc) => {
		const container = doc.createElement("div") as unknown as HTMLElement;
		const guide = createReenableGuide({
			kind: "microphone",
			container,
			flavor: "desktop", // 3 defaults
			lang: "en",
			theme: "light",
			steps: (ctx) => [...ctx.defaultSteps, { text: "extra" }], // → 4
		});

		assertEquals(guide.el.querySelectorAll(".mpg__dot").length, 4);
		guide.destroy();
	});
});

Deno.test("factory: navigation re-renders the active step text", () => {
	withDocument((doc) => {
		const container = doc.createElement("div") as unknown as HTMLElement;
		const guide = createReenableGuide({
			kind: "microphone",
			container,
			flavor: "desktop",
			lang: "en",
			theme: "light",
			stepText: { desktop: ["one", "two", "three"] },
		});

		const readText = () => guide.el.querySelector(".mpg__text")!.innerHTML;
		assertEquals(readText(), "one");
		guide.next();
		assertEquals(readText(), "two");
		guide.goto(99); // clamps to last
		assertEquals(readText(), "three");
		guide.destroy();
	});
});
