/**
 * Financial skills -- stock quotes, crypto, company financials, SEC, forex, DeFi.
 */

import type { SkillDefinition } from "../../types.js";

export const financialSkills: SkillDefinition[] = [
  {
    id: "stock-quote",
    name: "Stock Quote",
    description: "Get real-time stock quote from Yahoo Finance",
    category: "financial",
    tags: ["stock", "quote", "market", "finance"],
    parameters: [
      { name: "symbol", description: "Stock ticker symbol (e.g., AAPL, GOOGL)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://finance.yahoo.com/quote/{{symbol}}/" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-testid='qsp-price']", timeout: 10000 },
        extract: {
          name: "quote",
          selector: "#quote-header-info, [data-testid='quote-header'], main",
          fields: {
            name: { selector: "h1", transform: "text" },
            price: { selector: "[data-testid='qsp-price'], [data-field='regularMarketPrice']", transform: "text" },
            change: { selector: "[data-testid='qsp-price-change'], [data-field='regularMarketChange']", transform: "text" },
            changePercent: { selector: "[data-testid='qsp-price-change-percent'], [data-field='regularMarketChangePercent']", transform: "text" },
            volume: { selector: "[data-field='regularMarketVolume']", transform: "text" },
            marketCap: { selector: "[data-field='marketCap']", transform: "text" },
            peRatio: { selector: "[data-field='trailingPE']", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, price, change, changePercent, volume, marketCap, peRatio}",
  },
  {
    id: "crypto-price",
    name: "Crypto Price",
    description: "Get cryptocurrency price from CoinGecko",
    category: "financial",
    tags: ["crypto", "bitcoin", "ethereum", "price"],
    parameters: [
      { name: "coin", description: "Coin ID (e.g., bitcoin, ethereum, solana)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.coingecko.com/en/coins/{{coin}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-coin-id]", timeout: 10000 },
        extract: {
          name: "coin",
          selector: "[data-controller='coins-show'], main",
          fields: {
            name: { selector: "h1", transform: "text" },
            price: { selector: "[data-converter-target='price'], .no-wrap", transform: "text" },
            change24h: { selector: "[data-price-change-target='percent']", transform: "text" },
            marketCap: { selector: "[data-target='price.marketCap'], td[data-sort*='market_cap']", transform: "text" },
            volume24h: { selector: "[data-target='price.volume24h'], td[data-sort*='volume']", transform: "text" },
            rank: { selector: ".badge.badge-secondary, .tw-bg-gray-200", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, price, change24h, marketCap, volume24h, rank}",
  },
  {
    id: "company-financials",
    name: "Company Financials",
    description: "Get key financial data for a company from Yahoo Finance",
    category: "financial",
    tags: ["financials", "company", "earnings", "revenue"],
    parameters: [
      { name: "symbol", description: "Stock ticker symbol", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://finance.yahoo.com/quote/{{symbol}}/financials/" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".tableContainer, [data-testid='fin-row']" },
        extract: {
          name: "financials",
          selector: ".tableContainer .row, [data-testid='fin-row']",
          fields: {
            label: { selector: ".rowTitle, [data-testid='fin-col-0']", transform: "text" },
            value1: { selector: ".column:nth-child(2), [data-testid='fin-col-1']", transform: "text" },
            value2: { selector: ".column:nth-child(3), [data-testid='fin-col-2']", transform: "text" },
            value3: { selector: ".column:nth-child(4), [data-testid='fin-col-3']", transform: "text" },
          },
          multiple: true,
          limit: 30,
        },
      },
    ],
    outputHint: "Array of {label, value1, value2, value3} (rows from financial statement)",
  },
  {
    id: "sec-filing",
    name: "SEC Filing Search",
    description: "Search SEC EDGAR for company filings",
    category: "financial",
    tags: ["sec", "filing", "edgar", "10-K", "10-Q"],
    parameters: [
      { name: "company", description: "Company name or CIK number", required: true },
      { name: "type", description: "Filing type (e.g., 10-K, 10-Q, 8-K)", required: false, default: "" },
    ],
    steps: [
      { action: "navigate", value: "https://efts.sec.gov/LATEST/search-index?q={{company}}&dateRange=custom&startdt=2024-01-01&forms={{type}}" },
      {
        action: "navigate",
        value: "https://www.sec.gov/cgi-bin/browse-edgar?company={{company}}&CIK=&type={{type}}&dateb=&owner=include&count=20&search_text=&action=getcompany",
      },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".tableFile2, table" },
        extract: {
          name: "filings",
          selector: ".tableFile2 tr, table tbody tr",
          fields: {
            type: { selector: "td:nth-child(1)", transform: "text" },
            date: { selector: "td:nth-child(4), td:nth-child(3)", transform: "text" },
            description: { selector: "td:nth-child(2)", transform: "text" },
            url: { selector: "td:nth-child(2) a", attribute: "href", transform: "url" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {type, date, description, url}",
  },
  {
    id: "forex-rate",
    name: "Forex Exchange Rate",
    description: "Get current forex exchange rate",
    category: "financial",
    tags: ["forex", "currency", "exchange", "fx"],
    parameters: [
      { name: "from", description: "From currency code (e.g., USD)", required: true },
      { name: "to", description: "To currency code (e.g., EUR)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.google.com/finance/quote/{{from}}-{{to}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-last-price]" },
        extract: {
          name: "rate",
          selector: "main",
          fields: {
            pair: { selector: "[data-source='{{from}}'] h1, .zzDege", transform: "text" },
            rate: { selector: "[data-last-price], .YMlKec.fxKbKc", transform: "text" },
            change: { selector: "[data-last-change], .JwB6zf", transform: "text" },
            changePercent: { selector: "[data-last-change-percent], .P2Luy", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{pair, rate, change, changePercent}",
  },
  {
    id: "defi-tvl",
    name: "DeFi Protocol TVL",
    description: "Get DeFi protocol TVL and stats from DeFiLlama",
    category: "financial",
    tags: ["defi", "tvl", "protocol", "blockchain"],
    parameters: [
      { name: "protocol", description: "Protocol name (e.g., aave, uniswap, lido)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://defillama.com/protocol/{{protocol}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[class*='stat'], [class*='Value']", timeout: 10000 },
        extract: {
          name: "protocol",
          selector: "main",
          fields: {
            name: { selector: "h1", transform: "text" },
            tvl: { selector: "[class*='stat']:first-of-type, [class*='Value']:first-of-type", transform: "text" },
            change1d: { selector: "[class*='change'], [class*='1d']", transform: "text" },
            category: { selector: "[class*='category']", transform: "text" },
            chains: { selector: "[class*='chains']", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, tvl, change1d, category, chains}",
  },
];
