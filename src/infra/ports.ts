import { createServer } from "net";

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    // No host = bind to all interfaces (same as Express default),
    // so the check matches what .listen(port) actually does.
    server.listen(port);
  });
}

/**
 * Find a free port starting from `preferred`, incrementing until one is available.
 * Tries up to `maxAttempts` ports.
 */
export async function findFreePort(preferred: number, maxAttempts = 20): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    if (await isPortAvailable(port)) return port;
  }
  // Fallback: let the OS pick any free port
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free port found"))));
    });
    server.once("error", reject);
  });
}
