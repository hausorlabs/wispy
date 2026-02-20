/**
 * Camera & Screenshot Integration
 *
 * Captures images from the webcam using ffmpeg and takes screenshots using
 * native OS commands. No external API keys required -- uses local devices only.
 *
 * @requires ffmpeg - For webcam capture (must be on PATH)
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

export default class CameraIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "camera",
    name: "Camera & Screenshot",
    category: "media",
    version: "1.0.0",
    description: "Capture images from webcam and take screenshots using local OS tools.",
    auth: { type: "none" },
    capabilities: { offline: true },
    requires: { bins: ["ffmpeg"] },
    tools: [
      {
        name: "camera_capture",
        description: "Capture an image from the webcam/camera using ffmpeg.",
        parameters: {
          type: "object",
          properties: {
            device: { type: "string", description: "Camera device path (e.g. /dev/video0 on Linux, 'default' on macOS). Defaults to auto-detect." },
            output: { type: "string", description: "Output file path. Defaults to a temp file." },
          },
        },
      },
      {
        name: "camera_screenshot",
        description: "Take a screenshot of the current screen using native OS commands.",
        parameters: {
          type: "object",
          properties: {
            output: { type: "string", description: "Output file path. Defaults to a temp file." },
            display: { type: "number", description: "Display/monitor number (0-indexed). Defaults to primary." },
          },
        },
      },
    ],
  };

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "camera_capture":
          return await this.capture(args.device as string | undefined, args.output as string | undefined);
        case "camera_screenshot":
          return await this.screenshot(args.output as string | undefined, args.display as number | undefined);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Camera error: ${(err as Error).message}`);
    }
  }

  private async capture(device?: string, output?: string): Promise<ToolResult> {
    const outPath = output || join(tmpdir(), `wispy-cam-${randomUUID()}.jpg`);
    const platform = process.platform;

    let inputFlag: string;
    let devicePath: string;
    if (platform === "darwin") {
      inputFlag = "-f avfoundation";
      devicePath = device || "0";
    } else if (platform === "win32") {
      inputFlag = "-f dshow";
      devicePath = device || "video=Integrated Camera";
    } else {
      inputFlag = "-f v4l2";
      devicePath = device || "/dev/video0";
    }

    const cmd = `ffmpeg -y ${inputFlag} -i "${devicePath}" -frames:v 1 -q:v 2 "${outPath}" 2>&1`;
    try {
      await execAsync(cmd, { timeout: 15_000 });
    } catch (err) {
      return this.error(`ffmpeg capture failed: ${(err as Error).message}. Ensure a camera is connected and ffmpeg is installed.`);
    }

    const stats = await readFile(outPath);
    return this.ok(`Captured webcam image: ${outPath} (${stats.length} bytes)`, {
      path: outPath, size: stats.length, format: "jpeg",
    });
  }

  private async screenshot(output?: string, display?: number): Promise<ToolResult> {
    const outPath = output || join(tmpdir(), `wispy-screen-${randomUUID()}.png`);
    const platform = process.platform;

    let cmd: string;
    if (platform === "darwin") {
      const displayArg = display !== undefined ? `-D ${display}` : "";
      cmd = `screencapture ${displayArg} -x "${outPath}"`;
    } else if (platform === "win32") {
      // Use PowerShell to capture screen on Windows
      const ps = [
        `Add-Type -AssemblyName System.Windows.Forms`,
        `$screen = [System.Windows.Forms.Screen]::AllScreens[${display ?? 0}]`,
        `$bounds = $screen.Bounds`,
        `$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)`,
        `$gfx = [System.Drawing.Graphics]::FromImage($bmp)`,
        `$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)`,
        `$bmp.Save('${outPath.replace(/'/g, "''")}')`,
        `$gfx.Dispose(); $bmp.Dispose()`,
      ].join("; ");
      cmd = `powershell -NoProfile -Command "${ps}"`;
    } else {
      // Linux: try gnome-screenshot, then scrot, then import (ImageMagick)
      cmd = `gnome-screenshot -f "${outPath}" 2>/dev/null || scrot "${outPath}" 2>/dev/null || import -window root "${outPath}"`;
    }

    try {
      await execAsync(cmd, { timeout: 10_000 });
    } catch (err) {
      return this.error(`Screenshot failed: ${(err as Error).message}. Install a screenshot tool for your OS.`);
    }

    const stats = await readFile(outPath);
    return this.ok(`Screenshot saved: ${outPath} (${stats.length} bytes)`, {
      path: outPath, size: stats.length, format: "png",
    });
  }
}
