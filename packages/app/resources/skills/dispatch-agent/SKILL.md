---
name: dispatch-agent
description: >
  Dispatch coding tasks to specialized CLI coding agents (Claude Code, OpenCode, Codex).
  Load this skill when the user requests writing code, fixing bugs, refactoring, running tests, or performing tasks in a project directory.
---

# Dispatch Agent SOP (Standard Operating Procedure)

This skill guides Rover on how to validate, clarify, and dispatch coding tasks to specialized external CLI coding agents.

## Core Rules & Invariants

1. **Working Directory (`cwd`) is Mandatory**:
   - A valid, absolute filesystem directory path is strictly required to run a coding agent.
   - **Never guess or invent a path**.
   - If the user did not specify the project directory path and no active workspace directory is known in context, **DO NOT call `dispatch_agent`**. Instead, stop and ask the user to clarify the target directory path.

2. **Agent Selection (`agent`)**:
   - Supported agents: `claude` (recommended default), `opencode`, `codex`.
   - If the user did not express a preference, default to `claude`.

3. **Task Prompt Construction (`taskPrompt`)**:
   - Ensure the prompt passed to the agent is self-contained, detailed, and clear.
   - Include any constraints, target files, or specific reproduction steps provided by the user.

---

## Step-by-Step Workflow

### Step 1: Checklist & Clarification

Verify the following before calling the dispatch tool:

- [ ] Is `cwd` an absolute directory path?
- [ ] Is `agent` one of `"claude" | "opencode" | "codex"`?
- [ ] Is `taskPrompt` clear and actionable?

**If any required item is missing**:
Reply directly to the user with a concise, polite clarifying question. Do not invoke `dispatch_agent`.

### Step 2: Tool Invocation

When all parameters are verified, invoke the `dispatch_agent` controlled tool:

```json
{
  "agent": "claude",
  "cwd": "/path/to/workspace",
  "taskPrompt": "Detailed task instructions..."
}
```

### Step 3: Informing the User

- For `claude` / `opencode`: Inform the user that the task has been dispatched and is currently running with the returned Task ID.
- For `codex`: Inform the user that the dispatch attempt has been initiated and is awaiting session confirmation.
