/**
 * Process Manager
 *
 * Manages long-running background processes spawned by the agent.
 * Supports process lifecycle (spawn, monitor, kill), output buffering,
 * stdin writing, and auto-restart on crash.
 *
 * OpenClaw parity: background process management for dev servers,
 * watchers, build tools, and any long-running commands.
 */

import { spawn, type ChildProcess } from "child_process";
import { createLogger } from "../infra/logger.js";

const log = createLogger("process-manager");

export interface ManagedProcess {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  pid?: number;
  status: "running" | "stopped" | "crashed" | "restarting";
  startedAt: string;
  stoppedAt?: string;
  restartCount: number;
  autoRestart: boolean;
  exitCode?: number;
}

export interface ProcessSummary {
  id: string;
  name: string;
  command: string;
  pid?: number;
  status: string;
  uptime: string;
  restartCount: number;
  outputLines: number;
}

const MAX_OUTPUT_LINES = 500;

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private children = new Map<string, ChildProcess>();
  private outputBuffers = new Map<string, string[]>();
  private idCounter = 0;

  /**
   * Spawn a new background process.
   */
  spawn(
    command: string,
    name: string,
    options?: { cwd?: string; autoRestart?: boolean }
  ): ManagedProcess {
    const id = `proc_${++this.idCounter}`;
    const proc: ManagedProcess = {
      id,
      name,
      command,
      cwd: options?.cwd,
      status: "running",
      startedAt: new Date().toISOString(),
      restartCount: 0,
      autoRestart: options?.autoRestart ?? false,
    };

    this.processes.set(id, proc);
    this.outputBuffers.set(id, []);
    this.startProcess(id, proc);

    log.info("Spawned process: %s (%s) -> %s", name, id, command);
    return proc;
  }

  private startProcess(id: string, proc: ManagedProcess): void {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/sh";
    const shellFlag = isWin ? "/c" : "-c";

    const child = spawn(shell, [shellFlag, proc.command], {
      cwd: proc.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    proc.pid = child.pid;
    this.children.set(id, child);

    const buffer = this.outputBuffers.get(id) ?? [];

    const appendLine = (line: string) => {
      const timestamped = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
      buffer.push(timestamped);
      if (buffer.length > MAX_OUTPUT_LINES) {
        buffer.splice(0, buffer.length - MAX_OUTPUT_LINES);
      }
    };

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter((l) => l.trim());
      lines.forEach((line) => appendLine(line));
    });

    child.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter((l) => l.trim());
      lines.forEach((line) => appendLine(`[ERR] ${line}`));
    });

    child.on("exit", (code) => {
      proc.exitCode = code ?? undefined;
      proc.stoppedAt = new Date().toISOString();
      proc.pid = undefined;
      this.children.delete(id);

      if (code !== 0 && proc.autoRestart && proc.status === "running") {
        proc.status = "restarting";
        proc.restartCount++;
        appendLine(`Process exited with code ${code}, restarting (attempt ${proc.restartCount})...`);
        log.warn("Process %s crashed (code %s), restarting...", proc.name, String(code ?? "unknown"));

        // Delay restart to avoid tight loops
        setTimeout(() => {
          if (proc.status === "restarting") {
            proc.status = "running";
            proc.startedAt = new Date().toISOString();
            this.startProcess(id, proc);
          }
        }, 2000);
      } else {
        proc.status = code === 0 ? "stopped" : "crashed";
        appendLine(`Process exited with code ${code}`);
        log.info("Process %s exited (code %s)", proc.name, String(code ?? 0));
      }
    });

    child.on("error", (err) => {
      appendLine(`[ERR] ${err.message}`);
      proc.status = "crashed";
    });
  }

  /**
   * List all processes.
   */
  list(): ProcessSummary[] {
    const now = Date.now();
    return Array.from(this.processes.values()).map((p) => {
      const started = new Date(p.startedAt).getTime();
      const uptimeMs = p.status === "running" ? now - started : 0;
      const secs = Math.floor(uptimeMs / 1000);
      const mins = Math.floor(secs / 60);
      const hours = Math.floor(mins / 60);

      let uptime = "stopped";
      if (p.status === "running") {
        uptime = hours > 0
          ? `${hours}h ${mins % 60}m`
          : mins > 0
            ? `${mins}m ${secs % 60}s`
            : `${secs}s`;
      }

      return {
        id: p.id,
        name: p.name,
        command: p.command,
        pid: p.pid,
        status: p.status,
        uptime,
        restartCount: p.restartCount,
        outputLines: this.outputBuffers.get(p.id)?.length ?? 0,
      };
    });
  }

  /**
   * Get recent output from a process.
   */
  getOutput(idOrName: string, lines: number = 50): string[] {
    const id = this.resolveId(idOrName);
    if (!id) return [`Process '${idOrName}' not found`];

    const buffer = this.outputBuffers.get(id) ?? [];
    return buffer.slice(-lines);
  }

  /**
   * Write to a process's stdin.
   */
  writeInput(idOrName: string, input: string): boolean {
    const id = this.resolveId(idOrName);
    if (!id) return false;

    const child = this.children.get(id);
    if (!child?.stdin?.writable) return false;

    child.stdin.write(input + "\n");
    return true;
  }

  /**
   * Kill a process.
   */
  kill(idOrName: string, signal: string = "SIGTERM"): boolean {
    const id = this.resolveId(idOrName);
    if (!id) return false;

    const proc = this.processes.get(id);
    const child = this.children.get(id);

    if (proc) {
      proc.autoRestart = false; // Prevent auto-restart on manual kill
      proc.status = "stopped";
    }

    if (child) {
      try {
        child.kill(signal as NodeJS.Signals);
        return true;
      } catch (err) {
        log.warn("Failed to kill process %s: %s", id, err);
        return false;
      }
    }

    return false;
  }

  /**
   * Kill all processes.
   */
  killAll(): number {
    let killed = 0;
    for (const [id] of this.children) {
      if (this.kill(id)) killed++;
    }
    return killed;
  }

  /**
   * Get a process by ID or name.
   */
  get(idOrName: string): ManagedProcess | undefined {
    const id = this.resolveId(idOrName);
    return id ? this.processes.get(id) : undefined;
  }

  private resolveId(idOrName: string): string | undefined {
    // Direct ID match
    if (this.processes.has(idOrName)) return idOrName;

    // Name match
    for (const [id, proc] of this.processes) {
      if (proc.name.toLowerCase() === idOrName.toLowerCase()) return id;
    }

    return undefined;
  }
}
