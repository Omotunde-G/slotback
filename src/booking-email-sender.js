const pool = require("./database");
const { createHash } = require("node:crypto");

async function sendBookingEmails(slotId, ownerId) {
  const client = await pool.connect();
  let transactionOpen = false;
  let issue = null;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    await client.query("SET LOCAL lock_timeout = '3s'");

    // Check ownership and prevent simultaneous delivery for this opening.
    const opening = await client.query(
      `SELECT id
       FROM slots
       WHERE id::text = $1
         AND owner_id = $2
         AND status = 'filled'
       FOR UPDATE`,
      [slotId, ownerId]
    );

    if (!opening.rowCount) {
      throw Object.assign(
        new Error("Confirmed opening not found."),
        { status: 404 }
      );
    }

    const result = await client.query(
      `SELECT o.*,
              o.created_at > NOW() - INTERVAL '23 hours' AS retry_safe
       FROM booking_email_outbox o
       JOIN slot_requests r ON r.id = o.request_id
       WHERE r.slot_id = $1
       ORDER BY o.request_id
       FOR UPDATE OF o`,
      [slotId]
    );

    const rows = result.rows;
    const fromAddress = process.env.SLOTBACK_EMAIL_FROM?.trim();
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const deadline = Date.now() + 20000;

    // Stable groups prevent retries from accidentally changing a batch.
    for (let start = 0; start < rows.length; start += 100) {
      const batch = rows.slice(start, start + 100);
      const pending = batch.filter((row) => !row.sent_at);

      if (!pending.length) continue;

      // Older or partially processed batches require a log check first.
      if (
        pending.length !== batch.length ||
        pending.some((row) => !row.retry_safe)
      ) {
        issue =
          "Email history needs review before retrying. " +
          "Check Resend logs first.";
        break;
      }

      if (
        !apiKey ||
        !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(fromAddress || "")
      ) {
        issue =
          "Check RESEND_API_KEY and the bare email address " +
          "in SLOTBACK_EMAIL_FROM.";
        break;
      }

      if (Date.now() >= deadline) {
        issue =
          "Some emails remain queued. Retry delivery to continue.";
        break;
      }

      const key = createHash("sha256")
        .update(batch.map((row) => row.request_id).join(","))
        .digest("hex");

      let data;

      try {
        const response = await fetch(
          "https://api.resend.com/emails/batch",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `slotback-booking-v1/${key}`,
            },
            body: JSON.stringify(
              batch.map((row) => ({
                from: `SLOTBACK <${fromAddress}>`,
                to: [row.recipient_email],
                reply_to: row.reply_email,
                subject: row.subject,
                text: row.body,
              }))
            ),
            signal: AbortSignal.timeout(10000),
          }
        );

        data = await response.json();

        if (!response.ok) {
          console.error(
            "Booking email provider error:",
            response.status,
            data.name
          );

          issue =
            `Resend did not accept the batch (HTTP ${response.status}). ` +
            "Check Resend logs, then retry delivery.";
          break;
        }

        if (
          !Array.isArray(data.data) ||
          data.data.length !== batch.length ||
          data.data.some(
            (email) => typeof email.id !== "string" || !email.id
          )
        ) {
          throw new Error("Unexpected email response");
        }
      } catch (error) {
        console.error(
          "Booking email response uncertain:",
          error.name
        );

        issue =
          "Email delivery could not be confirmed. " +
          "Retry delivery using the saved emails.";
        break;
      }

      // Record acceptance only after Resend returns message IDs.
      await client.query(
        `UPDATE booking_email_outbox AS o
         SET sent_at = NOW(),
             provider_message_id = sent.provider_id
         FROM jsonb_to_recordset($1::jsonb)
           AS sent(request_id UUID, provider_id TEXT)
         WHERE o.request_id = sent.request_id
           AND o.sent_at IS NULL`,
        [
          JSON.stringify(
            batch.map((row, index) => ({
              request_id: row.request_id,
              provider_id: data.data[index].id,
            }))
          ),
        ]
      );

      batch.forEach((row) => {
        row.sent_at = true;
      });
    }

    await client.query("COMMIT");
    transactionOpen = false;

    const acceptedEmailCount = rows.filter(
      (row) => row.sent_at
    ).length;

    const queuedEmailCount = rows.length - acceptedEmailCount;

    return {
      bookingConfirmed: true,
      acceptedEmailCount,
      queuedEmailCount,
      message: !rows.length
        ? "Booking confirmed. No notification emails were queued for this booking."
        : queuedEmailCount
          ? `Booking confirmed. ${acceptedEmailCount} email(s) accepted by Resend; ${queuedEmailCount} still queued. ${
              issue || "Retry delivery to continue."
            }`
          : `Booking confirmed. Resend accepted all ${acceptedEmailCount} customer email(s) for delivery.`,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The database connection may already be unavailable.
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = { sendBookingEmails };
