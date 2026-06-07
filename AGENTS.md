# AGENTS.md

This file provides guidance to AI assistants working in this repository.

## Project Overview

**mac-disk-scanner** — a Tauri 2.0 desktop application for macOS disk space management. Scans directories to find large files and folders, allowing users to identify and delete space-consuming items.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Rust, Tauri 2.0, walkdir |
| Package Manager | pnpm |
| Dev Server | Port 1420 |

## Project Structure

```
├── src/                        # Frontend React app
│   ├── App.tsx                 # Main component, state management
│   ├── components/
│   │   ├── Scanner.tsx         # Scan controls UI
│   │   ├── FileList.tsx        # Results display (fixed header + scrollable body)
│   │   └── ConfirmDialog.tsx   # Delete confirmation
│   ├── types.ts                # TypeScript type definitions
│   └── main.tsx                # React entry point
│
├── src-tauri/                  # Backend Rust app
│   ├── src/
│   │   ├── lib.rs              # Tauri app setup, command registration
│   │   ├── commands.rs         # Tauri command handlers (scan_directory, delete_path)
│   │   └── scanner.rs          # Core disk scanning logic
│   ├── Cargo.toml              # Rust dependencies
│   └── tauri.conf.json         # Tauri configuration + dialog plugin
│
├── package.json                # Node dependencies + scripts
├── vite.config.ts              # Vite config
├── tailwind.config.js          # Tailwind config
└── tsconfig.json               # TypeScript config
```

## Commands

```bash
pnpm dev            # Start Vite dev server
pnpm build          # Build frontend
pnpm tauri dev      # Full Tauri dev (frontend + backend)
pnpm tauri build    # Production build
cargo build         # Build Rust backend only
```

## Architecture

### Frontend ↔ Backend Communication
- Tauri Commands: frontend calls Rust via `invoke()` API
- `scan_directory(path, options)` — recursive scan, returns file/folder info
- `delete_path(path)` — deletes with safety checks (blocks system dirs)

### Key Backend Details
- Uses `walkdir` with `max_depth(100)`, `min_depth(1)`
- Thread-safe directory size tracking: `Arc<Mutex<HashMap>>`
- Batched parent directory size updates
- Progress logging every 1000 items via tracing

### Security
- Path validation on all file operations
- Blocks deletion of `/system`, `/library`, `/usr`, etc.
- Frontend confirmation dialog before any deletion

## Conventions

- Frontend state lives in `App.tsx` (no external state library)
- TypeScript types in `src/types.ts`
- Tailwind for all styling (no CSS modules)
- Rust errors converted to strings for Tauri commands
- Column widths in FileList: Name 60%, Type 8%, Size 16%, Modified 16%, Actions 8%

## Known Issues / TODOs

- Scanner performance has room for optimization (see `scanner.rs` TODO)
- No test infrastructure yet (no Rust tests, no React tests)
- No real-time progress indicator during scan
- No cancel functionality for long-running scans
