/**
 * Session Manager tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionManager } from "../core/session-manager.js";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import path from "node:path";

// Mock playwright-core to avoid real browser launches in unit tests
vi.mock("playwright-core", () => {
  const mockPage = {
    url: vi.fn(() => "about:blank"),
    title: vi.fn(() => ""),
    goto: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    evaluate: vi.fn(() => []),
    waitForLoadState: vi.fn(),
    waitForSelector: vi.fn(),
    screenshot: vi.fn(),
    keyboard: { press: vi.fn() },
  };

  const mockContext = {
    pages: vi.fn(() => [mockPage]),
    newPage: vi.fn(() => mockPage),
    close: vi.fn(),
    cookies: vi.fn(() => []),
    addCookies: vi.fn(),
    addInitScript: vi.fn(),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
  };

  const mockBrowser = {
    newContext: vi.fn(() => mockContext),
    close: vi.fn(),
  };

  return {
    chromium: {
      launch: vi.fn(() => mockBrowser),
      connectOverCDP: vi.fn(() => mockBrowser),
    },
  };
});

describe("SessionManager", () => {
  let manager: SessionManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "wispy-test-"));
    manager = new SessionManager(tmpDir);
  });

  afterEach(async () => {
    await manager.dispose();
  });

  it("should create a session", async () => {
    const session = await manager.createSession();
    expect(session.id).toBeTruthy();
    expect(session.id.length).toBe(8);
    expect(manager.sessionCount).toBe(1);
  });

  it("should list sessions", async () => {
    await manager.createSession();
    await manager.createSession();
    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it("should close a session", async () => {
    const session = await manager.createSession();
    expect(manager.sessionCount).toBe(1);
    await manager.closeSession(session.id);
    expect(manager.sessionCount).toBe(0);
  });

  it("should get default session", async () => {
    const session = await manager.createSession();
    const retrieved = manager.getSession();
    expect(retrieved?.id).toBe(session.id);
  });

  it("should get or create session", async () => {
    expect(manager.sessionCount).toBe(0);
    const session = await manager.getOrCreateSession();
    expect(manager.sessionCount).toBe(1);

    // Should return same session
    const again = await manager.getOrCreateSession();
    expect(again.id).toBe(session.id);
    expect(manager.sessionCount).toBe(1);
  });

  it("should close all sessions", async () => {
    await manager.createSession();
    await manager.createSession();
    expect(manager.sessionCount).toBe(2);
    await manager.closeAll();
    expect(manager.sessionCount).toBe(0);
  });

  it("should evict oldest session when max reached", async () => {
    // Create max sessions (5) then one more
    for (let i = 0; i < 6; i++) {
      await manager.createSession();
    }
    // Should still only have 5 (max)
    expect(manager.sessionCount).toBeLessThanOrEqual(5);
  });
});
