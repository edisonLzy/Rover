# M1 macOS Release Smoke

Run this checklist for both Claude Code and Codex CLI on each supported release architecture. It
covers M1 behavior that cannot be made reliable in a headless test runner.

## Record

- Date:
- Tester:
- Rover commit/build:
- macOS version:
- Architecture: arm64 / x86_64
- Claude Code version:
- Codex CLI version:

## Checklist

- [ ] Launch a Rover-owned CLI session in the background without bringing Terminal.app forward.
- [ ] Confirm the session obtains one native session ID and produces one Rover `SessionStart`.
- [ ] Quit the Rover application and confirm the CLI remains alive in GNU Screen.
- [ ] Reopen Rover and attach from Terminal.app to the original running Screen session.
- [ ] Confirm the original TUI state and conversation context are visible; no second native session is created.
- [ ] Enter Chinese text and emoji, resize the Terminal window, detach, and attach again; input and redraw remain correct.
- [ ] Trigger a safe permission request in a disposable repository and approve it in the attached Terminal session.
- [ ] End the Screen-hosted CLI normally and reopen it by native session ID.
- [ ] Confirm the resumed conversation is the same native session and accepts another input turn.
- [ ] Start the same CLI manually, outside Rover, and confirm Rover creates no Task/session event for it.
- [ ] Deny Terminal Automation permission on a disposable macOS test user and confirm the existing M1 error gives the System Settings repair path.
- [ ] Install then uninstall the Rover Hook on a disposable test user and confirm unrelated user Hooks remain unchanged.

## Release-blocking failures

- Terminal attaches to a different Screen or native session.
- Resume creates a new native session instead of opening the recorded one.
- Quitting Rover terminates the CLI.
- A manual non-Rover CLI session writes a Rover event.
- Hook installation or removal changes an unrelated user Hook.
- Terminal permission failure lacks actionable recovery guidance.
