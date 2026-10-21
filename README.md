# Prometheus

Local-first project management. Linear-style issues, cycles and roadmap. Monday-style boards with custom columns and timeline. Single user, no sync. Runs on macOS and Windows.

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
