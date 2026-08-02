## 1. 后端：批量删除

- [ ] 1.1 在 `commands.rs` 新增 `delete_paths(index_manager, paths: Vec<String>, scan_id: Option<String>)`：逐路径校验存在性与 `is_sensitive_path`（任一敏感 → 整体拒绝）；规范化重复/父子重叠选择；`spawn_blocking` 中用 osascript 逐项移到废纸篓，收集成功与失败；成功项从所属索引批量删除并**只重算一次**聚合/总量/洞察；返回每项结果与 `DeleteResult { message, updated }`
- [ ] 1.2 在 `lib.rs` 注册 `delete_paths`

## 2. 后端测试

- [ ] 2.1 `delete_paths` 批量删除后索引一致：已删项不复活、祖先聚合/总量/洞察正确
- [ ] 2.2 敏感路径在批量中 → 整体拒绝，无任何删除
- [ ] 2.3 部分失败路径 → 成功项从索引移除、失败路径保留并在响应中列出
- [ ] 2.4 `cargo test` 全绿

## 3. 前端：squarify 布局

- [ ] 3.1 新增 `src/squarify.ts`：Bruls squarified 布局（按值降序铺行、最差长宽比判定、输出归一化 `(x,y,w,h)`），小于最小像素阈值的瓦片聚合进"其他"
- [ ] 3.2 新增 `src/squarify.ts` 的纯函数测试（比例正确、不重叠、取整安全）

## 4. 前端：地图视图

- [ ] 4.1 `types.ts` 增加地图视图模式与批量删除类型；`scanApi.ts` 新增 `deletePaths`
- [ ] 4.2 新增 `src/components/TreemapView.tsx`：SVG 渲染、类型着色 + 图例（复用 `categorizeFile`）、悬停 tooltip（名称/路径/大小/占比）、点击目录下钻 + 面包屑、多选（点击/Shift 连选/空白清空）、扫描中实时地图（用 `previewItems`）
- [ ] 4.3 数据加载：`query_subtree` 分页拉取至渲染上限（500）或 ≥99% 总量，`query_dir_size` 取总量，"其他"矩形 = 总量 − 已加载合计
- [ ] 4.4 `ConfirmDialog.tsx` 增加批量确认模式（路径列表 + 合计大小 + 敏感路径提示）
- [ ] 4.5 `FileList.tsx` 视图切换扩展为三态（树形/平铺/地图，`RESULT_VIEW_MODE_STORAGE_KEY` 支持 `map`），接入 `TreemapView`；类型筛选时地图仅高亮不重排
- [ ] 4.6 `App.tsx` 接线：选中集 → 批量 `deletePaths` → 成功同步 `updated` 统计 + 清空选中 + `listVersion` 重载；`pnpm build` 通过

## 5. 验证

- [ ] 5.1 `cargo test` + `pnpm build` 全绿
- [ ] 5.2 手动验证：地图下钻/返回、类型着色、悬停占比、Shift 多选批量删除（删除后不复活、统计同步）、口径切换重排、扫描中实时地图
