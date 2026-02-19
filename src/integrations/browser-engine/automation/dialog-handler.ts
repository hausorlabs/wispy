/**
 * Dialog Handler -- auto-handle browser alerts, confirms, prompts.
 *
 * Browser Use auto-accepts dialogs by default. We capture dialog history
 * and allow the LLM to configure how to respond.
 */

import type { Page, Dialog } from "playwright-core";

export interface DialogRecord {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultValue?: string;
  response: string;
  timestamp: number;
}

export interface DialogConfig {
  /** Default action for alerts (default: accept). */
  alertAction?: "accept" | "dismiss";
  /** Default action for confirms (default: accept). */
  confirmAction?: "accept" | "dismiss";
  /** Default action for prompts (default: accept with default value). */
  promptAction?: "accept" | "dismiss";
  /** Text to enter for prompts (default: use dialog's defaultValue). */
  promptText?: string;
}

/**
 * Set up automatic dialog handling on a page.
 * Returns a function to retrieve the dialog history.
 */
export function setupDialogHandler(
  page: Page,
  config?: DialogConfig
): { getDialogs: () => DialogRecord[]; clearDialogs: () => void } {
  const history: DialogRecord[] = [];

  page.on("dialog", async (dialog: Dialog) => {
    const type = dialog.type() as DialogRecord["type"];
    const message = dialog.message();
    const defaultValue = dialog.defaultValue();

    let response = "accepted";

    try {
      switch (type) {
        case "alert": {
          const action = config?.alertAction ?? "accept";
          if (action === "dismiss") {
            await dialog.dismiss();
            response = "dismissed";
          } else {
            await dialog.accept();
          }
          break;
        }
        case "confirm": {
          const action = config?.confirmAction ?? "accept";
          if (action === "dismiss") {
            await dialog.dismiss();
            response = "dismissed";
          } else {
            await dialog.accept();
          }
          break;
        }
        case "prompt": {
          const action = config?.promptAction ?? "accept";
          if (action === "dismiss") {
            await dialog.dismiss();
            response = "dismissed";
          } else {
            const text = config?.promptText ?? defaultValue ?? "";
            await dialog.accept(text);
            response = `accepted with "${text}"`;
          }
          break;
        }
        case "beforeunload": {
          await dialog.accept();
          break;
        }
        default: {
          await dialog.accept();
          break;
        }
      }
    } catch {
      // Dialog may have already been handled
      response = "auto-handled";
    }

    history.push({
      type,
      message,
      defaultValue,
      response,
      timestamp: Date.now(),
    });
  });

  return {
    getDialogs: () => [...history],
    clearDialogs: () => { history.length = 0; },
  };
}

/**
 * Format dialog history for LLM output.
 */
export function formatDialogs(dialogs: DialogRecord[]): string {
  if (dialogs.length === 0) return "No dialogs have appeared.";

  return dialogs
    .map((d, i) =>
      `[${i + 1}] ${d.type}: "${d.message}" -> ${d.response}`
    )
    .join("\n");
}
