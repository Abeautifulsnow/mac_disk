# mac-disk-scanner

**A professional macOS disk space analyzer and cleanup tool built with Tauri, Rust, and React**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightblue.svg)](macos)
[![Rust](https://img.shields.io/badge/Rust-1.76+-orange.svg)](https://rust-lang.org)
[![React](https://img.shields.io/badge/React-18+-blue.svg)](https://reactjs.org)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-purple.svg)](https://tauri.app)

A high-performance desktop application for macOS that helps you identify and manage space-consuming files and directories. Built with modern web technologies and native Rust performance.

## ✨ Key Features

### 🔍 **Intelligent Disk Scanning**
- **Recursive Directory Analysis**: Deep scan any directory to find large files and folders
- **Real-time Progress Tracking**: Live updates with estimated time remaining (ETA)
- **Performance Optimized**: Single-pass streaming traversal with bounded top-K retention and efficient metadata reuse
- **Progressive Scan Status**: Progress events show discovery and processing phases, and matching previews appear during the scan before final results are committed

### ⚡ **Complete & Honest Index**
- **No result truncation**: the scan builds a complete queryable index — every regular file is queryable, browsable, and deletable (the old top-K display cap is gone)
- **Server-side filters**: flat-view size / time / search / type filters run against the complete index and return every match, never a truncated subset
- **Partial-scan honesty**: permission-denied and I/O errors are recorded as unscanned regions; partial scans are explicitly labeled, never presented as complete statistics
- **Three size dimensions**: logical size, allocated disk bytes (`blocks × 512`), and hard-link-deduplicated allocated bytes (non-additive; surfaced at scan-root or file level only)
- **Timeout Protection**: prevent long-running scans with configurable timeouts

### 🛡️ **Safety Features**
- **System Directory Protection**: Automatically blocks deletion of critical macOS system directories (`/system`, `/library`, `/usr`, etc.)
- **Trash-first, recoverable**: deletions move items to the Trash and are recoverable until the Trash is emptied — never permanent
- **Scan-time snapshot**: results reflect the disk at scan completion; in-app deletions keep the index consistent, while external changes require a rescan
- **Path Validation**: Backend validates all file paths before operations
- **Error Handling**: Comprehensive error reporting with user-friendly messages

### 💻 **Modern UI/UX**
- **Clean Interface**: Beautiful React + Tailwind CSS interface
- **Fixed-Height Lists**: Scrollable result tables with sticky headers
- **Type Information**: File types and modified dates displayed
- **Action Controls**: Quick delete buttons with visual feedback
- **Clear Scan Stats**: Separates total scanned size, matched item counts, and displayed result count

## 📐 Data Contract

The scan result contract uses explicit size fields across Rust and TypeScript:

- `sizeLogical`: logical file content size from `metadata.len()`
- `sizeDisk`: allocated disk usage from `metadata.blocks() * 512`; when blocks are zero the value is `0` (never falls back to logical size)
- `physicalUnique`: allocated bytes after hard-link deduplication (per inode counted once; **non-additive** — never presented as a summable directory size)
- `physicalUniqueTotal`: deduplicated allocated bytes for the whole scan root
- `totalSizeLogical` / `totalSizeDisk`: total bytes scanned for the requested root
- `filesFound` / `directoriesFound`: all files and directories scanned (no truncation)
- `scanCoverage`: entry count plus `unscannedRegions` (path + reason) and a `partial` flag for incomplete scans

## 🛠️ Technology Stack

### **Frontend**
- **React 18** with TypeScript
- **Vite** for fast development and builds
- **Tailwind CSS** for styling
- **Lucide React** for icons

### **Backend**
- **Rust** for native performance
- **Tauri 2.0** for desktop framework
- **Walkdir** for directory traversal
- **Lru** for caching
- **Tokio** for async operations

### **Development**
- **pnpm** for package management
- **TypeScript** for type safety
- **ES Modules** for modern JavaScript

## 📊 Performance Features

The scanner builds a complete, queryable in-memory index (arena-based compact nodes):

1. **Streaming Traversal**: Processes each `WalkDir` entry once, inserting every regular file into the index
2. **Complete Retention**: Every regular file is retained and queryable — no top-K truncation; directory aggregates are always complete
3. **Efficient Metadata Reading**: Single metadata read per file, avoiding duplicate calls
4. **Bounded Live Previews**: Preview events are emitted for large files (≤ 200 events) so the UI shows progress without flooding
5. **Incremental Directory Aggregation**: Parent directory aggregates are computed bottom-up after the walk
6. **Hard-link awareness**: Deduplicated allocated bytes are computed via `(dev, inode)` tracking
7. **Coverage tracking**: Permission-denied / I/O failures are recorded as unscanned regions

## 🚀 Development

### **Setup**
```bash
pnpm install
```

### **Dev Mode**
```bash
pnpm tauri dev
```

### **Build**
```bash
pnpm tauri build
```

## 📁 Project Structure

```
mac_disk/
├── src/                    # React frontend
│   ├── App.tsx            # Main application
│   ├── components/        # React components
│   │   ├── Scanner.tsx    # Scanning UI
│   │   ├── FileList.tsx   # Results display
│   │   └── ConfirmDialog.tsx # Delete confirmation
│   └── types.ts          # TypeScript definitions
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── lib.rs        # Tauri setup
│   │   ├── commands.rs   # Command handlers
│   │   └── scanner.rs    # Core scanning logic
│   └── Cargo.toml        # Rust dependencies
```

## 🎯 Use Cases

- **Disk Cleanup**: Identify largest files taking up space
- **System Maintenance**: Monitor disk usage patterns
- **Development**: Find temporary files and build artifacts
- **Backup Planning**: Understand data distribution before backups
- **Troubleshooting**: Diagnose disk space issues

## 🔒 Security

- **Path Validation**: All paths are validated before file operations
- **System Protection**: Critical macOS directories are protected
- **User Confirmation**: Deletions require explicit approval
- **Error Handling**: Graceful failure with informative messages

## 💡 Future Enhancements

- Parallel scanning (rayon/jwalk) for full-volume speed
- Whole-volume scan UX with per-volume overview
- Interactive treemap visualization rendering live during the scan
- Categorized "reclaimable space" report with safe, undoable batch cleanup
- Scan history / "what changed since last scan" diffing

## 📝 License

MIT License - feel free to use and modify for your projects.

---

**Built with ❤️ using Tauri, Rust, and React for macOS**

This description provides a comprehensive overview highlighting the key features, technology stack, security considerations, and development aspects of the mac-disk-scanner project. It's suitable for use as a GitHub repository description, README file, or project documentation introduction.
