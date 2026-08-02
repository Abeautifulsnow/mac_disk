import { AlertTriangle, Trash2, X } from 'lucide-react'
import { FileInfo } from '../types'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  file: FileInfo | null
  batchFiles?: FileInfo[] | null
  formatFileSize: (bytes: number) => string
  sizeMode: "logical" | "disk"
}

const MAX_BATCH_PREVIEW = 8

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  file,
  batchFiles,
  formatFileSize,
  sizeMode
}: ConfirmDialogProps) {
  const hasBatch = !!batchFiles && batchFiles.length > 0
  if (!isOpen || (!file && !hasBatch)) return null

  const handleConfirm = async () => {
    await onConfirm()
    onClose()
  }

  const sizeOf = (f: FileInfo) => (sizeMode === "disk" ? f.sizeDisk : f.sizeLogical)

  const batchTotal = hasBatch
    ? batchFiles!.reduce((s, f) => s + sizeOf(f), 0)
    : 0
  const previewFiles = hasBatch ? batchFiles!.slice(0, MAX_BATCH_PREVIEW) : []

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />

        <div className="inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:align-middle">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 className="text-lg font-medium leading-6 text-gray-900">
                  {hasBatch ? `移到废纸篓（${batchFiles!.length} 项）` : "移到废纸篓"}
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    您确定要将以下项目移到废纸篓吗？
                  </p>

                  <div className="mt-4 rounded-lg bg-gray-50 p-4">
                    {hasBatch ? (
                      <>
                        <div className="space-y-1.5">
                          {previewFiles.map((f) => (
                            <div key={f.path} className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-gray-900">{f.name}</div>
                                <div className="truncate text-xs text-gray-500">{f.path}</div>
                              </div>
                              <div className="flex-shrink-0 text-sm font-semibold text-red-600">
                                {formatFileSize(sizeOf(f))}
                              </div>
                            </div>
                          ))}
                          {batchFiles!.length > MAX_BATCH_PREVIEW && (
                            <div className="text-xs text-gray-500">
                              …以及另外 {batchFiles!.length - MAX_BATCH_PREVIEW} 个项目
                            </div>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2">
                          <span className="text-sm text-gray-700">合计</span>
                          <span className="text-base font-bold text-red-600">
                            {formatFileSize(batchTotal)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {file!.name}
                            </div>
                            <div className="text-xs text-gray-500 mt-1 truncate max-w-xs">
                              {file!.path}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-red-600">
                            {formatFileSize(sizeOf(file!))}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center space-x-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${file!.is_dir ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                            {file!.is_dir ? '目录' : '文件'}
                          </span>
                          {file!.is_dir && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              包含子内容
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-4 rounded-lg bg-red-50 p-3">
                    <div className="flex">
                      <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
                      <div className="ml-3">
                        <h4 className="text-sm font-medium text-red-800">注意</h4>
                        <div className="mt-1 text-sm text-red-700">
                          <p>
                            项目会进入废纸篓，可在 Finder 中恢复；<b>清空废纸篓后不可恢复</b>。
                          </p>
                          {hasBatch && batchFiles!.some((f) => f.is_dir) && (
                            <p className="mt-1">目录及其中的所有内容会一起移入废纸篓。</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              onClick={handleConfirm}
              className="inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              移到废纸篓
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              <X className="h-4 w-4 mr-2" />
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
