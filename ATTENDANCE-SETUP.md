# King Academy Attendance Management — Safe Rollout

This feature is being developed on `feature/attendance-management`. The production `main` branch is not changed by these commits.

## What this feature adds

- PostgreSQL `attendance_records` table created with `CREATE TABLE IF NOT EXISTS` and an additive index.
- One attendance status per student per date: Present, Absent, Late, or Excused.
- Date and grade filters, search, optional notes, bulk save, attendance summary cards, and daily CSV export.
- Admin and teacher login configured through Render environment variables.
- Administrator-only student create/edit/status/delete, marks entry/deletion, subject management, and data exports.
- A premium navy, white, and gold attendance dashboard with a classroom photo background.

## Required Render environment variables

Keep the existing `DATABASE_URL` unchanged. Configure these in Render → service → Environment:

- `ADMIN_USERNAME` — e.g. a private administrator username.
- `ADMIN_PASSWORD` — a strong unique password.
- `TEACHER_USERNAME` — a separate teacher username.
- `TEACHER_PASSWORD` — a strong unique password.
- `SESSION_SECRET` — a long random secret, if not already configured.

Do not commit passwords or connection strings to GitHub. Do not send them in chat.

## Safe deployment sequence

1. Back up/export existing student data before any production rollout.
2. Deploy this branch to a separate Render preview service if available, pointed at a **separate test Neon database**. Do not test migrations against the live production database first.
3. Confirm the new attendance table exists and student counts match the test database.
4. Test admin and teacher login, marking attendance, refreshing, signing out/in, and CSV export.
5. Confirm teachers receive HTTP 403 for administrator-only operations.
6. Only after successful testing, open a pull request and review the diff before merging to `main`.
7. After production deploy, test one clearly labeled test record and remove it only through the normal UI after verifying it is not real data.

## Data safety notes

The attendance schema is additive. It does not drop, truncate, reseed, or rewrite existing student/marks records. Attendance references students with `ON DELETE RESTRICT` so a student with attendance history cannot be deleted accidentally without a deliberate data-management decision.

The Express in-memory session store warning remains a separate production-hardening task; sessions can be lost on server restart. Use a persistent session store before relying on long-lived staff sessions.
