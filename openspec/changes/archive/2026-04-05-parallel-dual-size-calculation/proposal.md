## Why

切换左下角"逻辑大小"/"磁盘使用量"按钮时，右上角"总扫描大小"不会自动更新。原因是该值依赖后端扫描完成时返回的 `Completed.total_size`，而切换模式仅改变前端显示口径，未触发重新计算。用户看到列表项大小变化但总计不变，造成困惑。

## What Changes

- 前端在扫描完成时基于 `sizeMode` 对结果重新计算总大小，切换模式时即时更新
- 后端 `FileInfo` 统一字段命名为 `size_logical` 和 `size_disk`，更清晰表达两种口径
- 后端扫描逻辑确保两种尺寸在并行计算中同时产出
- 前端列表项和排序逻辑统一使用新字段名

## Capabilities

### New Capabilities
- `frontend-total-recalculation`: 前端基于 sizeMode 对扫描结果本地重新计算总大小，切换模式时即时更新
- `parallel-dual-size-computation`: 后端并行计算逻辑大小和磁盘使用量，提升扫描效率

### Modified Capabilities
- `size-calculation-mode`: 字段命名从 `size`/`disk_usage` 统一为 `size_logical`/`size_disk`，前端显示和排序逻辑适配

## Impact

- **后端**：`commands.rs` 中 `FileInfo` 字段重命名
- **后端**：`scanner.rs` 中并行计算逻辑确保两种尺寸同时产出
- **前端**：`types.ts` 中 `FileInfo` 字段重命名为 `sizeLogical`/`sizeDisk`
- **前端**：`App.tsx` 中总大小计算改为前端本地重新计算
- **前端**：`FileList.tsx` 中大小显示和排序使用新字段名
- **前端**：`Scanner.tsx` 中切换控件无需改动（已通过 props 传递）
