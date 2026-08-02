## Why

当前扫描引擎把结果截断为 top-K（默认 50，上限 200）后一次性返回，造成三类"正确性谎言"：平铺视图的大小筛选只返回"恰好超过阈值的 top-K"，而不是所有命中项；ScanInsights 类型占比在截断样本上失真；排名 200 之后的文件不可浏览、不可删除。更关键的是，任何后续进阶能力（可视化地图、历史快照、诚实分析、清理分级）都必须基于完整数据，在截断模型上做等于在错误地基上盖楼。本次变更把扫描结果模型从"截断清单"改为"完整可查询索引"，是 Phase 1（完整而诚实的引擎）的第一个可交付物，直接消除三条正确性谎言。

## What Changes

- **BREAKING**: 扫描完成后不再通过单个 `Completed` 事件返回截断的 `results` 数组；改为在扫描期间构建完整索引，前端通过分页查询命令按需拉取结果。
- 新增完整索引：扫描保留**全部常规文件记录**与**全部目录聚合**（不受显示限制影响）。`minSize` 仅是**查询/UI 筛选参数**，不再作为索引入库的裁剪阈值——从而消除"按某口径扫描后切换口径查不到该文件"的不一致；任何文件都可被查询、浏览、删除。
- 新增分页查询命令：`query_flat_files`（服务端应用大小/时间/搜索/**类型**筛选，`kind` 区分文件/目录，`sizeMode` 决定口径维度，分页返回全部命中）、`query_subtree`（按需展开子项）、`query_dir_size`（取目录聚合大小）。
- **不完整扫描契约**：权限拒绝、I/O 错误、无法读取元数据的路径与原因进入 `unscannedRegions`；`Completed` 携带 `scanCoverage` 与 `partial` 标记；UI 必须标注"部分扫描完成"，不得显示为完整统计。
- **删除一致性**：成功移入废纸篓后，后端以原子方式从该 `scanId` 的索引移除节点及后代，回减祖先聚合，重算总量/`physicalUnique`/洞察。索引是**扫描时间点快照**，外部文件变更不反映，文案如实说明。
- 空间口径显式拆为三个维度：`sizeLogical`（内容字节，可累加）、`sizeDisk`（blocks×512 已分配字节，可累加）、`physicalUnique`（**硬链接去重后的已分配字节**；`blocks` 不可得时为 `null`，绝不回退为逻辑大小；**不可累加**，仅卷/根层级或单文件展示；APFS clone 去重不在本期）。
- 现有平铺视图筛选、ScanInsights 类型占比改为**只基于完整查询结果**计算。
- 保留：流式进度/取消/超时事件、逻辑/磁盘口径切换（无需重扫，切换后重发查询）、废纸篓删除与系统路径保护。

## Capabilities

### New Capabilities
- `scan-index-model`: 扫描构建完整可查询索引（保留全部文件记录与目录聚合），不再以 top-K 作为扫描结果模型；含不完整扫描契约与删除一致性
- `paged-queries`: 后端分页查询命令与前端按需加载契约（含 `kind`/`type`/`sizeMode` 参数、分页边界、索引失效恢复），保证查询完整性
- `size-semantics`: 三个显式空间口径（逻辑/已分配/硬链接去重物理）及其可累加性约束
- `complete-filters-insights`: 平铺筛选与扫描洞察只基于完整数据计算

### Modified Capabilities
<!-- 仓库尚无 baseline specs（openspec/specs/ 为空），本变更全部为新建能力 -->

## Impact

- **后端**：`scanner.rs`（构建完整索引与目录聚合、收集未扫描区域、`physicalUnique` 计算）、`commands.rs`（新增查询命令、`Completed` 载荷精简、`delete_path` 索引变更、`ScanIndex`/`ScanIndexManager`）、`lib.rs`（注册新命令）
- **数据契约**：`FileInfo` 增加 `physicalUnique`（可空）；`ScanEvent::Completed` 携带元数据 + 计数 + 总量 + `scanCoverage` + `insights`，不再携带 `results` 数组
- **前端**：`App.tsx`（以查询驱动结果，消费 `insights`/`scanCoverage`，删除后状态同步）、`FileList.tsx`（平铺/树视图改查询驱动，筛选/排序/搜索/类型为查询参数）、`scanInsights.ts`（消费 `insights` 载荷）、`types.ts`（同步新字段与查询类型）
- **依赖**：本次无新增第三方库；rayon/jwalk 并行化留待本变更之后的独立阶段
