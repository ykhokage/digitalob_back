# Incidents64 prompt compliance audit

Updated after re-checking `C:\Users\denla\Desktop\промт для диплома.docx`.

Status legend:

- `DONE` - implemented and usable in the current codebase.
- `PARTIAL` - core model/API/UI exists, but production behavior or a requested sub-feature is incomplete.
- `STUB` - mostly enum/config placeholder, not real behavior.
- `MISSING` - not implemented.
- `REMOVED` - intentionally removed from the final product scope.

## 1. User management

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Registration with email confirmation | DONE | Code-based registration through Resend exists and the sender domain is verified. |
| Login and logout | DONE | JWT access/refresh login, logout and refresh-token revocation exist. |
| Password reset through email | DONE | Reset email/link flow exists through Resend; sender domain is verified and email delivery was tested. |
| Password change | DONE | Profile/API flow verifies current password and revokes active refresh tokens. |
| User profile editing | DONE | Profile fields, contacts, avatar upload, email change by code and password change exist. |
| Roles admin/observer | DONE | RBAC guard is applied across services, incidents, reports, notifications, users, diagnostics and audit. |
| Notification contact data | DONE | Email, phone, Telegram chat id and webhook URL are stored in profile. |
| 2FA optional | DONE | TOTP setup, enable, login verification and disable flows exist. |
| Login journal | DONE | LoginLog records known-user attempts; AuditLog records success/failure security events. |
| Audit log | DONE | Additional admin audit page/API logs important actions. |

## 2. Microservice management

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Add/edit/delete microservices | DONE | CRUD API and frontend form/table exist. |
| Disable monitoring | DONE | API and UI toggle monitoring. |
| Required service fields | DONE | Schema and UI cover name, description, URL, type, environment, intervals, expected codes, thresholds, tags, group and owner team. |
| Grouping by project/team/tags | DONE | Group/team/tag fields exist, filters are available, and cards/compact/map views make groups and owners visible. |
| Service details card | DONE | Details page shows service data, metrics, incidents and dependencies. |
| Dependency map | DONE | Dependency model/API exists, and the services page includes a dependency map with chain-failure risk hints. |

## 3. Metrics and checks

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Availability, response time, success/error %, HTTP status, uptime/downtime, failures | DONE | Worker writes these fields from HTTP checks. |
| CPU/RAM/disk, RPM, avg/peak, app errors | DONE | Fields exist, worker stores them, and local demo microservices expose `/metrics` with CPU/RAM/disk/RPM/app-error values. |
| Health/liveness/readiness checks | DONE | Worker writes separate `health`, `liveness` and `readiness` health-check rows. |
| Threshold analysis | DONE | Response-time, CPU, RAM, disk and error-rate thresholds are checked when metrics are available. |
| SSL expiry check | DONE | HTTPS certificate expiry check enqueues `SSL_EXPIRING` events. |

## 4. Dashboard

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Summary counts and recent incidents | DONE | Dashboard API/UI show totals, statuses and recent incidents. |
| Slowest and most-error services | DONE | Dashboard API/UI show these. |
| Line/bar/pie/timeline visualizations | DONE | Recharts-based visualizations exist. |
| Heatmap | DONE | API returns 24-hour heatmap and frontend renders it. |
| Color status indication | DONE | OK/WARNING/CRITICAL classes are used across UI. |

## 5. Notifications

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Notification rules | DONE | Rule CRUD exists and is scoped to the current user. |
| Email, Telegram, webhook channels | DONE | Sender pipeline exists for Resend, Telegram Bot API and webhook. Telegram has automatic `/start code` linking; email delivery was verified through Resend. |
| Web Push optional | DONE | Real Web Push sender exists: VAPID keys, browser subscription storage, service worker and delivery pipeline. |
| SMS optional | REMOVED | SMS was deliberately removed from the product and database enum; supported channels are Email, Telegram, Web Push and Webhook. |
| Instant notifications | DONE | Worker enqueues events and the dispatcher sends matched notifications automatically. |
| Periodic reports by email | DONE | Periodic report rules, manual send-now and scheduled enqueue/delivery exist. |
| Quiet hours and dedupe | DONE | Implemented in notification enqueue logic. |
| Repeat sending / escalation | DONE | Escalation minutes are configurable in rules; open incidents trigger repeat notifications while unresolved. |
| Acknowledge notification | DONE | ACK endpoint exists and is audited. |
| Test notification endpoint | DONE | User can send test email/Telegram/webhook notification from the notifications page. |

## 6. Incidents

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Incident journal | DONE | API/UI list incidents. |
| State-change history | PARTIAL | Incidents are created/resolved by worker, but there is no separate full event-history table for every status transition. |
| Filters by service/time/status | DONE | API supports service/time/status/severity; UI exposes status/severity and export respects the selected filters. |
| Incident details | DONE | Dedicated detail page exists. |
| Comments | DONE | API and frontend comment flow exist. |
| Statuses new/in progress/resolved | DONE | Enum/API support all; frontend table allows admin status changes and resolve still calculates duration. |
| CSV/PDF export | DONE | Incident export endpoints and UI buttons exist. |
| Downtime duration | DONE | Resolve path calculates duration. |

## 7. Reports and analytics

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Uptime/downtime/avg response/incident reports | DONE | Report generation calculates and stores these. |
| Stability analysis | DONE | Analytics comparison includes a stability score based on uptime, errors, incidents and response time. |
| Period comparison | DONE | `/api/reports/comparison` and the analytics page compare current and previous periods. |
| SLA/SLO and violations | DONE | SLA/SLO values, violation count, stability score and period comparison are calculated and shown. |
| Automatic report generation | DONE | Worker creates scheduled weekly SLA reports for users with enabled `REPORT` rules. |
| Export PDF/Excel/CSV | DONE | Reports export to PDF, Excel and CSV. |

## 8. Search, filters, usability

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Search services | DONE | API/UI search by name/description. |
| Filter by status/env/tag | DONE | API and frontend expose these filters. |
| Sort by metrics | DONE | Services API/UI can sort by response time, error rate, CPU, RAM, disk, RPM, availability and incident count. |
| Favorite services | DONE | `isFavorite` is editable from UI. |
| Different display modes | DONE | Services page supports table, cards, compact list and dependency map views. |
| Mobile adaptation | PARTIAL | Layout, nav and tables are responsive; final browser/device QA is still needed. |
| Loading/error/empty states | PARTIAL | Present on many pages; not yet fully uniform everywhere. |

## 9. Additional functions

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Service dependency visualization | DONE | Services page includes a dependency map view and highlights possible chain-failure risk. |
| Separate service page | DONE | Current state, metrics, charts-ish data, dependencies and incidents are present. Notification log per service can be queried but is not emphasized in UI. |
| Manual incident status management | DONE | Admins can switch incidents between NEW / IN_PROGRESS / RESOLVED in the table; resolve still calculates duration. |
| Public/internal status page | DONE | Public endpoint and frontend status page exist. |
| REST API | DONE | Nest REST API exists. |
| API docs | DONE | Swagger is available at `/api/docs`. |
| External integrations | DONE | Resend, Telegram, Web Push, webhook and S3-compatible storage integrations exist; diagnostics show environment readiness. |
| Admin diagnostics | DONE | `/api/diagnostics` and frontend diagnostics page show OK/WARNING/MISSING statuses. |

## 10. Stack and deployment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| React + Vite + TS + Tailwind + shadcn-style UI + Lucide + Recharts | DONE | Frontend stack is present and builds. |
| TanStack Table / React Hook Form / Zod | PARTIAL | Dependencies are installed, but current UI mostly uses local form/table components instead of fully adopting these libraries. |
| NestJS + Prisma + PostgreSQL | DONE | Implemented and builds. |
| JWT, refresh, bcrypt, CORS, Helmet, rate limiting, class-validator | DONE | Core security stack exists. Some query params can still be typed more strictly. |
| Resend with `incidents64.fun` | DONE | Domain is verified in Resend and code uses `noreply@incidents64.fun` as sender. |
| Render API / Worker / Cron docs | DONE | Deployment notes and production env example exist. Runtime deployment still needs final external validation. |
| Upstash Redis | DONE | Notification dedupe uses Upstash Redis when configured; production can require it with `NOTIFICATIONS_REQUIRE_REDIS=true`, and diagnostics performs a real Redis PING. |
| Yandex Object Storage | DONE | Avatar upload requires S3-compatible Yandex Object Storage; diagnostics reports missing credentials instead of treating local fallback as production-ready. |

## Current strongest gaps before final diploma demo

1. Add or replace the local demo microservices with the final real microservices and validate worker checks against them.
2. Fill real Yandex Object Storage credentials before demonstrating avatar upload.
3. Fill real Upstash Redis credentials before production deployment.
4. Do final browser QA on mobile widths.
