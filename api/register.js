const crypto = require("crypto");

function supabaseHeaders(secret, extra = {}) {
  const headers = { apikey: secret, "Content-Type": "application/json", ...extra };
  if (!secret.startsWith("sb_secret_")) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailHtml(accessUrl) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#202124">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px">
        <tr><td style="padding:0 0 22px 0">
          <div style="font-size:18px;font-weight:600;color:#202124">Archive Recovery Initiative</div>
          <div style="font-size:13px;color:#6b7280;margin-top:3px">Recovered Records Office</div>
        </td></tr>

        <tr><td style="font-size:15px;line-height:1.6;color:#202124">
          <p style="margin:0 0 16px 0">Thank you for your submission.</p>

          <p style="margin:0 0 16px 0">
            A corresponding record has been identified within the recovered archive of St. Maren Hospital.
          </p>

          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0;font-size:14px;line-height:1.7">
            <tr><td style="padding-right:22px;color:#5f6368">Match status</td><td style="font-weight:600">Confirmed</td></tr>
            <tr><td style="padding-right:22px;color:#5f6368">Record classification</td><td>Patient</td></tr>
            <tr><td style="padding-right:22px;color:#5f6368">Archive status</td><td>Incomplete</td></tr>
            <tr><td style="padding-right:22px;color:#5f6368">Archive reference</td><td style="font-family:'Courier New',monospace">19-8/04-71-3</td></tr>
          </table>

          <p style="margin:0 0 16px 0">
            Due to the condition of the recovered material, portions of the record may be missing, altered or incorrectly indexed.
          </p>

          <p style="margin:20px 0;font-weight:600">
            Some recovered records may contain information that appears unfamiliar to you.
          </p>

          <p style="margin:0 0 24px 0">
            Temporary access has been granted to the surviving material associated with this record.
          </p>

          <p style="margin:28px 0 30px 0">
            <a href="${escapeHtml(accessUrl)}"
               style="display:inline-block;background:#1a73e8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:4px">
              ACCESS RECORD
            </a>
          </p>

          <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5">
            This message was generated automatically by the Archive Recovery Initiative electronic index.
            Replies are not monitored.
          </p>

          <p style="margin:18px 0 0 0;font-size:11px;color:#9aa0a6">
            Archive Recovery Initiative
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#9f1919;margin-left:6px;vertical-align:0"></span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY,
    BASE_URL,
    ST_MAREN_URL,
    RESEND_FROM,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !BASE_URL) {
    console.error("Missing required environment variables");
    return res.status(500).json({ ok: false, error: "server_not_configured" });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "invalid_email" });
  }

  try {
    const recentUrl =
      `${SUPABASE_URL}/rest/v1/players?email=eq.${encodeURIComponent(email)}` +
      `&select=id,created_at&order=created_at.desc&limit=1`;

    const recentResponse = await fetch(recentUrl, {
      headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY),
    });

    if (recentResponse.ok) {
      const recent = await recentResponse.json();
      if (recent?.[0]?.created_at) {
        const ageMs = Date.now() - new Date(recent[0].created_at).getTime();
        if (ageMs >= 0 && ageMs < 5 * 60 * 1000) {
          return res.status(200).json({ ok: true });
        }
      }
    }

    const playerId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/players`, {
      method: "POST",
      headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, { Prefer: "return=representation" }),
      body: JSON.stringify({
        id: playerId,
        email,
        created_at: createdAt,
        current_day: 0,
        token,
        next_release_at: null,
      }),
    });

    if (!insertResponse.ok) {
      const details = await insertResponse.text();
      console.error("Supabase insert failed:", insertResponse.status, details);
      return res.status(500).json({ ok: false, error: "archive_write_failed" });
    }

    const base = String(ST_MAREN_URL || BASE_URL).replace(/\/+$/, "");
    const accessUrl = ST_MAREN_URL
      ? `${base}/?token=${encodeURIComponent(token)}`
      : `${base}/record.html?token=${encodeURIComponent(token)}`;

    const scheduledAt = new Date(Date.now() + 60 * 1000).toISOString();
    const from = RESEND_FROM || "Archive Recovery Unit <onboarding@resend.dev>";

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `c17-match-${playerId}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Record Match Confirmed",
        html: emailHtml(accessUrl),
        scheduled_at: scheduledAt,
        tags: [
          { name: "project", value: "c17" },
          { name: "stage", value: "day0_match" },
        ],
      }),
    });

    if (!resendResponse.ok) {
      const details = await resendResponse.text();
      console.error("Resend scheduling failed:", resendResponse.status, details);
      return res.status(500).json({ ok: false, error: "mail_schedule_failed" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
