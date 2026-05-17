# IRTH OS File Structure

```
/
├── apps/
│   ├── admin/                 # Next.js 15.3+ App Router (Cloudflare Pages)
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   └── [locale]/
│   │   │   │       ├── layout.tsx
│   │   │   │       ├── page.tsx
│   │   │   │       └── login/page.tsx
│   │   │   ├── components/ui/ # shadcn/ui components (rtl:true)
│   │   │   ├── messages/      # next-intl translations
│   │   │   │   └── ar.json
│   │   │   └── i18n/
│   ├── api/                   # Hono.js on Cloudflare Workers
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts       # Main Hono app
│   │   │   ├── auth.ts        # Better Auth config
│   │   │   └── routes/
│   │   │       └── health.ts
│   └── mobile/                # React Native Expo (Phase 3+)
├── packages/
│   ├── db/                    # Drizzle ORM + Supabase PostgreSQL
│   │   ├── package.json
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   └── schema.ts      # organizations, products, orders, audit_log
│   ├── types/
│   │   └── package.json
│   ├── utils/
│   │   └── package.json
│   └── emails/                # Resend + react-email
│       └── package.json
├── .github/
│   └── workflows/
│       └── deploy.yml
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```
