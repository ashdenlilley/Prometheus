# Sync across devices

Folder sync. Works on macOS and Windows with the same code. Each device keeps a full local SQLite copy and exchanges row- and field-level ops through a folder you choose (iCloud Drive by default). The folder holds ciphertext only.

## Layout

```
<folder>/prometheus-sync.json            passphrase check: scrypt salt + sealed marker
<folder>/<deviceId>/<hlc>.ndjson         sealed segment, one flush each
<folder>/<deviceId>/<hlc>.snap.ndjson    sealed snapshot written by compaction
```

- Each segment is AES-256-GCM sealed under a key derived from the passphrase (scrypt, N=2^15). The GCM tag rejects truncated or altered files.
- The derived key is stored on each device encrypted by the OS keychain (Electron `safeStorage`: DPAPI on Windows, Keychain on macOS). It is never written in plain text.
- Writes go to a dot-temp name, then rename. Readers skip dot-files and files that do not parse yet.
- The local SQLite file stays in `userData` and is never placed in the synced folder.

## Ops

- `create` carries a full row. `set` carries changed fields (and `unset` for removed ones). `del` removes the row.
- `hlc` = 15-digit ms, 6-digit counter, device id. Lexical order is causal order.

## Merge rules

- Per field, highest hlc wins. Two devices editing different fields of one issue both keep their edits. Editing the same field: the later hlc wins on every device.
- Row existence has its own clock. A delete beats older field edits. Field edits to a deleted row are ignored.
- Renderer saves are diffed against the last state the renderer received, then merged onto the live state. A stale renderer cannot revert remote changes.
- Clock-skew guard: segments with ops stamped more than 24 h ahead of the reading device are skipped and reported in Settings. Those ops are not applied and not marked applied, so they are retried after the clock is fixed.

## Compaction

- When one device holds more than 100 segments in the folder, it writes one snapshot and deletes its own old segments.
- Snapshot ops carry each field's winning hlc, not a fresh one, so replaying a snapshot cannot overwrite a newer edit from another device.

## Joining a folder

- New folder: choose a passphrase (8+ characters). Start sync.
- Existing folder: enter its passphrase. Then "Merge this device in" (local rows overwrite by clock) or "Replace with folder data" (local data is discarded).
- Device that lost its key (e.g. after moving the config): Settings shows "Unlock sync". Enter the passphrase.
- Passphrases are not recoverable. Lose it and the folder cannot be read. Local data on each device is unaffected.

## Timing

- Local edits flush about 400 ms after the change, and on quit.
- Remote folder is polled every 3 s. No file watchers (unreliable on cloud-provider folders).

## Known limits

- Clocks are wall time. Clock skew under 24 h can let a device's edit win a same-field conflict it should lose. Ops beyond 24 h are rejected.
- Deleting a folder on one device does not delete it elsewhere.
- Cloud-provider eviction: Windows iCloud placeholders are downloaded on read, which can make a poll slow.
- No key rotation. Changing the passphrase means a new folder.

## Test

`npm run test:sync` compiles the sync modules and runs `tests/sync-integration.js`: two devices over a shared temp folder covering passphrase refusal, ciphertext on disk, field merge, same-field conflict, delete, stale op, future-stamped segment, compaction, and restart.
