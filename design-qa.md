# Pet window design QA

Status: **Passed** for the requested pet appearance, compact sizing and Dashboard size control.

## Reference and captures

Reference: `docs/prototype/index.html`, `docs/prototype/app.js` and the existing `docs/prototype/assets/rover-pet.png`. No replacement artwork or new dependencies.

Browser comparison used a 1948 × 1215 viewport and the prototype's four initial tasks. Captures are cropped around the pet to compare the same content:

- [Prototype at 100%](/Users/evan/.codex/visualizations/2026/10/03/01a100d9-59d7-7802-a368-61bca15bb17a/pet-window-qa/prototype-expanded-100.jpg)
- [Implementation at 100%](/Users/evan/.codex/visualizations/2026/10/03/01a100d9-59d7-7802-a368-61bca15bb17a/pet-window-qa/pet-expanded-100.jpg)
- [Default expanded appearance at 75%](/Users/evan/.codex/visualizations/2026/10/03/01a100d9-59d7-7802-a368-61bca15bb17a/pet-window-qa/pet-expanded-75.jpg)
- [Default collapsed appearance over the prototype wallpaper](/Users/evan/.codex/visualizations/2026/10/03/01a100d9-59d7-7802-a368-61bca15bb17a/pet-window-qa/pet-compact-75.jpg)
- [Dashboard size setting](/Users/evan/.codex/visualizations/2026/10/03/01a100d9-59d7-7802-a368-61bca15bb17a/pet-window-qa/dashboard-pet-settings.jpg)

## Visual comparison

Reviewed the reference and rendered captures together. The same pet asset, white surfaces, rounded shapes, blue actions, green attention counts, task hierarchy, typography, shadows and processing border animation are present. At 100%, the shell is 420px wide, the pet is 94px tall and the input is 420 × 60px, matching the prototype. The expanded region scrolls instead of extending beyond the available window height.

The requested compact default is an intentional change: 75% scales the whole pet region, including text, buttons, cards, bubbles and reference suggestions. The pet becomes approximately 71px tall and the input 315 × 45px. Settings allow 60%–120% in 5% steps. The new settings panel uses the prototype's light surfaces and blue controls; other Dashboard panels retain their existing styling.

Layout corrections verified during comparison: prevent the shell from stretching, account for transparent window padding when resizing, and scale the suggestion popup with the pet. Final captures show no blocking visual differences within this scope.

## Interaction and validation

- Verified collapse/expand, composer focus, executor selection and structured `@Codex` references.
- Used a local mock Runtime to verify opening the original task session, unavailable session entries, streamed answers, queued prompts, continue/defer and preservation of queue order. Queued inputs do not create extra tasks.
- Verified 60%, 75%, 100% and 120% rendering, live updates between Dashboard and a separate pet tab, persistence after reload, and restore default. Size settings also work while Runtime is disconnected.
- Task summaries render Markdown as React nodes; completed, failed and intervention states retain their session actions.
- The voice entry gives an explanatory bubble because speech input has no existing backend.
- Application tests: 26 passed. Application build, application-directory lint, formatting, scoped whitespace check and `cargo check` passed.
- Full-repository lint still reports six pre-existing unused-variable/import errors in Runtime files; these unrelated files were not changed by this work.
- No new browser console errors after the final reload. An earlier Vite hot-reload message was caused by removing the temporary CSS file during the Tailwind conversion.

Native resize/drag permissions and compilation were checked. Native window dragging and monitor-edge repositioning still require a manual desktop check; the unbundled desktop window was unavailable to the UI automation tool. Native preference event synchronization is covered by tests.
