# dsh-union-workspace

Union workspaces for the DSH web GUI. Merge multiple directories into one
session (primary + members), persist them under `~/.dsh/union-workspaces.json`,
apply a permission preset per union, browse member files in a right-side panel,
and manage everything from a settings section and the `/uw` command.

## Features

- **Union workspaces** — group two or more directories into one session so
  the agent has access to all of them at once.
- **Sidebar entry** — click the ⛓ icon in the sidebar footer (beside Settings)
  to open the management panel.
- **Management panel** — right-side overlay with two tabs:
  - **Workspaces tab**: create, rename, open, remove unions and manage members.
  - **Files tab**: browse member directories in a tree view (lazy-loaded).
- **Permission preset** — each union has a `workspace-write` or
  `danger-full-access` preset applied automatically when the session starts.
- **Quick setup** — sessions with a single directory can be upgraded to a
  union via the `/uw` command or the `➕` header button.
- **Persistent** — union definitions survive agent restart
  (`~/.dsh/union-workspaces.json`).

## Installation

```bash
# Clone the repo
git clone https://github.com/lvchenguang/dsh-union-workspace.git
cd dsh-union-workspace

# Install dependencies
npm install

# Build
npm run build

# Install into a DSH profile
dsh plugin --profile <name> add link:$(pwd)
```

## Architecture

- **Host half** (`src/index.ts`) — runs in the DSH Node.js process, owns the
  union store, serves `/api/dsh-union-workspace/*` routes, and applies
  permission presets on session start.
- **Client half** (`src/client/index.ts`) — runs in the web GUI, registers
  locale dictionaries, settings section, conversation header badge/buttons,
  the `/uw` command, and mounts the overlay dialog and files panel via DOM
  injection.

## Development

```bash
# Watch mode
npm run watch

# Type-check only
npm run typecheck

# Build everything
npm run build
```

## Configuration

The plugin row in `cordis.patch.yml`:

```yaml
- insert:
    - id: union-workspace
      name: 'dsh-union-workspace'
```

## License

Apache-2.0