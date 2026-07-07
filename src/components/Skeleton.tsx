/** Shimmering placeholder shapes shown while data loads from the database. */

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <span className={`skeleton block ${className}`} style={style} aria-hidden="true" />;
}

/**
 * Generic list-row placeholders: [icon] [title + subtitle] [right-aligned meta].
 * Matches the row rhythm of the Documents / Imports / Audit / Sources lists.
 */
export function ListRowsSkeleton({
  rows = 6,
  icon = true,
}: {
  rows?: number;
  icon?: boolean;
}) {
  return (
    <div aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`flex items-center gap-3.5 px-[18px] py-3 ${
            i < rows - 1 ? "border-b border-hairline-2" : ""
          }`}
          style={{ opacity: 1 - i * 0.09 }}
        >
          {icon && <Skeleton className="h-[30px] w-[30px] flex-none rounded-lg" />}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-[45%] max-w-[260px]" />
            <Skeleton className="mt-1.5 h-2.5 w-[70%] max-w-[420px]" />
          </div>
          <div className="flex-none">
            <Skeleton className="ml-auto h-2.5 w-20" />
            <Skeleton className="ml-auto mt-1.5 h-2.5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Builder + live-preview layout placeholder for the share config pages. */
export function SharePageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-7 overflow-hidden p-7" aria-busy="true">
      <div className="min-w-0 max-w-[560px] flex-1">
        <Skeleton className="h-6 w-48 rounded-md" />
        <div className="mt-4 rounded-xl border border-line bg-card p-4">
          <Skeleton className="h-2.5 w-24" />
          <TextSkeleton lines={4} className="mt-4" />
        </div>
        <div className="mt-4 rounded-xl border border-line bg-card p-4">
          <Skeleton className="h-2.5 w-24" />
          <TextSkeleton lines={3} className="mt-4" />
        </div>
      </div>
      <div className="hidden w-[390px] flex-none lg:block">
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    </div>
  );
}

// varied line lengths so it reads as text, not a barcode
const TEXT_WIDTHS = ["92%", "100%", "78%", "95%", "60%", "88%", "70%", "84%"];

/** Paragraph-style placeholder lines (doc content, diff panes, log feeds). */
export function TextSkeleton({
  lines = 6,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: TEXT_WIDTHS[i % TEXT_WIDTHS.length] }} />
      ))}
    </div>
  );
}
