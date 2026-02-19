/**
 * Cookie Jar -- cookie serialization and import/export helpers.
 */

import type { BrowserContext, Cookie } from "playwright-core";
import type { SerializedCookie } from "../types.js";

/** Export cookies from a browser context to serializable format */
export async function exportCookies(context: BrowserContext): Promise<SerializedCookie[]> {
  const cookies = await context.cookies();
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: (c.sameSite ?? "None") as SerializedCookie["sameSite"],
  }));
}

/** Import cookies into a browser context */
export async function importCookies(
  context: BrowserContext,
  cookies: SerializedCookie[]
): Promise<void> {
  if (!cookies.length) return;

  const playwrightCookies: Cookie[] = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }));

  await context.addCookies(playwrightCookies);
}

/** Export localStorage for all origins in a page */
export async function exportLocalStorage(
  context: BrowserContext
): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};
  const pages = context.pages();

  for (const page of pages) {
    try {
      const url = new URL(page.url());
      const origin = url.origin;
      if (origin === "about:blank" || origin === "chrome:") continue;

      const storage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) items[key] = localStorage.getItem(key) ?? "";
        }
        return items;
      });

      if (Object.keys(storage).length > 0) {
        result[origin] = storage;
      }
    } catch {
      // Page might have navigated or be closed
    }
  }

  return result;
}

/** Import localStorage values into a page */
export async function importLocalStorage(
  context: BrowserContext,
  storage: Record<string, Record<string, string>>
): Promise<void> {
  for (const [origin, items] of Object.entries(storage)) {
    try {
      // Navigate to the origin first to set localStorage
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => {});

      await page.evaluate((data: Record<string, string>) => {
        for (const [key, value] of Object.entries(data)) {
          localStorage.setItem(key, value);
        }
      }, items);

      await page.close();
    } catch {
      // Origin might be unreachable
    }
  }
}
