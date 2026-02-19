/**
 * Drag and Drop -- drag elements to other elements or coordinates.
 */

import type { Page } from "playwright-core";

export interface DragDropResult {
  success: boolean;
  error?: string;
}

/**
 * Drag an element and drop it onto another element.
 */
export async function dragAndDrop(
  page: Page,
  source: { selector?: string; x?: number; y?: number },
  target: { selector?: string; x?: number; y?: number },
  opts?: { steps?: number; delay?: number }
): Promise<DragDropResult> {
  try {
    // Selector-to-selector drag
    if (source.selector && target.selector) {
      await page.dragAndDrop(source.selector, target.selector, {
        force: false,
      });
      return { success: true };
    }

    // Coordinate-based drag (manual mouse events)
    const sourcePos = source.selector
      ? await getElementCenter(page, source.selector)
      : { x: source.x ?? 0, y: source.y ?? 0 };

    const targetPos = target.selector
      ? await getElementCenter(page, target.selector)
      : { x: target.x ?? 0, y: target.y ?? 0 };

    if (!sourcePos || !targetPos) {
      return { success: false, error: "Could not resolve source or target position" };
    }

    const steps = opts?.steps ?? 10;
    const delay = opts?.delay ?? 50;

    // Perform drag with intermediate steps for smooth movement
    await page.mouse.move(sourcePos.x, sourcePos.y);
    await page.mouse.down();

    // Move in steps
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = sourcePos.x + (targetPos.x - sourcePos.x) * t;
      const y = sourcePos.y + (targetPos.y - sourcePos.y) * t;
      await page.mouse.move(x, y);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }

    await page.mouse.up();

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getElementCenter(
  page: Page,
  selector: string
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
}
