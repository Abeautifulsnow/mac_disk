import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Scan, Settings, AlertCircle, Loader2 } from 'lucide-react'

import type { ScanProgress } from '../types'

interface ScannerProps {
  onScan: (path: string, limit: number, minSize: number, timeoutSeconds: number) => void
  onCancel?: () => void
  loading: boolean
  cancelPending?: boolean
  progress?: ScanProgress | null
  canCancel?: boolean
}

export default function Scanner({ onScan, onCancel, loading, cancelPending = false, progress, canCancel = false }: ScannerProps) {
  const [path, setPath] = useState('/Users')
  const [limit, setLimit] = useState(50)
  const [minSize, setMinSize] = useState(10) // MB
  const [timeoutSeconds, setTimeoutSeconds] = useState(300)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(Date.now())

  useEffect(() => {
    if (loading) {
      setStartedAt((prev) => prev ?? Date.now())
    } else {
      setStartedAt(null)
    }
  }, [loading])

  useEffect(() => {
    if (!loading) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [loading])

  const etaSeconds = useMemo(() => {
    if (!startedAt || !progress?.totalEstimated || !progress.processed) return null
    const elapsedSeconds = (now - startedAt) / 1000
    if (elapsedSeconds <= 0) return null
    const rate = progress.processed / elapsedSeconds
    if (rate <= 0) return null
    const remaining = progress.totalEstimated - progress.processed
    if (remaining <= 0) return 0
    return Math.ceil(remaining / rate)
  }, [startedAt, now, progress])

  const formatEta = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return ''
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    if (m <= 0) return `${s}s`
    return `${m}m ${s}s`
  }

  const handleSelectDirectory = async () => {
    setDialogError(null)
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: '/Users',
        title: '选择要扫描的目录',
      })
      if (selected) {
        setPath(selected as string)
      }
    } catch (err) {
      console.error('选择目录失败:', err)
      setDialogError('无法打开文件选择器。请确保应用有访问文件系统的权限。')
    }
  }

  const handleScan = () => {
    if (path.trim()) {
      onScan(path, limit, minSize, timeoutSeconds)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <Scan className="h-5 w-5 mr-2 text-blue-600" />
          磁盘扫描
        </h3>
        <Settings className="h-5 w-5 text-gray-400" />
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            扫描目录
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="/Users/username"
            />
            <button
              type="button"
              onClick={handleSelectDirectory}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <FolderOpen className="h-4 w-4 mr-1.5" />
              选择
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            建议扫描用户目录（如 /Users/username）以避免系统文件
          </p>
          {dialogError && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{dialogError}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              显示数量限制
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="10"
                max="200"
                step="10"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-medium text-gray-900 w-12">{limit}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              限制显示的项目数量，提高性能
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              最小文件大小 (MB)
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="1"
                max="1000"
                step="10"
                value={minSize}
                onChange={(e) => setMinSize(parseInt(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-medium text-gray-900 w-16">{minSize} MB</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              只显示大于此大小的文件和目录
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            扫描超时 (秒)
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="number"
              min="0"
              max="3600"
              step="10"
              value={timeoutSeconds}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                setTimeoutSeconds(Number.isFinite(n) ? Math.max(0, n) : 0)
              }}
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <span className="text-xs text-gray-500">0 表示不限制</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            目录很大时建议调高，避免自动超时退出
          </p>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={handleScan}
            disabled={loading || !path.trim()}
            className="w-full inline-flex justify-center items-center px-4 py-3 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                扫描中...
              </>
            ) : (
              <>
                <Scan className="h-4 w-4 mr-2" />
                开始扫描
              </>
            )}
          </button>

          {/* 进度显示 */}
          {loading && (
            <div className="mt-4 space-y-2 transition-opacity duration-300">
              <div className="flex justify-between text-sm text-gray-700">
                <span className="flex items-center">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin text-blue-600" />
                  {progress?.phase === 'walking' && typeof progress.discovered === 'number'
                    ? `已发现: ${progress.discovered.toLocaleString()}`
                    : progress
                      ? `已处理: ${progress.processed.toLocaleString()}`
                      : '准备中...'}
                  {progress?.phase === 'processing' && progress?.totalEstimated && ` / ${progress.totalEstimated.toLocaleString()}`}
                </span>
                <span className="font-medium text-blue-600">
                  {progress?.phase === 'processing' && progress?.percentage ? `${progress.percentage.toFixed(1)}%` : ''}
                </span>
              </div>
              {(progress?.totalEstimated && etaSeconds !== null) && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>预计剩余: {formatEta(etaSeconds)}</span>
                  {startedAt && (
                    <span>已用时: {formatEta(Math.floor((now - startedAt) / 1000))}</span>
                  )}
                </div>
              )}
              
              <div className="relative w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                {/* 背景动画条 (当没有精确进度时显示) */}
                {(!progress || !progress.percentage) && (
                  <div className="absolute inset-0 bg-gray-200 animate-pulse"></div>
                )}
                
                {/* 实际进度条 */}
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out flex items-center justify-end relative"
                  style={{ width: progress?.percentage ? `${Math.min(progress.percentage, 100)}%` : '0%' }}
                >
                  {/* 进度条光效 */}
                  <div className="absolute top-0 bottom-0 right-0 w-4 bg-white/30 skew-x-[-20deg]"></div>
                </div>
              </div>
              
              <div className="text-xs text-gray-500 truncate font-mono h-4" title={progress?.currentPath}>
                {progress?.currentPath ? `扫描: ${progress.currentPath}` : '正在初始化扫描引擎...'}
              </div>
            </div>
          )}

          {/* 取消按钮 */}
          {canCancel && onCancel && loading && (
            <div className="mt-4">
              <button
                onClick={onCancel}
                disabled={cancelPending}
                className="w-full inline-flex justify-center items-center px-4 py-2 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                {cancelPending ? '取消中...' : '取消扫描'}
              </button>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500 text-center">
            首次扫描可能需要一些时间，具体取决于目录大小
          </p>
        </div>

        <div className="rounded-lg bg-blue-50 p-4">
          <h4 className="text-sm font-medium text-blue-800 mb-2">扫描提示</h4>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• 避免扫描系统根目录，选择用户目录进行扫描</li>
            <li>• 设置最小文件大小可过滤小文件，提高性能</li>
            <li>• 扫描大目录时请耐心等待</li>
            <li>• 删除操作需要二次确认，请谨慎操作</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
