## Context

Phase 1（`complete-scan-index`，已归档）建立了完整可查询索引：目录聚合完整、`query_subtree`/`query_dir_size` 按需返回子项与总量、`minSize`/`type`/`sizeMode` 为服务端查询参数。当前结果呈现只有树表（`query_subtree` 懒加载）与平铺（`query_flat_files` 分页）。本变更新增第三种呈现：**地图视图**——把当前目录子项画成面积正比于占用的嵌套矩形。

约束：复用完整索引与查询命令，不新增整树序列化；保持废纸篓可恢复、敏感路径保护、口径切换无需重扫。

## Goals / Non-Goals

**Goals:**
- 地图视图把当前目录子项渲染为 squarified treemap，矩形面积对目录总量精确。
- 点击目录下钻（重设根）、面包屑返回；悬停 tooltip（名称/路径/大小/占比）。
- 类型着色复用前端 `categorizeFile`。
- 扫描中用流式预览渲染粗略实时地图。
- 矩形多选（点击/Shift/范围）→ 批量移入废纸篓（`delete_paths`），索引一次性变更、统计同步。
- 视图模式三态（树形/平铺/地图）持久化。

**Non-Goals:**
- sunburst/环形图（先做 treemap，后续可加）。
- 单视图内渲染深层嵌套层级（用下钻代替）。
- 超大规模瓦片（用渲染上限 + "其他"聚合代替虚拟化，虚拟化留后续）。
- 拖拽交互、云盘、跨平台。

## Decisions

### 1. 数据源：`query_subtree` + `query_dir_size`，不做整树序列化

**决策：** 地图只渲染**当前 `viewPath` 的一层子项**（与树视图同源数据）。渲染所需：
- `query_dir_size(viewPath)` → 当前目录总量（逻辑/磁盘）。
- `query_subtree(viewPath, sizeMode, offset, limit)` → 子项（按大小降序），循环取页直到达到**渲染上限**或**已加载合计 ≥ 总量 × 99%**。

**理由：** 完整索引已提供这两个查询，无需后端新增整树/`treeBatch` 事件；地图与树/平铺共享同一数据模型与口径切换语义（切口径重发查询）。

### 2. 渲染上限 + "其他"聚合，比例始终对全量精确

**决策：** 渲染瓦片数上限 `MAX_TILES = 500`。超过上限的剩余子项聚合为一个"其他"矩形，其面积 = `总量 − 已加载子项合计`。因此每个矩形的面积占比 `size_i / total` 始终精确（不像 top-K 截断那样失真）。

**备选：** 无上限全量渲染 → 大目录下数万 SVG 节点卡死。**理由：** 有界渲染 + 精确聚合是正确性（比例真）与性能（有界）的平衡；用户可下钻到子目录查看更细。

### 3. 布局：手写 squarified（Bruls et al.），不引第三方图表库

**决策：** 实现经典 squarified treemap 布局（~120 行）：把矩形列表按面积降序排列，逐个铺入当前行，当"最差长宽比"继续加会变差时把该行压扁为一行，再开新行。输出每个瓦片的归一化 `(x, y, w, h)`，用 SVG `<rect>` 渲染。

**备选：** d3-hierarchy（~30KB）。**理由：** squarify 算法成熟且实现简单，避免新增前端依赖；`categorizeFile` 已有，类型→颜色映射一张表即可。

### 4. 下钻交互：重设根而非嵌套

**决策：** 点击目录矩形 → `viewPath = 该目录` → 地图重渲染其子项；面包屑返回。**理由：** 与树视图导航一致、查询有界、符合 DaisyDisk 的 re-root 心智模型。不做嵌套展开（那需要多级同时渲染，突破渲染上限）。

### 5. 扫描中实时地图：复用流式预览

**决策：** `isPreview` 时，把 `previewItems`（已发现的 top 大文件/目录）按各自大小渲染为一张粗略 squarified 地图（比例为预览项彼此之和），扫描完成后切换为精确地图。**理由：** 保留"扫描中已有画面"的实时感，成本低（复用同一 squarify + 渲染）。

### 6. 多选 + 批量删除：`delete_paths` 命令 + 索引一次性变更

**决策：** 前端维护 `selectedPaths: Set<string>`（点击单选、Shift 连续、点击空白清空）；选中后出现工具条"已选 N 项 · X GB → 移到废纸篓"。确认走扩展后的 ConfirmDialog（批量列表 + 合计大小）。

后端新增：
```rust
#[command]
pub async fn delete_paths(index_manager, paths: Vec<String>, scan_id: Option<String>) -> Result<DeleteResult, String>
```
- 逐路径校验存在性与 `is_sensitive_path`（任一敏感 → 整体拒绝，避免部分删除）。
- 在 `spawn_blocking` 中用 osascript 逐项移到废纸篓，收集每项结果。
- 全部成功后，对所属索引：对每个路径 `delete_subtree`，**只重算一次**聚合/总量/洞察；返回 `DeleteResult { message, updated: Option<IndexSummary> }`（复用 Phase 1 结构）。
- 部分失败：返回成功/失败路径与更新后的摘要；成功移入废纸篓的项立即从索引删除，失败项保留，确保索引反映实际磁盘状态。

**理由：** 一次索引变更 + 一次统计同步，与单删 `delete_path` 行为一致；失败不落库保持一致性。

### 7. 视图模式三态与持久化

**决策：** FileList 的视图切换由两态（树形/平铺）扩展为三态（树形/平铺/**地图**），存储键 `RESULT_VIEW_MODE_STORAGE_KEY` 值扩展为 `tree|flat|map`。地图视图与平铺共用筛选语义？——地图默认不套用 `type`/`minSize` 筛选（它是空间全貌视图）；若设置了 `type` 筛选，地图仅高亮该类型瓦片（不重排），并提示"类型筛选仅对平铺视图生效"。

## Risks / Trade-offs

- **[Risk] 大目录的加载与渲染**：子项数十万时逐页拉取至上限仍可能较慢。
  **Mitigation:** 渲染上限 500 + "其他"聚合；分页拉取在达到上限或 99% 即停；必要时后续加虚拟化。
- **[Risk] squarify 数值精度**：极小瓦片（占比 < 0.01%）坐标取整后可能重叠或消失。
  **Mitigation:** 低于最小像素阈值的瓦片聚合进"其他"；取整用 floor 保证不重叠。
- **[Risk] 批量删除部分失败导致状态不一致**：某些路径废纸篓失败。
  **Mitigation:** 返回每条路径的结果；仅从索引删除实际进入废纸篓的项，失败项继续可见并显示错误。
- **[Risk] 类型着色漂移**：前端 `categorizeFile` 与后端分类法不一致。
  **Mitigation:** 沿用 Phase 1 的一致性测试约束（后端权威、前端镜像）；地图颜色仅用于着色，不参与查询。
- **[Risk] 多选跨分页/跨目录**：选中集按路径存，删除后 `listVersion` 重载清空选中。
  **Mitigation:** 删除成功后清空 `selectedPaths`；索引变更保证已删项不复活。

## Migration Plan

1. **后端：** 新增 `delete_paths` 命令 + 单元测试（批量删除后索引一致、敏感路径整体拒绝、部分失败不落库）。
2. **前端：** `squarify.ts`（布局 + 最小阈值聚合）、`TreemapView.tsx`（SVG 渲染、tooltip、下钻、多选、实时预览）、`ConfirmDialog` 批量模式、FileList 三态切换与地图视图接入、`scanApi.deletePaths`。
3. **收尾：** `cargo test` + `pnpm build` 通过；手动验证（下钻、多选删除、口径切换、实时地图）。

## Open Questions

- 地图视图是否需要 `kind`（文件/目录）过滤？（本设计：默认全部；目录瓦片可下钻，文件瓦片可选中删除。）
- 批量删除的 osascript 单脚本多路径 vs 逐项调用？（本设计：逐项调用、失败即止；性能非瓶颈，正确性优先。）
