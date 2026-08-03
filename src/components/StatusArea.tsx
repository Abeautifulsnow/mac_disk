import { CheckCircle, XCircle } from "lucide-react";

interface StatusAreaProps {
  error: string | null;
  success: string | null;
}

/** Compact, stacked notification slot for scan/action errors and successes. */
export default function StatusArea({ error, success }: StatusAreaProps) {
  if (!error && !success) return null;

  return (
    <div className="mb-4 space-y-2">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">{error}</div>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-green-800">{success}</div>
        </div>
      )}
    </div>
  );
}
