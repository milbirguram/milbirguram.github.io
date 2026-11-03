# creativeOS

## What it is for

A browser desktop for moving a loose idea into a note, sketch or colour study that can be kept and exported. Familiar launchers, file names, windows and a taskbar make the next action visible. The experience is a web desktop, not a bootable kernel, hardware operating system or shell with access to the host computer.

## How it works

Three small apps share a local file collection. Notes are plain text; Sketch stores normalised brush strokes and exports a PNG; Colour studies contain five editable swatches and a hue explorer. The file manager opens files, imports notes/workspace backups, moves files to Trash and restores them. Empty Trash is an explicit permanent action with a confirmation. Window buttons support keyboard focus, minimise/restore, maximise and close. Narrow screens maximise windows. Full screen is optional. Ctrl/Cmd+N makes a note; Ctrl/Cmd+S exports the active workspace collection.

WinBox 0.2.82 supplies window management. idb-keyval 6.3.0 stores the workspace in a dedicated IndexedDB database. Both are vendored locally with Apache-2.0 notices; no CDN is contacted at runtime. The shared project frame is outside a same-origin iframe, so window coordinates and bounds remain inside the desktop.

Notes save on input; sketches save when a stroke finishes. Saves are queued. If storage is unavailable or a save fails, the status changes to session-only/export guidance. Files stay in the browser where they were made; they do not sync across devices, origins or accounts. Clearing site data can remove them. Workspace exports include active files, not Trash. Import appends with new IDs and does not replace the existing collection. Limits are shared between save/export/import: 100 files including Trash, 2,000,000 UTF-8 bytes, 50,000 characters per note, 500 strokes per sketch and 3,000 points per stroke. Mutations that exceed workspace capacity are rejected; notes have a visible input limit and oversized text imports are rejected. Imports are schema-checked and rendered as text/canvas data, never evaluated as HTML or code.

`model.js` contains file validation, naming, colour generation and the workspace format. Run `node projects/creativeos/tests/run-all.js` for round trips, malformed data, non-ASCII byte limits, file-count and colour checks. Browser QA covers file persistence after reload, window actions, palette editing, drawing, mobile layout and preview lifecycle. Sketch undo removes the last stroke and can restore one cleared canvas. It is not an infinite revision history or collaborative editor.

Preview mode is a visibly representative, read-only studio composition, with no access to the visitor's private files, no IndexedDB operations and no writes. Its frame follows the gallery's play/pause messages and reduced motion. The preview is a demonstration rather than a recording of someone's workspace.

## Sources

- [WinBox](https://github.com/nextapps-de/winbox), pinned to 0.2.82; Apache-2.0.

- [idb-keyval](https://github.com/jakearchibald/idb-keyval), pinned to 6.3.0; Apache-2.0.

- Vendor licences and hashes are in `vendor/`. Illustrations, icons, seed notes and application code are original. System fonts require no runtime requests.
