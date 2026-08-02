## 1. 后端：索引构建、三口径与覆盖收集

- [x] 1.1 新增 `ScanIndex` arena 结构（紧凑节点：`parent` / `first_child` / `next_sibling` / 路径缓冲偏移与长度 / `size_logical` / `size_disk` / `physical_unique` / `modified` / `is_dir`），在 `commands.rs` 的 `FileInfo` 增加 `physicalUnique: Option<u64>`
- [x] 1.2 在 `scanner.rs` 构建 `ScanIndex`：保留**全部常规文件记录**与全部目录聚合；构建期用临时 `HashSet<(dev, ino)>` 计算 `physicalUnique`（inode 首现计入、重复为 0，不驻留每节点）
- [x] 1.3 自底向上后序遍历计算各目录聚合大小，确保目录聚合包含全部子孙
- [x] 1.4 **移除遍历期 `min_size` 裁剪**（`scanner.rs:179-180` 的口径相关阈值判断）——`ScanOptions.minSize` 标记 deprecated，仅在查询层生效
- [x] 1.5 **修正 `compute_disk_usage`**（`scanner.rs:389`）：`blocks == 0` 时 `sizeDisk`/`physicalUnique` 置 `null`，不再回退逻辑大小
- [x] 1.6 **收集 `unscannedRegions`**：在 walkdir 迭代 Err（`scanner.rs:140`）与 metadata Err（`scanner.rs:153`）分支记录 `{ path, reason }`（`permission-denied` / `io-error` / `metadata-error` / `symlink-loop`），只记顶层失败路径去重
- [x] 1.7 新增 `ScanIndexManager`（以 `scanId` 为键，复用 `lru` crate，保留最近 2 次扫描，内存预算 ≤ 512MB），在 `lib.rs` 注册
- [x] 1.8 本轮保留旧截断路径（`retain_top_files` 等）便于新旧对照与回滚；最终移除放入第 6 组

## 2. 后端：查询命令、Completed 精简与删除一致性

- [x] 2.1 新增 `query_flat_files` 命令：服务端应用 `minSize` / `modifiedWindow` / `searchQuery` / **`kind`（all|files|dirs）** / **`type`（类型分桶标签）**，`sizeMode` 决定筛选/排序维度；`offset/limit` 分页，返回 `{ items, total, hasMore }`
- [x] 2.2 新增 `query_subtree` 命令：返回目录完整子项（文件 + 子目录含聚合大小），分页、按大小降序，不做 `minSize` 裁剪
- [x] 2.3 新增 `query_dir_size` 命令：返回目录逻辑/磁盘聚合大小，不含子项
- [x] 2.4 **分页契约**：`limit ∈ [1, 500]`、`offset ≥ 0`；非法参数返回 `InvalidPagination` 错误；`offset ≥ total` 返回空页 + `total` + `hasMore=false`；稳定排序 tie-breaker `(key desc, path asc, node_id asc)`；索引不存在/被淘汰返回 `IndexNotFound`
- [x] 2.5 `ScanEvent::Completed` 精简：移除 `results` 数组，携带元数据 + 计数（`filesScanned` / `directoriesScanned`）+ 总量（含 `physicalUniqueTotal`）+ **`scanCoverage`（`partial` 标记 + `unscannedRegions`）** + `insights`
- [x] 2.6 Rust 侧实现类型分桶与"最大目录/最大文件/近期大文件/久未大文件"洞察计算（分类法供 `query_flat_files` 的 `type` 筛选复用），随 `Completed.insights` 下发
- [x] 2.7 **`delete_path` 索引变更**：废纸篓成功后，若存在该路径所属索引则原子移除节点及后代、沿祖先链回减聚合、重算 `physicalUniqueTotal` 与 `insights`，返回更新后计数/总量/洞察；前端显式传 `scanId`，缺失时按路径反查兜底
- [x] 2.8 在 `lib.rs` 的 `invoke_handler` 注册新查询命令与更新 `delete_path` 签名

## 3. 后端测试

- [x] 3.1 重写/删除过时的 top-K 与祖先拼接测试（`file_limit_keeps_largest_matching_files`、`limited_results_include_ancestors_for_tree_rendering` 等）
- [x] 3.2 索引构建测试：文件记录完整（>200 文件全部可达）、目录聚合完整
- [x] 3.3 **minSize 与口径无关测试**：按磁盘口径扫描的稀疏/普通文件，切逻辑口径后 `query_flat_files` 仍能命中（含大小筛选完整）
- [x] 3.4 **`physicalUnique` 测试**：同一 inode 硬链接只计一次；`blocks == 0` 时 `sizeDisk`/`physicalUnique` 为 `null`（稀疏文件不报大）
- [x] 3.5 **覆盖测试**：无权限目录/IO 错误进入 `unscannedRegions`（`partial` 置位），只记顶层失败路径去重
- [x] 3.6 **删除一致性测试**：删除文件/目录后，重新分页、展开父目录、`query_dir_size`、洞察与总量保持一致，已删项不复活
- [x] 3.7 **分页稳定性测试**：大量同尺寸文件无重复无缺页；非法参数报错；`offset ≥ total` 空页；索引失效返回 `IndexNotFound`
- [x] 3.8 **洞察与类型筛选测试**：Rust 分桶与 TS `categorizeFile` 集合一致；`type` 筛选跨所有页生效
- [x] 3.9 `cargo test` 全绿

## 4. 前端：类型与数据流

- [x] 4.1 `types.ts` 同步 `FileInfo.physicalUnique`（可空）、`ScanEvent::Completed` 新载荷（含 `scanCoverage`）、查询命令请求/响应类型
- [x] 4.2 `App.tsx` 移除 `setFiles(payload.results)`：Completed 后保存扫描元数据与 `scanId`，通过查询命令拉取树根子项与平铺首页，消费 `insights` / `scanCoverage`
- [x] 4.3 封装查询 hook（`useFlatQuery` / `useSubtreeQuery`），管理分页、加载与 `IndexNotFound` 恢复（"结果已失效，请重新扫描"）
- [x] 4.4 移除"显示数量限制"滑块及其扫描参数（旧 top-K 概念），保留 `minSize` 作为平铺视图默认筛选控件

## 5. 前端：查询驱动的视图与洞察

- [x] 5.1 `FileList.tsx` 平铺视图改为 `query_flat_files` 驱动：`minSize`/时间/搜索/类型/`kind` 作为查询参数，`sizeMode` 切换重发查询，分页加载（"加载更多"）
- [x] 5.2 `FileList.tsx` 树视图改为 `query_subtree` 驱动：展开时按需加载子项；面包屑、大小条、百分比、键盘导航、持久化视图模式保持不回归
- [x] 5.3 `scanInsights.ts` 改为消费 `Completed.insights` 载荷；`categorizeFile` 仅保留类型筛选等交互用途
- [x] 5.4 头部统计支持 `partial` 标记："部分扫描完成：N 个区域不可访问" + 区域列表；删除后同步后端返回的更新统计
- [x] 5.5 保留流式预览（`fileFound` / `directoryFound`）与进度/取消/超时交互
- [x] 5.6 `pnpm build` 通过

## 6. 收尾清理与验证

- [x] 6.1 移除 `retain_top_files`、`final_files.truncate(l)`、`all_dirs.into_iter().take(l)`、`add_ancestor_dirs` 等截断机制
- [x] 6.2 移除前端对全量 `results` 数组驱动的陈旧逻辑
- [x] 6.3 删除过时测试，`cargo test` + `pnpm build` 全绿
- [x] 6.4 人工验证：逻辑/磁盘口径切换后筛选完整性（含稀疏文件）；大小/时间/搜索/类型筛选返回全部命中；`partial` 扫描正确标注；删除后翻页/展开/洞察/总量一致；>200 文件可浏览到末位；废纸篓删除、Finder 显示、目录重扫正常
- [x] 6.5 更新 README/CLAUDE.md：移除"显示数量限制"与截断语义描述，补充"扫描时间点快照"、"硬链接去重后的已分配字节"、"移入废纸篓后可恢复；清空废纸篓后不可恢复"文案口径
