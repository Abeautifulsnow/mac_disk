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
- **Performance Optimized**: Parallel processing with Rayon, efficient metadata caching
- **Progressive Results**: Files are displayed as they're discovered

### ⚡ **Smart Filtering**
- **Size Threshold**: Set minimum file size to filter out small items
- **Result Limits**: Control the number of results displayed
- **Timeout Protection**: Prevent long-running scans with configurable timeouts
- **Depth Control**: Automatic depth limiting for system protection

### 🛡️ **Safety Features**
- **System Directory Protection**: Automatically blocks deletion of critical macOS system directories (`/system`, `/library`, `/usr`, etc.)
- **Confirmation Dialogs**: All deletions require explicit user confirmation
- **Path Validation**: Backend validates all file paths before operations
- **Error Handling**: Comprehensive error reporting with user-friendly messages

### 💻 **Modern UI/UX**
- **Clean Interface**: Beautiful React + Tailwind CSS interface
- **Fixed-Height Lists**: Scrollable result tables with sticky headers
- **Type Information**: File types and modified dates displayed
- **Action Controls**: Quick delete buttons with visual feedback
- **Real-time Stats**: Show files found, directories found, and total size

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
- **Rayon** for parallel processing
- **Lru** for caching
- **Tokio** for async operations

### **Development**
- **pnpm** for package management
- **TypeScript** for type safety
- **ES Modules** for modern JavaScript

## 📊 Performance Features

The scanner includes sophisticated performance optimizations:

1. **Parallel Processing**: Uses Rayon for concurrent directory traversal
2. **Efficient Metadata Reading**: Single metadata read per file, avoiding duplicate calls
3. **Thread-safe Caching**: Hash map for directory size accumulation
4. **Depth Limiting**: Prevents excessive recursion (max_depth: 100)
5. **Batch Updates**: Optimize parent directory size calculations
6. **Progress Logging**: Debug logs every 1000 processed items
7. **Performance Metrics**: Detailed timing for metadata reads, sorting, and calculations

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

- Real-time progress percentage display
- Cancel functionality for long-running scans
- Incremental results display during scanning
- Caching mechanism for frequently accessed directories
- Export results to CSV/JSON
- File type statistics and charts
- Sorting and filtering capabilities

## 📝 License

MIT License - feel free to use and modify for your projects.

---

**Built with ❤️ using Tauri, Rust, and React for macOS**

This description provides a comprehensive overview highlighting the key features, technology stack, security considerations, and development aspects of the mac-disk-scanner project. It's suitable for use as a GitHub repository description, README file, or project documentation introduction.
