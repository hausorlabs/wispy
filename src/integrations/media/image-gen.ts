/**
 * Image Generation Integration
 *
 * Generates and edits images using DALL-E, Stability AI, or Replicate as the
 * backend provider. The provider is selected via the IMAGE_GEN_PROVIDER env var.
 *
 * @requires IMAGE_GEN_API_KEY  - API key for the chosen provider
 * @requires IMAGE_GEN_PROVIDER - One of "dalle", "stability", "replicate"
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

type Provider = "dalle" | "stability" | "replicate";

const ENDPOINTS: Record<Provider, { generate: string; edit: string }> = {
  dalle: {
    generate: "https://api.openai.com/v1/images/generations",
    edit: "https://api.openai.com/v1/images/edits",
  },
  stability: {
    generate: "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
    edit: "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
  },
  replicate: {
    generate: "https://api.replicate.com/v1/predictions",
    edit: "https://api.replicate.com/v1/predictions",
  },
};

export default class ImageGenIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "image-gen",
    name: "Image Generation",
    category: "media",
    version: "1.0.0",
    description: "Generate and edit images using DALL-E, Stability AI, or Replicate.",
    auth: {
      type: "api-key",
      envVars: ["IMAGE_GEN_API_KEY", "IMAGE_GEN_PROVIDER"],
    },
    requires: { env: ["IMAGE_GEN_API_KEY", "IMAGE_GEN_PROVIDER"] },
    tools: [
      {
        name: "image_generate",
        description: "Generate an image from a text prompt.",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Text description of the image to generate." },
            size: { type: "string", description: "Image size (e.g. 1024x1024).", default: "1024x1024" },
            n: { type: "number", description: "Number of images to generate (1-4).", default: 1 },
          },
          required: ["prompt"],
        },
      },
      {
        name: "image_edit",
        description: "Edit or inpaint an existing image using a text prompt.",
        parameters: {
          type: "object",
          properties: {
            image_url: { type: "string", description: "URL of the source image to edit." },
            prompt: { type: "string", description: "Description of the desired edit." },
            mask_url: { type: "string", description: "URL of the mask image for inpainting (optional)." },
          },
          required: ["image_url", "prompt"],
        },
      },
    ],
  };

  private get provider(): Provider {
    return (process.env.IMAGE_GEN_PROVIDER as Provider) || "dalle";
  }

  private get apiKey(): string {
    const key = process.env.IMAGE_GEN_API_KEY;
    if (!key) throw new Error("Missing IMAGE_GEN_API_KEY");
    return key;
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "image_generate":
          return await this.generate(args.prompt as string, args.size as string, args.n as number);
        case "image_edit":
          return await this.edit(args.image_url as string, args.prompt as string, args.mask_url as string | undefined);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Image gen error: ${(err as Error).message}`);
    }
  }

  private async generate(prompt: string, size = "1024x1024", n = 1): Promise<ToolResult> {
    const p = this.provider;
    const url = ENDPOINTS[p].generate;
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (p === "dalle") {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "dall-e-3", prompt, size, n: Math.min(n, 4) }),
      });
      if (!res.ok) return this.error(`DALL-E API ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { data: { url: string; revised_prompt?: string }[] };
      const urls = data.data.map((d) => d.url);
      return this.ok(`Generated ${urls.length} image(s):\n${urls.join("\n")}`, { urls, provider: "dalle" });
    }

    if (p === "stability") {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      headers["Accept"] = "application/json";
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text_prompts: [{ text: prompt, weight: 1 }],
          cfg_scale: 7,
          width: parseInt(size.split("x")[0]) || 1024,
          height: parseInt(size.split("x")[1]) || 1024,
          samples: Math.min(n, 4),
          steps: 30,
        }),
      });
      if (!res.ok) return this.error(`Stability API ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { artifacts: { base64: string }[] };
      const images = data.artifacts.map((a, i) => `[image_${i + 1}: base64, ${a.base64.length} chars]`);
      return this.ok(`Generated ${images.length} image(s) (base64):\n${images.join("\n")}`, {
        count: images.length, provider: "stability", format: "base64",
      });
    }

    // Replicate
    headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        version: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        input: { prompt, width: parseInt(size.split("x")[0]) || 1024, height: parseInt(size.split("x")[1]) || 1024 },
      }),
    });
    if (!res.ok) return this.error(`Replicate API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id: string; urls: { get: string } };
    return this.ok(`Prediction started: ${data.id}\nPoll status at: ${data.urls.get}`, {
      predictionId: data.id, provider: "replicate",
    });
  }

  private async edit(imageUrl: string, prompt: string, maskUrl?: string): Promise<ToolResult> {
    const p = this.provider;

    if (p === "dalle") {
      // DALL-E edits require multipart form data with image files.
      // Download the image first, then send as form data.
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return this.error(`Failed to fetch source image: ${imgRes.status}`);
      const imgBlob = await imgRes.blob();

      const form = new FormData();
      form.append("image", imgBlob, "image.png");
      form.append("prompt", prompt);
      form.append("model", "dall-e-2");
      form.append("size", "1024x1024");
      if (maskUrl) {
        const maskRes = await fetch(maskUrl);
        if (maskRes.ok) form.append("mask", await maskRes.blob(), "mask.png");
      }

      const res = await fetch(ENDPOINTS.dalle.edit, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) return this.error(`DALL-E edit ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { data: { url: string }[] };
      return this.ok(`Edited image: ${data.data[0]?.url}`, { url: data.data[0]?.url, provider: "dalle" });
    }

    if (p === "stability") {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return this.error(`Failed to fetch source image: ${imgRes.status}`);
      const imgBlob = await imgRes.blob();

      const form = new FormData();
      form.append("init_image", imgBlob, "image.png");
      form.append("text_prompts[0][text]", prompt);
      form.append("text_prompts[0][weight]", "1");
      form.append("image_strength", "0.35");

      const res = await fetch(ENDPOINTS.stability.edit, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        body: form,
      });
      if (!res.ok) return this.error(`Stability edit ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { artifacts: { base64: string }[] };
      return this.ok(`Edited image (base64, ${data.artifacts[0]?.base64.length} chars)`, {
        provider: "stability", format: "base64",
      });
    }

    // Replicate image-to-image
    const res = await fetch(ENDPOINTS.replicate.edit, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        input: { prompt, image: imageUrl, ...(maskUrl ? { mask: maskUrl } : {}) },
      }),
    });
    if (!res.ok) return this.error(`Replicate edit ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id: string; urls: { get: string } };
    return this.ok(`Edit prediction started: ${data.id}\nPoll: ${data.urls.get}`, {
      predictionId: data.id, provider: "replicate",
    });
  }
}
