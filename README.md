# Workfinder

Workfinder combines Personal Career Agent's career research and deterministic matching with Trust Tech Jobs' public Greenhouse and Lever sources. Its bounded career agent searches and compares roles, explains match scores, finds skill gaps, and prepares interview practice. It cannot apply, contact recruiters, send messages, or access a user's device.

## Requirements

- Node.js 22 or newer and npm
- Python 3 for optional job ingestion; no Python packages are required
- A Firebase project with Authentication, App Check, and Cloud Firestore enabled
- A local Ollama service or another OpenAI-compatible model endpoint for agent responses

## Firebase Setup

1. Create a Firebase project and register a Web App. Put its API key, auth domain, project ID, and app ID in `.env.local` as the corresponding `NEXT_PUBLIC_FIREBASE_*` values in `.env.example`. These web config values are public identifiers, not server credentials.
2. Enable Email/Password in Firebase Authentication, configure the verification-email template, and add the Workfinder origin to Authorized Domains.
3. Register the web app with Firebase App Check using reCAPTCHA v3. Put the reCAPTCHA site key in `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`. Add localhost only for local development; use the production domain for deployed builds. Agent/session requests use limited-use App Check tokens, which the server consumes to reject replay.
4. Create the default Firestore database in a region appropriate for the app. Deploy `firestore.rules`; direct browser reads and writes are denied. The server uses Firebase Admin after verifying the session and App Check token.
5. Configure server credentials through Application Default Credentials. On a managed Google runtime, use its attached service identity with only the Auth, App Check verification, and Firestore access it needs. For local development, use a service-account file through `GOOGLE_APPLICATION_CREDENTIALS`; keep that file outside the repo and never commit it. Set `FIREBASE_PROJECT_ID`.

Deploy the rules with the Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

Usage and throttle documents include an `expiresAt` field for a 90-day retention policy. Configure Firestore TTL policies for the `days`, `authLimits`, `agentLimits`, and `agentGlobalLimits` collection groups if automatic cleanup is desired; verify current billing requirements for your Firebase plan.

## Run Locally

Set the Firebase values and local Application Default Credentials in `.env.local`, then:

```bash
npm ci
npm run dev
```

For this checkout, `README.local.md` contains a detailed local setup checklist and is intentionally ignored by Git. The tracked setup and security contract remain in this README and `docs/architecture.md`.

The app still provides public job search and deterministic scores if Firebase or the model is not configured, but sign-in and agent access remain unavailable until Firebase is configured.

The default model endpoint is local Ollama:

```dotenv
WORKFINDER_LLM_BASE_URL=http://127.0.0.1:11434/v1
WORKFINDER_LLM_MODEL=qwen3:8b
WORKFINDER_LLM_API_KEY=ollama
```

Install and start Ollama, then pull the selected model with `ollama pull qwen3:8b`. The model must support OpenAI-compatible chat completions with tool calls. You may configure another HTTPS OpenAI-compatible endpoint; its privacy terms and charges are separate. Model licenses and memory requirements vary.

Set `WORKFINDER_ALLOWED_ORIGIN` to the exact public origin in production. `npm start` binds to `127.0.0.1` by default. Firebase App Hosting sets a runtime-only `WORKFINDER_HOSTNAME=0.0.0.0` in `apphosting.yaml`; its managed HTTPS ingress is the public boundary. For other hosts, keep the server behind a TLS reverse proxy with ingress controls and HSTS.

## Deploy to Firebase App Hosting

Use Firebase App Hosting to run the complete Next.js server, including the existing same-origin session and agent routes. Connect the repository and production branch to an App Hosting backend in Firebase Console; App Hosting builds and deploys that branch. GitHub Actions remains responsible for CI and any scheduled ingestion, not serving live API requests. Do not configure a static export or split the routes into Cloud Functions unless intentionally migrating the API and its cookie/origin contract.

Configure the following for the App Hosting backend:

- Set `NEXT_PUBLIC_FIREBASE_*` values as build-time environment variables. These are public Firebase web-app settings.
- Set `FIREBASE_PROJECT_ID`, `WORKFINDER_ALLOWED_ORIGIN`, and any OTLP endpoints as server runtime environment variables.
- Store `WORKFINDER_LLM_API_KEY` and `OTEL_EXPORTER_OTLP_HEADERS` in Secret Manager and expose them only at runtime when needed.
- Grant the App Hosting runtime service identity the minimum Firebase Auth, App Check, and Firestore permissions required by Firebase Admin. Use its attached identity (ADC), never a service-account key file.
- Add the App Hosting domain to Firebase Auth authorized domains and the App Check reCAPTCHA configuration. Configure Firestore TTL and budget alerts before accepting traffic.

Verify that the selected App Hosting region and currently supported Next.js version meet deployment needs. Review Firebase and model-provider pricing; request quotas do not impose a provider dollar cap.

## Security and Usage Controls

- Firebase email/password accounts require email verification. The server exchanges a verified ID token for a five-day HttpOnly, SameSite session cookie; production uses the `__Host-` cookie prefix and `Secure`.
- Every agent call requires the session cookie and a fresh, consumed Firebase App Check token. The route checks the exact origin, caps body size and conversation history, and never accepts a user-supplied model endpoint.
- Firestore transactions enforce per-account and deployment-wide rate/token reservations across app instances. Defaults per account are 6 requests/minute, 40 requests/day, and 180,000 tokens/day reserved in 32,000-token blocks. Global defaults are 120 requests/minute, 200 requests/day, and 1,000,000 tokens/day. Override with `WORKFINDER_AGENT_*` variables. Token quotas are not a monetary provider-spend cap; monitor Firebase and model-provider budgets.
- Firestore stores daily aggregate token counts, completion/tool-call counts, duration, and model name for up to 90 days when TTL is configured. Prompts, profile context, job descriptions, and model responses are not written to telemetry.
- Saved roles, feedback, and career preferences remain in browser storage namespaced by Firebase UID. They are not synchronized to Firestore or other devices. The App Check public site key is not a secret; Firebase Admin credentials and model API keys must remain server-only.
- Firestore client rules deny direct access. The server derives the UID only from a verified Firebase session, never from request JSON.
- Application OpenTelemetry logs and metrics record API method, fixed route, status, and duration, with a matching `X-Request-Id` response header. They omit raw URLs, headers, bodies, user IDs, prompts, and model responses. Framework traces are sampled only when their URL/target attributes contain no query string. Configure `OTEL_EXPORTER_OTLP_ENDPOINT`, or separate `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` and `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, for OTLP/HTTP export. Without an OTLP logs endpoint, request logs use stdout; metrics remain disabled.

## Data and Agent Behavior

The initial board contains five seed listings. Run `npm run ingest` to fetch public Greenhouse and Lever boards and merge them by source/listing ID into `src/data/jobs.json`; run ingestion before rebuilding to include the new snapshot. The importer needs no Google Sheets credentials and has no scheduled background job.

The agent has four read-only tools: `search_jobs`, `explain_match`, `compare_jobs`, and `interview_prep`. Scores remain deterministic application output. Job descriptions are untrusted text, and no tool can apply for jobs or perform other external actions.

## Validation and Deployment

```bash
npm run lint
npm test
npm run build
npm start
```

Set `NEXT_PUBLIC_FIREBASE_*` values before building because Next.js embeds them into the client bundle. Provide server-side ADC and model credentials at runtime. Firebase client/Admin SDKs are Apache-2.0 licensed; Firebase Auth/App Check/Firestore themselves are managed Google services, not self-hostable open-source services. Review current Firebase free quotas and billing-plan requirements before deployment; free usage is not unlimited.

See [docs/architecture.md](docs/architecture.md) for the architecture and design decisions.
