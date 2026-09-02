# IRTH Intelligence v1

IRTH Intelligence is a read-only operational assistant for the admin console.
It answers questions about orders, products, inventory, and sales through the Hono API.

## Setup

Set the Groq secret on the API service:

```bash
wrangler secret put GROQ_API_KEY
```

Optional model override:

```bash
GROQ_MODEL=openai/gpt-oss-120b
```

The admin app calls the API through `NEXT_PUBLIC_API_URL`, which should point at the Hono API origin.

## Security Model

- `GROQ_API_KEY` is read only on the server and is never exposed to the admin client.
- `/api/ai/chat` uses the trusted Hono context populated by Better Auth: `userId`, `orgId`, and `role`.
- Tool calls never accept `orgId` or `userId` from the model, user prompt, or client payload.
- Every tool is checked against the shared role permission matrix before execution.
- v1 tools are read-only. No create, update, delete, fulfillment, invoice, or inventory adjustment actions are exposed.
- Conversation and tool-call audit metadata is recorded in `ai_conversation_logs`.

## Tools

- `orders_list`: recent or status-filtered orders, requires `orders.view`.
- `products_search`: product lookup by name/status, requires `products.view`.
- `inventory_snapshot`: low/out/ok inventory levels, requires `inventory.view`.
- `sales_summary`: sales metrics over 1-90 days, requires `finance.view`.
