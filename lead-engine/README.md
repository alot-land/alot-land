# Sugar Tree lead system — setup and operation

## How a buyer enquiry travels

```
buyer submits the short form on a lot page
        │
        ▼
Netlify Forms  ← PRIMARY RECORD. Stored by Netlify before any of our code runs.
        │        Visible in Netlify → Forms → stv-lead. Survives any bug below.
        ▼
submission-created function
        │  validate → spam check → dedupe → write working record (Netlify Blobs)
        ▼
notify David, Tony, Ryan (email) + Tony (SMS)   → every attempt recorded
acknowledge the buyer (email)                    → recorded, never assumed
        │
        ▼
/lead — agents sign in with Netlify Identity and work the lead
        │
        ▼
lead-sweep (hourly) — reconcile, retry, escalate, report
```

**The two stores are independent on purpose.** If the function below Netlify
Forms breaks, the submission still exists and `lead-sweep` rebuilds the lead
from it. Two writes inside one pipeline would not be a backup.

## Environment variables

Set in Netlify → Site configuration → Environment variables. Never in code.

| Variable | Required | What it does |
|---|---|---|
| `RESEND_API_KEY` | **yes, to notify anyone** | Sends agent alerts, the buyer acknowledgment, escalations and the daily report. Without it every send is recorded as `skipped` and **nobody is told a lead arrived**. |
| `LEAD_FROM_EMAIL` | recommended | e.g. `Alot of Land <leads@alot.land>`. The domain must be verified in Resend. |
| `NETLIFY_API_TOKEN` | **yes, for reconciliation** | Read-only token so the sweep can compare Netlify Forms against the working records. Without it reconciliation is skipped and says so. |
| `PUBLIC_META_PIXEL_ID` | when ads start | Meta Pixel. Unset = no pixel code at all. |
| `LEAD_AGENTS` | optional | Who may open `/lead`. Defaults to David, Tony, Ryan. |
| `LEAD_NOTIFY_OWNER` / `LEAD_NOTIFY_AGENTS` | optional | Override notification recipients. |
| `LEAD_NOTIFY_SMS` | optional | Tony's number. Defaults to +17316072221. |
| `SMS_ENABLED` | **no — leave unset** | Must be `true` before a single text is sent. Keeps costs at zero until approved. |
| `SMS_PROVIDER_URL` / `SMS_PROVIDER_TOKEN` | with SMS | Any provider accepting `{to, message}`. |
| `LEAD_DAILY_REPORT` | optional | `off` disables the daily exception email. |

## Who gets access

`/lead` uses **Netlify Identity**, already live on this site and already
invite-only. Invite Tony and Ryan at Netlify → Identity → Invite users. They set
a password once and stay signed in on their phones. Nobody can self-register,
and the allow-list is enforced server-side on every request — the link in the
SMS names a lead, it does not grant access to it.

## Operating it

- **Daily:** clear anything in the exception email.
- **A lead arrives:** Tony gets a text with a link. He opens it, signs in, calls.
  "No answer" and "Spoke with them" are separate buttons — tapping Call never
  claims a conversation happened.
- **Nobody acknowledges within one business hour** (08:00–20:00): everyone is
  emailed. Opening the lead and marking it stops that.
- **No contact after 24 hours:** flagged in the daily report.
- **Spam** is held, never deleted, and listed for review so a real buyer wrongly
  filtered can be recovered.

## What this system does not claim

Email and SMS providers report *acceptance*, not receipt. A lead showing
"accepted" means the provider took it, not that a human read it. Nothing here
marks an unresolved failure as successful.
