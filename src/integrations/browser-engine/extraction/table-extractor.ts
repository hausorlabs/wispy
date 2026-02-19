/**
 * Table Extractor -- detect and extract HTML tables from pages.
 */

import type { Page } from "playwright-core";
import type { ExtractedTable } from "../types.js";

/**
 * Extract all tables from the current page.
 */
export async function extractTables(page: Page, opts?: { limit?: number }): Promise<ExtractedTable[]> {
  const limit = opts?.limit ?? 10;

  const tables = await page.evaluate((maxTables: number) => {
    const results: Array<{
      headers: string[];
      rows: string[][];
      caption: string | null;
      index: number;
    }> = [];

    const tableEls = document.querySelectorAll("table");

    for (let i = 0; i < Math.min(tableEls.length, maxTables); i++) {
      const table = tableEls[i];

      // Extract caption
      const caption = table.querySelector("caption")?.textContent?.trim() ?? null;

      // Extract headers
      const headers: string[] = [];
      const headerCells = table.querySelectorAll("thead th, thead td, tr:first-child th");
      for (let hi = 0; hi < headerCells.length; hi++) {
        headers.push(headerCells[hi].textContent?.trim() ?? "");
      }

      // If no thead, try first row
      if (headers.length === 0) {
        const firstRow = table.querySelector("tr");
        if (firstRow) {
          const firstRowCells = firstRow.querySelectorAll("th, td");
          for (let fi = 0; fi < firstRowCells.length; fi++) {
            headers.push(firstRowCells[fi].textContent?.trim() ?? "");
          }
        }
      }

      // Extract rows
      const rows: string[][] = [];
      const bodyRows = table.querySelectorAll("tbody tr, tr");
      const startIdx = headers.length > 0 && !table.querySelector("thead") ? 1 : 0;

      for (let j = startIdx; j < bodyRows.length; j++) {
        const row: string[] = [];
        const cells = bodyRows[j].querySelectorAll("td, th");
        for (let ci = 0; ci < cells.length; ci++) {
          row.push(cells[ci].textContent?.trim() ?? "");
        }
        if (row.length > 0) rows.push(row);
      }

      // Skip empty tables
      if (rows.length === 0 && headers.length === 0) continue;

      results.push({ headers, rows, caption, index: i });
    }

    return results;
  }, limit);

  return tables.map((t) => ({
    headers: t.headers,
    rows: t.rows,
    caption: t.caption ?? undefined,
    selector: `table:nth-of-type(${t.index + 1})`,
  }));
}

/**
 * Format extracted tables as markdown for LLM consumption.
 */
export function formatTablesAsMarkdown(tables: ExtractedTable[]): string {
  if (tables.length === 0) return "No tables found on the page.";

  const parts: string[] = [];

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const lines: string[] = [];

    if (table.caption) {
      lines.push(`### ${table.caption}`);
    } else {
      lines.push(`### Table ${i + 1}`);
    }

    if (table.headers.length > 0) {
      lines.push("| " + table.headers.join(" | ") + " |");
      lines.push("| " + table.headers.map(() => "---").join(" | ") + " |");
    }

    for (const row of table.rows) {
      lines.push("| " + row.join(" | ") + " |");
    }

    lines.push(`\n*${table.rows.length} rows*`);
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}
