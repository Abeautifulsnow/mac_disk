use crate::commands::FileInfo;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

// ---------------------------------------------------------------------------
// Scan coverage (incomplete-scan contract)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnscannedRegion {
    pub path: String,
    /// One of: "permission-denied", "io-error", "metadata-error", "symlink-loop".
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCoverage {
    pub scanned_entries: usize,
    pub unscanned_regions: Vec<UnscannedRegion>,
    pub partial: bool,
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightPick {
    pub path: String,
    pub size_logical: u64,
    pub size_disk: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeBucketStat {
    pub label: String,
    pub count: usize,
    pub total_logical: u64,
    pub total_disk: u64,
    pub sample_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub largest_directory: Option<InsightPick>,
    pub largest_file: Option<InsightPick>,
    pub recent_large_file: Option<InsightPick>,
    pub stale_large_file: Option<InsightPick>,
    pub top_types: Vec<TypeBucketStat>,
}

impl Insights {
    pub fn empty() -> Self {
        Self {
            largest_directory: None,
            largest_file: None,
            recent_large_file: None,
            stale_large_file: None,
            top_types: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Rust mirror of the frontend categorizeFile taxonomy (src/scanInsights.ts)
// ---------------------------------------------------------------------------

pub fn categorize_file(name: &str, path: &str, is_dir: bool) -> Option<String> {
    let lower_name = name.to_lowercase();
    let lower_path = path.to_lowercase();

    if is_dir {
        if lower_name.ends_with(".app") {
            return Some("应用".to_string());
        }
        if lower_name == "node_modules" {
            return Some("Node 模块".to_string());
        }
        if lower_path.contains("/library/caches/") || lower_name == "caches" {
            return Some("缓存目录".to_string());
        }
        if lower_path.contains("/deriveddata/") {
            return Some("Xcode 缓存".to_string());
        }
        return None;
    }

    let ext = lower_name
        .contains('.')
        .then(|| lower_name.rsplit('.').next().unwrap_or("").to_string())
        .unwrap_or_default();

    let label = match ext.as_str() {
        "app" | "dmg" | "pkg" => "应用",
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "xz" => "归档文件",
        "mov" | "mp4" | "mkv" | "avi" | "m4v" | "webm" => "视频",
        "jpg" | "jpeg" | "png" | "gif" | "heic" | "webp" | "svg" => "图片",
        "mp3" | "wav" | "flac" | "aac" | "m4a" => "音频",
        "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx" | "pages" => "文档",
        "psd" | "ai" | "sketch" | "fig" => "设计文件",
        "sql" | "db" | "sqlite" | "sqlite3" => "数据库",
        "iso" => "磁盘镜像",
        _ => "其他文件",
    };
    Some(label.to_string())
}

// ---------------------------------------------------------------------------
// Query filter types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SizeMode {
    Logical,
    Disk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortKey {
    Size,
    Modified,
    Name,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KindFilter {
    All,
    Files,
    Dirs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifiedWindow {
    All,
    Days30,
    Days180,
    Days365,
}

#[derive(Debug, Clone)]
pub struct FlatQuery {
    pub min_size: Option<u64>,
    pub modified_window: ModifiedWindow,
    pub search_query: Option<String>,
    pub kind: KindFilter,
    pub type_filter: Option<String>,
    pub sort: SortKey,
    pub sort_desc: bool,
    pub size_mode: SizeMode,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatPage {
    pub items: Vec<FileInfo>,
    pub total: usize,
    pub has_more: bool,
}

/// Absolute upper bound for a query page, enforced server-side.
pub const MAX_PAGE_SIZE: usize = 500;

// ---------------------------------------------------------------------------
// Scan index
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Node {
    parent: i32,
    first_child: i32,
    next_sibling: i32,
    path: String,
    name: String,
    is_dir: bool,
    size_logical: u64,
    size_disk: u64,
    physical_unique: u64,
    modified: Option<u64>,
    /// (dev, ino) retained for recomputing hard-link-deduplicated totals after deletion.
    dev: u32,
    ino: u64,
    deleted: bool,
}

/// Normalize a path for use as an index key (strip trailing slashes, keep "/").
pub fn normalize_path(path: &str) -> String {
    if path == "/" {
        return "/".to_string();
    }
    path.trim_end_matches('/').to_string()
}

/// A complete, queryable in-memory index for one scan. Holds every regular
/// file record and every directory aggregate; nothing is truncated.
pub struct ScanIndex {
    nodes: Vec<Node>,
    path_to_node: HashMap<String, u32>,
    root: u32,
    file_ids: Vec<u32>,
    dir_ids: Vec<u32>,
    files_scanned: usize,
    directories_scanned: usize,
    physical_unique_total: u64,
    insights: Insights,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSummary {
    pub files_scanned: usize,
    pub directories_scanned: usize,
    pub total_size_logical: u64,
    pub total_size_disk: u64,
    pub physical_unique_total: u64,
    pub insights: Insights,
}

impl ScanIndex {
    pub fn new(root_path: &Path) -> Self {
        let root_str = normalize_path(&root_path.to_string_lossy());
        let root_name = root_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root_str.clone());
        let root_node = Node {
            parent: -1,
            first_child: -1,
            next_sibling: -1,
            path: root_str.clone(),
            name: root_name,
            is_dir: true,
            size_logical: 0,
            size_disk: 0,
            physical_unique: 0,
            modified: None,
            dev: 0,
            ino: 0,
            deleted: false,
        };
        let mut path_to_node = HashMap::new();
        path_to_node.insert(root_str, 0u32);
        Self {
            nodes: vec![root_node],
            path_to_node,
            root: 0,
            file_ids: Vec::new(),
            dir_ids: Vec::new(),
            files_scanned: 0,
            directories_scanned: 0,
            physical_unique_total: 0,
            insights: Insights::empty(),
        }
    }

    /// Insert an entry. `size_logical`/`size_disk` are the file's own bytes
    /// (0 for directories); directory aggregates are computed in `finish`.
    pub fn insert(
        &mut self,
        path: &Path,
        is_dir: bool,
        size_logical: u64,
        size_disk: u64,
        physical_unique: u64,
        dev: u32,
        ino: u64,
        modified: Option<u64>,
    ) {
        let path_str = normalize_path(&path.to_string_lossy());
        if self.path_to_node.contains_key(&path_str) {
            return;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());

        let parent_id = path
            .parent()
            .map(|p| self.path_to_node.get(&normalize_path(&p.to_string_lossy())).copied())
            .flatten()
            .unwrap_or(self.root);

        let id = self.nodes.len() as u32;
        let parent = parent_id as i32;
        let node = Node {
            parent,
            first_child: -1,
            next_sibling: self.nodes[parent_id as usize].first_child,
            path: path_str.clone(),
            name,
            is_dir,
            size_logical,
            size_disk,
            physical_unique,
            modified,
            dev,
            ino,
            deleted: false,
        };
        self.nodes[parent_id as usize].first_child = id as i32;
        self.nodes.push(node);

        if is_dir {
            self.directories_scanned += 1;
            self.dir_ids.push(id);
        } else {
            self.files_scanned += 1;
            self.file_ids.push(id);
            self.physical_unique_total += physical_unique;
        }
        self.path_to_node.insert(path_str, id);
    }

    /// Compute directory aggregates bottom-up, deduplicated totals, and insights.
    /// Call once after all entries are inserted.
    pub fn finish(&mut self) {
        self.recompute_aggregates();
        self.recompute_physical_unique_total();
        self.insights = self.compute_insights();
    }

    /// Reset directory aggregates to zero, then accumulate children bottom-up.
    fn recompute_aggregates(&mut self) {
        for node in &mut self.nodes {
            if node.is_dir {
                node.size_logical = 0;
                node.size_disk = 0;
            }
        }
        // Reverse insertion order => children before parents.
        for id in (1..self.nodes.len()).rev() {
            if self.nodes[id].deleted {
                continue;
            }
            let parent = self.nodes[id].parent;
            if parent < 0 {
                continue;
            }
            let (l, d) = {
                let n = &self.nodes[id];
                (n.size_logical, n.size_disk)
            };
            self.nodes[parent as usize].size_logical += l;
            self.nodes[parent as usize].size_disk += d;
        }
    }

    /// Recompute the hard-link-deduplicated allocated total over remaining files.
    fn recompute_physical_unique_total(&mut self) {
        let mut seen: HashSet<(u32, u64)> = HashSet::new();
        let mut total = 0u64;
        for &id in &self.file_ids {
            let n = &self.nodes[id as usize];
            if n.deleted {
                continue;
            }
            if n.ino != 0 && seen.insert((n.dev, n.ino)) {
                total += n.size_disk;
            } else if n.ino == 0 {
                total += n.size_disk;
            }
        }
        self.physical_unique_total = total;
    }

    /// Sum of file-only sizes when no inode info is available (fallback).
    fn compute_insights(&self) -> Insights {
        let mut largest_dir: Option<InsightPick> = None;
        let mut largest_file: Option<InsightPick> = None;
        let mut recent_file: Option<InsightPick> = None;
        let mut stale_file: Option<InsightPick> = None;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let recent_window = 30u64 * 24 * 60 * 60;
        let stale_window = 180u64 * 24 * 60 * 60;

        let mut buckets: HashMap<String, TypeBucketStat> = HashMap::new();

        for node in self.nodes.iter().filter(|n| !n.deleted) {
            let pick = InsightPick {
                path: node.path.clone(),
                size_logical: node.size_logical,
                size_disk: node.size_disk,
            };
            if node.is_dir {
                if node.path != self.nodes[self.root as usize].path
                    && is_larger(&pick, largest_dir.as_ref())
                {
                    largest_dir = Some(pick);
                }
            } else {
                if is_larger(&pick, largest_file.as_ref()) {
                    largest_file = Some(pick.clone());
                }
                if let Some(modified) = node.modified {
                    let age = now.saturating_sub(modified);
                    if age <= recent_window && is_larger(&pick, recent_file.as_ref()) {
                        recent_file = Some(pick.clone());
                    }
                    if age >= stale_window && is_larger(&pick, stale_file.as_ref()) {
                        stale_file = Some(pick);
                    }
                }
                if let Some(label) = categorize_file(&node.name, &node.path, false) {
                    let label_for_insert = label.clone();
                    let entry = buckets
                        .entry(label.clone())
                        .or_insert_with(|| TypeBucketStat {
                            label: label_for_insert,
                            count: 0,
                            total_logical: 0,
                            total_disk: 0,
                            sample_path: node.path.clone(),
                        });
                    entry.count += 1;
                    entry.total_logical += node.size_logical;
                    entry.total_disk += node.size_disk;
                }
            }
        }

        let mut top_types: Vec<TypeBucketStat> = buckets.into_values().collect();
        top_types.sort_by(|a, b| {
            b.total_logical
                .cmp(&a.total_logical)
                .then_with(|| a.label.cmp(&b.label))
        });
        top_types.truncate(6);

        Insights {
            largest_directory: largest_dir,
            largest_file,
            recent_large_file: recent_file,
            stale_large_file: stale_file,
            top_types,
        }
    }

    pub fn summary(&self) -> IndexSummary {
        let root = &self.nodes[self.root as usize];
        IndexSummary {
            files_scanned: self.files_scanned,
            directories_scanned: self.directories_scanned,
            total_size_logical: root.size_logical,
            total_size_disk: root.size_disk,
            physical_unique_total: self.physical_unique_total,
            insights: self.insights.clone(),
        }
    }

    fn to_file_info(&self, id: u32) -> FileInfo {
        let n = &self.nodes[id as usize];
        FileInfo {
            path: n.path.clone(),
            size_logical: n.size_logical,
            is_dir: n.is_dir,
            modified: n.modified,
            name: n.name.clone(),
            size_disk: n.size_disk,
            physical_unique: n.physical_unique,
        }
    }

    fn size_in_mode(&self, id: u32, mode: SizeMode) -> u64 {
        let n = &self.nodes[id as usize];
        match mode {
            SizeMode::Logical => n.size_logical,
            SizeMode::Disk => n.size_disk,
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    pub fn query_flat(&self, q: &FlatQuery) -> FlatPage {
        let candidates: Vec<u32> = match q.kind {
            KindFilter::All => (1..self.nodes.len() as u32)
                .filter(|&id| !self.nodes[id as usize].deleted)
                .collect(),
            KindFilter::Files => self
                .file_ids
                .iter()
                .copied()
                .filter(|&id| !self.nodes[id as usize].deleted)
                .collect(),
            KindFilter::Dirs => self
                .dir_ids
                .iter()
                .copied()
                .filter(|&id| !self.nodes[id as usize].deleted)
                .collect(),
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let search = q.search_query.as_ref().map(|s| s.to_lowercase());
        let window_seconds = match q.modified_window {
            ModifiedWindow::All => None,
            ModifiedWindow::Days30 => Some(30u64 * 24 * 60 * 60),
            ModifiedWindow::Days180 => Some(180u64 * 24 * 60 * 60),
            ModifiedWindow::Days365 => Some(365u64 * 24 * 60 * 60),
        };

        let mut matched: Vec<u32> = Vec::new();
        for &id in &candidates {
            let n = &self.nodes[id as usize];
            if let Some(min) = q.min_size {
                if self.size_in_mode(id, q.size_mode) < min {
                    continue;
                }
            }
            if let Some(window) = window_seconds {
                match n.modified {
                    Some(m) if now.saturating_sub(m) <= window => {}
                    _ => continue,
                }
            }
            if let Some(needle) = &search {
                let name = n.name.to_lowercase();
                let path = n.path.to_lowercase();
                if !name.contains(needle) && !path.contains(needle) {
                    continue;
                }
            }
            if let Some(label) = &q.type_filter {
                if categorize_file(&n.name, &n.path, n.is_dir).as_ref() != Some(label) {
                    continue;
                }
            }
            matched.push(id);
        }

        let desc = q.sort_desc;
        matched.sort_by(|&a, &b| {
            let na = &self.nodes[a as usize];
            let nb = &self.nodes[b as usize];
            let ord = match q.sort {
                SortKey::Size => self.size_in_mode(a, q.size_mode).cmp(&self.size_in_mode(b, q.size_mode)),
                SortKey::Modified => na.modified.cmp(&nb.modified),
                SortKey::Name => na.name.cmp(&nb.name),
            };
            let ord = if desc { ord.reverse() } else { ord };
            ord.then_with(|| na.path.cmp(&nb.path))
                .then_with(|| a.cmp(&b))
        });

        let total = matched.len();
        let start = q.offset.min(total);
        let end = (start + q.limit).min(total);
        let items: Vec<FileInfo> = matched[start..end].iter().map(|&id| self.to_file_info(id)).collect();
        FlatPage {
            items,
            total,
            has_more: end < total,
        }
    }

    /// Children of `path`, sorted by size descending, paginated. Returns an
    /// empty page when the path is absent or a file.
    pub fn query_subtree(&self, path: &str, size_mode: SizeMode, offset: usize, limit: usize) -> FlatPage {
        let key = normalize_path(path);
        let Some(&id) = self.path_to_node.get(&key) else {
            return FlatPage { items: Vec::new(), total: 0, has_more: false };
        };
        if self.nodes[id as usize].deleted {
            return FlatPage { items: Vec::new(), total: 0, has_more: false };
        }

        let mut children: Vec<u32> = Vec::new();
        let mut child = self.nodes[id as usize].first_child;
        while child >= 0 {
            if !self.nodes[child as usize].deleted {
                children.push(child as u32);
            }
            child = self.nodes[child as usize].next_sibling;
        }

        children.sort_by(|&a, &b| {
            self.size_in_mode(b, size_mode)
                .cmp(&self.size_in_mode(a, size_mode))
                .then_with(|| self.nodes[a as usize].path.cmp(&self.nodes[b as usize].path))
                .then_with(|| a.cmp(&b))
        });

        let total = children.len();
        let start = offset.min(total);
        let end = (start + limit).min(total);
        let items: Vec<FileInfo> = children[start..end]
            .iter()
            .map(|&c| self.to_file_info(c))
            .collect();
        FlatPage {
            items,
            total,
            has_more: end < total,
        }
    }

    /// Aggregate (logical, disk) sizes for a directory without its children.
    pub fn query_dir_size(&self, path: &str) -> Option<(u64, u64)> {
        let key = normalize_path(path);
        let id = *self.path_to_node.get(&key)?;
        if self.nodes[id as usize].deleted {
            return None;
        }
        let n = &self.nodes[id as usize];
        Some((n.size_logical, n.size_disk))
    }

    // -----------------------------------------------------------------------
    // Deletion consistency
    // -----------------------------------------------------------------------

    /// Atomically remove `path` and all descendants from the index, recompute
    /// aggregates, totals, and insights. Returns the removed subtree's sizes.
    pub fn delete_subtree(&mut self, path: &str) -> Option<(u64, u64, usize)> {
        let key = normalize_path(path);
        let id = *self.path_to_node.get(&key)?;
        if self.nodes[id as usize].deleted {
            return None;
        }

        let removed_logical = self.nodes[id as usize].size_logical;
        let removed_disk = self.nodes[id as usize].size_disk;

        let mut stack = vec![id as usize];
        let mut removed_count = 0usize;
        while let Some(i) = stack.pop() {
            if self.nodes[i].deleted {
                continue;
            }
            self.nodes[i].deleted = true;
            removed_count += 1;
            let mut child = self.nodes[i].first_child;
            while child >= 0 {
                stack.push(child as usize);
                child = self.nodes[child as usize].next_sibling;
            }
        }

        // Rebuild id lists and recompute all derived values.
        self.file_ids.retain(|&id| !self.nodes[id as usize].deleted);
        self.dir_ids.retain(|&id| !self.nodes[id as usize].deleted);
        self.files_scanned = self.file_ids.len();
        self.directories_scanned = self.dir_ids.len();
        self.recompute_aggregates();
        self.recompute_physical_unique_total();
        self.insights = self.compute_insights();

        Some((removed_logical, removed_disk, removed_count))
    }

    /// Remove several subtrees and rebuild derived values once after all paths
    /// have been marked. Callers should pass de-duplicated, non-overlapping
    /// paths; deleted or missing paths are ignored.
    pub fn delete_subtrees(&mut self, paths: &[String]) -> usize {
        let mut stack = Vec::new();
        for path in paths {
            let key = normalize_path(path);
            let Some(&id) = self.path_to_node.get(&key) else {
                continue;
            };
            if !self.nodes[id as usize].deleted {
                stack.push(id as usize);
            }
        }

        let mut removed_count = 0usize;
        while let Some(node_id) = stack.pop() {
            if self.nodes[node_id].deleted {
                continue;
            }
            self.nodes[node_id].deleted = true;
            removed_count += 1;
            let mut child = self.nodes[node_id].first_child;
            while child >= 0 {
                stack.push(child as usize);
                child = self.nodes[child as usize].next_sibling;
            }
        }

        if removed_count > 0 {
            self.file_ids.retain(|&id| !self.nodes[id as usize].deleted);
            self.dir_ids.retain(|&id| !self.nodes[id as usize].deleted);
            self.files_scanned = self.file_ids.len();
            self.directories_scanned = self.dir_ids.len();
            self.recompute_aggregates();
            self.recompute_physical_unique_total();
            self.insights = self.compute_insights();
        }

        removed_count
    }
}

fn is_larger(candidate: &InsightPick, current: Option<&InsightPick>) -> bool {
    match current {
        None => true,
        Some(cur) => {
            if candidate.size_logical != cur.size_logical {
                candidate.size_logical > cur.size_logical
            } else {
                candidate.path < cur.path
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Scan index manager (per-scan LRU)
// ---------------------------------------------------------------------------

pub type SharedIndex = Arc<RwLock<ScanIndex>>;

#[derive(Clone)]
pub struct ScanIndexManager {
    indexes: Arc<Mutex<lru::LruCache<String, SharedIndex>>>,
}

impl ScanIndexManager {
    pub fn new() -> Self {
        let capacity = std::num::NonZeroUsize::new(2).expect("capacity > 0");
        Self {
            indexes: Arc::new(Mutex::new(lru::LruCache::new(capacity))),
        }
    }

    pub fn insert(&self, scan_id: String, index: ScanIndex) {
        let mut guard = self.indexes.lock().unwrap();
        guard.put(scan_id, Arc::new(RwLock::new(index)));
    }

    pub fn get(&self, scan_id: &str) -> Option<SharedIndex> {
        let mut guard = self.indexes.lock().unwrap();
        guard.get(scan_id).cloned()
    }

    #[allow(dead_code)]
    pub fn remove(&self, scan_id: &str) {
        let mut guard = self.indexes.lock().unwrap();
        guard.pop(scan_id);
    }
}
