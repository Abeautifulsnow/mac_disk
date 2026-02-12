# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Tauri desktop application** for macOS disk space management (macOS磁盘扫描工具). The application scans directories to find large files and folders, allowing users to identify and delete space-consuming items.

**Architecture:**
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Rust + Tauri 2.0
- **Package Manager**: pnpm
- **Development Server**: Port 1420

## Common Development Commands

### Frontend Development
```bash
pnpm dev          # Start development server (Vite)
pnpm build        # Build frontend (TypeScript + Vite)
pnpm preview      # Preview production build
```

### Tauri Development
```bash
pnpm tauri dev    # Start Tauri development (frontend + backend)
pnpm tauri build  # Build Tauri application for production
```

### Backend (Rust) Development
```bash
cargo build       # Build Rust backend
cargo run         # Run Rust application directly
```

## Project Structure

```
├── src/                    # Frontend React application
│   ├── App.tsx            # Main application component
│   ├── components/        # React components
│   │   ├── Scanner.tsx    # Scanning controls UI
│   │   ├── FileList.tsx   # Results display component
│   │   └── ConfirmDialog.tsx # Delete confirmation dialog
│   ├── types.ts           # TypeScript type definitions
│   └── main.tsx           # React entry point
│
├── src-tauri/             # Backend Rust application
│   ├── src/
│   │   ├── lib.rs         # Tauri application setup
│   │   ├── commands.rs    # Tauri command handlers
│   │   └── scanner.rs     # Core disk scanning logic
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
│
├── package.json           # Node.js dependencies and scripts
├── vite.config.ts         # Vite build configuration
├── tailwind.config.js     # Tailwind CSS configuration
└── tsconfig.json          # TypeScript configuration
```

## Key Architecture Patterns

### Frontend-Backend Communication
- **Tauri Commands**: Frontend calls Rust functions via `invoke()` API
- **Commands** (`src-tauri/src/commands.rs`):
  - `scan_directory`: Recursively scans directory, returns large files/folders
  - `delete_path`: Deletes files/directories with safety checks
- **Data Flow**: User input → React component → Tauri command → Rust scanner → Results display

### Disk Scanning Logic
- **Scanner Module** (`src-tauri/src/scanner.rs`): Uses `walkdir` crate for recursive traversal
- **Performance**: Has TODO comment about poor performance - consider optimization
- **Safety**: Prevents deletion of system directories (`/system`, `/library`, `/usr`, etc.)
- **Configuration**: Minimum file size and result limit filters

### State Management
- **React State**: Local component state in `App.tsx` (files, loading, error, confirmDelete)
- **Type Safety**: Strong TypeScript types defined in `src/types.ts`
- **UI Components**: Modular components with Tailwind CSS styling

## Security Considerations

1. **Path Validation**: Backend validates all file paths before operations
2. **System Protection**: Blocks deletion of critical macOS system directories
3. **User Confirmation**: Frontend confirmation dialog for all deletions
4. **Error Handling**: Comprehensive error handling in both frontend and backend

## Development Notes

### Performance
- The scanner has a TODO comment about poor performance in `scanner.rs`
- Consider optimizing directory traversal or adding progress indicators
- Current implementation uses `walkdir` crate with configurable limits

### Testing
- No test infrastructure currently exists
- Consider adding:
  - Rust unit tests for scanner logic
  - React component tests
  - Integration tests for Tauri commands

### Build Configuration
- **Frontend**: Vite with React plugin, TypeScript, Tailwind CSS
- **Backend**: Tauri 2.0 with custom protocol feature enabled
- **Development**: DevTools automatically open in debug mode

### Permissions
- `.claude/settings.local.json` defines allowed Bash commands for Claude Code
- Includes permissions for Tauri development commands and package management

## Recent Optimizations (2026-01-24)

### Performance Improvements to `scan_directory`
1. **Reduced metadata reads**: Added `create_file_info_from_metadata()` to avoid duplicate `std::fs::metadata()` calls
2. **Optimized directory size calculation**: Thread-safe `Arc<Mutex<HashMap>>` for directory size tracking
3. **Depth limiting**: Added `max_depth(100)` to prevent excessive recursion
4. **Batch updates**: `update_parent_sizes_optimized()` batches parent directory updates
5. **Progress logging**: Tracing debug logs every 1000 processed items
6. **Skip root directory**: `min_depth(1)` improves traversal efficiency

### UI/UX Improvements
1. **Fixed-height file list**: `calc(100vh - 280px)` height with vertical scrolling
2. **Separate header/body tables**: Header remains fixed while body scrolls
3. **Better column width distribution**: Name (60%), Type (8%), Size (16%), Modified (16%), Actions (8%)
4. **Improved file selector**: Added dialog plugin configuration and error handling
5. **Enhanced error display**: Visual error feedback for file selector failures

### Configuration Updates
1. **Dialog plugin enabled**: Added to `tauri.conf.json` with default path configuration
2. **Error handling**: User-friendly error messages for file system access issues

### Further Optimization Opportunities
1. **Real-time progress**: Add progress percentage display during scanning
2. **Cancel functionality**: Allow users to cancel long-running scans
3. **Parallel processing**: Consider `rayon` for concurrent directory traversal
4. **Incremental results**: Display large files as they're discovered
5. **Caching mechanism**: Cache scan results for frequently accessed directories

## Common Tasks

### Adding New Tauri Commands
1. Define command in `src-tauri/src/commands.rs`
2. Add handler to `invoke_handler` in `src-tauri/src/lib.rs`
3. Call from frontend using `invoke()` API

### Adding New React Components
1. Create component in `src/components/`
2. Import and use in `App.tsx` or other components
3. Follow existing patterns for TypeScript types and Tailwind styling

### Modifying Scanner Logic
1. Edit `src-tauri/src/scanner.rs` for core scanning logic
2. Update `ScanOptions` in `src-tauri/src/commands.rs` if needed
3. Adjust frontend UI in `src/components/Scanner.tsx`

## Troubleshooting

### Build Issues
- Ensure pnpm is installed: `npm install -g pnpm`
- Rust toolchain: `rustup update`
- Tauri CLI: `cargo install tauri-cli`

### Development Server
- Frontend runs on port 1420 by default (configured in `vite.config.ts`)
- Tauri dev mode opens native window with embedded webview
- DevTools automatically open in debug builds