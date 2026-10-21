# Package Prometheus for macOS

Produces `dist/Prometheus-0.1.0-universal.dmg` (Apple Silicon and Intel).

Build on macOS only. Locally:

```sh
npm ci
npm run dist:mac
```

CI: `.github/workflows/release.yml` builds the DMG on `macos-14` and the Windows installer on `windows-latest`. Push a tag `v*` to publish both to a GitHub release.

## Signing and notarisation (optional)

Unsigned builds show a Gatekeeper warning. To sign and notarise, set these secrets in GitHub (or env locally):

- `CSC_LINK`, `CSC_KEY_PASSWORD`: Developer ID Application certificate (`.p12`, base64 or path).
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: notarisation.

Never commit certificates or passwords.
