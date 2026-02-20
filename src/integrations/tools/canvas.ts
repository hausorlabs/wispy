/**
 * Canvas Integration
 *
 * Generates SVG graphics from text descriptions, creates Mermaid diagrams,
 * and exports canvases to PNG. No API keys required -- all generation is local.
 *
 * Uses built-in SVG primitives and Mermaid text syntax. PNG export relies on
 * an optional sharp or svg2img dependency, falling back to raw SVG output.
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";
import { writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export default class CanvasIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "canvas",
    name: "Canvas",
    category: "tools",
    version: "1.0.0",
    description: "Generate SVG graphics, create Mermaid diagrams, and export to PNG.",
    auth: { type: "none" },
    capabilities: { offline: true },
    tools: [
      {
        name: "canvas_draw",
        description: "Generate an SVG image from a description. Supports shapes, text, colors, and layouts.",
        parameters: {
          type: "object",
          properties: {
            description: { type: "string", description: "Natural language description of the graphic to draw." },
            width: { type: "number", description: "Canvas width in pixels.", default: 800 },
            height: { type: "number", description: "Canvas height in pixels.", default: 600 },
            background: { type: "string", description: "Background color (hex or named).", default: "#ffffff" },
            output: { type: "string", description: "Output file path. Defaults to a temp file." },
          },
          required: ["description"],
        },
      },
      {
        name: "canvas_diagram",
        description: "Create a Mermaid diagram from a text description. Returns the Mermaid syntax and an SVG rendering hint.",
        parameters: {
          type: "object",
          properties: {
            description: { type: "string", description: "What the diagram should show (e.g. 'user login flow with auth and database')." },
            type: { type: "string", description: "Diagram type.", enum: ["flowchart", "sequence", "class", "state", "er", "gantt", "pie", "mindmap"], default: "flowchart" },
            direction: { type: "string", description: "Flow direction for flowcharts.", enum: ["TB", "BT", "LR", "RL"], default: "TB" },
            output: { type: "string", description: "Output file path for the .mmd file." },
          },
          required: ["description"],
        },
      },
      {
        name: "canvas_export",
        description: "Export an SVG file to PNG. Requires sharp to be installed, otherwise returns the SVG path.",
        parameters: {
          type: "object",
          properties: {
            svg_path: { type: "string", description: "Path to the SVG file to convert." },
            svg_content: { type: "string", description: "Raw SVG content to convert (used if svg_path is not provided)." },
            width: { type: "number", description: "Output PNG width.", default: 1024 },
            output: { type: "string", description: "Output PNG file path." },
          },
        },
      },
    ],
  };

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "canvas_draw":
          return await this.draw(args);
        case "canvas_diagram":
          return await this.diagram(args);
        case "canvas_export":
          return await this.exportPng(args);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Canvas error: ${(err as Error).message}`);
    }
  }

  private async draw(args: Record<string, unknown>): Promise<ToolResult> {
    const desc = args.description as string;
    const width = (args.width as number) || 800;
    const height = (args.height as number) || 600;
    const bg = (args.background as string) || "#ffffff";
    const outPath = (args.output as string) || join(tmpdir(), `wispy-canvas-${randomUUID()}.svg`);

    // Parse description keywords to build SVG elements
    const elements: string[] = [];
    const lower = desc.toLowerCase();

    // Title text
    const titleMatch = desc.match(/(?:title|heading|text)[:\s]+"?([^"]+)"?/i);
    if (titleMatch) {
      elements.push(
        `  <text x="${width / 2}" y="50" text-anchor="middle" font-family="Inter, sans-serif" font-size="28" font-weight="bold" fill="#111">${this.escapeXml(titleMatch[1])}</text>`
      );
    }

    // Circles
    if (lower.includes("circle")) {
      const colors = this.extractColors(desc);
      elements.push(
        `  <circle cx="${width / 3}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="${colors[0] || "#4A90D9"}" opacity="0.85"/>`
      );
    }

    // Rectangles / boxes
    if (lower.includes("rect") || lower.includes("box") || lower.includes("square")) {
      const colors = this.extractColors(desc);
      const rw = width * 0.4;
      const rh = height * 0.3;
      elements.push(
        `  <rect x="${(width - rw) / 2}" y="${(height - rh) / 2}" width="${rw}" height="${rh}" rx="8" fill="${colors[0] || "#34C759"}" opacity="0.85"/>`
      );
    }

    // Lines / grid
    if (lower.includes("line") || lower.includes("grid")) {
      for (let i = 1; i < 5; i++) {
        const y = (height / 5) * i;
        elements.push(`  <line x1="40" y1="${y}" x2="${width - 40}" y2="${y}" stroke="#ddd" stroke-width="1"/>`);
      }
    }

    // Star / polygon
    if (lower.includes("star")) {
      const cx = width / 2;
      const cy = height / 2;
      const points = this.starPoints(cx, cy, 5, Math.min(width, height) / 4, Math.min(width, height) / 8);
      elements.push(`  <polygon points="${points}" fill="#FFB800" stroke="#FF7000" stroke-width="2"/>`);
    }

    // Fallback: render the description as centered text if no shapes were detected
    if (elements.length === 0) {
      const lines = desc.match(/.{1,50}/g) || [desc];
      lines.forEach((line, i) => {
        elements.push(
          `  <text x="${width / 2}" y="${height / 2 - (lines.length * 12) + i * 28}" text-anchor="middle" font-family="Inter, sans-serif" font-size="18" fill="#333">${this.escapeXml(line.trim())}</text>`
        );
      });
    }

    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
      `  <rect width="100%" height="100%" fill="${bg}"/>`,
      ...elements,
      `</svg>`,
    ].join("\n");

    await writeFile(outPath, svg, "utf-8");
    return this.ok(`SVG created: ${outPath} (${svg.length} bytes)`, { path: outPath, width, height });
  }

  private async diagram(args: Record<string, unknown>): Promise<ToolResult> {
    const desc = args.description as string;
    const type = (args.type as string) || "flowchart";
    const direction = (args.direction as string) || "TB";
    const outPath = (args.output as string) || join(tmpdir(), `wispy-diagram-${randomUUID()}.mmd`);

    // Build Mermaid syntax from description
    const words = desc.split(/[\s,;.]+/).filter(Boolean);
    let mermaid: string;

    if (type === "pie") {
      const sections = words.slice(0, 6).map((w, i) => `  "${w}" : ${Math.floor(Math.random() * 40) + 10}`);
      mermaid = `pie title ${desc.slice(0, 60)}\n${sections.join("\n")}`;
    } else if (type === "mindmap") {
      const root = words[0] || "Root";
      const children = words.slice(1, 8).map((w) => `    ${w}`);
      mermaid = `mindmap\n  root(${root})\n${children.join("\n")}`;
    } else if (type === "sequence") {
      const actors = words.slice(0, 4);
      const lines = [];
      for (let i = 0; i < actors.length - 1; i++) {
        lines.push(`  ${actors[i]}->>+${actors[i + 1]}: ${desc.slice(0, 30)}`);
        lines.push(`  ${actors[i + 1]}-->>-${actors[i]}: Response`);
      }
      mermaid = `sequenceDiagram\n${lines.join("\n")}`;
    } else {
      // Default: flowchart
      const nodes = words.slice(0, 8).map((w, i) => ({ id: String.fromCharCode(65 + i), label: w }));
      const defs = nodes.map((n) => `  ${n.id}[${n.label}]`).join("\n");
      const edges = nodes.slice(1).map((n, i) => `  ${nodes[i].id} --> ${n.id}`).join("\n");
      mermaid = `flowchart ${direction}\n${defs}\n${edges}`;
    }

    await writeFile(outPath, mermaid, "utf-8");
    return this.ok(`Mermaid diagram saved: ${outPath}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``, {
      path: outPath, type, syntax: mermaid,
    });
  }

  private async exportPng(args: Record<string, unknown>): Promise<ToolResult> {
    const svgPath = args.svg_path as string | undefined;
    const svgContent = args.svg_content as string | undefined;
    const width = (args.width as number) || 1024;
    const outPath = (args.output as string) || join(tmpdir(), `wispy-export-${randomUUID()}.png`);

    let svg: string;
    if (svgPath) {
      svg = await readFile(svgPath, "utf-8");
    } else if (svgContent) {
      svg = svgContent;
    } else {
      return this.error("Provide either svg_path or svg_content.");
    }

    // Try sharp for high-quality conversion
    try {
      const sharpMod = await import("sharp") as any;
      const sharpFn = sharpMod.default ?? sharpMod;
      await sharpFn(Buffer.from(svg)).resize(width).png().toFile(outPath);
      return this.ok(`PNG exported: ${outPath}`, { path: outPath, width });
    } catch {
      // sharp not available -- save SVG as fallback
      const fallbackPath = outPath.replace(/\.png$/, ".svg");
      await writeFile(fallbackPath, svg, "utf-8");
      return this.ok(
        `sharp not installed -- saved SVG instead: ${fallbackPath}\nInstall sharp for PNG export: npm i sharp`,
        { path: fallbackPath, fallback: true },
      );
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private extractColors(text: string): string[] {
    const hexMatches = text.match(/#[0-9a-fA-F]{3,8}/g) || [];
    const namedColors = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
    const found = namedColors.filter((c) => text.toLowerCase().includes(c));
    return [...hexMatches, ...found];
  }

  private starPoints(cx: number, cy: number, n: number, outerR: number, innerR: number): string {
    const points: string[] = [];
    for (let i = 0; i < n * 2; i++) {
      const angle = (Math.PI / n) * i - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
    }
    return points.join(" ");
  }
}
