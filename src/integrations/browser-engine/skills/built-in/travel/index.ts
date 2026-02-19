/**
 * Travel skills -- Google Flights, Booking, Google Maps, TripAdvisor.
 */

import type { SkillDefinition } from "../../types.js";

export const travelSkills: SkillDefinition[] = [
  {
    id: "google-flights",
    name: "Google Flights Search",
    description: "Search Google Flights for flight prices",
    category: "travel",
    tags: ["flights", "travel", "airline", "booking"],
    parameters: [
      { name: "from", description: "Departure city or airport code", required: true },
      { name: "to", description: "Destination city or airport code", required: true },
      { name: "date", description: "Departure date (YYYY-MM-DD)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.google.com/travel/flights?q=flights+from+{{from}}+to+{{to}}+on+{{date}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[class*='flight'], .pIav2d", timeout: 15000 },
        extract: {
          name: "flights",
          selector: "[class*='flight-result'], li[class*='pIav2d'], [data-ved]",
          fields: {
            airline: { selector: "[class*='airline'], .sSHqwe", transform: "text" },
            departure: { selector: "[class*='depart'], .mv1WYe", transform: "text" },
            arrival: { selector: "[class*='arrive'], .GsOpOe", transform: "text" },
            duration: { selector: "[class*='duration'], .Ak5kof .gvkrdb", transform: "text" },
            stops: { selector: "[class*='stop'], .EfT7Ae", transform: "text" },
            price: { selector: "[class*='price'], .YMlIz", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {airline, departure, arrival, duration, stops, price}",
  },
  {
    id: "booking-search",
    name: "Booking.com Hotel Search",
    description: "Search hotels on Booking.com",
    category: "travel",
    tags: ["hotel", "booking", "accommodation"],
    parameters: [
      { name: "destination", description: "City or destination name", required: true },
      { name: "checkin", description: "Check-in date (YYYY-MM-DD)", required: true },
      { name: "checkout", description: "Check-out date (YYYY-MM-DD)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.booking.com/searchresults.html?ss={{destination}}&checkin={{checkin}}&checkout={{checkout}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-testid='property-card']", timeout: 15000 },
        extract: {
          name: "hotels",
          selector: "[data-testid='property-card']",
          fields: {
            name: { selector: "[data-testid='title']", transform: "text" },
            rating: { selector: "[data-testid='review-score']", transform: "text" },
            price: { selector: "[data-testid='price-and-discounted-price']", transform: "text" },
            location: { selector: "[data-testid='address']", transform: "text" },
            url: { selector: "a[data-testid='title-link']", attribute: "href", transform: "url" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {name, rating, price, location, url}",
  },
  {
    id: "google-maps-search",
    name: "Google Maps Search",
    description: "Search Google Maps for places, businesses, or points of interest",
    category: "travel",
    tags: ["maps", "places", "business", "location"],
    parameters: [
      { name: "query", description: "Place or business search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.google.com/maps/search/{{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[class*='result'], .Nv2PK", timeout: 15000 },
        extract: {
          name: "places",
          selector: "[class*='result'], .Nv2PK",
          fields: {
            name: { selector: ".qBF1Pd, .fontHeadlineSmall", transform: "text" },
            rating: { selector: ".MW4etd, .ZkP5Je", transform: "text" },
            reviews: { selector: ".UY7F9, .e4rVHe", transform: "text" },
            type: { selector: ".W4Efsd:first-child, .RfnDt", transform: "text" },
            address: { selector: ".W4Efsd:nth-child(2), .rllt__details div:nth-child(3)", transform: "text" },
          },
          multiple: true,
          limit: 10,
        },
      },
    ],
    outputHint: "Array of {name, rating, reviews, type, address}",
  },
  {
    id: "tripadvisor-search",
    name: "TripAdvisor Search",
    description: "Search TripAdvisor for attractions, restaurants, or hotels",
    category: "travel",
    tags: ["tripadvisor", "travel", "reviews", "restaurants"],
    parameters: [
      { name: "query", description: "Search query (place, restaurant, attraction)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.tripadvisor.com/Search?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-test-target='result-item'], .result-card", timeout: 15000 },
        extract: {
          name: "results",
          selector: "[data-test-target='result-item'], .result-card",
          fields: {
            name: { selector: ".result-title, [data-test-target='result-item-title'] a", transform: "text" },
            type: { selector: ".search-result-type, .result-type", transform: "text" },
            rating: { selector: ".rating, .ui_bubble_rating", transform: "text" },
            reviews: { selector: ".review-count, .result-reviews-count", transform: "text" },
            url: { selector: "a", attribute: "href", transform: "url" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {name, type, rating, reviews, url}",
  },
];
