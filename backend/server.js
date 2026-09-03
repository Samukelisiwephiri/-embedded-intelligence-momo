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

// In-memory demo data stores
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
const payments = new Map(); // referenceId -> payment
const orders = new Map();   // referenceId -> order
const ordersById = new Map(); // orderId -> order

function configured() {
  return Boolean(MOMO_COLLECTION_SUBSCRIPTION_KEY && process.env.MOMO_API_USER && process.env.MOMO_API_KEY)
    && ![MOMO_COLLECTION_SUBSCRIPTION_KEY, process.env.MOMO_API_USER, process.env.MOMO_API_KEY].some((value) => value.startsWith("replace_"));
}

// Country config + validation
const countries = [
  { name: "South Africa", code: "ZA", dialCode: "27", validation: /^[6-8][0-9]{8}$/ }
];
function validatePhone(countryCode, number) {
  const cfg = countries.find((c) => c.code === countryCode);
  if (!cfg) return false;
  const cleaned = String(number || "").replace(/\D/g, "");
  let local = cleaned;
  if (local.startsWith(cfg.dialCode)) local = local.substring(cfg.dialCode.length);
  if (local.startsWith("0")) local = local.substring(1);
  return cfg.validation.test(local);
}
function normaliseMsisdn(countryCode, value) {
  const cfg = countries.find((c) => c.code === countryCode);
  if (!cfg) throw new Error("Unsupported country for MSISDN normalization");
  const cleaned = String(value || "").replace(/\D/g, "");
  let local = cleaned;
  if (local.startsWith("0")) local = local.substring(1);
  if (local.startsWith(cfg.dialCode)) local = local.substring(cfg.dialCode.length);
  if (!cfg.validation.test(local)) throw new Error("Invalid mobile number for " + countryCode);
  return cfg.dialCode + local;
}

// Token caching
const tokenCache = { token: null, expiresAt: 0 };
async function momoAccessToken() {
  if (!configured()) throw new Error("MoMo is not configured. Add valid MoMo credentials to .env.");
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 5000) return tokenCache.token;
  const basic = Buffer.from(`${process.env.MOMO_API_USER}:${process.env.MOMO_API_KEY}`).toString("base64");
  const response = await fetch(`${MOMO_BASE_URL}/collection/token/`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": MOMO_COLLECTION_SUBSCRIPTION_KEY,
      "X-Target-Environment": MOMO_TARGET_ENVIRONMENT,
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error(`MoMo token request failed (${response.status}).`);
  const body = await response.json();
  const token = body.access_token;
  const expiresIn = Number(body.expires_in) || 3600;
  tokenCache.token = token;
  tokenCache.expiresAt = Date.now() + (expiresIn - 30) * 1000;
  return token;
}
function momoHeaders(token, referenceId) {
  const headers = {
    "Ocp-Apim-Subscription-Key": process.env.MOMO_SUBSCRIPTION_KEY,
    "X-Target-Environment": MOMO_TARGET_ENVIRONMENT,
    Authorization: token ? 'Bearer ' + token : 'Basic ' + Buffer.from(process.env.MOMO_API_USER + ':' + process.env.MOMO_API_KEY).toString('base64')
  };
  if (referenceId) headers["X-Reference-Id"] = referenceId;
  return headers;
}

app.get("/health", (_req, res) => res.json({ status: "ok", momoConfigured: configured() }));

// Auth (demo)
app.post("/api/auth/login", (req, res) => {
  const { country = "ZA", phoneNumber, password } = req.body;
  if (!phoneNumber) return res.status(400).json({ success: false, message: "Phone number is required." });
  if (!validatePhone(country, phoneNumber)) return res.status(400).json({ success: false, message: "Invalid mobile number for country." });
  const normalized = normaliseMsisdn(country, phoneNumber);
  // Demo password check (accept any non-empty password)
  if (!password || String(password).length < 1) return res.status(400).json({ success: false, message: "Password is required." });
  const user = { id: `user_${randomUUID()}`, phone: normalized, country };
  res.json({ success: true, token: `demo_${randomUUID()}`, user });
});

// Shops
app.post("/api/shops", (req, res) => {
  const { name, category = "Other", owner = "demo-user" } = req.body;
  if (!String(name || "").trim()) return res.status(400).json({ error: "Shop name is required." });
  const shop = { id: randomUUID(), name: String(name).trim(), category, owner };
  shops.push(shop);
  res.status(201).json({ shop });
});

// Products CRUD
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
app.get("/api/products/:id", (req, res) => {
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json({ product });
});
app.put("/api/products/:id", (req, res) => {
  const { name, price, category = "Other", seller = "My Shop", emoji = "🛍️", description = "" } = req.body;
  const numericPrice = Number(price);
  if (!String(name || "").trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) {
    return res.status(400).json({ error: "Product name and a price greater than zero are required." });
  }
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Product not found." });
  const updated = { ...products[idx], name: String(name).trim(), price: numericPrice, category, seller, emoji, description };
  products[idx] = updated;
  res.json({ product: updated });
});
app.delete("/api/products/:id", (req, res) => {
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Product not found." });
  const [removed] = products.splice(idx, 1);
  res.json({ product: removed });
});

// AI helpers (demo)
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
  todaySales: 2450, orders: ordersById.size, products: products.length,
  insight: "Your wireless earphones are your fastest-growing product. Consider restocking within the next 3 days."
}));

// Create an order (client chooses payment method)
app.post("/api/orders", async (req, res, next) => {
  try {
    const { items = [], totalAmount, customer = {}, paymentMethod = "CASH", country = "ZA", phoneNumber, externalId } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Order must include items." });
    if (!Number.isFinite(Number(totalAmount)) || Number(totalAmount) <= 0) return res.status(400).json({ error: "totalAmount must be greater than zero." });

    const orderId = `ord_${randomUUID()}`;
    const order = {
      id: orderId,
      customerId: customer.id || `user_${randomUUID()}`,
      items,
      totalAmount: Number(totalAmount),
      paymentMethod,
      paymentStatus: paymentMethod === 'CASH' ? 'PAY_ON_COLLECTION' : 'PENDING',
      momoReferenceId: null,
      orderStatus: paymentMethod === 'CASH' ? 'CONFIRMED' : 'PENDING'
    };

    if (paymentMethod === 'CASH') {
      ordersById.set(orderId, order);
      return res.status(201).json({ order });
    }

    if (paymentMethod === 'MOMO') {
      if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber is required for MoMo payments' });
      if (!validatePhone(country, phoneNumber)) return res.status(400).json({ error: 'Invalid phone number for selected country' });
      const normalized = normaliseMsisdn(country, phoneNumber);
      // create payment request
      const referenceId = randomUUID();
      if (!configured()) {
        const payment = { referenceId, amount: Number(totalAmount), currency: 'ZAR', items, externalId: externalId || referenceId, state: 'SUCCESSFUL', demo: true, normalized };
        payments.set(referenceId, payment);
        order.paymentStatus = 'PAID';
        order.momoReferenceId = referenceId;
        order.orderStatus = 'CONFIRMED';
        orders.set(referenceId, order);
        ordersById.set(orderId, order);
        return res.status(201).json({ order, referenceId });
      }

      const token = await momoAccessToken();
      const response = await fetch(`${MOMO_BASE_URL}/collection/v1_0/requesttopay`, {
        method: 'POST',
        headers: { ...momoHeaders(token, referenceId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: String(order.totalAmount), currency: 'ZAR', externalId: externalId || referenceId, payer: { partyIdType: 'MSISDN', partyId: normalized }, payerMessage: 'Payment for order', payeeNote: 'MoMo Marketplace order' })
      });
      if (response.status !== 202) {
        const text = await response.text();
        throw new Error(`MoMo request-to-pay failed (${response.status}): ${text}`);
      }
      payments.set(referenceId, { referenceId, amount: order.totalAmount, currency: 'ZAR', items, externalId: externalId || referenceId, state: 'PENDING' });
      order.momoReferenceId = referenceId;
      orders.set(referenceId, order);
      ordersById.set(orderId, order);
      return res.status(201).json({ order, referenceId });
    }

    // Card placeholder
    if (paymentMethod === 'CARD') {
      ordersById.set(orderId, order);
      return res.status(201).json({ order, message: 'Card payment is not implemented in this demo.' });
    }

    res.status(400).json({ error: 'Unsupported payment method' });
  } catch (err) { next(err); }
});

// Existing payment status endpoints
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

// Fetch order by payment reference (legacy)
app.get("/api/orders/:paymentReference", (req, res) => {
  const order = orders.get(req.params.paymentReference);
  if (!order) return res.status(404).json({ error: "Order not found or payment is not yet successful." });
  res.json({ order });
});

// Fetch order by internal order id
app.get("/api/orders/by-id/:orderId", (req, res) => {
  const order = ordersById.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(502).json({ error: error.message || "An unexpected server error occurred." });
});

app.listen(PORT, () => console.log(`MoMo Market API running on http://localhost:${PORT}`));
