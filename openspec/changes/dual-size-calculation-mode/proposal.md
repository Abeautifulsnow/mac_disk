## Why

当前应用的大小显示与 macOS `du -sh` 命令的结果不一致。后端仅计算逻辑大小（`metadata.len()`），而 `du` 报告的是磁盘使用量（`blocks * 512`）。用户无法在两种计算口径之间切换，导致数值差异令人困惑。

## What Changes

- 后端扫描逻辑同时计算逻辑大小和磁盘使用量两种尺寸
- `FileInfo` 数据模型暴露 `sizeLogical` 与 `sizeDisk` 两个序列化字段
- 前端新增"大小计算方式"切换控件（逻辑大小 / 磁盘使用量）
- 文件列表根据用户选择的模式显示对应的大小值
- 最小大小过滤支持按选定模式进行
- 扫描完成事件暴露 `resultCount`，用于区分符合条件数量与实际展示数量

## Capabilities

### New Capabilities
- `size-calculation-mode`: 支持在逻辑大小和磁盘使用量之间切换显示，扫描时同时计算两种尺寸
- `dual-size-file-info`: FileInfo 结构扩展，同时暴露 `sizeLogical` 和 `sizeDisk` 两个字段

### Modified Capabilities
<!-- 无现有 spec 需要修改 -->

## Impact

- **后端**：`scanner.rs` 中的 `create_file_info_from_metadata` 和 `create_file_info` 函数需要计算并返回两种尺寸
- **后端**：`commands.rs` 中的 `FileInfo` 结构体使用 `size_logical` / `size_disk`，序列化为 `sizeLogical` / `sizeDisk`
- **前端**：`types.ts` 中 `FileInfo` 接口包含 `sizeLogical` / `sizeDisk` 字段
- **前端**：`App.tsx` 新增 sizeMode 状态管理
- **前端**：`Scanner.tsx` 新增大小计算方式切换控件
- **前端**：`FileList.tsx` 根据 sizeMode 选择显示字段
