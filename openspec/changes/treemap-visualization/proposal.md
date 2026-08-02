## Why

可视化地图是所有竞争研究里用户点名的 #1 必备功能（DaisyDisk 的 sunburst 是它的品牌，GrandPerspective 的 treemap 是它的招牌）。当前应用只有树表/平铺两种表格视图——"扫描 → 滚动列表"的体验远谈不上"一眼看到元凶"。Phase 1 的完整索引已经把地基打好了：目录聚合完整、比例可精确到全量、查询可任意下钻，treemap 不再受截断约束。本变更把扫描结果从"表格"升级为"决策面"：打开即见谁是元凶 → 点击下钻 → 多选批量移入废纸篓。

## What Changes

- 新增 **地图视图**（树形/平铺/**地图**三态切换，持久化）：把当前目录的子项渲染为 **squarified treemap**，矩形面积正比于占用（逻辑或磁盘口径），按文件类型着色，悬停显示名称/路径/大小/占比，点击目录矩形下钻，面包屑返回。
- **数据源复用完整索引，不新增整树序列化**：地图用 `query_subtree` + `query_dir_size` 按需加载当前目录的子项与总量；超过渲染上限的剩余子项聚合为"其他"矩形，**面积始终对全量精确**。
- **扫描中实时地图**：用流式预览事件（已发现的 top 大文件/目录）渲染一张粗略地图，扫描完成切换为精确地图。
- **矩形多选 + 批量删除**：点击/Shift 点击/范围选择多个矩形，工具栏显示选中数与合计大小，经 ConfirmDialog 确认后调用新增的 `delete_paths` 后端命令批量移入废纸篓；索引一次性变更，总量/洞察重算。
- 类型着色复用前端 `categorizeFile`（后端权威分类法的镜像，已有）。
- 保留：现有树/平铺视图、口径切换、废纸篓可恢复语义、系统路径保护。

## Capabilities

### New Capabilities
- `treemap-view`: 基于查询数据的 squarified treemap 渲染（下钻、类型着色、悬停、实时预览、渲染上限 + "其他"聚合）
- `batch-delete`: `delete_paths` 批量命令与多选删除流程，批量删除后索引一致性

### Modified Capabilities
<!-- 仓库无 baseline specs，全部为新建能力 -->

## Impact

- **后端**：`commands.rs`（新增 `delete_paths` 批量命令：逐项废纸篓 + 敏感路径校验 + 索引一次性变更重算）、`lib.rs`（注册）
- **前端**：`types.ts`（`deletePath` 请求/响应、地图视图类型）、`scanApi.ts`（`deletePaths`）、新增 `TreemapView.tsx`（squarify 布局 + SVG 渲染 + 多选）、`FileList.tsx`（三态视图切换与地图视图接入）、`ConfirmDialog.tsx`（批量确认）、`App.tsx`（批量删除接线与统计同步）
- **依赖**：不新增（squarify 手写 ~120 行，复用现有 `categorizeFile`）
