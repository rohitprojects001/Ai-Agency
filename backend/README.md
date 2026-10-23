# AI Agency — Backend

Node.js + Express + TypeScript + Prisma + PostgreSQL. Multi-tenant from day one:
every table that belongs to a business carries `organizationId`, and every
query in every route is filtered by the `organizationId` that came from the
verified JWT — never from the request body.

## What's built in this phase

- **Auth**: email-verified registration, bcrypt password hashing, sign-in,
  email verification, password reset/change, per-account lockout, and
  revocable database-backed sessions delivered only in HTTP-only cookies.
- **Authorization**: every protected request reloads the user's current
  verified identity, active organization membership, and role from PostgreSQL;
  the role claim in a signed cookie is never used to authorize a request.
- **Workspace lifecycle and plans**: platform admins can suspend/restore users
  and workspaces. Trial workspaces use the free demo providers; Live
  workspaces require an active plan for paid features. Existing workspaces
  are grandfathered by the subscription migration.
- **Trial → Live conversion**: every workspace has its own `mode`,
  `trialStartedAt`, `trialEndsAt`, and configurable trial limits/features.
  Super-admin-only controls are in Business setup; switching to Live requires
  explicit confirmation, an active plan, at least one configured real channel,
  and an OpenAI key. Mode changes are audit logged with previous/new mode,
  actor, and timestamp. Suspension revokes active workspace sessions.
- **Provider selection**: messaging, voice, and AI are selected centrally from
  organization mode. Trial WhatsApp/SMS/email and AI responses are local demos;
  trial voice creates a local demo call (with optional browser speech). Live
  sends use the real Meta/Twilio/Resend adapters and never fall back to demo.
  Live provider errors are stored as failures and surfaced to the caller.
- **Trial controls**: super-admins can set duration, WhatsApp/SMS/email/voice
  demo message limits, maximum users, and enabled feature areas per workspace.
  Defaults are centralized and not repeated in route logic.
- **Manual plan activation**: after confirming payment, a verified platform
  admin can activate a workspace plan through
  `POST /api/admin/organizations/:organizationId/subscription` with
  `{ "confirmation": "ACTIVATE", "plan": "MONTHLY|SIX_MONTHS|SEVEN_MONTHS" }`.
  An optional `paymentReference` is retained for reconciliation. Plan periods
  are 1, 6, and 7 calendar months. `GET /api/subscription` reports the current
  workspace plan and access state. Only emails in `SUPER_ADMIN_EMAILS` can
  activate plans; activation is audited.
- **Session controls**: `GET /api/auth/sessions` lists the current user's
  active sessions; `POST /api/auth/sessions/:sessionId/revoke` revokes one,
  and `POST /api/auth/logout-all` revokes every session.
- **Workspace access**: access requests are tied to a verified user and target
  workspace slug; only workspace owners/admins or configured platform
  super-admins can approve them. Approval creates an `AGENT` membership.
- **Role policy**: OWNER/ADMIN manage business configuration, agents, and
  automations; MANAGER can manage products and operations; AGENT can work with
  contacts, leads, and conversations; VIEWER is read-only.
- **Multi-tenancy**: tenant-owned records remain scoped to the organization
  selected from an active server-side session, never from request parameters.
- **CRM and inbox API**: contacts, leads, conversations, human handoff,
  product catalog, appointments, and business profile routes.
- **AI agents**: workspace-scoped agent prompts, default-agent selection, and
  persistent conversation assignment.
- **AI orchestration**: OpenAI tool calls for availability, bookings, lead
  updates, and human escalation, shared by WhatsApp, SMS, and voice. Trial mode
  uses a local demo response and does not require an OpenAI key.
- **Mira advisor**: an authenticated workspace-scoped `/api/assistant/chat`
  endpoint that gives practical advice from live dashboard metrics. Trial
  responses are local demos; Live uses a configured OpenAI provider or the
  explicitly configured local Ollama provider (`OLLAMA_URL`, `OLLAMA_MODEL`).
- **Automation engine**: event-triggered workflows for new leads, incoming
  messages, and bookings; supports message delivery, lead-stage updates,
  conditions, and persistent execution logs.
- **Channels**: Meta WhatsApp, Twilio SMS/voice, and Resend email adapters.
  Outbound messages are written to the CRM with provider IDs and delivery
  states; inbound Twilio and Meta webhook signatures are validated.
- **Launch safeguards**: Helmet security headers, a 1 MB JSON body limit,
  rate limits for authentication and Mira, production JWT/CORS checks, and a
  database-aware `/api/health/ready` check.
- **Database migrations**: the checked-in initial migration is the source of
  truth for fresh databases. Async route failures are forwarded to Express's
  centralized error handler instead of terminating the process.
- **Seed data**: a realistic demo business ("UrbanFit Studio") with a contact,
  a scored lead, and a WhatsApp conversation, so the dashboard isn't empty.

## Real WhatsApp connection (new)

- `src/lib/whatsapp.ts` — sends real messages via the WhatsApp Cloud API.
  Does nothing until `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`
  are set.
- `src/routes/webhooks.ts` — `GET /api/webhooks/whatsapp` handles Meta's
  verification handshake; `POST /api/webhooks/whatsapp` verifies Meta's
  `X-Hub-Signature-256` using `META_APP_SECRET` before processing messages.
- `BusinessProfile.whatsappPhoneNumberId` maps incoming/outgoing WhatsApp to
  the right organization — set it in Business Settings. This route is
  intentionally **not** behind `requireAuth` - Meta
  calls it directly; its GET handshake uses the verify token and incoming
  POST requests require a valid Meta app signature.
- `GET /api/business-profile/whatsapp-status` — used by the Settings page
  to show a Connected / Not connected badge.
- Full non-technical walkthrough: **`WHATSAPP_SETUP.md`** at the project
  root — Meta account, access token, webhook, ngrok for local testing, all
  of it.

## Products / Services catalog

- New `Product` model — name, price, optional description/duration/category.
- `GET/POST /api/products`, `PATCH /api/products/:id`, `DELETE /api/products/:id`.
- The AI orchestrator now pulls active products straight into its system
  prompt as an authoritative price list (`buildSystemPrompt` in
  `orchestrator.ts`) — alongside the free-text `aiInstructions` from
  Settings. Add a product here and the AI quotes it correctly on the very
  next message, no other wiring needed.
- New frontend page: `/dashboard/products` — add/remove products, see them
  listed with price and duration.

## Inbox + Human Handoff

- The AI has a 4th tool, `escalate_to_human` — it calls this when a customer
  asks for a person, complains, disputes a payment, or asks something it
  can't help with. This sets `conversation.status = ESCALATED`.
- Once escalated, **the AI stops responding in that conversation** — see the
  early-return in `handleIncomingMessage` in `orchestrator.ts`. New customer
  messages are still recorded, just not auto-replied to. That's the whole
  point of a handoff: no AI talking over a human.
- `POST /api/conversations/:id/reply` — a human sends a message directly,
  bypassing the AI entirely (`sender: HUMAN`).
- `PATCH /api/conversations/:id/status` — manually escalate, resolve
  (close), or reopen a conversation.
- New frontend page: `/dashboard/inbox` — every conversation across every
  channel in one list, with Escalate / Mark resolved / Reopen controls and
  a reply box for manual takeover.

## AI can now DO things, not just talk

The orchestrator gives the AI three real tools via OpenAI function calling —
`check_availability`, `book_appointment`, `create_or_update_lead`. Each one
touches the real database. If the AI says "booked", there's a real row in
`appointments`. If a tool fails (slot taken, bad date), the AI is told and
is instructed to say so honestly instead of pretending it worked — see
`buildSystemPrompt` in `src/services/orchestrator.ts`.

Try it: in the WhatsApp simulator, ask for pricing, then ask to book a slot
and confirm a specific date/time. Check `/dashboard/appointments` — it
should be there for real.

## AI Orchestrator + WhatsApp Demo Simulator

- `src/lib/openai.ts` — thin wrapper around the OpenAI API. Requires
  `OPENAI_API_KEY` in `.env`.
- `src/services/orchestrator.ts` — the core logic: takes an incoming
  message, finds/creates the contact and conversation, builds a system
  prompt from the business's `aiInstructions`, asks the AI, saves both
  messages. This is the same function a real WhatsApp webhook will call
  later — only the message *source* changes, not this logic.
- `POST /api/conversations/whatsapp/simulate` — stands in for a real
  WhatsApp webhook. Pass `{ contactName, contactPhone, message }` and it
  runs the full orchestrator, returns the AI's reply.
- Every message is saved with `isDemo: true` until a real WhatsApp
  connection replaces the simulator - the data model doesn't change when
  that happens, so nothing needs to be rebuilt.
- The AI answers **only** from `BusinessProfile.aiInstructions` (services,
  prices, policies you type in) — it's told explicitly not to invent
  prices or facts. The seeded UrbanFit Studio demo has this filled in.

## Agents, Automations, and Channels

- `GET/POST /api/agents`, `PATCH/DELETE /api/agents/:id` manage tenant-scoped
  AI employees. A default active agent's instructions are included in new
  customer conversations.
- `GET/POST /api/automations`, `PATCH/DELETE /api/automations/:id` manage
  workflows. Supported triggers are `LEAD_CREATED`, `MESSAGE_RECEIVED`, and
  `APPOINTMENT_BOOKED`. Actions send WhatsApp/SMS/email messages or update a
  lead stage. `GET /api/automations/runs` exposes execution history.
- Message templates support values such as `{{contact.name}}`,
  `{{message.text}}`, `{{lead.status}}`, and `{{appointment.service}}`.
- `POST /api/channels/send` sends a tracked WhatsApp, SMS, or email message to
  an existing CRM contact. `GET /api/channels/status` reports provider
  readiness without exposing secrets.
- `POST /api/telecalling/calls` starts an outbound AI voice call. Twilio speech
  turns and call status are written to the CRM conversation.
- Twilio webhooks are mounted at `/api/webhooks/twilio/sms`,
  `/api/webhooks/twilio/voice`, `/api/webhooks/twilio/voice/turn`, and
  `/api/webhooks/twilio/voice/status`. They require `PUBLIC_API_URL` to point
  to a publicly reachable API and validate `X-Twilio-Signature`.

### Provider Configuration

Keep provider secrets in `backend/.env`; never send them to the browser.

- **WhatsApp**: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, and
  `META_APP_SECRET`; link each business's Meta phone-number ID in Business
  Settings.
- **SMS and voice**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and a Twilio
  sender number in Business Settings. Voice also requires a public
  `PUBLIC_API_URL` (use an HTTPS tunnel for local testing).
- **AI replies**: `OPENAI_API_KEY`.

Providers report unavailable until credentials and sender details are
configured. Failed sends are persisted as `FAILED`, never marked successful.

## Setup

```bash
cd backend
cp .env.example .env        # then edit JWT_SECRET, and add your OPENAI_API_KEY
docker compose up -d        # starts local Postgres on :5432
npm ci
npx prisma generate
npx prisma migrate deploy  # creates the schema from checked-in migrations
npm run seed                # optional: creates the UrbanFit Studio demo data
npm run dev                 # http://localhost:4000
```

For a database that already has this schema but no migration history, baseline
it once with `npx prisma migrate resolve --applied 20260928000000_init`.
For schema changes during development, use
`npx prisma migrate dev --name describe-the-change` and commit the generated migration.

Demo login (after seeding): `owner@urbanfit.demo` / `demo12345`

## Endpoints so far

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | no | sanity check |
| GET | `/api/health/ready` | no | checks API and database availability |
| POST | `/api/auth/register` | no | creates a workspace and sends email verification |
| POST | `/api/auth/register/start` | no | compatibility registration alias |
| POST | `/api/auth/forgot-password` | no | sends a password reset link to a registered account |
| POST | `/api/auth/login` | no | validates password and sets an HTTP-only session cookie |
| POST | `/api/auth/logout` | no | revokes current session and clears cookie |
| POST | `/api/auth/forgot-password` | no | requests a one-time password reset link |
| POST | `/api/auth/reset-password` | no | consumes a one-time reset link and revokes sessions |
| POST | `/api/auth/change-password` | yes | changes password and revokes other sessions |
| GET | `/api/auth/me` | yes | restores verified user and active workspace identity |
| GET | `/api/auth/workspaces` | yes | lists the signed-in user's active memberships |
| POST | `/api/auth/switch-workspace` | yes | checks membership and switches current session |
| GET/POST | `/api/access-requests` | yes | list own requests or request access by workspace slug |
| GET | `/api/access-requests/organization/:slug` | owner/admin | list pending requests in the current workspace |
| POST | `/api/access-requests/organization/:slug/:requestId/:decision` | owner/admin | approve or deny; approval grants least-privilege AGENT membership |
| GET | `/api/access-requests/admin/pending` | configured super admin | list pending requests across workspaces |
| POST | `/api/access-requests/admin/:requestId/:decision` | configured super admin | approve or deny a pending request |
| GET | `/api/admin/organizations` | configured super admin | list workspaces, Live readiness, and active plan |
| PUT | `/api/admin/organizations/:organizationId/integrations` | configured super admin | set per-workspace sender IDs while Trial/suspended |
| PUT | `/api/admin/organizations/:organizationId/trial-settings` | configured super admin | configure trial dates, limits, and feature flags |
| POST | `/api/admin/organizations/:organizationId/mode` | configured super admin | confirmed Trial/Live/Suspended mode transition; audit logged |
| POST | `/api/admin/organizations/:organizationId/subscription` | configured super admin | manually activate the selected paid plan after payment |
| GET | `/api/subscription` | yes | current workspace subscription and paid access |
| POST | `/api/assistant/chat` | yes | asks Mira for advice using dashboard context |
| GET | `/api/contacts` | yes | scoped to your organization |
| POST | `/api/contacts` | yes | |
| GET | `/api/contacts/:id` | yes | includes leads + conversations |
| GET | `/api/leads` | yes | for the pipeline/Kanban board |
| POST | `/api/leads` | yes | |
| PATCH | `/api/leads/:id/status` | yes | drag-and-drop pipeline moves |
| GET | `/api/conversations` | yes | latest activity and message preview |
| GET | `/api/conversations/:id` | yes | full message history |
| POST | `/api/conversations/:id/reply` | yes | human reply |
| PATCH | `/api/conversations/:id/status` | yes | open, escalate, or close |
| POST | `/api/conversations/whatsapp/simulate` | yes | run a demo customer message through the AI |
| GET | `/api/appointments` | yes | list bookings created by the AI |
| GET/POST | `/api/products` | yes | list and create offers |
| PATCH/DELETE | `/api/products/:id` | yes | update or remove an offer |
| GET/PUT | `/api/business-profile` | yes | read and update business context |
| GET | `/api/business-profile/whatsapp-status` | yes | check provider and number configuration |
| GET/POST | `/api/agents` | yes | list and create AI agents |
| PATCH/DELETE | `/api/agents/:id` | yes | update or remove an agent |
| GET/POST | `/api/automations` | yes | list and create workflows |
| PATCH/DELETE | `/api/automations/:id` | yes | update or remove a workflow |
| GET | `/api/automations/runs` | yes | latest workflow execution history |
| GET | `/api/channels/status` | yes | provider readiness for this business |
| POST | `/api/channels/send` | yes | send and track WhatsApp, SMS, or email |
| POST | `/api/telecalling/calls` | yes | start an AI voice call |
| GET/POST | `/api/webhooks/whatsapp` | no | Meta verification; signed incoming-message webhook |
| POST | `/api/webhooks/twilio/sms` | no | signed inbound SMS webhook |
| POST | `/api/webhooks/twilio/voice` | no | signed Twilio voice entry point |

Protected browser requests use the `studio_session` HTTP-only cookie.
Authorization is rechecked against the database on every request; the signed
role claim is not trusted. Unsafe cookie-authenticated requests must match an
allowed `Origin`.

## Why these decisions

- **Prisma over raw SQL**: type-safe queries, migrations you can read and
  review, and it makes the "every query scoped to organizationId" rule easy
  to audit — you can grep every `where:` clause in the routes folder.
- **JWT plus database sessions**: the token is kept in an HTTP-only cookie and
  bound to a revocable database session. Membership, status, and role are read
  from PostgreSQL on every protected request so access can be revoked
  immediately.
- **`isDemo` flag on messages** instead of a totally separate demo system:
  keeps one data model. Once a real WhatsApp/email/voice provider is wired
  up, its messages just get `isDemo: false` — the UI, CRM, and automations
  don't need two code paths.

## Remaining Roadmap

A document knowledge base with embeddings, automated payment collection,
email invitations, configurable permission policies, and manual appointment
create/edit/cancel endpoints remain future work. Subscription collection and
activation are manual; there is no payment-provider integration. Access is
currently granted by workspace request approval. Provider API secrets remain
server environment configuration shared by the deployment; only sender IDs
and addresses are scoped per organization. Customer-specific encrypted
credentials, multiple numbers/senders, and provider vaulting remain future
work. Production deployments should use a shared/distributed rate-limit store
and configure a verified Resend sender domain.
