# App resources

Rover owns built-in skills under `skills/<skill-id>/SKILL.md`. Each skill needs YAML frontmatter
with a unique lowercase hyphenated `name` and a non-empty `description`, followed by instructions.
Supporting scripts, references and assets live inside the same skill directory.

Tauri bundles the complete `skills/` tree. Rust supplies its absolute path to Runtime with
`--skills-dir`: the source directory during development and the Tauri Resource directory after
packaging. Runtime uses the same loader for both and does not embed or search for fallback content.

Resources are read directly from the app bundle. Restart Runtime after editing a skill during
development. Loading a skill does not execute its scripts; script execution remains a separate capability.

See [ADR-0016](../../../docs/adr/0016-app-owned-builtin-skills.md) for ownership and verification.
