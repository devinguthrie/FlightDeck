"use client";

interface Props {
  page: number;
  pageCount: number;
  pageSize: number;
  totalItems: number;
  itemLabel: string;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function PaginationControls({
  page,
  pageCount,
  pageSize,
  totalItems,
  itemLabel,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const start = totalItems === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(totalItems, (page + 1) * pageSize);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
      <span>
        Page {page + 1} of {pageCount} · Showing {start}-{end} of {totalItems} {itemLabel}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            aria-label={`${itemLabel} rows per page`}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="rounded border border-gray-200 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          disabled={page >= pageCount - 1}
          className="rounded border border-gray-200 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
