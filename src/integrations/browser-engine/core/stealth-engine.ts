/**
 * Stealth Engine -- anti-detection patches applied via Playwright's addInitScript().
 *
 * Covers: webdriver flag, navigator properties, WebGL, canvas, plugins, permissions,
 * Chrome runtime, iframe detection, timezone spoofing.
 * No external deps (no puppeteer-extra).
 */

import type { BrowserContext } from "playwright-core";
import { USER_AGENTS } from "../config.js";

/**
 * Apply all stealth patches to a browser context.
 */
export async function applyStealthPatches(
  context: BrowserContext,
  options: { userAgent?: string; timezone?: string; locale?: string } = {}
): Promise<void> {
  const ua = options.userAgent ?? USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  // 1. Remove webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  // 2. Override navigator.plugins (empty in headless)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ];
        const arr = Object.create(PluginArray.prototype);
        for (let i = 0; i < plugins.length; i++) {
          const p = Object.create(Plugin.prototype);
          Object.defineProperties(p, {
            name: { value: plugins[i].name },
            filename: { value: plugins[i].filename },
            description: { value: plugins[i].description },
            length: { value: 0 },
          });
          arr[i] = p;
        }
        Object.defineProperty(arr, "length", { value: plugins.length });
        return arr;
      },
    });
  });

  // 3. Override navigator.languages
  await context.addInitScript((locale: string) => {
    Object.defineProperty(navigator, "languages", {
      get: () => [locale, locale.split("-")[0]],
    });
  }, options.locale ?? "en-US");

  // 4. Chrome runtime object (missing in headless)
  await context.addInitScript(() => {
    if (!(window as unknown as Record<string, unknown>)["chrome"]) {
      const chrome = {
        runtime: {
          connect: () => {},
          sendMessage: () => {},
          onMessage: { addListener: () => {}, removeListener: () => {} },
        },
        loadTimes: () => ({
          commitLoadTime: Date.now() / 1000,
          connectionInfo: "h2",
          finishDocumentLoadTime: Date.now() / 1000 + 0.1,
          finishLoadTime: Date.now() / 1000 + 0.2,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000 + 0.05,
          navigationType: "Other",
          npnNegotiatedProtocol: "h2",
          requestTime: Date.now() / 1000 - 0.3,
          startLoadTime: Date.now() / 1000 - 0.2,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
        }),
        csi: () => ({ startE: Date.now(), onloadT: Date.now() + 100, pageT: 200, tran: 15 }),
      };
      Object.defineProperty(window, "chrome", { get: () => chrome, configurable: true });
    }
  });

  // 5. WebGL vendor/renderer spoofing
  await context.addInitScript(() => {
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      if (param === 37445) return "Intel Inc.";
      if (param === 37446) return "Intel Iris OpenGL Engine";
      return getParameterOrig.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== "undefined") {
      const getParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param: number) {
        if (param === 37445) return "Intel Inc.";
        if (param === 37446) return "Intel Iris OpenGL Engine";
        return getParam2.call(this, param);
      };
    }
  });

  // 6. Permissions API spoofing
  await context.addInitScript(() => {
    const origQuery = Permissions.prototype.query;
    Permissions.prototype.query = function (desc: PermissionDescriptor) {
      if (desc.name === "notifications") {
        return Promise.resolve({ state: "prompt", onchange: null } as PermissionStatus);
      }
      return origQuery.call(this, desc);
    };
  });

  // 7. Canvas fingerprint noise
  await context.addInitScript(() => {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args: Parameters<typeof origToDataURL>) {
      const ctx = this.getContext("2d");
      if (ctx) {
        const noise = Math.random() * 0.01;
        const imageData = ctx.getImageData(0, 0, Math.min(this.width, 2), Math.min(this.height, 2));
        imageData.data[0] = Math.floor(imageData.data[0] + noise);
        ctx.putImageData(imageData, 0, 0);
      }
      return origToDataURL.apply(this, args);
    };
  });

  // 8. Override user agent at the page level (context-level is set separately)
  await context.addInitScript((userAgent: string) => {
    Object.defineProperty(navigator, "userAgent", { get: () => userAgent });
    Object.defineProperty(navigator, "appVersion", { get: () => userAgent.replace("Mozilla/", "") });
    Object.defineProperty(navigator, "platform", {
      get: () => {
        if (userAgent.includes("Win")) return "Win32";
        if (userAgent.includes("Mac")) return "MacIntel";
        return "Linux x86_64";
      },
    });
  }, ua);

  // 9. Hardware concurrency + device memory
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
  });

  // 10. Connection API
  await context.addInitScript(() => {
    if (!("connection" in navigator)) {
      Object.defineProperty(navigator, "connection", {
        get: () => ({
          effectiveType: "4g",
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
    }
  });

  // 11. WebRTC IP leak prevention
  await context.addInitScript(() => {
    // Prevent WebRTC from leaking local IP via STUN
    const origRTCPeerConnection = (window as unknown as Record<string, unknown>).RTCPeerConnection;
    if (origRTCPeerConnection) {
      (window as unknown as Record<string, unknown>).RTCPeerConnection = function (
        this: unknown,
        config?: RTCConfiguration,
        ...args: unknown[]
      ) {
        // Strip STUN/TURN servers to prevent IP leak
        if (config?.iceServers) {
          config.iceServers = [];
        }
        return Reflect.construct(
          origRTCPeerConnection as new (...a: unknown[]) => unknown,
          [config, ...args],
          new.target || origRTCPeerConnection
        );
      } as unknown as typeof RTCPeerConnection;
      Object.setPrototypeOf(
        (window as unknown as Record<string, unknown>).RTCPeerConnection,
        origRTCPeerConnection
      );
    }
  });

  // 12. AudioContext fingerprint noise
  await context.addInitScript(() => {
    const origCreateOscillator = AudioContext.prototype.createOscillator;
    const origCreateDynamicsCompressor = AudioContext.prototype.createDynamicsCompressor;

    AudioContext.prototype.createOscillator = function (...args: Parameters<typeof origCreateOscillator>) {
      const osc = origCreateOscillator.apply(this, args);
      // Add slight frequency offset to prevent fingerprinting
      const origFreq = osc.frequency.value;
      osc.frequency.value = origFreq + (Math.random() * 0.01 - 0.005);
      return osc;
    };

    AudioContext.prototype.createDynamicsCompressor = function (...args: Parameters<typeof origCreateDynamicsCompressor>) {
      const comp = origCreateDynamicsCompressor.apply(this, args);
      // Slightly modify threshold to add noise
      comp.threshold.value = comp.threshold.value + (Math.random() * 0.1 - 0.05);
      return comp;
    };
  });

  // 13. Battery API spoofing (returns consistent values)
  await context.addInitScript(() => {
    if ("getBattery" in navigator) {
      (navigator as unknown as Record<string, unknown>).getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1.0,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null,
      });
    }
  });

  // 14. Bluetooth API -- prevent detection fingerprinting
  await context.addInitScript(() => {
    if ("bluetooth" in navigator) {
      (navigator as unknown as Record<string, unknown>).bluetooth = {
        getAvailability: () => Promise.resolve(false),
        requestDevice: () => Promise.reject(new DOMException("User cancelled", "NotFoundError")),
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    }
  });

  // 15. Prevent iframe detection (window.top === window.self)
  await context.addInitScript(() => {
    // Some sites detect headless by checking if we're in an iframe
    try {
      Object.defineProperty(window, "outerWidth", { get: () => window.innerWidth });
      Object.defineProperty(window, "outerHeight", { get: () => window.innerHeight + 85 }); // Account for Chrome toolbar
    } catch {
      // May fail in strict mode
    }
  });
}

/** Pick a random user agent */
export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
