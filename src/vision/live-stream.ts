/**
 * Live Vision Stream -- Captures webcam frames at intervals and sends to
 * Gemini vision for real-time analysis.
 *
 * Each frame is a standard Gemini generateContent call with inline image data.
 * The onFrame callback delivers Gemini's analysis to the caller (CLI or Telegram).
 */

import { readFileSync, unlinkSync, existsSync } from "fs";
import { captureFrame, isFfmpegAvailable } from "./webcam.js";
import { getClient } from "../ai/gemini.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("live-stream");

export interface LiveStreamOptions {
  /** Camera device identifier (platform-specific) */
  device?: string;
  /** Frame capture interval in ms (default: 2000) */
  intervalMs?: number;
  /** Max frames before auto-stop (default: 30) */
  maxFrames?: number;
  /** Analysis prompt for Gemini (default: "Describe what you see") */
  prompt?: string;
  /** Callback per frame with analysis result */
  onFrame?: (analysis: string, frameIndex: number) => void | Promise<void>;
  /** Output directory for captured frames */
  outputDir?: string;
  /** Whether to keep frame files after analysis (default: false) */
  keepFrames?: boolean;
  /** Gemini model to use for vision (default: gemini-2.5-flash-preview-05-20) */
  model?: string;
}

export interface StreamStatus {
  running: boolean;
  framesAnalyzed: number;
  lastAnalysis?: string;
  startedAt?: number;
  error?: string;
}

export class LiveVisionStream {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameCount = 0;
  private lastAnalysis?: string;
  private startedAt?: number;
  private lastError?: string;

  /** Get current stream status */
  getStatus(): StreamStatus {
    return {
      running: this.running,
      framesAnalyzed: this.frameCount,
      lastAnalysis: this.lastAnalysis,
      startedAt: this.startedAt,
      error: this.lastError,
    };
  }

  /**
   * Start the live vision stream.
   * Captures frames at intervals and sends each to Gemini for analysis.
   */
  async start(options: LiveStreamOptions = {}): Promise<void> {
    if (this.running) {
      throw new Error("Live stream is already running. Call stop() first.");
    }

    if (!isFfmpegAvailable()) {
      throw new Error("FFmpeg not found. Install FFmpeg: https://ffmpeg.org/download.html");
    }

    const intervalMs = options.intervalMs || 2000;
    const maxFrames = options.maxFrames || 30;
    const prompt = options.prompt || "Describe what you see in this webcam frame. Be concise.";
    const model = options.model || "gemini-2.5-flash-preview-05-20";
    const keepFrames = options.keepFrames || false;

    this.running = true;
    this.frameCount = 0;
    this.lastAnalysis = undefined;
    this.lastError = undefined;
    this.startedAt = Date.now();

    log.info("Starting live vision stream (interval: %dms, max: %d frames)", intervalMs, maxFrames);

    const analyzeFrame = async () => {
      if (!this.running) return;

      try {
        // Capture a frame
        const framePath = captureFrame({
          device: options.device,
          filename: `live_frame_${Date.now()}.jpg`,
          outputDir: options.outputDir,
        });

        // Read image as base64
        const imageBuffer = readFileSync(framePath);
        const base64 = imageBuffer.toString("base64");

        // Send to Gemini vision
        const ai = getClient();
        const response = await ai.models.generateContent({
          model,
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: base64 } },
              { text: prompt },
            ],
          }],
        });

        const analysis = response.text || "No analysis available";
        this.lastAnalysis = analysis;
        this.frameCount++;

        log.info("Frame %d analyzed: %s", this.frameCount, analysis.slice(0, 80));

        // Call the frame callback
        if (options.onFrame) {
          await options.onFrame(analysis, this.frameCount);
        }

        // Clean up frame file unless keepFrames is set
        if (!keepFrames && existsSync(framePath)) {
          try { unlinkSync(framePath); } catch { /* ignore */ }
        }

        // Check if we've hit the max
        if (this.frameCount >= maxFrames) {
          log.info("Reached max frames (%d), stopping stream", maxFrames);
          this.stop();
          return;
        }
      } catch (err) {
        const msg = (err as Error).message;
        this.lastError = msg;
        log.warn("Frame analysis failed: %s", msg);

        // Don't stop on transient errors, but stop on critical ones
        if (msg.includes("FFmpeg not found") || msg.includes("not initialized")) {
          this.stop();
        }
      }
    };

    // Capture first frame immediately
    await analyzeFrame();

    // Set up interval for subsequent frames
    if (this.running) {
      this.timer = setInterval(analyzeFrame, intervalMs);
    }
  }

  /** Stop the live vision stream */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const elapsed = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    log.info("Live stream stopped after %d frames (%ds)", this.frameCount, elapsed);
  }
}
