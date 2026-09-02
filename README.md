# MoMo Marketplace AI

Hackathon-ready local marketplace demo with AI features and a production-shaped MTN MoMo Collection backend.

## Project layout

```text
momo-marketplace-ai/
├── frontend/
│   └── index.html          # Login + marketplace + merchant dashboard
├── backend/
│   ├── server.js           # Express API + MoMo Collection calls
│   ├── package.json
│   ├── pnpm-lock.yaml
│   └── .env.example        # Safe credential template
└── README.md
```

## Start it

1. In `backend/`, copy `.env.example` to `.env`.
2. Run `npm install` then `npm run dev`.
3. Open `frontend/index.html` in a browser.

The interface works without the server as a visual demo. With the API running, it uses local endpoints for login, catalogue data, merchant metrics, AI product descriptions and the shopping assistant.

The backend also exposes `POST /api/shops` and `POST /api/products` for the merchant flow. Products and orders are held in memory for the demo, so restarting the server resets them.

## MoMo setup

Add the real MoMo Collection API values to `backend/.env`. Credentials are intentionally not included in this project. Payment requests are created by the backend and the order is confirmed only after the provider reports `SUCCESSFUL`.

When MoMo credentials are not configured, `POST /api/payments/momo` uses a clearly flagged sandbox response and immediately creates a confirmed demo order. This keeps the checkout journey demoable while credentials are pending. Use a South African number in `27XXXXXXXXX` format in the checkout form.
