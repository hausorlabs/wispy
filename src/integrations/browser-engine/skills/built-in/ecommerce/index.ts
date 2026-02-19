/**
 * E-commerce skills -- Amazon, eBay, Shopify, AliExpress, Etsy, price comparison.
 */

import type { SkillDefinition } from "../../types.js";

export const ecommerceSkills: SkillDefinition[] = [
  {
    id: "amazon-search",
    name: "Amazon Product Search",
    description: "Search Amazon for products and extract titles, prices, ratings, and URLs",
    category: "ecommerce",
    tags: ["amazon", "shopping", "products"],
    parameters: [
      { name: "query", description: "Product search query", required: true },
      { name: "num_results", description: "Number of results", required: false, default: "10" },
    ],
    steps: [
      { action: "navigate", value: "https://www.amazon.com/s?k={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-component-type='s-search-result']", timeout: 15000 },
        extract: {
          name: "products",
          selector: "[data-component-type='s-search-result']",
          fields: {
            title: { selector: "h2 a span", transform: "text" },
            url: { selector: "h2 a", attribute: "href", transform: "url" },
            price: { selector: ".a-price .a-offscreen", transform: "text" },
            rating: { selector: ".a-icon-alt", transform: "text" },
            reviews: { selector: ".a-size-base.s-underline-text", transform: "text" },
            image: { selector: ".s-image", attribute: "src" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, url, price, rating, reviews, image}",
  },
  {
    id: "amazon-product",
    name: "Amazon Product Details",
    description: "Extract detailed information from a specific Amazon product page",
    category: "ecommerce",
    tags: ["amazon", "product", "details"],
    parameters: [
      { name: "url", description: "Amazon product URL", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "#productTitle" },
        extract: {
          name: "product",
          selector: "#dp-container, #ppd",
          fields: {
            title: { selector: "#productTitle", transform: "text" },
            price: { selector: ".a-price .a-offscreen, #priceblock_ourprice", transform: "text" },
            rating: { selector: "#acrPopover .a-icon-alt", transform: "text" },
            reviews_count: { selector: "#acrCustomerReviewText", transform: "text" },
            availability: { selector: "#availability span", transform: "text" },
            description: { selector: "#feature-bullets", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{title, price, rating, reviews_count, availability, description}",
  },
  {
    id: "ebay-search",
    name: "eBay Search",
    description: "Search eBay for listings",
    category: "ecommerce",
    tags: ["ebay", "auction", "shopping"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.ebay.com/sch/i.html?_nkw={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".s-item" },
        extract: {
          name: "listings",
          selector: ".s-item",
          fields: {
            title: { selector: ".s-item__title", transform: "text" },
            price: { selector: ".s-item__price", transform: "text" },
            url: { selector: ".s-item__link", attribute: "href" },
            shipping: { selector: ".s-item__shipping", transform: "text" },
            condition: { selector: ".SECONDARY_INFO", transform: "text" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, price, url, shipping, condition}",
  },
  {
    id: "etsy-search",
    name: "Etsy Search",
    description: "Search Etsy for handmade and vintage items",
    category: "ecommerce",
    tags: ["etsy", "handmade", "vintage", "crafts"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.etsy.com/search?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-search-results]", timeout: 15000 },
        extract: {
          name: "items",
          selector: "[data-search-results] .v2-listing-card",
          fields: {
            title: { selector: ".v2-listing-card__info h3, .v2-listing-card__title", transform: "text" },
            price: { selector: ".currency-value", transform: "text" },
            url: { selector: "a.listing-link", attribute: "href" },
            shop: { selector: ".v2-listing-card__shop", transform: "text" },
            rating: { selector: ".v2-listing-card__rating .screen-reader-only", transform: "text" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, price, url, shop, rating}",
  },
  {
    id: "aliexpress-search",
    name: "AliExpress Search",
    description: "Search AliExpress for products",
    category: "ecommerce",
    tags: ["aliexpress", "china", "wholesale"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.aliexpress.com/w/wholesale-{{query}}.html" },
      {
        action: "extract",
        waitFor: { type: "delay", timeout: 3000 },
        extract: {
          name: "products",
          selector: "[class*='SearchResult'] [class*='Card']",
          fields: {
            title: { selector: "h3, [class*='title']", transform: "text" },
            price: { selector: "[class*='price']", transform: "text" },
            url: { selector: "a", attribute: "href", transform: "url" },
            orders: { selector: "[class*='trade'], [class*='sold']", transform: "text" },
            rating: { selector: "[class*='evaluation']", transform: "text" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, price, url, orders, rating}",
  },
  {
    id: "price-compare",
    name: "Price Comparison",
    description: "Search Google Shopping for price comparisons",
    category: "ecommerce",
    tags: ["price", "compare", "shopping"],
    parameters: [
      { name: "product", description: "Product name to compare prices", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.google.com/search?q={{product}}&tbm=shop" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".sh-dgr__grid-result, .sh-dlr__list-result" },
        extract: {
          name: "prices",
          selector: ".sh-dgr__grid-result, .sh-dlr__list-result",
          fields: {
            title: { selector: "h3, .tAxDx", transform: "text" },
            price: { selector: ".a8Pemb, .kHxwFf", transform: "text" },
            store: { selector: ".aULzUe, .IuHnof", transform: "text" },
            url: { selector: "a", attribute: "href", transform: "url" },
            rating: { selector: ".Rsc7Yb", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, price, store, url, rating}",
  },
];
