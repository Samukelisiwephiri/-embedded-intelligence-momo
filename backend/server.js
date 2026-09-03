
import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const MOMO_BASE_URL = process.env.MOMO_BASE_URL || "https://proxy.momoapi.mtn.com";
const MOMO_TARGET_ENVIRONMENT = process.env.MOMO_ENVIRONMENT || process.env.MOMO_TARGET_ENVIRONMENT || "mtnsouthafrica";
const MOMO_CALLBACK_URL = process.env.MOMO_CALLBACK_URL || "";
const MOMO_COLLECTION_SUBSCRIPTION_KEY = process.env.MOMO_COLLECTION_SUBSCRIPTION_KEY || process.env.MOMO_SUBSCRIPTION_KEY || "";

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json());

const products = [
  { id: "earphones", name: "Wireless Earphones", seller: "TechHaven", price: 499, category: "Electronics", emoji: "🎧", description: "Experience crystal-clear sound and all-day comfort with these wireless earphones." },
  { id: "running-shoes", name: "Running Shoes", seller: "Kasi Kicks", price: 450, category: "Fashion", emoji: "👟" },
  { id: "sourdough", name: "Sourdough Loaf", seller: "The Daily Crumb", price: 65, category: "Food", emoji: "🍞" },
  { id: "candle", name: "Scented Candle", seller: "Hearth & Home", price: 220, category: "Home", emoji: "🕯️" },
  { id: "studio-buds", name: "Studio Buds", seller: "Sound Studio", price: 459, category: "Electronics", emoji: "🎧", description: "Compact earbuds with rich sound for work, travel and everyday listening." },
  { id: "fresh-spinach", name: "Fresh Spinach", seller: "Mandla's Garden", price: 18, category: "Home-grown", unit: "1 bunch", emoji: "🥬", description: "Freshly harvested spinach grown by a local community gardener." },
  { id: "roasted-peanuts", name: "Roasted Peanuts", seller: "Thandi's Patch", price: 25, category: "Home-grown", unit: "250 g", emoji: "🥜", description: "Locally grown and roasted peanuts, packed in convenient 250 g portions." },
  { id: "garden-lettuce", name: "Garden Lettuce", seller: "Mandla's Garden", price: 15, category: "Home-grown", unit: "1 head", emoji: "🥬", description: "Crisp lettuce harvested fresh from a nearby home garden." },
  { id: "maize-meal", name: "Maize Meal", seller: "Siyakhula Spaza", price: 42, category: "Spaza shop", unit: "2.5 kg", emoji: "🌽", description: "A family-size staple available from your neighborhood spaza shop." },
  { id: "bread-milk", name: "Bread and Milk", seller: "Corner Star Spaza", price: 32, category: "Spaza shop", unit: "1 set", emoji: "🥖", description: "Everyday essentials conveniently stocked by a local spaza shop." },
  { id: "washing-soap", name: "Washing Soap", seller: "Siyakhula Spaza", price: 28, category: "Spaza shop", unit: "750 g", emoji: "🧼", description: "Affordable household soap from a nearby community retailer." }
];
const shops = [{ id: "techhaven", name: "TechHaven", owner: "demo-user", category: "Electronics" }];
const payments = new Map();
const orders = new Map();
const merchantStats = { todaySales: 2450, orders: 12 };

function configured() {
  return Boolean(MOMO_COLLECTION_SUBSCRIPTION_KEY && process.env.MOMO_API_USER && process.env.MOMO_API_KEY)
    && ![MOMO_COLLECTION_SUBSCRIPTION_KEY, process.env.MOMO_API_USER, process.env.MOMO_API_KEY].some((value) => value.startsWith("replace_"));
}

function normaliseMsisdn(value) {
  const phone = String(value || "").replace(/\D/g, "");
  if (!/^27\d{9}$/.test(phone)) throw new Error("payerMsisdn must be a South African number in 27XXXXXXXXX format, without +.");
  return phone;
}

async function momoAccessToken() {
  if (!configured()) throw new Error("MoMo is not configured. Add valid MoMo credentials to .env.");
  const basic = Buffer.from(`${process.env.MOMO_API_USER}:${process.env.MOMO_API_KEY}`).toString("base64");
  const response = await fetch(`${MOMO_BASE_URL}/collection/token/`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": MOMO_COLLECTION_SUBSCRIPTION_KEY,
      "X-Target-Environment": MOMO_TARGET_ENVIRONMENT,
      Authorization: `Basic ${basic}`
    }
  });
  if (!response.ok) throw new Error(`MoMo token request failed (${response.status}).`);
  const body = await response.json();
  return body.access_token;
}

function momoHeaders(token, referenceId) {
  return {
    "Ocp-Apim-Subscription-Key": MOMO_COLLECTION_SUBSCRIPTION_KEY,
    "X-Target-Environment": MOMO_TARGET_ENVIRONMENT,
    Authorization: `Bearer ${token}`,
    ...(referenceId ? { "X-Reference-Id": referenceId } : {})
  };
}

app.get("/health", (_req, res) => res.json({ status: "ok", momoConfigured: configured() }));

app.post("/api/auth/login", (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Mobile number is required." });
  // Demo login only. Replace with verified identity + hashed passwords before production.
  res.json({ token: `demo_${randomUUID()}`, user: { id: "demo-user", phone, name: "Nandi" } });
});

app.post("/api/shops", (req, res) => {
  const { name, category = "Other", owner = "demo-user" } = req.body;
  if (!String(name || "").trim()) return res.status(400).json({ error: "Shop name is required." });
  const shop = { id: randomUUID(), name: String(name).trim(), category, owner };
  shops.push(shop);
  res.status(201).json({ shop });
});

app.post("/api/products", (req, res) => {
  const { name, price, category = "Other", seller = "My Shop", emoji = "🛍️", description = "" } = req.body;
  const numericPrice = Number(price);
  if (!String(name || "").trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) {
    return res.status(400).json({ error: "Product name and a price greater than zero are required." });
  }
  const product = { id: randomUUID(), name: String(name).trim(), seller, price: numericPrice, category, emoji, description };
  products.push(product);
  res.status(201).json({ product });
});

app.get("/api/products", (req, res) => {
  const query = String(req.query.q || "").toLowerCase();
  const category = String(req.query.category || "").toLowerCase();
  const matches = products.filter((product) => {
    const matchesCategory = !category || product.category.toLowerCase() === category;
    const matchesQuery = !query || Object.values(product).join(" ").toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });
  res.json({ products: matches });
});

app.post("/api/ai/product-description", (req, res) => {
  const { name, price } = req.body;
  if (!name || !price) return res.status(400).json({ error: "Product name and price are required." });
  res.json({ description: `Experience dependable quality with ${name}. At R${price}, it is a smart local find for work, travel and everyday life.` });
});

app.post("/api/ai/shopping-assistant", (req, res) => {
  const query = String(req.body.query || "").trim();
  if (!query) return res.status(400).json({ error: "A shopping question is required." });
  const lowerQuery = query.toLowerCase();
  const budgetMatch = lowerQuery.match(/(?:under|below|less than)\s*r?\s*(\d+)/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : Infinity;
  const terms = lowerQuery.replace(/(?:under|below|less than)\s*r?\s*\d+/, "").split(/\s+/).filter((term) => term.length > 2);
  const searchTerms = terms.flatMap((term) => term === "headphones" ? [term, "earphones", "buds"] : [term]);
  const matches = products
    .filter((product) => product.price <= budget)
    .map((product) => ({ product, score: searchTerms.filter((term) => `${product.name} ${product.category} ${product.description || ""}`.toLowerCase().includes(term)).length }))
    .filter(({ score }) => score > 0 || searchTerms.length === 0)
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price)
    .slice(0, 5)
    .map(({ product }) => product);
  res.json({ message: `I found ${matches.length} option${matches.length === 1 ? "" : "s"} that fit your request.`, products: matches, budget: Number.isFinite(budget) ? budget : null, demo: true });
});

app.get("/api/merchant/dashboard", (_req, res) => res.json({
  todaySales: merchantStats.todaySales, orders: merchantStats.orders, products: products.length,
  insight: "Your wireless earphones are your fastest-growing product. Consider restocking within the next 3 days."
}));

app.post(["/api/payments/momo", "/api/payments/pay"], async (req, res, next) => {
  try {
    const { amount, currency = "ZAR", payerMsisdn, phoneNumber, externalId, payerMessage = "MoMo Market payment", payeeNote = "MoMo Market order", items = [] } = req.body;
    const cents = Number(amount);
    if (!Number.isFinite(cents) || cents <= 0) return res.status(400).json({ error: "amount must be greater than zero." });
    if (currency !== "ZAR") return res.status(400).json({ error: "Only ZAR is supported for this collection setup." });
    const payer = normaliseMsisdn(payerMsisdn || phoneNumber);
    const referenceId = randomUUID();
    if (!configured()) {
      const payment = { referenceId, amount: cents, currency, items, externalId: externalId || referenceId, state: "SUCCESSFUL", demo: true };
      payments.set(referenceId, payment);
      const order = { id: `ord_${randomUUID()}`, paymentReference: referenceId, amount: cents, currency, items, status: "CONFIRMED", demo: true };
      orders.set(referenceId, order);
      merchantStats.todaySales += cents;
      merchantStats.orders += 1;
      return res.status(202).json({ referenceId, status: "SUCCESSFUL", demo: true, order });
    }
    const token = await momoAccessToken();
    const response = await fetch(`${MOMO_BASE_URL}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers: { ...momoHeaders(token, referenceId), "Content-Type": "application/json", ...(MOMO_CALLBACK_URL ? { "X-Callback-Url": MOMO_CALLBACK_URL } : {}) },
      body: JSON.stringify({ amount: String(cents), currency, externalId: externalId || referenceId, payer: { partyIdType: "MSISDN", partyId: payer }, payerMessage, payeeNote })
    });
    if (response.status !== 202) throw new Error(`MoMo request-to-pay failed (${response.status}).`);
    payments.set(referenceId, { referenceId, amount: cents, currency, items, externalId: externalId || referenceId, state: "PENDING" });
    res.status(202).json({ referenceId, status: "PENDING" });
  } catch (error) { next(error); }
});

app.get("/api/payments/momo/:referenceId", async (req, res, next) => {
  try {
    const { referenceId } = req.params;
    const payment = payments.get(referenceId);
    if (!payment) return res.status(404).json({ error: "Payment reference not found." });
    if (payment.demo) return res.json({ amount: String(payment.amount), currency: payment.currency, externalId: payment.externalId, status: payment.state, demo: true, order: orders.get(referenceId) || null });
    const token = await momoAccessToken();
    const response = await fetch(`${MOMO_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`, { headers: momoHeaders(token) });
    if (!response.ok) throw new Error(`MoMo status request failed (${response.status}).`);
    const providerPayment = await response.json();
    payment.state = providerPayment.status;
    if (providerPayment.status === "SUCCESSFUL" && !orders.has(referenceId)) {
      orders.set(referenceId, { id: `ord_${randomUUID()}`, paymentReference: referenceId, amount: payment.amount, currency: payment.currency, items: payment.items, status: "CONFIRMED", financialTransactionId: providerPayment.financialTransactionId || null });
      merchantStats.todaySales += payment.amount;
      merchantStats.orders += 1;
    }
    res.json({ ...providerPayment, order: orders.get(referenceId) || null });
  } catch (error) { next(error); }
});

app.get("/api/orders/:paymentReference", (req, res) => {
  const order = orders.get(req.params.paymentReference);
  if (!order) return res.status(404).json({ error: "Order not found or payment is not yet successful." });
  res.json({ order });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(502).json({ error: error.message || "An unexpected server error occurred." });
});

app.listen(PORT, () => console.log(`MoMo Market API running on http://localhost:${PORT}`));
