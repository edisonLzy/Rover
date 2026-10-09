# Rover bubble interaction review

- Source visual truth: user-provided sketch in this conversation (input with two adjacent circular entries), subsequent accepted interaction notes, and https://linear.app/docs/inbox. The user explicitly requested an independent HTML interaction draft, not fidelity to an existing prototype.
- Implementation screenshot: `preview.png`, 939 × 1003 pixels. Browser viewport: 939 × 1003 CSS pixels; screenshot density: 1×. The sketch establishes structure, not a pixel-perfect viewport, palette, or font specification.
- State: both entries present, Inbox expanded; input remains available.
- Full-view evidence: reviewed the supplied sketch and rendered screenshot. Input occupies the left side, two separate circular entries occupy the right, and the shared compact list expands below. The introductory text and demo controls are prototype presentation aids.
- Focused evidence: inspected Inbox and Task screenshots, including row hierarchy, truncation, status labels, count badges, selection feedback, and input alignment.

## Findings and fixes

- Fixed hidden zero-count badges by adding an explicit `[hidden]` display rule, since the badge's grid display could override the browser's hidden style.
- Fonts: system sans-serif; distinct title, secondary text, time and status hierarchy. Intentional muted prototype palette; no supplied font to reproduce.
- Spacing: 580px maximum toolbar, 64px circular entries with 12px separation; input width expands from 428px to 580px as entries disappear. Rounded list container holds compact rows without individual card borders.
- Colors: white surfaces on a muted neutral background; green actions and amber attention indicators. This is an intentional draft direction, not a replica of Linear's dark theme.
- Assets: Lucide library icons. SVG filter is used for the requested liquid UI surface transition; no illustrative assets are substituted.
- Copy: all operational data is explicitly presented as demonstration data.

## Browser verification

- Inbox and Task expand below the input and replace each other.
- Input draft survives switching between lists.
- Message details expand; selecting a reference adds a visible removable input reference.
- Submitting a draft clears accepted input and adds a demonstration task.
- Empty lists retain their associated entry while expanded; closing them removes the entry and restores input width.
- Reset restores demonstration data and clears draft/reference state.
- Browser console error log: empty at final verification.

## Follow-up polish / limits

- Native Tauri window boundaries and desktop scale are outside this standalone draft.
- Icons currently load from the public Lucide CDN.
- Liquid motion timing is an initial 620ms setting for user review.
- No real Agent execution or backend integration.

final result: passed
