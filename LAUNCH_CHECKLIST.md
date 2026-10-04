# Pilot deployment and launch checklist

The product is being prepared for a **managed-service pilot**. It is not yet
ready for an unrestricted public launch: business identity, domain, provider
accounts, privacy/legal terms, customer provisioning, and production
operations still require owner decisions and setup.

## Recommended first deployment

Use a managed application host (Render is a straightforward option) and a
managed PostgreSQL database. Deploy the API and dashboard as separate services
in the same region as the database. Choose paid, persistent production plans;
free/sleeping instances and expiring databases are only appropriate for
experiments.

### API service

Use `backend/` as the service root:

- Build: `npm ci && npx prisma generate && npm run build`
- Start: `npx prisma migrate deploy && npm start`
- Health check: `/api/health/ready`

Set these server-side environment variables in the host:

| Variable | Production setup |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Use the host-provided port |
| `DATABASE_URL` | Managed PostgreSQL connection string |
| `JWT_SECRET` | Unique random secret, at least 32 characters |
| `JWT_EXPIRES_IN` | Keep the short default unless you have a session policy |
| `CORS_ORIGIN` | Exact dashboard origin(s), comma-separated; no `*` |
| `TRUST_PROXY_HOPS` | Set to the proxy hops documented by your host (usually `1`) |
| `OPENAI_API_KEY` | Real server-side key if using OpenAI; never a sample value |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Only if the API can reach a deployed Ollama service |

The Mac's `localhost:11434` Ollama instance is not reachable from a hosted
backend. Configure a reachable model service or a real OpenAI key. Provider
keys must never be added to the frontend service.

### Dashboard service

Use `frontend/` as the service root:

- Build: `npm ci && npm run build`
- Start: `npm start`
- Set `NEXT_PUBLIC_API_URL` to the public API URL ending in `/api`, for
  example `https://api.example.com/api`.

Set `CORS_ORIGIN` on the API to the exact dashboard origin, such as
`https://app.example.com`. If the host generates separate service URLs, update
both values once those URLs exist. Configure custom domains and HTTPS before
connecting customer channels.

## Before the first customer

- [ ] Pick and verify the business/legal name, public support address, domain,
  and customer support process.
- [ ] Publish owner-reviewed Terms of Service, Privacy Policy, data-retention
  rules, and subprocessor disclosures for every country where customers or
  their contacts are located.
- [ ] Decide and implement the managed-customer account provisioning and
  deprovisioning process. Public registration currently exists and does not
  verify email; do not advertise unrestricted signup until invitation,
  verification, and account-recovery flows are ready.
- [ ] Configure production database backups and test restoring one.
- [ ] Configure error reporting, uptime alerts, log retention, and an incident
  response contact.
- [ ] Keep a single API instance until rate-limit state is moved to shared
  storage; the current rate limits are in-memory.
- [ ] Configure a real AI provider and review its data-processing terms before
  sending customer data to it.
- [ ] Configure each messaging/voice provider with verified business accounts,
  consent and opt-out handling, regional number rules, and approved templates
  where required. Do not send marketing messages without the required consent.
- [ ] Test registration, sign-in, sign-out, tenant isolation, all CRUD screens,
  handoff, demo simulations, and provider failure cases using separate test
  workspaces.
- [ ] Remove demo credentials/data from production and verify no secrets are
  present in client bundles, source control, or logs.
- [ ] Document support response times, cancellation/deletion requests, and
  customer data export/deletion procedures.

## Current product limits to resolve before a broad launch

- Registration creates a workspace immediately; email verification, invitations,
  password recovery, and a managed operator console are not implemented.
- Account roles exist in the data model, but a complete team invitation and
  permission-management experience is not yet available.
- Rate limiting uses process memory; use a shared store before running multiple
  API instances.
- WhatsApp inbound requests require `META_APP_SECRET` for signature checks.
  Configure it alongside the access token and verify token.
- SMS/voice still use Twilio. The app's demo path does not require real provider
  credentials. Provider replacement and local regulatory setup are separate
  launch tasks.
- A health check passing only confirms that the API and database are reachable;
  it does not verify AI, messaging, voice, or email provider readiness.
