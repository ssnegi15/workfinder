# Workfinder project guidance

Workfinder combines Personal Career Agent matching with Trust Tech Jobs listings. Keep the original sibling repositories unchanged.

## Architecture

- Use Next.js App Router and TypeScript.
- Firebase Auth provides email/password identity. Require verified email for server sessions.
- Firebase App Check protects session exchange and agent requests; use limited-use tokens and server consumption.
- Firestore stores only server-side agent quota/usage aggregates. Browser rules deny all access.
- Keep preferences, saved roles, and relevance feedback in UID-scoped browser storage until a server profile feature is explicitly designed.
- Keep Firebase Admin and model credentials server-only. Use ADC/workload identity in deployment.

## Security

- Agent API calls require a verified session, valid consumed App Check token, exact allowed Origin, bounded input, transactional per-user quota, and privacy-minimized telemetry.
- Never log or persist prompts, profile context, job descriptions, model responses, or credentials in telemetry.
- Keep the agent read-only and allow-listed. Do not add application, recruiter-contact, messaging, shell, browser, or filesystem tools without explicit authorization and a threat-model change.
- Treat imported job content as untrusted text.
- Production binds to loopback. Network exposure requires TLS plus reverse-proxy ingress controls and provider budget alerts.

## Project conventions

- Add focused tests for session/origin/App Check boundaries, quota behavior, matching, and ingestion.
- Document Firebase setup, model configuration, rate limits, telemetry retention, and deployment boundaries in README.md and docs/architecture.md.
