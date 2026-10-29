# OS-354 Documents (design note)

Status: design for review. No code yet. Issue: OS-354. Size: XL. The first slice below is about L (3 to 5 days).

## Decisions
- Decided (Ashden): Markdown with a live preview is the editor. Rich-text editing is not planned.

## Scope
First slice:
- Markdown docs under a space or a project (team docs once OS-353 lands): create, edit, rename, delete (with undo) and duplicate.
- A split editor (a plain textarea with a live preview), not a rich-text editor.
- Mentions: typing `OS-123` or `@Issue` links to the issue, and backlinks appear on the issue ("Mentioned in docs").
- A Doc column type that links an issue to one or more docs.
- Doc templates: save a doc as a template, and create a doc from one.
- Docs are included in folder sync, backups, JSON export, and the command menu search (title and body).

Deferred:
- Images pasted inline (files stay attachments), real-time co-editing (needs OS-359), version history beyond undo, and comments on docs.

## Storage model
- A new `docs` table in SQLite: `{ id, spaceId, projectId?, teamId?, title, body, createdAt, updatedAt, archivedAt?, template?: boolean }`.
- Body limit: 512 KB per doc (a warning at 256 KB). Large text belongs in files.
- `AppData.docs?: Doc[]` is added as an optional field, so there is no schema bump.

## Editor choice
- Rendering: `marked` (small, no runtime dependencies) plus `dompurify` for sanitising. `npm audit` must stay at 0 when they are added.
- Decided: no rich-text editor. CodeMirror for the Markdown textarea (syntax highlighting) is a possible later nicety.
- Rendered HTML is sanitised and links open externally through `shell.openExternal` with an http/https allowlist.

## Sync merge
- Docs use the existing field-level HLC ops. `title` and `body` are separate fields.
- If two devices edit the same doc body while offline, the later HLC wins the whole body. The losing body is kept as a "conflicted copy" doc, so no text is lost silently. This is simpler than a text CRDT, and a proper text merge waits for OS-359.

## UI touchpoints
A Docs section in the sidebar (per space or project), a doc page (editor plus preview), a Doc column cell (a picker and chips), "Mentioned in docs" on the issue panel, templates in the "New doc" menu, and results in the command menu.

## Security
- XSS: rendered Markdown is sanitised with DOMPurify, and the renderer keeps its existing CSP. No raw HTML embeds.
- No secrets involved.

## Accounts or tokens Ashden needs
None.

## Test plan
- Unit: the reducer (create, rename, delete, undo), mention parsing, backlinks, creating from a template, the size limit, and the conflicted-copy merge rule.
- `npm run test:sync`: a doc edit syncs, and concurrent body edits produce one winner plus one conflicted copy on both devices.
- Smoke (xvfb): create a doc with an issue mention, link it from a Doc column, and open the backlink. Screenshot.

## Open questions for Ashden
1. Is a "conflicted copy" acceptable for the rare same-doc offline edit, rather than a text merge?
2. Should docs also be written to disk as `.md` files (for example in a chosen folder), or stay in SQLite only?

## Dependencies and suggested build order

Suggested order for the eight remaining features (each starts only after its design note is approved):

1. OS-353 Teams: no dependencies. Gives later features a stable "team" owner.
2. OS-354 Documents: project and space docs need nothing; team docs need OS-353.
3. OS-355 Agents as assignees: builds on the existing MCP server. Introduces the "actor" idea that OS-359 reuses.
4. OS-356 Webhooks and local REST API: builds on the MCP tool layer. Introduces the shared credential store and the outgoing-HTTP delivery queue.
5. OS-357 Git integration: reuses the credential store from OS-356.
6. OS-358 Third-party integrations: reuses the credential store and delivery queue from OS-356, and the link model from OS-357.
7. OS-359 Multi-user and real-time sync: needs OS-353 (membership becomes real accounts) and OS-355 (actor attribution). The only item that needs a backend.
8. OS-360 Permissions: needs OS-359 (server-side enforcement needs a server and real identities) and OS-353 (team roles).

Items 1 to 6 keep Prometheus single-user and local-first. Items 7 and 8 change that and should be decided together.
