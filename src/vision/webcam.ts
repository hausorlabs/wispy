/**
 * Webcam Module -- Cross-platform webcam capture via ffmpeg subprocess.
 *
 * Supports Windows (dshow), macOS (avfoundation), and Linux (v4l2).
 * Captures single frames or records short video clips from connected cameras.
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createLogger } from "../infra/logger.js";

const log = createLogger("webcam");

export interface CaptureOptions {
  device?: string;
  width?: number;
  height?: number;
  filename?: string;
  outputDir?: string;
}

export interface RecordOptions {
  device?: string;
  duration?: number;
  fps?: number;
  filename?: string;
  outputDir?: string;
}

export interface DeviceInfo {
  name: string;
  id: string;
  type: "video" | "audio" | "unknown";
}

/** Check if ffmpeg is available on the system */
export function isFfmpegAvailable(): boolean {
  try {
    execSync("ffmpeg -version", { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Get the platform-specific ffmpeg input device format */
function getInputFormat(): string {
  switch (process.platform) {
    case "win32": return "dshow";
    case "darwin": return "avfoundation";
    default: return "v4l2";
  }
}

/** Get the default device argument for the platform */
function getDefaultDevice(): string {
  switch (process.platform) {
    case "win32": return "video=Integrated Webcam";
    case "darwin": return "0";
    default: return "/dev/video0";
  }
}

/** Format device string for ffmpeg -i argument */
function formatDeviceArg(device: string): string {
  if (process.platform === "win32") {
    // dshow expects "video=DeviceName" format
    return device.includes("=") ? device : `video=${device}`;
  }
  return device;
}

/**
 * List available video capture devices.
 * Returns parsed device list from ffmpeg.
 */
export function listDevices(): DeviceInfo[] {
  const devices: DeviceInfo[] = [];
  const inputFormat = getInputFormat();

  try {
    let output = "";

    if (process.platform === "win32") {
      // Windows: list dshow devices
      const result = spawnSync("ffmpeg", [
        "-f", "dshow", "-list_devices", "true", "-i", "dummy"
      ], { encoding: "utf8", timeout: 10000 });
      output = result.stderr || "";
    } else if (process.platform === "darwin") {
      // macOS: list avfoundation devices
      const result = spawnSync("ffmpeg", [
        "-f", "avfoundation", "-list_devices", "true", "-i", ""
      ], { encoding: "utf8", timeout: 10000 });
      output = result.stderr || "";
    } else {
      // Linux: list v4l2 devices
      try {
        const result = execSync("v4l2-ctl --list-devices 2>/dev/null || ls /dev/video* 2>/dev/null", {
          encoding: "utf8",
          timeout: 10000,
        });
        // Parse v4l2 output
        const lines = result.split("\n").filter(l => l.trim());
        for (const line of lines) {
          if (line.startsWith("/dev/video")) {
            devices.push({ name: line.trim(), id: line.trim(), type: "video" });
          } else if (!line.startsWith("\t")) {
            // Device name header
            const nextLine = lines[lines.indexOf(line) + 1];
            if (nextLine?.trim().startsWith("/dev/")) {
              devices.push({ name: line.trim().replace(/:$/, ""), id: nextLine.trim(), type: "video" });
            }
          }
        }
        return devices;
      } catch {
        return [];
      }
    }

    // Parse ffmpeg device list output (Windows/macOS)
    const lines = output.split("\n");
    let currentType: "video" | "audio" | "unknown" = "unknown";

    for (const line of lines) {
      if (line.includes("DirectShow video devices") || line.includes("AVFoundation video devices")) {
        currentType = "video";
        continue;
      }
      if (line.includes("DirectShow audio devices") || line.includes("AVFoundation audio devices")) {
        currentType = "audio";
        continue;
      }

      // Match device entries: [dshow @ ...] "Device Name" or [AVFoundation ...] [0] Device Name
      const dshowMatch = line.match(/"([^"]+)"/);
      const avfMatch = line.match(/\[(\d+)\]\s+(.+)/);

      if (dshowMatch && currentType === "video") {
        devices.push({ name: dshowMatch[1], id: dshowMatch[1], type: "video" });
      } else if (avfMatch && currentType === "video") {
        devices.push({ name: avfMatch[2].trim(), id: avfMatch[1], type: "video" });
      }
    }
  } catch (err) {
    log.warn("Failed to list devices: %s", (err as Error).message);
  }

  return devices;
}

/**
 * Capture a single frame from the webcam.
 * Returns the path to the captured image file.
 */
export function captureFrame(opts: CaptureOptions = {}): string {
  if (!isFfmpegAvailable()) {
    throw new Error("FFmpeg not found. Install FFmpeg: https://ffmpeg.org/download.html");
  }

  const device = opts.device || getDefaultDevice();
  const width = opts.width || 1280;
  const height = opts.height || 720;
  const filename = opts.filename || `webcam_${Date.now()}.jpg`;
  const outputDir = opts.outputDir || join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".wispy", "captures"
  );

  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, filename);
  const inputFormat = getInputFormat();
  const deviceArg = formatDeviceArg(device);

  let args: string[];

  if (process.platform === "win32") {
    args = [
      "-f", inputFormat,
      "-video_size", `${width}x${height}`,
      "-i", deviceArg,
      "-frames:v", "1",
      "-y",
      outputPath,
    ];
  } else if (process.platform === "darwin") {
    args = [
      "-f", inputFormat,
      "-video_size", `${width}x${height}`,
      "-framerate", "30",
      "-i", deviceArg,
      "-frames:v", "1",
      "-y",
      outputPath,
    ];
  } else {
    args = [
      "-f", inputFormat,
      "-video_size", `${width}x${height}`,
      "-i", deviceArg,
      "-frames:v", "1",
      "-y",
      outputPath,
    ];
  }

  log.info("Capturing frame: ffmpeg %s", args.join(" "));

  const result = spawnSync("ffmpeg", args, {
    encoding: "utf8",
    timeout: 15000,
    stdio: "pipe",
  });

  if (result.error) {
    throw new Error(`Webcam capture failed: ${result.error.message}`);
  }

  if (!existsSync(outputPath)) {
    const stderr = result.stderr || "";
    throw new Error(`Frame not captured. FFmpeg stderr: ${stderr.slice(-300)}`);
  }

  log.info("Frame captured: %s", outputPath);
  return outputPath;
}

/**
 * Record a short video clip from the webcam.
 * Returns the path to the recorded video file.
 */
export function recordVideo(opts: RecordOptions = {}): string {
  if (!isFfmpegAvailable()) {
    throw new Error("FFmpeg not found. Install FFmpeg: https://ffmpeg.org/download.html");
  }

  const device = opts.device || getDefaultDevice();
  const duration = Math.min(opts.duration || 10, 30); // Cap at 30s
  const fps = opts.fps || 15;
  const filename = opts.filename || `webcam_${Date.now()}.mp4`;
  const outputDir = opts.outputDir || join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".wispy", "captures"
  );

  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, filename);
  const inputFormat = getInputFormat();
  const deviceArg = formatDeviceArg(device);

  let args: string[];

  if (process.platform === "win32") {
    args = [
      "-f", inputFormat,
      "-framerate", String(fps),
      "-i", deviceArg,
      "-t", String(duration),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-y",
      outputPath,
    ];
  } else if (process.platform === "darwin") {
    args = [
      "-f", inputFormat,
      "-framerate", String(fps),
      "-i", deviceArg,
      "-t", String(duration),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-y",
      outputPath,
    ];
  } else {
    args = [
      "-f", inputFormat,
      "-framerate", String(fps),
      "-i", deviceArg,
      "-t", String(duration),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-y",
      outputPath,
    ];
  }

  log.info("Recording %ds video: ffmpeg %s", duration, args.join(" "));

  const result = spawnSync("ffmpeg", args, {
    encoding: "utf8",
    timeout: (duration + 15) * 1000,
    stdio: "pipe",
  });

  if (result.error) {
    throw new Error(`Webcam recording failed: ${result.error.message}`);
  }

  if (!existsSync(outputPath)) {
    const stderr = result.stderr || "";
    throw new Error(`Video not recorded. FFmpeg stderr: ${stderr.slice(-300)}`);
  }

  log.info("Video recorded: %s (%ds)", outputPath, duration);
  return outputPath;
}
