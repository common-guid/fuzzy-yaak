# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Architecture Overview

Yaak is a **Tauri-based desktop application** combining Node.js and Rust in a monorepo structure. The architecture consists of:

- **Frontend (src-web/)**: React + TypeScript using Vite, Tauri APIs, TanStack Router, CodeMirror editors, and Tailwind CSS
- **Backend (src-tauri/)**: Rust monorepo with multiple specialized crates for HTTP, gRPC, WebSocket, SSE, plugins, templating, and sync
- **Plugin System**: Node.js sidecar that communicates with the app over gRPC, enabling extensibility for auth, filters, importers, and template functions
- **Shared Packages (packages/)**: Common libraries including plugin runtime types and a common utilities library
- **Plugins (plugins/)**: Multiple plugin workspaces for auth methods, importers, filters, template functions, and themes

The app is distributed as a lightweight, privacy-first desktop client supporting REST, GraphQL, gRPC, WebSocket, and SSE.

## Key Modules

**Frontend (src-web/)**:
- `components/`: Large collection of React components for UI (editors, dialogs, layouts)
- `commands/`: Tauri command handlers for app operations
- Request/response handling for different protocols (HTTP, gRPC, WebSocket, SSE)

**Backend (src-tauri/)**:
- `yaak-http`: HTTP client with cookie and auth support
- `yaak-grpc`: gRPC protocol implementation
- `yaak-ws`: WebSocket support
- `yaak-sse`: Server-Sent Events support
- `yaak-plugins`: Plugin system and gRPC communication
- `yaak-templates`: Template tag evaluation and dynamic values
- `yaak-sync`: Git-based workspace synchronization
- `yaak-crypto`: Encryption for secrets storage
- `yaak-models`: Core data models and database layer

## Common Commands

**Setup & Development**:
```bash
npm install                 # Install all dependencies
npm run bootstrap          # Initial setup (installs wasm-pack, builds, vendors dependencies)
npm start                  # Run the app in development mode
```

**Building & Distribution**:
```bash
npm run app-build         # Build the desktop app release binary
npm run build             # Build all workspace packages
npm run build-plugins     # Build all plugin packages
```

**Linting & Formatting**:
```bash
npm run lint              # Lint entire repo with Biome
npm run lint:biome        # Run just Biome linter
npm run lint:extra        # Run workspace-specific linters
npm run format            # Format with Biome
```

**Testing**:
```bash
npm test                  # Run tests across all workspaces
```

**Maintenance**:
```bash
npm run migration         # Create a new SQLite migration
npm run vendor            # Re-vendor external dependencies (plugins, protoc, node)
npm run replace-version   # Update version across the codebase
```

## Workspace & Package Management

This is a **monorepo using npm workspaces**. Key workspace patterns:
- Frontend app: `src-web/`
- Tauri/Rust backend: `src-tauri/` (also a Cargo workspace)
- Common packages: `packages/`
- Plugins: `plugins/`

The root `package.json` uses workspace scripts with `--workspaces --if-present` flags, so many commands run across all packages that define them. For single package operations, run commands from that package's directory.

## Development Workflow

1. **Starting development**: `npm start` runs Tauri in dev mode with hot reload for React
2. **Making frontend changes**: Edit files in `src-web/` — Vite dev server handles rebuilding
3. **Making backend changes**: Rust changes in `src-tauri/` require restarting Tauri dev server
4. **Database migrations**: Use `npm run migration` to create new migrations, then restart the app to apply them
5. **Plugin development**: Plugins are built via workspace scripts; changes require rebuilds

## Code Style & Standards

- **Biome** handles linting and formatting for JS/TS/JSON
- **TypeScript**: Strict mode enabled; no unchecked indexed access
- **Formatting**: Single quotes, double quotes for JSX, trailing commas, semicolons always
- **Line width**: 100 characters
- **Rust**: Uses `rustfmt` for formatting (config in `rustfmt.toml`)

## Database & Migrations

The app uses SQLite with separate databases for development and production builds (for safety). Create new migrations from the `src-tauri/` directory using the provided npm script; they apply automatically on app restart.

## Important Notes

- Yaak only accepts contributions for **bug fixes** (see README.md)
- The plugin system communicates with the app via **gRPC over the Node.js sidecar**
- Core plugins are vendored at build time
- Linux development requires additional system dependencies (checked by prestart script)
- Development and production builds use isolated database locations
