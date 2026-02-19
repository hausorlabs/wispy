/**
 * Media Extractor -- extract images, videos, links from pages.
 */

import type { Page } from "playwright-core";
import type { ExtractedLink, ExtractedMedia } from "../types.js";

/**
 * Extract all links from the current page.
 */
export async function extractLinks(
  page: Page,
  opts?: { filter?: string; limit?: number }
): Promise<ExtractedLink[]> {
  const pageUrl = page.url();
  const limit = opts?.limit ?? 500;

  const links = await page.evaluate((maxLinks: number) => {
    const results: Array<{ text: string; url: string }> = [];
    const anchors = document.querySelectorAll("a[href]");

    for (let i = 0; i < Math.min(anchors.length, maxLinks); i++) {
      const a = anchors[i] as HTMLAnchorElement;
      results.push({
        text: a.textContent?.trim() ?? "",
        url: a.href,
      });
    }

    return results;
  }, limit);

  let result: ExtractedLink[] = links.map((l) => {
    let isExternal = false;
    try {
      isExternal = new URL(l.url).hostname !== new URL(pageUrl).hostname;
    } catch {
      // Invalid URL
    }
    return { text: l.text, url: l.url, isExternal };
  });

  // Apply regex filter if provided
  if (opts?.filter) {
    const re = new RegExp(opts.filter, "i");
    result = result.filter((l) => re.test(l.url) || re.test(l.text));
  }

  return result;
}

/**
 * Extract media elements (images, videos, audio).
 */
export async function extractMedia(
  page: Page,
  opts?: { type?: "image" | "video" | "audio"; limit?: number }
): Promise<ExtractedMedia[]> {
  const limit = opts?.limit ?? 200;
  const filterType = opts?.type;

  const media = await page.evaluate(
    (args: { maxItems: number; filterType?: string }) => {
      const results: Array<{
        type: "image" | "video" | "audio";
        src: string;
        alt?: string;
        width?: number;
        height?: number;
      }> = [];

      // Images
      if (!args.filterType || args.filterType === "image") {
        const imgs = document.querySelectorAll("img[src]");
        for (let i = 0; i < Math.min(imgs.length, args.maxItems); i++) {
          const img = imgs[i] as HTMLImageElement;
          if (!img.src || img.src.startsWith("data:")) continue;
          results.push({
            type: "image",
            src: img.src,
            alt: img.alt || undefined,
            width: img.naturalWidth || undefined,
            height: img.naturalHeight || undefined,
          });
        }
      }

      // Videos
      if (!args.filterType || args.filterType === "video") {
        const videos = document.querySelectorAll("video, video source");
        for (let i = 0; i < Math.min(videos.length, args.maxItems); i++) {
          const vid = videos[i] as HTMLVideoElement;
          const src = vid.src || vid.getAttribute("src") || "";
          if (!src) continue;
          results.push({
            type: "video",
            src,
            width: vid.videoWidth || undefined,
            height: vid.videoHeight || undefined,
          });
        }
      }

      // Audio
      if (!args.filterType || args.filterType === "audio") {
        const audios = document.querySelectorAll("audio, audio source");
        for (let i = 0; i < Math.min(audios.length, args.maxItems); i++) {
          const aud = audios[i] as HTMLAudioElement;
          const src = aud.src || aud.getAttribute("src") || "";
          if (!src) continue;
          results.push({ type: "audio", src });
        }
      }

      return results;
    },
    { maxItems: limit, filterType }
  );

  return media;
}

/**
 * Format links as a readable list.
 */
export function formatLinks(links: ExtractedLink[]): string {
  if (links.length === 0) return "No links found.";

  return links
    .map((l, i) => {
      const ext = l.isExternal ? " [external]" : "";
      const text = l.text ? ` "${l.text}"` : "";
      return `${i + 1}. ${l.url}${text}${ext}`;
    })
    .join("\n");
}
