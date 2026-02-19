/**
 * Schema Extractor tests.
 */

import { describe, it, expect, vi } from "vitest";
import { extractWithSchema, formatExtractedData } from "../extraction/schema-extractor.js";

describe("extractWithSchema", () => {
  it("should extract data using schema", async () => {
    const mockPage = {
      evaluate: vi.fn(() => [
        { title: "Product A", price: "$29.99", url: "https://example.com/a" },
        { title: "Product B", price: "$49.99", url: "https://example.com/b" },
      ]),
    };

    const data = await extractWithSchema(mockPage as never, {
      selector: ".product",
      fields: {
        title: { selector: "h2", transform: "text" },
        price: { selector: ".price", transform: "text" },
        url: { selector: "a", attribute: "href" },
      },
      multiple: true,
      limit: 10,
    });

    expect(data).toHaveLength(2);
    expect(data[0].title).toBe("Product A");
    expect(data[1].price).toBe("$49.99");
  });
});

describe("formatExtractedData", () => {
  it("should format data as readable text", () => {
    const data = [
      { title: "Item 1", price: "$10" },
      { title: "Item 2", price: "$20" },
    ];

    const output = formatExtractedData(data);
    expect(output).toContain("2 item(s)");
    expect(output).toContain("Item 1");
    expect(output).toContain("$20");
  });

  it("should handle empty data", () => {
    const output = formatExtractedData([]);
    expect(output).toBe("No data extracted.");
  });
});
