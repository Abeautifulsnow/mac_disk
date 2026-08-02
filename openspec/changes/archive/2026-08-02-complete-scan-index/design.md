## Context

当前扫描引擎（`scanner.rs`）在遍历时已正确累积了**全部**目录聚合（`dir_sizes: HashMap<PathBuf, (u64, u64)>`），但随后丢弃到只剩 top-K：文件按 `retain_top_files` 保留全局前 K 个，目录按 `take(l)` 截断，`ScanEvent::Completed` 一次性携带截断后的 `results: Vec<FileInfo>` 给前端。前端 `App.tsx` 通过 `setFiles(payload.results)` 把截断结果放进 React 状态，`FileList.tsx` 在其上做树构建、筛选、排序，`scanInsights.ts` 在其上做类型占比。

这造成三类"正确性谎言"：大小筛选只命中"恰好超过阈值的 top-K"；类型占比在截断样本上失真；排名 200 之后的文件不可达。**此外还有四个会破坏"完整而诚实"承诺的既有行为：**`scanner.rs:179-180` 按扫描时选定的口径（逻辑/磁盘）判 `min_size` 阈值，导致切换口径后部分文件永久不可见；`scanner.rs:140` 与 `:150-154` 把 WalkDir/metadata 错误静默跳过，不完整扫描被伪装成完整；删除（`App.tsx` 仅从 React 数组移除）在查询驱动模型下会使后端索引陈旧；`compute_disk_usage`（`scanner.rs:389`）在 `blocks == 0` 时回退逻辑大小，把稀疏文件的实际占用报大。

约束：存量功能（流式进度/取消/超时、废纸篓删除、系统路径保护、树/平铺视图与键盘导航）必须保持可用；本次不引入并行扫描、整盘扫描、treemap、快照持久化。

## Goals / Non-Goals

**Goals:**
- 移除 top-K 作为扫描结果模型：扫描构建完整索引，**保留全部常规文件记录与全部目录聚合**；任何文件可被查询、浏览、删除。
- `minSize` 仅是查询/UI 筛选参数，不是索引入库阈值；因此索引与口径选择无关，切换逻辑/磁盘口径不丢失任何可筛文件。
- 目录聚合大小永远完整（不受显示限制影响）。
- 新增分页查询命令（`query_flat_files` / `query_subtree` / `query_dir_size`），筛选、排序、类型、口径在服务端完成，查询结果完整；定义分页边界、错误与索引失效恢复。
- **不完整扫描契约**：权限拒绝、I/O 错误、元数据读取失败以 `unscannedRegions`（路径+原因）记录；`Completed` 携带 `scanCoverage` 与 `partial` 标记；UI 明确标注"部分扫描完成"。
- **删除一致性**：成功移入废纸篓后原子变更索引（移除节点及后代、回减祖先聚合、重算总量/`physicalUnique`/洞察），并如实说明"结果是扫描时间点快照"。
- 空间口径显式拆为三：逻辑大小、已分配磁盘字节、**硬链接去重后的已分配字节**；UI 遵守"去重物理空间不可累加"约束。
- 平铺筛选与 ScanInsights 只基于完整数据。
- 保留流式预览、口径切换（切换后重发查询）、安全删除。

**Non-Goals:**
- 并行扫描（rayon/jwalk）与整盘扫描（后续独立阶段）。
- Treemap/可视化地图（后续阶段，消费本索引）。
- 快照持久化与历史对比（后续阶段；本索引结构与 LRU 管理层为其预留形态）。
- **APFS clone / CoW 去重**（`physicalUnique` 仅做硬链接去重，命名与文案如实限定）。
- 重复文件检测、清理分级、批量删除。
- 删除流程行为本身不变（废纸篓 + 系统路径保护），但成功删除会同步变更索引（见 Goals）。
- 显示数量限制滑块（旧 top-K 概念）——本变更移除该 UI 概念，页面大小改为查询内部分页参数。

## Decisions

### 1. 索引形态：arena 紧凑索引，保留全部文件记录

**决策：** Rust 侧构建 arena 索引 `ScanIndex`，节点为紧凑数组（非 `Vec<FileInfo>` 字符串堆），存于按 `scanId` 管理的全局状态中；前端从不接收完整树，只通过查询命令按需拉取。**索引保留全部常规文件记录**——`minSize` 不再在遍历时裁剪（见决策 2），因此索引与扫描时选择的口径无关。

结构（示意）：
```
Node { parent: i32 /* -1=root */, first_child: i32, next_sibling: i32,
       name_off: u32, name_len: u16, // 指向连续路径缓冲
       size_logical: u64, size_disk: u64, physical_unique: u64,
       modified: u32, is_dir: u8 }
```
- 每个节点约 48B（路径以连续字节缓冲 + 偏移保存）；500 万文件 ≈ 240MB，在 **512MB 内存预算**内。
- `(dev, ino)` 去重仅在**构建期**用临时 `HashSet<(u32, u64)>` 完成：inode 首次出现时 `physical_unique = blocks*512`，重复出现为 0；不驻留每节点（省 12B/节点）。
- 目录聚合大小在扫描后自底向上后序遍历一次计算（现有 `dir_sizes` 增量累积可复用）。

**备选：** 保留 `Vec<FileInfo>`（每个节点含独立 `String` path）→ 每节点 ~100B+，且序列化整树撑爆 IPC。**理由：** arena + 紧凑字段 + 分页查询同时解决内存与 IPC 规模；"保证查询完整，而非 UI 一次渲染完整"。

**内存预算与淘汰：** 索引 ≤ 512MB；`ScanIndexManager` 复用已依赖的 `lru` crate，保留最近 2 次扫描，淘汰后前端查询报 `IndexNotFound`（见决策 7）。若未来需要，可提供"仅索引 ≥ N MB 文件"的显式 opt-in（那将把产品承诺降级为"完整目录聚合 + 阈值以上文件索引"），本期不做。

### 2. `minSize` 是查询/UI 筛选，不是索引入库阈值

**决策：** 扫描始终保留全部文件记录；`ScanOptions.minSize` 不再参与遍历裁剪（标记为 deprecated，扫描端忽略）。`minSize` 成为 `query_flat_files` 的查询参数，作用于**当前** `sizeMode` 维度（逻辑或磁盘）。切换口径 = 重发查询，同一记录因索引完整而必然可达。

**理由：** 消除 `scanner.rs:179` 的口径依赖缺陷——"按磁盘口径 + 10MB 扫描，稀疏文件（大逻辑/小磁盘）不入库，切逻辑口径永远查不到"不再发生。索引完整性不再依赖扫描时用户选的口径。

**代价：** 全部常规文件入库，内存按决策 1 的预算与淘汰管理；平铺视图默认页可通过 `minSize`/分页控制展示量。

### 3. 查询契约：三个命令，服务端完成筛选/排序/类型/口径

**决策：** 新增三个 Tauri 命令，全部以 `scanId` 作用域：

- `query_flat_files(scanId, filters, sort, page)` → `{ items, total, hasMore }`。`filters` 含 `minSize`、`modifiedWindow`（30d/180d/365d/all）、`searchQuery`（名称/路径子串）、**`kind`（all|files|dirs，默认 all 保持混排）**、**`type`（类型分桶标签，来自洞察分类器；null=全部）**；`sort` 为 `size|modified|name`，方向可逆；**`sizeMode`（logical|disk）决定筛选与排序使用哪个维度**。
- `query_subtree(scanId, path, page)` → 目录子项（文件 + 子目录，目录含聚合大小），分页、按大小降序；展开完整，不做 `minSize` 裁剪。
- `query_dir_size(scanId, path)` → 目录聚合大小（逻辑/磁盘），不含子项。

**备选：** 继续前端加载全部命中后本地筛选 → 分页后"只看这类"退化为只筛当前页，且大数据集往返过多。**理由：** 筛选/排序/类型/口径全部下沉服务端，一次查询即得完整命中集；前端只保留展开/选择等交互状态。

**口径切换语义：** 切换 `sizeMode` 后重发 `query_flat_files`（维度换列），不再前端重排。

### 4. `Completed` 事件载荷精简（BREAKING）与覆盖契约

**决策：** `ScanEvent::Completed` 不再携带 `results: Vec<FileInfo>`，改为：
- 元数据：`scanId`、`root`、扫描选项；
- 计数：`filesScanned`（= 全部文件数）、`directoriesScanned`、`resultCount`（本次变更后指索引内记录总数，语义与旧"匹配数"区分并更新文案）；
- 总量：`totalSizeLogical`、`totalSizeDisk`、`physicalUniqueTotal`；
- **覆盖：`scanCoverage`（见下）**；
- 洞察：`insights`（类型分桶 top-6、最大目录、最大文件、近期/久未大文件）。

**不完整扫描契约（新增）：** 遍历期间收集 `unscannedRegions: Vec<{ path, reason }>`，`reason ∈ { permission-denied, io-error, metadata-error, symlink-loop }`；只记录**最顶层**失败路径（祖先已记录的子路径跳过，避免海量重复）；`scanCoverage = { scannedEntries, unscannedRegions, partial }`，`partial = !unscannedRegions.is_empty()`。`Completed` 始终携带 `scanCoverage`；UI 在 `partial` 时于头部显示"部分扫描完成：N 个区域不可访问"，并提供区域列表查看。

**收集实现：** `WalkDir::into_iter` 的 `Err` 条目调用 `err.path()` 与 `err.io_error()` 分类记录；`entry.metadata()` 失败同样记录（`metadata-error`）。这些错误当前在 `scanner.rs:140` 与 `:153` 被静默跳过——改为同时写入 `unscannedRegions`。

### 5. 三空间口径与"不可累加"约束

**决策：** `FileInfo` 增加 `physicalUnique: Option<u64>`。语义与命名：
- `sizeLogical` = `metadata.len()`，可累加。
- `sizeDisk` = `blocks * 512`（可累加）。**`compute_disk_usage` 移除 `blocks == 0` 时回退逻辑大小的分支**：`blocks == 0` 时 `sizeDisk` 与 `physicalUnique` 置为 `null`（标为未知），绝不回退逻辑大小——稀疏文件的实际占用不再被报大。
- `physicalUnique` = **硬链接去重后的已分配字节**（构建期按 `(dev, ino)` 首现计入）；当 `blocks` 不可得时为 `null`。**不可累加**——目录的 `physicalUnique` 不对任何展示目的开放为可加数字。APFS clone / CoW 去重不在本期，命名与文案不得声称"物理真实占用"。

UI 规则（写进 spec）：目录大小永远用 `sizeLogical` 或 `sizeDisk`（可累加口径）；`physicalUnique` 仅在**扫描根/卷层级**（`physicalUniqueTotal`）或**单个文件**上展示；任何 UI 都不把去重物理空间显示为可累加的目录大小。

**跨文件文案原则（本次不涉及删除逻辑改动，触及文案时应用）：** 删除表述统一为"移入废纸篓后可恢复；清空废纸篓后不可恢复"；审计记录（未来阶段引入）为"记录而非恢复机制"；结果标注"反映扫描完成时刻的磁盘状态，外部变更需重新扫描"。

### 6. 删除一致性：成功移入废纸篓后原子变更索引

**决策：** `delete_path(path, scanId?)` 在 Finder 废纸篓成功返回后，若存在包含该路径的索引：以原子方式移除节点及全部后代（标记删除并从所有查询排除），沿祖先链回减 `sizeLogical`/`sizeDisk`，重算 `physicalUniqueTotal` 与 `insights`（对剩余节点 O(n) 重算一次），并返回更新后的计数/总量/洞察给前端同步头部与洞察面板。被删路径不在任何索引中时保持现状（仅返回成功）。

**理由：** 查询驱动模型下，后端索引若不随删除变更，已移入废纸篓的项目会在下一页/重新展开的树中"复活"。**备选：** 标记索引 stale 并要求重扫 → 破坏删除后即时一致的体验，弃用。

**快照语义文案：** 索引反映扫描完成时刻的磁盘状态；应用内删除会同步索引，但应用外的新增/删除（如 Finder 里改了文件）不反映，直到重新扫描——UI 与文档如实说明。

### 7. 分页契约与性能边界

**决策：**
- 页面大小 `limit` 上限 **500**（内部常量），`limit ∈ [1, 500]`；`offset ≥ 0`。
- 非法参数（负 offset、`limit` 越界）→ `InvalidPagination` 错误；`offset ≥ total` → 返回空 `items`、`total`、`hasMore=false`（非错误）。
- **稳定排序 tie-breaker**：`(排序键 desc, path asc, node_id asc)`，`node_id` 为 arena 下标——大量同尺寸文件分页无重复无缺页。
- 索引不存在/已淘汰（LRU 逐出）→ `IndexNotFound` 错误；前端显示"扫描结果已失效，请重新扫描"并提供重新扫描入口。
- **性能边界：** 每次查询对索引做 O(n) 过滤+排序；`n ≤ ~10M` 时单页 < 50ms（Rust 纯结构比较），可接受；若实测超界，按需为常用排序维护预排序辅助索引（记录为后续优化，不阻塞 M0）。

### 8. 洞察计算移到后端，避免 TS/Rust 分类法重复

**决策：** 类型分桶与"最大目录/最大文件/近期/久未"在 Rust 侧对完整索引计算，随 `Completed.insights` 下发；`query_flat_files` 的 `type` 筛选复用同一 Rust 分类器（标签一致，跨页生效）。前端 `scanInsights.ts` 改为消费 `insights` 载荷；`categorizeFile` 仅保留类型筛选等交互用途。Rust 分类器与 `categorizeFile` 分桶一致，以单元测试断言两侧分桶集合一致，防漂移。

**备选：** 前端分页拉全量文件后本地分桶 → 大目录下页数过多、开销大，"只看这类"退化为只筛当前页。**理由：** 后端 O(n) 一次算出，载荷小；类型筛选下沉服务端后跨页完整。

## Risks / Trade-offs

- **[Risk] 前端重构爆炸半径**：`App.tsx` 由 `setFiles(payload.results)` 改为查询驱动，`FileList.tsx` 的客户端 `buildTree` 由 `query_subtree` 取代，涉及大量状态迁移。
  **Mitigation:** 先落地后端（索引 + 查询命令 + Completed 精简 + 覆盖 + 删除变更 + 后端测试），再迁移前端；保留流式预览事件与树/平铺视图既有交互（展开、面包屑、大小条、键盘导航、持久化视图模式）不动；查询层封装为独立 hook。

- **[Risk] 全部文件入库的内存占用**：整盘 500 万+ 文件时索引可能逼近 512MB 预算。
  **Mitigation:** 紧凑 arena（~48B/节点）+ 构建期去重不驻留 inode；LRU 只保留最近 2 次扫描；后续快照持久化阶段落盘后释放内存；如需可提供"仅索引 ≥ N MB"显式 opt-in（降级承诺，本期不做）。

- **[Risk] 不完整扫描的收集遗漏**：部分错误路径（深层权限拒绝）可能被 walkdir 语义漏掉。
  **Mitigation:** 统一在 `scanner.rs` 的两个错误分支（迭代 Err、metadata Err）写入 `unscannedRegions`；只记顶层路径去重；`partial` 标记强制 UI 提示，不显示为完整统计。

- **[Risk] 删除变更的原子性/一致性**：废纸篓成功与索引变更之间若崩溃，索引与磁盘不一致。
  **Mitigation:** 先执行废纸篓删除，成功后变更索引；索引变更失败仅导致旧索引残留（下次重扫自愈），不阻断用户；洞察/总量重算为单次 O(n) 传递，返回给前端同步。

- **[Risk] `physicalUnique` 非累加被误用 / 命名过誉**：UI 或下游把它当目录大小相加，或文案暗示 APFS clone 去重。
  **Mitigation:** 数据契约标注不可累加；UI 只在扫描根层级展示 `physicalUniqueTotal` 或单文件展示；命名/文案限定为"硬链接去重后的已分配字节"，APFS clone 明确不在本期。

- **[Risk] `blocks == 0` 置 null 影响既有展示**：某些文件系统上 `sizeDisk`/`physicalUnique` 显示为"未知"。
  **Mitigation:** 接受此诚实性代价；UI 对 `null` 显示"未知"而非错误的逻辑大小；`min_size` 筛选跳过 `null` 维度。

- **[Risk] 分页 O(n) 性能**：极深分页（数千页）时每次查询线性扫描。
  **Mitigation:** 页面 ≤ 500 + 稳定 tie-breaker；实测超界再加预排序辅助索引（后续优化）；前端"加载更多"避免一次翻到底。

- **[Risk] 现有测试耦合 top-K/祖先拼接**：`limited_results_include_ancestors_for_tree_rendering`、`file_limit_keeps_largest_matching_files` 等将过时。
  **Mitigation:** 重写为 arena 聚合、查询分页、物理去重、覆盖收集、删除一致性的新测试；删除过时测试。

## Migration Plan

1. **后端（保留旧路径短暂共存，便于对照）：** 在 `scanner.rs` 构建 `ScanIndex`（保留全部文件记录、计算 `physicalUnique`、收集 `unscannedRegions`、移除 `min_size` 遍历裁剪与 `blocks==0` 回退）；新增 `query_flat_files` / `query_subtree` / `query_dir_size`；`Completed` 精简载荷并附 `scanCoverage` + `insights`；`delete_path` 增加索引变更；新增 `ScanIndexManager` 并注册到 `lib.rs`。新增后端单元测试。
2. **前端：** `types.ts` 同步字段与查询类型；`App.tsx` 改为查询驱动（Completed 后拉取树根子项与平铺首页 + 消费 `insights`/`scanCoverage`，删除后同步返回的统计）；`FileList.tsx` 树/平铺视图改为调用查询命令并维护分页状态，筛选/排序/搜索/类型/口径作为查询参数；`scanInsights.ts` 改为消费 `insights` 载荷；移除"显示数量限制"滑块。
3. **收尾：** 删除 `retain_top_files`、`add_ancestor_dirs`、`truncate(l)` 等截断机制；删除前端全量结果数组驱动逻辑；`cargo test` + `pnpm build` 通过。
4. **回滚：** 变更集中在后端索引/命令与前端数据流两层；整体回滚 = `git revert` 相关提交。`Completed` 载荷变更为 BREAKING，需前后端同版本发布。

## Open Questions

- 平铺视图"全部文件"默认展示量：保留 UI `minSize` 控件作为平铺视图默认筛选（扫描端忽略），是否同时作为树视图 `query_subtree` 的默认过滤？（本设计：树视图展开完整，不裁剪；平铺用 `minSize`。）
- 类型分类法是否应立即收敛为单一 Rust 源（删除 TS `categorizeFile` 的洞察用途），还是保持双实现 + 一致性测试过渡？（本设计：保持双实现 + 测试锁定，降低一次性迁移风险。）
- `delete_path` 的 `scanId` 传参：由前端显式传当前 `scanId`，还是后端按路径反查所属索引？（本设计：前端显式传 `scanId`，缺失时按路径反查兜底。）
