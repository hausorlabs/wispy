/**
 * Download Manager -- file download capture and management.
 *
 * Intercepts browser downloads, saves them to disk, and tracks
 * download history per session.
 */

import type { Page, Download } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface DownloadInfo {
  filename: string;
  url: string;
  path: string;
  mimeType: string;
  size: number;
  timestamp: number;
}

export interface DownloadResult {
  success: boolean;
  download?: DownloadInfo;
  error?: string;
}

/**
 * Click a link/button and capture the resulting download.
 */
export async function captureDownload(
  page: Page,
  trigger: { selector?: string; url?: string },
  downloadDir: string,
  timeout = 30_000
): Promise<DownloadResult> {
  await mkdir(downloadDir, { recursive: true });

  try {
    let download: Download;

    if (trigger.url) {
      // Direct URL download
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout }),
        page.evaluate((url: string) => {
          const a = document.createElement("a");
          a.href = url;
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, trigger.url),
      ]);
      download = dl;
    } else if (trigger.selector) {
      // Click trigger
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout }),
        page.click(trigger.selector),
      ]);
      download = dl;
    } else {
      return { success: false, error: "Either selector or url is required." };
    }

    // Save the file
    const suggestedName = download.suggestedFilename();
    const filePath = path.join(downloadDir, suggestedName);
    await download.saveAs(filePath);

    // Get file info
    const { stat } = await import("node:fs/promises");
    let fileSize = 0;
    try {
      const stats = await stat(filePath);
      fileSize = stats.size;
    } catch {
      // File might not exist yet if download failed
    }

    return {
      success: true,
      download: {
        filename: suggestedName,
        url: download.url(),
        path: filePath,
        mimeType: suggestedName.split(".").pop() ?? "unknown",
        size: fileSize,
        timestamp: Date.now(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("Timeout")) {
      return { success: false, error: "Download timed out. No download was triggered." };
    }
    return { success: false, error: `Download failed: ${msg}` };
  }
}

/**
 * Format download info for LLM output.
 */
export function formatDownloadInfo(info: DownloadInfo): string {
  const sizeStr = formatFileSize(info.size);
  return [
    `File downloaded: ${info.filename}`,
    `  URL: ${info.url}`,
    `  Path: ${info.path}`,
    `  Size: ${sizeStr}`,
    `  Type: ${info.mimeType}`,
  ].join("\n");
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
