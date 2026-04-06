## Context

当前应用已完成双尺寸计算的基础实现（`dual-size-calculation-mode`），后端同时计算 `size` 和 `disk_usage`，前端有 `sizeMode` 切换控件。但存在两个问题：

1. **右上角总大小不随模式切换更新**：`headerTotalSize` 依赖 `scanStats.totalSize`（后端 Completed 事件返回），切换 `sizeMode` 仅改变列表项显示，不触发重新计算。
2. **字段命名不统一**：后端使用 `size`/`disk_usage`，前端使用 `size`/`diskUsage`，语义不够清晰。

现有架构：
- 后端已有并行计算（`rayon`），同时产出两种尺寸
- 前端已有 `sizeMode` 状态和切换 UI
- `FileInfo` 已有 `size` 和 `disk_usage` 字段

## Goals / Non-Goals

**Goals:**
- 切换 sizeMode 时右上角总大小即时更新，无需重新扫描
- 统一字段命名为 `size_logical`/`size_disk`（后端）和 `sizeLogical`/`sizeDisk`（前端）
- 前端列表项显示和排序统一使用新字段
- 保持向后兼容，不破坏现有 API

**Non-Goals:**
- 不改变扫描算法核心逻辑
- 不引入新的外部依赖
- 不修改后端 Completed 事件的 total_size 计算（保持兼容）

## Decisions

### 1. 前端本地重新计算总大小
**决策：** 切换 sizeMode 时，前端对已加载的 `files` 数组按当前模式重新求和，更新 `displayedSize` 作为 header 显示。

**理由：**
- 零后端开销，即时响应
- 数据已在客户端，无需网络往返
- 与现有 `displayedSize` 计算逻辑一致，只需调整字段引用

### 2. 字段命名统一
**决策：** 后端 `FileInfo` 将 `size` 重命名为 `size_logical`，`disk_usage` 重命名为 `size_disk`。前端对应为 `sizeLogical`/`sizeDisk`。

**理由：**
- `size_logical`/`size_disk` 语义更清晰，避免歧义
- 与前端 `sizeMode` 的 `"logical"`/`"disk"` 值对齐
- 旧字段名 `size` 含义模糊（是逻辑大小还是磁盘大小？）

### 3. 排序一致性
**决策：** 后端排序仍按 `size_logical` 进行（默认模式），前端不重新排序。若用户切换到 disk 模式后希望按磁盘大小排序，可后续迭代。

**理由：**
- 保持最小改动
- 大多数用户按逻辑大小排序已满足需求
- 前端排序增加复杂度，暂不引入

## Risks / Trade-offs

### [Risk] 字段重命名是 BREAKING 变更
**Mitigation:** 此变更仅影响前后端内部通信，不涉及外部 API。前端和后端同步更新即可。

### [Risk] 前端求和与后端 total_size 可能有轻微差异
**Mitigation:** 后端 `total_size` 基于扫描过程中累加的值，前端基于最终结果数组求和。若后端对结果做了截断（limit），两者可能不一致。当前设计已使用 `displayedSize`（前端求和）作为 fallback，行为一致。

### [Trade-off] 排序不随模式切换
**Mitigation:** 记录为后续优化项，当前优先解决总大小不更新的核心问题。
