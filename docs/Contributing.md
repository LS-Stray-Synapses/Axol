# Working in this vault

## Setup
1. Install [Obsidian](https://obsidian.md).
2. `Open folder as vault` → select `docs/` inside your clone of the repo.
3. Optional (recommended) community plugins: *Settings → Community plugins → Browse*
   - **Obsidian Git**: pull/commit/push from inside Obsidian (or just use your normal git workflow).
   - **Excalidraw**: hand-drawn style diagrams, stored as `.excalidraw.md`.
   - **Dataview**: query notes like a database (e.g. list all ADRs by status).

## Conventions
- **Links:** standard Markdown links with relative paths (`[Harness](Harness.md)`), so they work on GitHub too. Obsidian is configured to create links this way automatically.
- **Diagrams:**
  - Prefer **Mermaid** code blocks: they are text, diff cleanly and render on GitHub *and* in Obsidian.
  - Use **Canvas** (`.canvas`) for big-picture maps. Renders only in Obsidian.
  - Images/exports go in `Attachments/`.
- **Decisions:** any non-trivial design choice gets an ADR in `Decisions/` (use the ADR template). Never edit an accepted ADR's decision; supersede it with a new one.
- **Components:** each component in `Architecture/` follows the Component template: purpose, interface, diagram, open questions.
- **Frontmatter:** use `status:` (`draft` / `proposed` / `accepted` / `deprecated`) and `owner:` on notes so we know who to ask.
- **Code ↔ notes:** reference code with repo-relative paths, e.g. `src/harness/loop.py`. Reference notes from code comments with `docs/Architecture/Harness.md`.

## Git workflow
- Notes go through the same branches/PRs as code. A design change PR should touch both the code and the relevant note/ADR.
- `.obsidian/workspace*.json` is gitignored (personal UI state). Shared settings in `.obsidian/` are committed.
- Discussion of a note → GitHub PR review comments or an issue linking the note.
