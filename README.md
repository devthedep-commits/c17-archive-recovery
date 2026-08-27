# C17 — Archive Recovery Initiative v2

This version connects the public email form to Supabase and schedules the first match email via Resend for about 60 seconds later.

## Required Vercel env vars
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- RESEND_API_KEY
- BASE_URL

Optional:
- RESEND_FROM
- ST_MAREN_URL

For testing, if RESEND_FROM is omitted the code uses `Archive Recovery Unit <onboarding@resend.dev>`. Once ArchiveRecovery.org is verified in Resend, set e.g. `RESEND_FROM=Archive Recovery Unit <records@archiverecovery.org>`.

When StMarenHospital.org is ready, set `ST_MAREN_URL=https://stmarenhospital.org`. Until then ACCESS RECORD opens `record.html`.

Expected Supabase `players` columns: id uuid, email text, created_at timestamptz, current_day int4, next_release_at timestamptz nullable, token uuid.

QStash is not used for this 1-minute email because Resend supports scheduled transactional emails directly. Keep QStash for later timed game jobs.
