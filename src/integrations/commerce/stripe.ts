/**
 * Stripe Integration
 *
 * Creates payment links, checks payment status, and lists customers via the
 * Stripe REST API. Uses native fetch -- no stripe SDK dependency required.
 *
 * @requires STRIPE_SECRET_KEY - Stripe secret key (sk_live_... or sk_test_...)
 * @see https://docs.stripe.com/api
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.stripe.com/v1";

export default class StripeIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "stripe",
    name: "Stripe",
    category: "commerce",
    version: "1.0.0",
    description: "Create payment links, check payments, and manage customers with Stripe.",
    website: "https://stripe.com",
    auth: {
      type: "api-key",
      envVars: ["STRIPE_SECRET_KEY"],
    },
    requires: { env: ["STRIPE_SECRET_KEY"] },
    tools: [
      {
        name: "stripe_create_payment",
        description: "Create a Stripe Payment Link for a given amount and description.",
        parameters: {
          type: "object",
          properties: {
            amount: { type: "number", description: "Amount in the smallest currency unit (e.g. cents for USD)." },
            currency: { type: "string", description: "Three-letter ISO currency code (e.g. usd, eur, kes).", default: "usd" },
            description: { type: "string", description: "Description shown on the payment page." },
            customer_email: { type: "string", description: "Pre-fill the customer email on checkout (optional)." },
          },
          required: ["amount", "description"],
        },
      },
      {
        name: "stripe_check_payment",
        description: "Check the status of a Stripe Payment Intent or Checkout Session.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Payment Intent ID (pi_...) or Checkout Session ID (cs_...)." },
          },
          required: ["id"],
        },
      },
      {
        name: "stripe_list_customers",
        description: "List Stripe customers, optionally filtered by email.",
        parameters: {
          type: "object",
          properties: {
            email: { type: "string", description: "Filter customers by email address (optional)." },
            limit: { type: "number", description: "Max number of customers to return (1-100).", default: 10 },
          },
        },
      },
    ],
  };

  private get apiKey(): string {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
    return key;
  }

  private async stripeRequest(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, string>
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    const opts: RequestInit = { method, headers };

    if (body && method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      opts.body = new URLSearchParams(body).toString();
    }

    return fetch(`${API_BASE}${path}`, opts);
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "stripe_create_payment":
          return await this.createPayment(args);
        case "stripe_check_payment":
          return await this.checkPayment(args.id as string);
        case "stripe_list_customers":
          return await this.listCustomers(args.email as string | undefined, args.limit as number | undefined);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Stripe error: ${(err as Error).message}`);
    }
  }

  private async createPayment(args: Record<string, unknown>): Promise<ToolResult> {
    const amount = args.amount as number;
    const currency = (args.currency as string) || "usd";
    const description = args.description as string;
    const email = args.customer_email as string | undefined;

    // Step 1: Create a product
    const prodRes = await this.stripeRequest("/products", "POST", {
      name: description,
    });
    if (!prodRes.ok) return this.error(`Create product failed: ${await prodRes.text()}`);
    const product = (await prodRes.json()) as { id: string };

    // Step 2: Create a price for the product
    const priceRes = await this.stripeRequest("/prices", "POST", {
      unit_amount: String(amount),
      currency,
      product: product.id,
    });
    if (!priceRes.ok) return this.error(`Create price failed: ${await priceRes.text()}`);
    const price = (await priceRes.json()) as { id: string };

    // Step 3: Create a payment link
    const linkBody: Record<string, string> = {
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": "1",
    };
    if (email) {
      linkBody["after_completion[type]"] = "redirect";
      linkBody["after_completion[redirect][url]"] = "https://example.com/thanks";
    }

    const linkRes = await this.stripeRequest("/payment_links", "POST", linkBody);
    if (!linkRes.ok) return this.error(`Create payment link failed: ${await linkRes.text()}`);
    const link = (await linkRes.json()) as { id: string; url: string; active: boolean };

    const formatted = (amount / 100).toFixed(2);
    return this.ok(
      `Payment link created:\n  URL: ${link.url}\n  Amount: ${formatted} ${currency.toUpperCase()}\n  Description: ${description}`,
      { paymentLinkId: link.id, url: link.url, amount, currency },
    );
  }

  private async checkPayment(id: string): Promise<ToolResult> {
    // Detect ID type and route to the correct endpoint
    let path: string;
    if (id.startsWith("cs_")) {
      path = `/checkout/sessions/${id}`;
    } else if (id.startsWith("pi_")) {
      path = `/payment_intents/${id}`;
    } else {
      path = `/payment_intents/${id}`;
    }

    const res = await this.stripeRequest(path);
    if (!res.ok) return this.error(`Stripe lookup ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as Record<string, unknown>;

    const status = data.status as string;
    const amount = data.amount as number | undefined;
    const currency = data.currency as string | undefined;
    const formatted = amount ? `${(amount / 100).toFixed(2)} ${(currency || "").toUpperCase()}` : "N/A";

    return this.ok(
      `Payment ${id}:\n  Status: ${status}\n  Amount: ${formatted}`,
      { id, status, amount, currency },
    );
  }

  private async listCustomers(email?: string, limit = 10): Promise<ToolResult> {
    const params = new URLSearchParams();
    params.set("limit", String(Math.min(Math.max(limit, 1), 100)));
    if (email) params.set("email", email);

    const res = await this.stripeRequest(`/customers?${params.toString()}`);
    if (!res.ok) return this.error(`List customers failed: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ id: string; email: string | null; name: string | null; created: number }> };

    if (data.data.length === 0) return this.ok("No customers found.", { count: 0 });

    const lines = data.data.map((c) => {
      const created = new Date(c.created * 1000).toISOString().split("T")[0];
      return `  ${c.id} | ${c.email || "(no email)"} | ${c.name || "(no name)"} | created ${created}`;
    });

    return this.ok(`Customers (${data.data.length}):\n${lines.join("\n")}`, { count: data.data.length });
  }
}
