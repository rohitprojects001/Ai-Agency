# Rohit AI Studio

A managed-service business operations dashboard for customer conversations,
leads, appointments, products, AI agents, and automations.

## Project layout

- `frontend/` — Next.js dashboard.
- `frontend/app/workshop/` — public sales page for the Business AI Workshop, served at `/workshop`.
- `backend/` — Express API, Prisma schema, and PostgreSQL migrations.
- `Cutie/` — separate local desktop/voice Mira assistant.
- `WHATSAPP_SETUP.md` — Meta WhatsApp Cloud API setup.
- `LAUNCH_CHECKLIST.md` — staging deployment and go-live requirements.

## Run locally

Prerequisites: Node.js 20.9 or newer, npm, and Docker with Compose.

1. Copy `backend/.env.example` to `backend/.env`. Set `DATABASE_URL` and
   `JWT_SECRET`; add an OpenAI key if you want hosted AI. For local Mira,
   configure Ollama using `OLLAMA_URL` and `OLLAMA_MODEL`.
2. Start PostgreSQL with `cd backend && docker compose up -d`.
3. In `backend/`, run `npm ci`, `npx prisma generate`,
   `npx prisma migrate deploy`, and `npm run dev`.
4. In another terminal, run `cd frontend && npm ci && npm run dev`.
5. Open <http://localhost:3000>.

The public workshop page is at <http://localhost:3000/workshop>. To receive
plan requests by email, configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and
`SALES_NOTIFICATION_EMAIL` in `backend/.env`. The page collects access
requests only; payment and workshop access are handled manually.

Every workspace starts in free Trial mode. Trial messages, voice-call
simulations, and AI previews use local demo providers; they do not send to real
customers and do not need Meta, Twilio, Resend, or OpenAI credentials. To try
the dashboard locally without email verification, run `cd backend && npm run seed`,
then sign in with `owner@urbanfit.demo` / `demo12345`. Seed data is for
local development only and must not be used in production.

Trial/Live controls are visible only to emails in `SUPER_ADMIN_EMAILS`, under
Business setup. Live activation requires a paid plan to be marked active, a
configured real channel, an OpenAI key, and explicit confirmation. Trial
limits/features are configurable per workspace from that admin panel. Mode
changes are audited; Live providers never silently fall back to demo. Sender
IDs are organization-scoped, but provider API keys currently remain shared
backend environment secrets rather than per-customer stored credentials.
Resend requires `RESEND_FROM_EMAIL` to use a domain verified in your Resend
account; the recipient notification inbox may be a Gmail address.

Protected customer workspaces use `/agency/<workspace-slug>`. The slug only
identifies the requested workspace: visitors must sign in with a verified
account and have an active membership before workspace data is available.
Authenticated users can request access; workspace owners/admins can review
requests at `GET /api/access-requests/organization/:slug` and approve or deny
them through `/api/access-requests/organization/:slug/:requestId/:decision`.
Platform-wide review is restricted to verified users whose email is explicitly
listed in `SUPER_ADMIN_EMAILS`.

Paid workspace features require an active plan. The monthly, 6-month, and
7-month plans are activated manually after payment by a platform administrator
using `POST /api/admin/organizations/:organizationId/subscription`, and the same
admin controls can extend or renew an active plan from the current expiry date
or from today when the plan is expired. Details and the current plan are
available at `GET /api/subscription`. Existing workspaces are grandfathered as
active. This is not an online checkout flow: payment collection and the
administrative plan-activation interface are not yet fully automated.

Before deploying the security changes:

1. Run `cd backend && npx prisma migrate deploy`.
2. Set a unique `JWT_SECRET`, `JWT_EXPIRES_IN` (15 minutes to 30 days),
   exact HTTPS `CORS_ORIGIN` values, `FRONTEND_URL`, and `SUPER_ADMIN_EMAILS`.
3. Set the frontend API URL and deploy the frontend and API on the same site
   (for example, `app.example.com` and `api.example.com`) so the `SameSite=Strict`
   HTTP-only session cookie works. Use HTTPS for both.
4. Configure a verified Resend sender domain to deliver verification and
   password-reset links to customers. Resend's temporary sender only works for
   the account's own inbox.

Existing accounts are treated as email-verified by the migration. New
registrations must verify their email before they can create a session.
Existing local-storage bearer tokens are intentionally no longer accepted;
users need to sign in again after deploying.

For production search and social previews, set `NEXT_PUBLIC_SITE_URL` in
`frontend/.env` to the public HTTPS domain (for example, `https://example.com`).
The workshop publishes its own sitemap, robots rules, social preview image,
and structured data at `/sitemap.xml`, `/robots.txt`, and
`/workshop/opengraph-image`.

For a populated demo workspace, run `cd backend && npm run seed`. Keep demo
credentials and demo data out of production.

## Production readiness

This repository is a launch candidate, not a fully operational global SaaS.
Before inviting paying customers, follow [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)
and complete its account, domain, legal, provider, backup, and operational
requirements. Never commit `.env` files or put server-side secrets in the
frontend.
