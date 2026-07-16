# Svelte examples — fully-custom look

Two reference components showing how to reskin the re-enable guide to a
brand design (the screenshots use a Dovera-style card: title + close button,
single full-width outlined CTA, dark-filled dots, green accent).

> ⚠️ Reference only. The mediaperms repo is Deno/vanilla and has **no Svelte
> build** — these `.svelte` files are not compiled or type-checked here. Copy
> the one you want into a Svelte 5 app (e.g. `src/lib/`).

## Which one?

| File                                                           | Approach                                                                                                                                                          | When                                                                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ReenableGuideSkinned.svelte`](./ReenableGuideSkinned.svelte) | **(a)** Reskin the built-in DOM guide via `slots` (`header`/`step`/`footer`) + a CSS override, driven by `createReenableGuide`. Brand copy via a `steps` builder. | You want the custom look with the least code and are fine authoring the chrome as DOM/HTML strings. Reuses the lib's navigation, dots and **flavor-correct SVG art**. |
| [`ReenableGuide.svelte`](./ReenableGuide.svelte)               | **(b)** Fully native Svelte markup on top of the headless `createReenableGuideController`, bridged into runes with `fromStore`.                                   | You want to own 100% of the DOM (scoped CSS, design-system components) while keeping flavor detection, default copy and navigation.                                   |

## Props (both)

- `accent?: string` — brand color (default `#0a7d54`, a placeholder green — set the real brand value).
- `onClose?`, `onDone?`, `onOpenSettings?` — callbacks.
- (b) also: `kind?` (default `"microphone"` — set `"camera"` / `"camera-and-microphone"` for the other flows), `flavor?`, `lang?`, `steps?`, `stepText?`, `title?`, `subtitle?`, `labels?` — forwarded to the controller. (a) hardcodes `kind: "microphone"` (it ships Slovak mic brand copy) — adapt the copy when changing the kind.

## Notes

- **No SVG is copied into these files.** (a) overrides only the **text** via a
  `steps` builder (`({ flavor, defaultSteps }) => …`), so the lib's
  flavor-correct art, step count and navigation are kept automatically. Browser
  flavors get the Slovak brand copy; WebView/PWA keep the lib's own copy + art
  (different count), so those flows aren't silently regressed. Override per
  flavor by branching on `ctx.flavor`, or use the declarative `stepText` map.
- `{@html}` / `innerHTML` on `step.text` is intentional — the lib documents it
  as **trusted, consumer-supplied** HTML (slot string returns share that
  contract). `title`/`subtitle` carry no such contract: the lib's built-in
  chrome escapes them as plain text. These examples render `subtitle` as HTML
  only because they own the header markup and supply the copy themselves — if
  you rely on the built-in header, keep `subtitle` plain text. Never feed any
  of these user input.
- Fully fixed-palette skins (like the skinned example) should pin `theme` —
  the default `"auto"` follows `html.dark` and would flip the lib's CSS vars
  under a hardcoded light card.
- The lib's built-in guide chrome uses the same `.mpg`/`.mpg__*` class names
  (and `mpg-styles` style-tag id) as `@marianmeres/micperms`' guide, so a skin
  written for that package keeps working here.
