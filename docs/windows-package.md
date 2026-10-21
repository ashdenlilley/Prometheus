# Package Prometheus for Windows

Produces an unsigned NSIS installer: `dist\Prometheus Setup 0.1.0.exe`. Run on a Windows machine. Do not run `dist:win` on macOS (the NSIS and rcedit tools need x86 and fail on Apple Silicon).

## Prerequisites

- Windows 10 or 11, x64.
- Node.js 20 LTS or 22 LTS (`node -v`).
- Git.
- About 2 GB free disk. The first run downloads the Electron Windows binary (about 120 MB) and NSIS.
- Internet access to `github.com` (Electron and electron-builder download binaries from there).

## Steps

Run in PowerShell.

```powershell
git clone https://github.com/ashdenlilley/Prometheus.git
cd Prometheus
git checkout main
git pull origin main
npm ci
npm run dist:win
```

`npm ci` must succeed before packaging. It installs exactly what is in `package-lock.json`, which includes `sql.js` (pure wasm, no native compile).

Build output:

- `dist\Prometheus Setup 0.1.0.exe` (installer)
- `dist\Prometheus Setup 0.1.0.exe.blockmap`
- `dist\win-unpacked\` (unpacked app, for debugging)

## Verify

1. Run `dist\Prometheus Setup 0.1.0.exe`. Windows SmartScreen will warn because the build is unsigned. Choose "More info" → "Run anyway".
2. Installer completes. Launch "Prometheus" from the Start menu.
3. Sidebar shows the seeded "Prometheus" space with "Core app" (4 issues).
4. Open Core app → Board. Drag a card between columns. Status changes.
5. Quit and relaunch. Changes persist.
6. Data file: `%APPDATA%\prometheus\prometheus.db`. The MCP token is in `%APPDATA%\prometheus\mcp.json`.
7. Settings → Local MCP server shows "Running at http://127.0.0.1:7878/mcp".

## Optional: code signing

Unsigned builds trigger SmartScreen. To sign, set these before `npm run dist:win`:

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "<password>"
npm run dist:win
```

Use an OV or EV code-signing certificate. Never commit the `.pfx` or the password.

## Troubleshooting

- `npm ci` fails with a 403 or timeout on `github.com`: check proxy settings, or set `ELECTRON_MIRROR` to a reachable mirror and retry.
- `dist:win` fails with `cannot execute` on rcedit: a leftover cache from another machine. Delete `%LOCALAPPDATA%\electron-builder\Cache` and retry.
- App starts blank or shows "sql-wasm.wasm" errors: the packaged build is missing `node_modules\sql.js`. Confirm `package.json` lists `sql.js` under `dependencies` (not `devDependencies`), then rerun `npm ci` and `npm run dist:win`.
- Port 7878 in use: MCP tries the next 7 ports automatically. Check the port shown in Settings.

## Reset local data

Close the app, then delete `%APPDATA%\prometheus\prometheus.db`. The next launch seeds sample data. Legacy `prometheus-data.json` is imported automatically on first run and renamed to `.bak`.
