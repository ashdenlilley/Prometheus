# Sync across devices

Folder sync. Works on macOS and Windows with the same code. Each device keeps a full local SQLite copy and exchanges row-level ops through a folder you choose (iCloud Drive by default).

## Layout

```
<folder>/<deviceId>/<hlc>.ndjson    one immutable segment per flush, one op per line
```

- Op: `{"hlc","table","id","row"?}`. No `row` means delete.
- `hlc` = 15-digit ms, 6-digit counter, device id. Lexical order is causal order.
- Each device writes only in its own subfolder. Files go to `.<name>.tmp`, then rename. Readers skip dot-files and any file whose lines do not parse yet.
- Local SQLite stays in `userData` and is never placed in the synced folder.

## Merge rules

- Per row, highest hlc wins (last-writer-wins). Tombstones are kept in `sync_clock`, so an old put cannot resurrect a deleted row.
- Conflicts are per row, not per field. Two devices editing different fields of the same issue: the later whole-row write wins.
- Renderer saves are diffed against the last state the renderer received, then merged onto the live state. A stale renderer cannot revert remote changes.

## Timing

- Local edits flush about 400 ms after the change, and on quit.
- Remote folder is polled every 3 s. No file watchers (unreliable on cloud-provider folders).

## Joining a folder

- Empty folder: "Choose folder" pushes this device's data.
- Folder with other devices: choose "Merge this device in" (local rows overwrite same-id rows by clock) or "Replace with folder data" (local data is discarded).

## Known limits

- No compaction. Segment count grows with edits. Planned: periodic snapshot segment plus pruning of applied files.
- Clocks trust wall time. A device with a clock far in the future wins conflicts until corrected.
- Deleting a folder on one device does not delete it elsewhere. Remote segments are not garbage-collected.
- Not end-to-end encrypted. Content is readable by whoever can read the folder.
- Cloud-provider eviction: Windows iCloud placeholders are downloaded on read, which can make a poll slow.
