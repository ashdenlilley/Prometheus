<p align="center">
  <img src="build/icon.png" alt="Prometheus icon" width="128" height="128">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/renderer/src/assets/wordmark-light.png">
    <img src="src/renderer/src/assets/wordmark-dark.png" alt="PROMETHEUS" width="420">
  </picture>
</p>

Local-first project management. Linear-style issues, cycles and roadmap. Monday-style boards with custom columns and timeline. Single user. Optional folder sync across devices (see docs/sync.md). Runs on macOS and Windows.

## Views

- **Issues**: status-grouped list. Toggle current project or all projects.
- **Board**: kanban by status. Drag cards between columns.
- **Table**: Monday-style grouped table. Inline edit. Add custom columns (text, number, date, checkbox, select).
- **Timeline**: Gantt of issues with start/due dates, cycle bands, today marker.
- **Cycles**: time-boxed sprints with progress. Assign open issues.
- **Roadmap**: projects as bars with progress, across all projects.

## Run

```sh
npm install
npm run dev        # development
npm run typecheck
npm run build
npm run dist:mac   # .dmg (run on macOS)
npm run dist:win   # .exe installer (run on Windows)
```

Data is stored in `prometheus-data.json` under the Electron `userData` directory.
