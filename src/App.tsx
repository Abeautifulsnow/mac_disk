import { AlertTriangle, HardDrive } from "lucide-react";
import ConfirmDialog from "./components/ConfirmDialog";
import FileList from "./components/filelist/FileList";
import Scanner from "./components/Scanner";
import ScanInsights from "./components/ScanInsights";
import StatusArea from "./components/StatusArea";
import { useScanSession } from "./hooks/useScanSession";
import { formatFileSize } from "./lib/format";

function App() {
  const session = useScanSession();
  const {
    scanId,
    scanRoot,
    loading,
    error,
    success,
    cancelPending,
    confirmDelete,
    confirmDeleteBatch,
    scanProgress,
    scanStats,
    scanCoverage,
    insights,
    previewItems,
    sizeMode,
    focusedResultPath,
    activeTypeFilter,
    listVersion,
  } = session;

  const headerTotalSize =
    scanStats && (sizeMode === "disk" ? scanStats.totalSizeDisk : scanStats.totalSizeLogical);
  const isPreviewResults = loading && previewItems.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">macOS磁盘扫描工具</h1>
              <p className="text-gray-500 text-sm">扫描并管理磁盘空间</p>
            </div>
          </div>

          <div className="flex items-center gap-5">
            {scanStats ? (
              <>
                <div className="text-right">
                  <div className="text-xs text-gray-400">已扫描总大小</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {formatFileSize(headerTotalSize ?? 0)}
                  </div>
                </div>
                <div className="h-9 w-px bg-gray-200" />
                <div className="text-right">
                  <div className="text-xs text-gray-400">统计口径</div>
                  <div className="text-sm font-medium text-gray-700">
                    {sizeMode === "disk" ? "磁盘使用量" : "逻辑大小"}
                  </div>
                </div>
                <div className="h-9 w-px bg-gray-200" />
                <div className="text-right">
                  <div className="text-xs text-gray-400">文件 / 目录</div>
                  <div className="text-sm font-medium text-gray-700">
                    {scanStats.filesFound.toLocaleString()} /{" "}
                    {scanStats.directoriesFound.toLocaleString()}
                  </div>
                </div>
                {scanCoverage?.partial && (
                  <div className="flex items-center gap-1 text-xs text-amber-700 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    部分扫描（{scanCoverage.unscannedRegions.length} 个区域不可访问）
                  </div>
                )}
              </>
            ) : isPreviewResults ? (
              <div className="text-right">
                <div className="text-sm text-amber-700 font-medium">
                  扫描中预览: {previewItems.length.toLocaleString()} 个项目
                </div>
                <div className="text-xs text-amber-600">完成后切换为完整结果</div>
              </div>
            ) : (
              <div className="text-xs text-gray-400">等待扫描</div>
            )}
          </div>
        </div>
      </header>

      <main className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1">
            <Scanner
              onScan={session.handleScan}
              onCancel={session.handleCancelScan}
              loading={loading}
              cancelPending={cancelPending}
              progress={scanProgress}
              canCancel={!!session.currentScanId}
              sizeMode={sizeMode}
              onSizeModeChange={session.setSizeMode}
            />
          </div>

          <div className="lg:col-span-2">
            <StatusArea error={error} success={success} />

            {scanCoverage?.partial && scanStats && !loading && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-amber-800 text-sm">
                    <div className="font-medium">部分扫描完成</div>
                    <div className="mt-1">
                      {scanCoverage.unscannedRegions.length} 个区域因权限或 I/O 错误未完整扫描，
                      统计与洞察仅覆盖可访问的部分。
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-amber-700 hover:text-amber-900">
                        查看不可访问区域
                      </summary>
                      <ul className="mt-2 max-h-40 overflow-auto space-y-1 font-mono text-xs">
                        {scanCoverage.unscannedRegions.map((region) => (
                          <li key={region.path} className="truncate">
                            {region.path}{" "}
                            <span className="text-amber-600">[{region.reason}]</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                </div>
              </div>
            )}

            {insights && scanStats && !loading && (
              <ScanInsights
                insights={insights}
                sizeMode={sizeMode}
                onFocusPath={session.setFocusedResultPath}
                activeTypeFilter={activeTypeFilter}
                onTypeFilterChange={session.setActiveTypeFilter}
              />
            )}

            {loading && previewItems.length === 0 && !scanStats ? (
              <div className="flex flex-col items-center justify-center py-12 bg-white rounded-xl border border-gray-200">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent mb-4" />
                <p className="text-gray-600">正在扫描磁盘，请稍候...</p>
                <p className="text-sm text-gray-500 mt-2">
                  这会保留全部文件记录，可能需要一些时间
                </p>
              </div>
            ) : (
              <FileList
                scanId={scanId}
                scanRoot={scanRoot}
                isPreview={isPreviewResults}
                previewItems={previewItems}
                sizeMode={sizeMode}
                activeTypeFilter={activeTypeFilter}
                onTypeFilterChange={session.setActiveTypeFilter}
                onDelete={session.setConfirmDelete}
                onShowInFinder={session.handleShowInFinder}
                onCopyPath={session.handleCopyPath}
                onRescanDirectory={session.handleRescanDirectory}
                onRescanRoot={session.handleRescanRoot}
                onDeletePaths={session.setConfirmDeleteBatch}
                focusedPath={focusedResultPath}
                listVersion={listVersion}
              />
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        isOpen={!!confirmDelete || !!confirmDeleteBatch}
        onClose={() => {
          session.setConfirmDelete(null);
          session.setConfirmDeleteBatch(null);
        }}
        onConfirm={
          confirmDeleteBatch && confirmDeleteBatch.length > 0
            ? session.confirmDeleteBatchAction
            : session.confirmDeleteAction
        }
        file={confirmDelete}
        batchFiles={confirmDeleteBatch}
        sizeMode={sizeMode}
      />
    </div>
  );
}

export default App;
