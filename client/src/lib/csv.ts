// CSV building and file download (no dependencies), used by the dashboard's Export CSV button.
//
// RFC 4180: a value containing a comma, quote or line break is wrapped in quotes,
// and inner quotes are doubled. A byte-order mark (U+FEFF) is added at the start
// so Excel reads the file as UTF-8.

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

function escapeCell(raw: string | number | null | undefined): string {
  const s = raw == null ? "" : String(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(","));
  }
  // CRLF, for Excel
  return "\uFEFF" + lines.join("\r\n");
}

// Download as a Blob.
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, content: string) {
  downloadFile(filename, content, "text/csv;charset=utf-8");
}

// Timestamp for file names (for example 2026-07-26T14-03-11, local time).
export function fileStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}
