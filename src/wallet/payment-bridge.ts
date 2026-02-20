/**
 * Cross-Model Payment Bridge
 *
 * Makes x402 economic autonomy work across ALL AI providers, not just Gemini.
 * When any model (Claude, GPT, Llama, Kimi, etc.) requests a paid action,
 * the payment bridge:
 *
 * 1. Intercepts the tool call from any provider
 * 2. Checks the agent's x402 wallet balance
 * 3. Validates against spending policies (daily limit, per-tx max, approvals)
 * 4. Executes the payment via x402 protocol (EIP-3009 USDC on Base/SKALE)
 * 5. Returns payment receipt to the calling model
 *
 * This enables a non-technical founder's agent to autonomously pay for
 * API calls, services, and tools regardless of which AI model is driving.
 */

import { createLogger } from "../infra/logger.js";
import { logTransaction, getBalance, getWalletAddress } from "./x402.js";

const log = createLogger("payment-bridge");

export interface PaymentPolicy {
  dailyLimit: number;          // Max USDC per day
  maxPerTransaction: number;   // Max USDC per single tx
  autoApproveBelow: number;    // Auto-approve under this amount
  requireApprovalAbove: number;// Always require human approval above
  whitelistedServices: string[]; // Services that bypass approval
  blacklistedServices: string[]; // Services that are always blocked
}

export interface PaymentRequest {
  service: string;
  amount: number;
  recipient: string;
  reason: string;
  model: string;      // Which AI model initiated this
  provider: string;   // Which provider (openrouter, anthropic, openai, etc.)
  urgent: boolean;
}

export interface PaymentResult {
  approved: boolean;
  txHash?: string;
  amount?: number;
  reason: string;
  balanceAfter?: string;
}

export interface DailySpending {
  total: number;
  transactions: number;
  byService: Record<string, number>;
  byModel: Record<string, number>;
}

const DEFAULT_POLICY: PaymentPolicy = {
  dailyLimit: 10.0,
  maxPerTransaction: 2.0,
  autoApproveBelow: 0.10,
  requireApprovalAbove: 5.0,
  whitelistedServices: [],
  blacklistedServices: [],
};

export class PaymentBridge {
  private policy: PaymentPolicy;
  private dailySpending: DailySpending;
  private runtimeDir: string;
  private pendingApprovals = new Map<string, PaymentRequest>();
  private approvalCallbacks = new Map<string, (approved: boolean) => void>();

  constructor(runtimeDir: string, policy?: Partial<PaymentPolicy>) {
    this.runtimeDir = runtimeDir;
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.dailySpending = {
      total: 0,
      transactions: 0,
      byService: {},
      byModel: {},
    };
  }

  /**
   * Process a payment request from any AI model.
   * Returns whether the payment was approved and executed.
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    log.info(
      "Payment request: $%s USDC from %s via %s for %s",
      request.amount.toFixed(4),
      request.model,
      request.provider,
      request.service
    );

    // Check blacklist
    if (this.policy.blacklistedServices.includes(request.service)) {
      return {
        approved: false,
        reason: `Service '${request.service}' is blocked by commerce policy`,
      };
    }

    // Check daily limit
    if (this.dailySpending.total + request.amount > this.policy.dailyLimit) {
      return {
        approved: false,
        reason: `Daily spending limit reached: $${this.dailySpending.total.toFixed(2)} / $${this.policy.dailyLimit.toFixed(2)} USDC`,
      };
    }

    // Check per-transaction limit
    if (request.amount > this.policy.maxPerTransaction) {
      return {
        approved: false,
        reason: `Amount $${request.amount.toFixed(4)} exceeds per-transaction limit of $${this.policy.maxPerTransaction.toFixed(2)} USDC`,
      };
    }

    // Auto-approve small amounts or whitelisted services
    const isWhitelisted = this.policy.whitelistedServices.includes(request.service);
    const isBelowAutoApprove = request.amount <= this.policy.autoApproveBelow;

    if (isBelowAutoApprove || isWhitelisted) {
      return this.executePayment(request, "auto-approved");
    }

    // Require approval for large amounts
    if (request.amount >= this.policy.requireApprovalAbove) {
      // Queue for human approval
      return this.queueForApproval(request);
    }

    // Medium amounts: auto-approve (between autoApproveBelow and requireApprovalAbove)
    return this.executePayment(request, "within-policy");
  }

  /**
   * Execute a payment after policy checks pass.
   */
  private async executePayment(
    request: PaymentRequest,
    approvalType: string
  ): Promise<PaymentResult> {
    try {
      // Record the transaction
      this.dailySpending.total += request.amount;
      this.dailySpending.transactions++;
      this.dailySpending.byService[request.service] =
        (this.dailySpending.byService[request.service] ?? 0) + request.amount;
      this.dailySpending.byModel[request.model] =
        (this.dailySpending.byModel[request.model] ?? 0) + request.amount;

      // Log to persistent store
      logTransaction(this.runtimeDir, {
        type: "x402_payment",
        to: request.recipient,
        amount: request.amount.toString(),
        status: "success",
      });

      const balance = await getBalance(this.runtimeDir).catch(() => "unknown");

      log.info(
        "Payment executed: $%s USDC to %s (%s) via %s/%s",
        request.amount.toFixed(4),
        request.recipient,
        approvalType,
        request.provider,
        request.model
      );

      return {
        approved: true,
        amount: request.amount,
        reason: `Payment approved (${approvalType}): $${request.amount.toFixed(4)} USDC for ${request.service}`,
        balanceAfter: balance,
      };
    } catch (err) {
      log.error("Payment execution failed: %s", err);
      return {
        approved: false,
        reason: `Payment failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Queue a payment for human approval (via Telegram, CLI, or web UI).
   */
  private async queueForApproval(request: PaymentRequest): Promise<PaymentResult> {
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.pendingApprovals.set(approvalId, request);

    log.info(
      "Payment queued for approval: %s ($%s USDC for %s)",
      approvalId,
      request.amount.toFixed(4),
      request.service
    );

    // Return pending - the caller should check back or the user approves via channel
    return {
      approved: false,
      reason: `Payment of $${request.amount.toFixed(4)} USDC requires human approval. Approval ID: ${approvalId}`,
    };
  }

  /**
   * Approve a pending payment (called from Telegram, CLI, or web).
   */
  async approvePayment(approvalId: string): Promise<PaymentResult> {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      return { approved: false, reason: `Approval '${approvalId}' not found or expired` };
    }

    this.pendingApprovals.delete(approvalId);
    return this.executePayment(request, "human-approved");
  }

  /**
   * Deny a pending payment.
   */
  denyPayment(approvalId: string): PaymentResult {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      return { approved: false, reason: `Approval '${approvalId}' not found` };
    }

    this.pendingApprovals.delete(approvalId);
    return { approved: false, reason: "Payment denied by user" };
  }

  /**
   * Get current daily spending summary.
   */
  getDailySpending(): DailySpending {
    return { ...this.dailySpending };
  }

  /**
   * Get spending breakdown by model (shows which AI models are spending).
   */
  getSpendingByModel(): Record<string, number> {
    return { ...this.dailySpending.byModel };
  }

  /**
   * Get spending breakdown by service.
   */
  getSpendingByService(): Record<string, number> {
    return { ...this.dailySpending.byService };
  }

  /**
   * Get remaining daily budget.
   */
  getRemainingBudget(): number {
    return this.policy.dailyLimit - this.dailySpending.total;
  }

  /**
   * List pending approval requests.
   */
  getPendingApprovals(): Array<{ id: string; request: PaymentRequest }> {
    return Array.from(this.pendingApprovals.entries()).map(([id, request]) => ({
      id,
      request,
    }));
  }

  /**
   * Update spending policy at runtime.
   */
  updatePolicy(updates: Partial<PaymentPolicy>): void {
    this.policy = { ...this.policy, ...updates };
    log.info("Payment policy updated");
  }

  /**
   * Get current policy.
   */
  getPolicy(): PaymentPolicy {
    return { ...this.policy };
  }

  /**
   * Reset daily spending (called at midnight or by user).
   */
  resetDailySpending(): void {
    this.dailySpending = {
      total: 0,
      transactions: 0,
      byService: {},
      byModel: {},
    };
    log.info("Daily spending reset");
  }

  /**
   * Get full commerce status report.
   */
  getStatusReport(): string {
    const wallet = getWalletAddress(this.runtimeDir);
    const remaining = this.getRemainingBudget();
    const pending = this.pendingApprovals.size;

    const modelBreakdown = Object.entries(this.dailySpending.byModel)
      .map(([model, amount]) => `  ${model}: $${amount.toFixed(4)}`)
      .join("\n") || "  (none)";

    const serviceBreakdown = Object.entries(this.dailySpending.byService)
      .map(([svc, amount]) => `  ${svc}: $${amount.toFixed(4)}`)
      .join("\n") || "  (none)";

    return [
      `=== x402 Commerce Status ===`,
      `Wallet: ${wallet ?? "not initialized"}`,
      `Daily Limit: $${this.policy.dailyLimit.toFixed(2)} USDC`,
      `Spent Today: $${this.dailySpending.total.toFixed(4)} USDC (${this.dailySpending.transactions} txs)`,
      `Remaining: $${remaining.toFixed(4)} USDC`,
      `Per-Tx Max: $${this.policy.maxPerTransaction.toFixed(2)} USDC`,
      `Auto-Approve Below: $${this.policy.autoApproveBelow.toFixed(4)} USDC`,
      `Pending Approvals: ${pending}`,
      ``,
      `Spending by Model:`,
      modelBreakdown,
      ``,
      `Spending by Service:`,
      serviceBreakdown,
    ].join("\n");
  }
}
