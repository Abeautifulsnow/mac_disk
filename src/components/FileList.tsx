import { File, Folder, Trash2, Calendar, AlertTriangle } from 'lucide-react'
import { FileInfo } from '../types'

interface FileListProps {
  files: FileInfo[]
  onDelete: (file: FileInfo) => void
  formatFileSize: (bytes: number) => string
}

export default function FileList({ files, onDelete, formatFileSize }: FileListProps) {
  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return '未知'
    const date = new Date(timestamp * 1000)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d} ${hh}:${mm}`
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">扫描结果 ({files.length} 项)</h2>
          <div className="text-sm text-gray-500">
            按大小排序，占用空间最大的项目显示在最前面
          </div>
        </div>
      </div>

      <div className="overflow-hidden flex flex-col border border-gray-200 rounded-lg" style={{ height: 'calc(100vh - 280px)' }}>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="grid grid-cols-[56px_minmax(0,1fr)_max-content_max-content_max-content_max-content] items-center bg-white">
            <div className="contents">
              <div className="pl-6 pr-3 py-3 sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <div className="h-5 w-5" />
              </div>
              <div className="pr-6 py-3 sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">名称</div>
              <div className="px-4 py-3 sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">类型</div>
              <div className="px-4 py-3 sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">大小</div>
              <div className="px-4 py-3 sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">修改时间</div>
              <div className="pl-2 pr-4 py-3 sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">操作</div>
            </div>

            {files.map((file) => (
              <div key={file.path} className="contents group">
                <div className="pl-6 pr-3 py-4 flex items-center border-b border-gray-200 group-hover:bg-gray-50">
                  {file.is_dir ? (
                    <Folder className="h-5 w-5 text-blue-500" />
                  ) : (
                    <File className="h-5 w-5 text-gray-500" />
                  )}
                </div>
                <div className="pr-6 py-4 min-w-0 border-b border-gray-200 group-hover:bg-gray-50" title={file.path}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate" title={file.name}>
                      {file.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate" title={file.path}>
                      {file.path}
                    </div>
                  </div>
                </div>

                <div className="px-4 py-4 whitespace-nowrap border-b border-gray-200 group-hover:bg-gray-50">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${file.is_dir ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                    {file.is_dir ? '目录' : '文件'}
                  </span>
                </div>

                <div className="px-4 py-4 whitespace-nowrap border-b border-gray-200 group-hover:bg-gray-50">
                  <div className="inline-flex items-center gap-2 flex-nowrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatFileSize(file.size)}
                    </span>
                    {file.size > 1024 * 1024 * 100 && (
                      <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 whitespace-nowrap">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        大文件
                      </span>
                    )}
                  </div>
                </div>

                <div className="px-4 py-4 whitespace-nowrap border-b border-gray-200 group-hover:bg-gray-50">
                  <div className="inline-flex items-center text-sm text-gray-500 whitespace-nowrap">
                    <Calendar className="hidden lg:block h-4 w-4 mr-2 flex-shrink-0" />
                    {formatDate(file.modified)}
                  </div>
                </div>

                <div className="pl-2 pr-4 py-4 whitespace-nowrap border-b border-gray-200 group-hover:bg-gray-50">
                  <button
                    onClick={() => onDelete(file)}
                    className="inline-flex items-center justify-center px-2 py-1 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors whitespace-nowrap"
                    title="删除此项"
                  >
                    <Trash2 className="h-3.5 w-3.5 xl:mr-1.5" />
                    <span className="hidden xl:inline">删除</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {files.length === 0 && (
        <div className="border border-gray-200 rounded-lg flex items-center justify-center" style={{ height: 'calc(100vh - 280px)' }}>
          <div className="text-center p-12">
            <div className="text-gray-400 mb-2">暂无数据</div>
            <p className="text-sm text-gray-500">开始扫描以查看占用空间大的项目</p>
          </div>
        </div>
      )}
    </div>
  )
}
