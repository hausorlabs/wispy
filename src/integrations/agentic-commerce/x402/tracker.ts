/**
 * Spend tracker for x402 payments.
 * Records every payment, computes aggregates, and generates audit reports.
 */

import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { COMMERCE_DEFAULTS, explorerTxLink } from "../config.js";

// ─── Types ──────────────────────────────────────────────────

export interface SpendRecord {
  id: string;
  timestamp: string;
  url: string;
  service: string;
  amount: number;
  recipient: string;
  txHash: string;
  /** CAIP-2 network identifier (e.g. "eip155:8453" for Base) */
  network?: string;
  blockNumber?: number;
  status: "settled" | "pending" | "failed";
  reason: string;
  ap2?: {
    intentId?: string;
    cartId?: string;
    paymentId?: string;
  };
}

export interface AuditReport {
  agentAddress: string;
  network: string;
  period: { from: string; to: string };
  totalSpent: number;
  totalTransactions: number;
  byRecipient: Array<{ address: string; total: number; count: number }>;
  byService: Array<{ name: string; total: number; count: number }>;
  records: SpendRecord[];
  budgetRemaining: number;
  dailyLimit: number;
}

// ─── Spend Tracker ──────────────────────────────────────────

export class SpendTracker {
  private records: SpendRecord[] = [];
  private readonly agentAddress: string;
  private readonly dailyLimit: number;

  constructor(agentAddress: string, dailyLimit?: number) {
    this.agentAddress = agentAddress;
    this.dailyLimit = dailyLimit ?? COMMERCE_DEFAULTS.dailyLimit;
  }

  /** Record a new payment event */
  record(event: Omit<SpendRecord, "id">): SpendRecord {
    const record: SpendRecord = { id: randomUUID(), ...event };
    this.records.push(record);
    console.log(
      `[x402] Recorded payment: ${record.amount} USDC to ${record.recipient} (${record.status})`,
    );
    return record;
  }

  /** Get total USDC spent today (settled only) */
  getTotalSpent(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.records
      .filter((r) => r.status === "settled" && r.timestamp.startsWith(today))
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /** Get spending by recipient address */
  getByRecipient(): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of this.records.filter((r) => r.status === "settled")) {
      map.set(r.recipient, (map.get(r.recipient) ?? 0) + r.amount);
    }
    return map;
  }

  /** Get spending by service name */
  getByService(): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of this.records.filter((r) => r.status === "settled")) {
      map.set(r.service, (map.get(r.service) ?? 0) + r.amount);
    }
    return map;
  }

  /** Generate a full audit report */
  getReport(): AuditReport {
    const settled = this.records.filter((r) => r.status === "settled");
    const timestamps = settled.map((r) => r.timestamp).sort();

    const byRecipient = Array.from(this.getByRecipient().entries()).map(
      ([address, total]) => ({
        address,
        total,
        count: settled.filter((r) => r.recipient === address).length,
      }),
    );

    const byService = Array.from(this.getByService().entries()).map(
      ([name, total]) => ({
        name,
        total,
        count: settled.filter((r) => r.service === name).length,
      }),
    );

    const networks = [...new Set(settled.map((r) => r.network).filter(Boolean))];
    const networkLabel = networks.length > 0
      ? networks.map((n) => n === "eip155:8453" ? "Base Mainnet" : `SKALE (${n})`).join(", ")
      : "SKALE BITE V2 Sandbox (eip155:103698795)";
    return {
      agentAddress: this.agentAddress,
      network: networkLabel,
      period: {
        from: timestamps[0] ?? new Date().toISOString(),
        to: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      },
      totalSpent: settled.reduce((sum, r) => sum + r.amount, 0),
      totalTransactions: settled.length,
      byRecipient,
      byService,
      records: this.records,
      budgetRemaining: this.dailyLimit - this.getTotalSpent(),
      dailyLimit: this.dailyLimit,
    };
  }

  /** Format audit report as chalk-colored CLI output */
  formatReport(): string {
    const report = this.getReport();
    const cyan = chalk.cyan;
    const green = chalk.green;
    const yellow = chalk.yellow;
    const dim = chalk.dim;
    const bold = chalk.bold;
    const white = chalk.white;

    const lines: string[] = [
      ``,
      cyan.bold(`  ━━━ x402 Spend Audit Report ━━━`),
      ``,
      `  ${dim("Agent:")}     ${cyan(report.agentAddress)}`,
      `  ${dim("Network:")}   ${white(report.network)}`,
      `  ${dim("Period:")}    ${white(report.period.from.slice(0, 19))} ${dim("to")} ${white(report.period.to.slice(0, 19))}`,
      ``,
      cyan(`  ┌─ Summary ──────────────────────────────────────────`),
      `  ${cyan("│")} Total Spent:      ${green.bold("$" + report.totalSpent.toFixed(6))} ${dim("USDC")}`,
      `  ${cyan("│")} Transactions:     ${bold.white(String(report.totalTransactions))}`,
      `  ${cyan("│")} Budget Remaining: ${yellow("$" + report.budgetRemaining.toFixed(6))} ${dim("USDC")}`,
      `  ${cyan("│")} Daily Limit:      ${white("$" + report.dailyLimit.toFixed(2))} ${dim("USDC")}`,
      cyan(`  └────────────────────────────────────────────────────`),
    ];

    if (report.byRecipient.length > 0) {
      lines.push(``, cyan(`  ┌─ By Recipient ────────────────────────────────────`));
      for (const r of report.byRecipient) {
        lines.push(
          `  ${cyan("│")} ${cyan(r.address)}  ${green("$" + r.total.toFixed(6))}  ${dim("(" + r.count + " tx)")}`,
        );
      }
      lines.push(cyan(`  └────────────────────────────────────────────────────`));
    }

    if (report.byService.length > 0) {
      lines.push(``, cyan(`  ┌─ By Service ──────────────────────────────────────`));
      for (const s of report.byService) {
        lines.push(
          `  ${cyan("│")} ${bold.white(s.name.padEnd(16))} ${green("$" + s.total.toFixed(6))}  ${dim("(" + s.count + " tx)")}`,
        );
      }
      lines.push(cyan(`  └────────────────────────────────────────────────────`));
    }

    lines.push(``, cyan(`  ┌─ Transaction Log ─────────────────────────────────`));
    if (report.records.length === 0) {
      lines.push(`  ${cyan("│")} ${dim("(no transactions recorded)")}`);
    }
    for (let i = 0; i < report.records.length; i++) {
      const r = report.records[i];
      const isLast = i === report.records.length - 1;
      const connector = isLast ? "╰" : "├";
      const hasRealTx = r.txHash && r.txHash.startsWith("0x") && r.txHash.length >= 66;
      const hash = hasRealTx ? cyan(r.txHash) : yellow("facilitator-settled");
      const explorerUrl = hasRealTx
        ? `\n  ${cyan("│")}   ${dim("Explorer:")} ${dim(explorerTxLink(r.txHash, r.network))}`
        : "";
      const statusColor = r.status === "settled" ? green : r.status === "failed" ? chalk.red : yellow;
      lines.push(
        `  ${cyan(connector)}─ ${bold.white("#" + (i + 1))} ${dim("[")}${white(r.timestamp.slice(11, 19))}${dim("]")} ${bold.white(r.service)}`,
        `  ${cyan("│")}   ${dim("Amount:")}    ${green("$" + r.amount.toFixed(6) + " USDC")}`,
        `  ${cyan("│")}   ${dim("Recipient:")} ${cyan(r.recipient)}`,
        `  ${cyan("│")}   ${dim("Tx:")}        ${hash}`,
        `  ${cyan("│")}   ${dim("Status:")}    ${statusColor(r.status)}${explorerUrl}`,
        `  ${cyan("│")}`,
      );
    }
    lines.push(cyan(`  └────────────────────────────────────────────────────`));

    return lines.join("\n");
  }

  /** Export full report as JSON string */
  toJSON(): string {
    return JSON.stringify(this.getReport(), null, 2);
  }

  /** Get all records (for external consumers) */
  getRecords(): SpendRecord[] {
    return [...this.records];
  }
}
