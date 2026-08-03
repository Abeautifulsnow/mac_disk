interface TypeBadgeProps {
  isDir: boolean;
}

/** Small directory/file badge shared by the result rows. */
export default function TypeBadge({ isDir }: TypeBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isDir ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
      }`}
    >
      {isDir ? "目录" : "文件"}
    </span>
  );
}
