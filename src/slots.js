const express = require("express");
const pool = require("./database");
const { randomUUID, createHash } = require("node:crypto");
const cloudinary = require("./cloudinary");
const { createHmac, randomInt } = require("node:crypto");
const { sendBookingEmails } = require("./booking-email-sender");

const router = express.Router();

async function deliverConfirmedBooking(req, res, slotId) {
  try {
    const result = await sendBookingEmails(
      slotId,
      req.session.ownerId
    );

    return res.json(result);
  } catch (error) {
    console.error(
      "Booking email delivery failed:",
      error.stack || error
    );

    return res.status(202).json({
      bookingConfirmed: true,
      message:
        "Booking is confirmed, but email delivery could not be checked. " +
        "Retry email delivery; do not create another booking.",
    });
  }
}

// Create an opening and save its selected channels.
router.post("/", async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  if (!req.session.ownerId) {
    return res.status(401).json({
      error: "Please reconnect Buffer before saving.",
    });
  }

  const expectedOrigin = new URL(
    process.env.BUFFER_REDIRECT_URI
  ).origin;

  if (req.get("origin") !== expectedOrigin) {
    return res.status(403).json({
      error: "This request did not come from SlotBack.",
    });
  }

  if (!req.is("application/json")) {
    return res.status(415).json({
      error: "Send the opening as JSON.",
    });
  }

  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      error: "Invalid opening.",
    });
  }

  function validText(value, max, required = true) {
    return (
      typeof value === "string" &&
      value.length <= max &&
      (!required || value.trim().length > 0)
    );
  }

  const validId =
    typeof body.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.id
    );

  const validDetails =
    validText(body.businessName, 120) &&
    validText(body.serviceName, 120) &&
    validText(body.location, 250) &&
    validText(body.description, 1000, false);

  const validDuration =
    Number.isInteger(body.durationMinutes) &&
    body.durationMinutes >= 5 &&
    body.durationMinutes <= 1440;

  const validPrice =
    typeof body.price === "string" &&
    /^\d{1,10}(\.\d{1,2})?$/.test(body.price);

  const startsAt = new Date(
    typeof body.startsAt === "string" ? body.startsAt : ""
  );

  const validTime =
    Number.isFinite(startsAt.getTime()) &&
    startsAt.getTime() > Date.now() &&
    body.startsAt === startsAt.toISOString();

  if (
    !validId ||
    !validDetails ||
    !validDuration ||
    !validPrice ||
    !validTime
  ) {
    return res.status(400).json({
      error: "Check the opening details and choose a future time.",
    });
  }

  const supportedServices = new Set([
    "facebook",
    "instagram",
    "twitter",
  ]);

  const knownChannels =
    typeof body.organizationId === "string"
      ? req.session.channelDetailsByOrg?.[body.organizationId]
      : null;

  const channelIds = body.channelIds;

  if (
    !Array.isArray(channelIds) ||
    channelIds.length === 0 ||
    channelIds.length > 50 ||
    channelIds.some((id) => typeof id !== "string") ||
    new Set(channelIds).size !== channelIds.length ||
    !Array.isArray(knownChannels)
  ) {
    return res.status(400).json({
      error: "Reload the dashboard and select your channels again.",
    });
  }

  const selectedChannels = channelIds.map((id) =>
    knownChannels.find(
      (channel) =>
        channel.id === id &&
        supportedServices.has(channel.service)
    )
  );

  if (selectedChannels.some((channel) => !channel)) {
    return res.status(403).json({
      error: "One of the selected channels is unavailable or unsupported.",
    });
  }

  let client;
  let transactionOpen = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionOpen = true;

    const result = await client.query(
      `
        INSERT INTO slots (
          id, owner_id, business_name, service_name,
          description, location, starts_at, timezone,
          duration_minutes, price, currency,
          buffer_organization_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'Africa/Lagos',
          $8, $9, 'NGN', $10
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id, status
      `,
      [
        body.id,
        req.session.ownerId,
        body.businessName.trim(),
        body.serviceName.trim(),
        body.description.trim(),
        body.location.trim(),
        startsAt.toISOString(),
        body.durationMinutes,
        body.price,
        body.organizationId,
      ]
    );

    if (!result.rowCount) {
      const existing = await client.query(
        `
          SELECT id, status
          FROM slots
          WHERE id = $1 AND owner_id = $2
        `,
        [body.id, req.session.ownerId]
      );

      await client.query("ROLLBACK");
      transactionOpen = false;

      if (!existing.rowCount) {
        return res.status(409).json({
          error: "Could not save this opening. Generate a new preview.",
        });
      }

      return res.json({
        slot: existing.rows[0],
      });
    }

    for (const channel of selectedChannels) {
      await client.query(
        `
          INSERT INTO slot_channels (
            slot_id, channel_id, channel_name, service
          )
          VALUES ($1, $2, $3, $4)
        `,
        [body.id, channel.id, channel.name, channel.service]
      );
    }

    await client.query("COMMIT");
    transactionOpen = false;

    res.status(201).json({
      slot: result.rows[0],
    });
  } catch (error) {
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection may already be unavailable.
      }
    }

    next(error);
  } finally {
    client?.release();
  }
});

// Read appointment details for the public customer page.
router.get("/public/:id", async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  const { id } = req.params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    )
  ) {
    return res.status(404).json({
      error: "Opening not found.",
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          id,
          business_name,
          service_name,
          description,
          location,
          starts_at,
          timezone,
          duration_minutes,
          price,
          currency,
          CASE
            WHEN status = 'open' AND starts_at <= CURRENT_TIMESTAMP
              THEN 'expired'
            ELSE status
          END AS status
        FROM slots
        WHERE id = $1
      `,
      [id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Opening not found.",
      });
    }

    res.json({
      slot: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// Submit a customer request.
router.post("/public/:id/requests", async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  const expectedOrigin = new URL(
    process.env.BUFFER_REDIRECT_URI
  ).origin;

  if (req.get("origin") !== expectedOrigin) {
    return res.status(403).json({
      error: "Please submit through the appointment page.",
    });
  }

  const { id } = req.params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    )
  ) {
    return res.status(404).json({
      error: "Opening not found.",
    });
  }

  if (!req.is("application/json")) {
    return res.status(415).json({
      error: "Send the request as JSON.",
    });
  }

  const body = req.body || {};

  const name =
    typeof body.name === "string" ? body.name.trim() : "";

  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

  const message =
    typeof body.message === "string" ? body.message.trim() : "";

  if (
    !name ||
    name.length > 120 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    message.length > 500
  ) {
    return res.status(400).json({
      error:
        "Enter your name, a valid email, and a message under 500 characters.",
    });
  }

  let client;
  let transactionOpen = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionOpen = true;

    const opening = await client.query(
      `
        SELECT status, starts_at
        FROM slots
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (!opening.rowCount) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return res.status(404).json({
        error: "Opening not found.",
      });
    }

    const slot = opening.rows[0];

    if (
      slot.status !== "open" ||
      new Date(slot.starts_at).getTime() <= Date.now()
    ) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return res.status(409).json({
        error: "This opening is no longer accepting requests.",
      });
    }

    await client.query(
      `
        INSERT INTO slot_requests (
          id, slot_id, customer_name, customer_email, message
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `,
      [randomUUID(), id, name, email, message]
    );

    await client.query("COMMIT");
    transactionOpen = false;

    res.json({
      message:
        "Request received. Your booking is not confirmed yet. " +
        "The business will contact you if selected.",
    });
  } catch (error) {
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection may already be unavailable.
      }
    }

    next(error);
  } finally {
    client?.release();
  }
});

// Read the logged-in owner's openings and customer requests.
router.get("/", async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  if (!req.session.ownerId) {
    return res.status(401).json({
      error: "Please reconnect Buffer to view your openings.",
    });
  }

  const { view = null, offset: rawOffset = "0" } = req.query;

  if (view !== null && view !== "open" && view !== "history") {
    return res.status(400).json({
      error: "Choose either the open or history view.",
    });
  }

  if (
    typeof rawOffset !== "string" ||
    !/^\d+$/.test(rawOffset) ||
    !Number.isSafeInteger(Number(rawOffset))
  ) {
    return res.status(400).json({
      error: "The offset must be a non-negative whole number.",
    });
  }

  const pageSize = 5;
  const offset = Number(rawOffset);

  try {
    const result = await pool.query(
      `
        SELECT
          s.id,
          s.service_name,
          s.starts_at,
          s.timezone,
          s.flyer_url,
          CASE
            WHEN s.status = 'open' AND s.starts_at <= CURRENT_TIMESTAMP
              THEN 'expired'
            ELSE s.status
          END AS status,
          (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                 'name', c.channel_name,
'service', c.service,
'status', c.buffer_status,
'postId', c.buffer_post_id
                )
                ORDER BY c.channel_name
              ),
              '[]'::jsonb
            )
            FROM slot_channels c
            WHERE c.slot_id = s.id
          ) AS channels,
          (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', r.id,
                  'name', r.customer_name,
                  'email', r.customer_email,
                  'message', r.message,
                  'status', r.status
                )
                ORDER BY r.created_at
              ),
              '[]'::jsonb
            )
            FROM slot_requests r
            WHERE r.slot_id = s.id
          ) AS requests
        FROM slots s
        WHERE s.owner_id = $1
          AND CASE $2::text
            WHEN 'open' THEN
              s.status = 'open' AND s.starts_at > CURRENT_TIMESTAMP
            WHEN 'history' THEN
              s.status <> 'open' OR s.starts_at <= CURRENT_TIMESTAMP
            ELSE TRUE
          END
        ORDER BY
          CASE WHEN $2::text = 'open' THEN EXISTS (
            SELECT 1
            FROM slot_requests pending
            WHERE pending.slot_id = s.id
              AND pending.status = 'pending'
          ) END DESC,
          CASE WHEN $2::text = 'open' THEN s.starts_at END ASC,
          CASE WHEN $2::text = 'history' THEN s.starts_at END DESC,
          s.created_at DESC,
          s.id ASC
        LIMIT $3 OFFSET $4
      `,
      [
        req.session.ownerId,
        view,
        view === null ? null : pageSize + 1,
        view === null ? 0 : offset,
      ]
    );

    if (view === null) {
      return res.json({ slots: result.rows });
    }

    res.json({
      slots: result.rows.slice(0, pageSize),
      nextOffset:
        result.rows.length > pageSize ? offset + pageSize : null,
    });
  } catch (error) {
    console.error("GET /api/slots failed", {
      code: error.code,
      message: error.message,
      position: error.position,
    });

    next(error);
  }
});

function hashReplyCode(code) {
  return createHmac("sha256", process.env.SESSION_SECRET)
    .update(`slotback-reply-email:${code}`)
    .digest("hex");
}

function canManageReplyEmail(req) {
  return (
    req.get("Origin") ===
    new URL(process.env.BUFFER_REDIRECT_URI).origin
  );
}

// Save a reply address and send its verification code.
router.post("/:slotId/email-sender", async (req, res, next) => {
  const ownerId = req.session.ownerId;
  const { slotId } = req.params;

  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim()
      : "";

  if (!ownerId) {
    return res.status(401).json({
      message: "Sign in first.",
    });
  }

  if (!canManageReplyEmail(req)) {
    return res.status(403).json({
      message: "Open SlotBack and try again.",
    });
  }

  if (
    email.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
  ) {
    return res.status(400).json({
      message: "Enter a valid reply email address.",
    });
  }

  const { RESEND_API_KEY, SLOTBACK_EMAIL_FROM } = process.env;

  if (!RESEND_API_KEY || !SLOTBACK_EMAIL_FROM) {
    return res.status(503).json({
      message: "Email sending is not configured yet.",
    });
  }

  try {
    const opening = await pool.query(
      `SELECT business_name
       FROM slots
       WHERE id::text = $1 AND owner_id = $2`,
      [slotId, ownerId]
    );

    if (!opening.rowCount) {
      return res.status(404).json({
        message: "Opening not found.",
      });
    }

    const { business_name: businessName } = opening.rows[0];

    const code = String(randomInt(0, 1000000)).padStart(6, "0");

    const saved = await pool.query(
      `INSERT INTO business_email_senders AS sender (
         owner_id, business_name, sender_email, reply_code_hash,
         reply_code_expires_at, reply_code_requested_at
       )
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes', NOW())
       ON CONFLICT (owner_id, business_name) DO UPDATE SET
         sender_email = EXCLUDED.sender_email,
         verified_at = NULL,
         reply_code_hash = EXCLUDED.reply_code_hash,
         reply_code_expires_at = EXCLUDED.reply_code_expires_at,
         reply_code_requested_at = EXCLUDED.reply_code_requested_at,
         reply_code_attempts = 0
       WHERE (
           sender.sender_email <> EXCLUDED.sender_email
           OR sender.verified_at IS NULL
         )
         AND (
           sender.reply_code_requested_at IS NULL OR
           sender.reply_code_requested_at <= NOW() - INTERVAL '1 minute'
         )
       RETURNING sender_email`,
      [ownerId, businessName, email, hashReplyCode(code)]
    );

    if (!saved.rowCount) {
      const existing = await pool.query(
        `SELECT sender_email, verified_at
         FROM business_email_senders
         WHERE owner_id = $1 AND business_name = $2`,
        [ownerId, businessName]
      );

      if (
        existing.rows[0]?.sender_email === email &&
        existing.rows[0]?.verified_at
      ) {
        return res.json({
          senderEmail: email,
          senderVerified: true,
        });
      }

      return res.status(429).json({
        message: "Wait one minute before requesting another code.",
      });
    }

    try {
      const response = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: SLOTBACK_EMAIL_FROM,
            to: [email],
            subject: "Verify your SlotBack reply email",
            text:
              `Your SlotBack verification code is ${code}. ` +
              "It expires in 10 minutes.",
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        console.error(
          "Resend verification request failed:",
          response.status
        );

        return res.status(502).json({
          message:
            "Could not send the code. Check the address and try again in a minute.",
        });
      }
    } catch (error) {
      console.error(
        "Resend verification request failed:",
        error.name
      );

      return res.status(502).json({
        message:
          "Could not confirm the code was sent. Check your inbox or retry in a minute.",
      });
    }

    return res.json({
      senderEmail: email,
      senderVerified: false,
      codeSent: true,
    });
  } catch (error) {
    return next(error);
  }
});

// Verify the business's reply address.
router.post("/:slotId/email-sender/verify", async (req, res, next) => {
  const ownerId = req.session.ownerId;

  const code =
    typeof req.body?.code === "string"
      ? req.body.code.trim()
      : "";

  if (!ownerId) {
    return res.status(401).json({
      message: "Sign in first.",
    });
  }

  if (!canManageReplyEmail(req)) {
    return res.status(403).json({
      message: "Open SlotBack and try again.",
    });
  }

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({
      message: "Enter the six-digit code.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE business_email_senders AS sender
       SET verified_at = CASE
             WHEN sender.reply_code_hash = $3 THEN NOW()
           END,
           reply_code_attempts = sender.reply_code_attempts + 1,
           reply_code_hash = CASE
             WHEN sender.reply_code_hash <> $3 THEN sender.reply_code_hash
           END
       FROM slots
       WHERE slots.id::text = $1 AND slots.owner_id = $2
         AND sender.owner_id = slots.owner_id
         AND sender.business_name = slots.business_name
         AND sender.verified_at IS NULL
         AND sender.reply_code_hash IS NOT NULL
         AND sender.reply_code_expires_at > NOW()
         AND sender.reply_code_attempts < 5
       RETURNING sender.sender_email, sender.verified_at`,
      [req.params.slotId, ownerId, hashReplyCode(code)]
    );

    const sender = result.rows[0];

    if (!sender?.verified_at) {
      return res.status(400).json({
        message:
          "The code is incorrect, expired, or has reached its attempt limit.",
      });
    }

    return res.json({
      senderEmail: sender.sender_email,
      senderVerified: true,
    });
  } catch (error) {
    return next(error);
  }
});

// Load the details used to prepare the booking emails.
router.get(
  "/:slotId/requests/:requestId/email-preview",
  async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    const ownerId = req.session.ownerId;

    if (!ownerId) {
      return res.status(401).json({
        error: "Sign in to review booking emails.",
      });
    }

    const { slotId, requestId } = req.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      !uuidPattern.test(slotId) ||
      !uuidPattern.test(requestId)
    ) {
      return res.status(404).json({
        error: "Opening or request not found.",
      });
    }

    try {
      const { rows: [preview] } = await pool.query(
        `SELECT
           s.business_name AS "businessName",
           s.service_name AS "serviceName",
           s.starts_at AS "startsAt",
           s.timezone AS "timeZone",
           s.location,
           sender.sender_email AS "senderEmail",
           (sender.verified_at IS NOT NULL) AS "senderVerified",
           r.customer_name AS "customerName",
           r.customer_email AS "customerEmail",
           (
             SELECT COUNT(*)::integer
             FROM slot_requests AS other
             WHERE other.slot_id = s.id
               AND other.id <> r.id
               AND other.status = 'pending'
           ) AS "otherApplicantCount"
         FROM slots AS s
         JOIN slot_requests AS r ON r.slot_id = s.id
         LEFT JOIN business_email_senders AS sender
           ON sender.owner_id = s.owner_id
          AND sender.business_name = s.business_name
         WHERE s.id = $1
           AND r.id = $2
           AND s.owner_id = $3
           AND s.status = 'open'
           AND s.starts_at > CURRENT_TIMESTAMP
           AND r.status = 'pending'`,
        [slotId, requestId, ownerId]
      );

      if (!preview) {
        return res.status(404).json({
          error:
            "This request is no longer available to confirm. Refresh requests.",
        });
      }

      res.json({ preview });
    } catch (error) {
      next(error);
    }
  }
);

// Confirm a customer after reviewing the notification emails.
router.post(
  "/:slotId/requests/:requestId/confirm",
  async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (!req.session.ownerId) {
      return res.status(401).json({
        error: "Please reconnect Buffer before confirming a customer.",
      });
    }

    const expectedOrigin = new URL(
      process.env.BUFFER_REDIRECT_URI
    ).origin;

    if (req.get("origin") !== expectedOrigin) {
      return res.status(403).json({
        error: "Please confirm through your SlotBack dashboard.",
      });
    }

    const { slotId, requestId } = req.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      !uuidPattern.test(slotId) ||
      !uuidPattern.test(requestId)
    ) {
      return res.status(404).json({
        error: "Opening or request not found.",
      });
    }

    function rejectRequest(status, message) {
      throw Object.assign(new Error(message), { status });
    }

    let client;
    let transactionOpen = false;

    try {
      client = await pool.connect();

      await client.query("BEGIN");
      transactionOpen = true;

      const openingResult = await client.query(
        `
          SELECT id, status, starts_at, business_name
          FROM slots
          WHERE id = $1 AND owner_id = $2
          FOR UPDATE
        `,
        [slotId, req.session.ownerId]
      );

      if (!openingResult.rowCount) {
        rejectRequest(404, "Opening not found.");
      }

      const slot = openingResult.rows[0];

      const requestResult = await client.query(
        `
          SELECT id, status, customer_email
          FROM slot_requests
          WHERE id = $1 AND slot_id = $2
          FOR UPDATE
        `,
        [requestId, slotId]
      );

      if (!requestResult.rowCount) {
        rejectRequest(404, "Customer request not found.");
      }

      const request = requestResult.rows[0];

      if (
        slot.status === "filled" &&
        request.status === "confirmed"
      ) {
        await client.query("COMMIT");
        transactionOpen = false;

        client.release();
        client = null;

        return await deliverConfirmedBooking(req, res, slotId);
      }

      if (
        slot.status !== "open" ||
        new Date(slot.starts_at).getTime() <= Date.now()
      ) {
        rejectRequest(409, "This opening is no longer available.");
      }

      if (request.status !== "pending") {
        rejectRequest(409, "This request is no longer pending.");
      }

      const bookingEmails = req.body?.bookingEmails;
      let queuedEmailCount = 0;

      if (
        !bookingEmails ||
        typeof bookingEmails !== "object" ||
        Array.isArray(bookingEmails)
      ) {
        rejectRequest(
          400,
          "Review the booking emails and verify your reply email before confirming."
        );
      }

      {
        const { replyEmail, confirmed, declined } = bookingEmails;

        const validDraft = (draft) =>
          typeof draft?.subject === "string" &&
          draft.subject.trim().length > 0 &&
          draft.subject.trim().length <= 200 &&
          !/[\r\n]/.test(draft.subject) &&
          typeof draft.body === "string" &&
          draft.body.trim().length > 0 &&
          draft.body.length <= 10000;

        if (!validDraft(confirmed)) {
          rejectRequest(
            400,
            "Enter a subject and message for the selected customer."
          );
        }

        if (!request.customer_email?.trim()) {
          rejectRequest(
            400,
            "The selected customer has no email address."
          );
        }

        const senderResult = await client.query(
          `SELECT sender_email
           FROM business_email_senders
           WHERE owner_id = $1 AND business_name = $2
             AND verified_at IS NOT NULL
           FOR SHARE`,
          [req.session.ownerId, slot.business_name]
        );

        const verifiedReplyEmail =
          senderResult.rows[0]?.sender_email;

        if (
          !verifiedReplyEmail ||
          verifiedReplyEmail !== replyEmail
        ) {
          rejectRequest(
            409,
            "Verify your current reply email and reopen the review."
          );
        }

        const applicantResult = await client.query(
          `SELECT id, customer_email
           FROM slot_requests
           WHERE slot_id = $1
             AND status = 'pending'
             AND id <> $2
           ORDER BY created_at, id`,
          [slotId, requestId]
        );

        const selectedEmail = request.customer_email.trim();

        const recipients = new Set([
          selectedEmail.toLowerCase(),
        ]);

        const messages = [
          {
            request_id: requestId,
            recipient_email: selectedEmail,
            subject: confirmed.subject.trim(),
            body: confirmed.body.trim(),
          },
        ];

        for (const applicant of applicantResult.rows) {
          const email = applicant.customer_email?.trim();

          if (
            !email ||
            recipients.has(email.toLowerCase())
          ) {
            continue;
          }

          if (!validDraft(declined)) {
            rejectRequest(
              400,
              "Enter a subject and message for the other applicants."
            );
          }

          recipients.add(email.toLowerCase());

          messages.push({
            request_id: applicant.id,
            recipient_email: email,
            subject: declined.subject.trim(),
            body: declined.body.trim(),
          });
        }

        const queued = await client.query(
          `INSERT INTO booking_email_outbox (
             request_id, business_name, recipient_email,
             reply_email, subject, body
           )
           SELECT message.request_id, $2, message.recipient_email, $3,
                  message.subject, message.body
           FROM jsonb_to_recordset($1::jsonb) AS message(
             request_id UUID,
             recipient_email TEXT,
             subject TEXT,
             body TEXT
           )`,
          [
            JSON.stringify(messages),
            slot.business_name,
            verifiedReplyEmail,
          ]
        );

        queuedEmailCount = queued.rowCount;
      }

      await client.query(
        `
          UPDATE slot_requests
          SET status = 'confirmed'
          WHERE id = $1 AND slot_id = $2
        `,
        [requestId, slotId]
      );

      await client.query(
        `
          UPDATE slot_requests
          SET status = 'declined'
          WHERE slot_id = $1
            AND id <> $2
            AND status = 'pending'
        `,
        [slotId, requestId]
      );

      await client.query(
        `
          UPDATE slots
          SET status = 'filled'
          WHERE id = $1 AND owner_id = $2
        `,
        [slotId, req.session.ownerId]
      );

      await client.query("COMMIT");
      transactionOpen = false;

      if (queuedEmailCount > 0) {
        client.release();
        client = null;

        return await deliverConfirmedBooking(req, res, slotId);
      }

      return res.json({
        message:
          "Customer confirmed and opening filled. Contact the customer " +
          "using their email to arrange the appointment.",
      });
    } catch (error) {
      if (client && transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The database connection may already be unavailable.
        }
      }

      if ([400, 404, 409].includes(error.status)) {
        return res.status(error.status).json({
          error: error.message,
        });
      }

      return next(error);
    } finally {
      client?.release();
    }
  }
);

// Retry delivery for an already-confirmed opening.
router.post(
  "/:slotId/booking-emails/send",
  async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (!req.session.ownerId) {
      return res.status(401).json({
        error: "Sign in first.",
      });
    }

    if (!canManageReplyEmail(req)) {
      return res.status(403).json({
        error: "Use your SlotBack dashboard.",
      });
    }

    try {
      const result = await sendBookingEmails(
        req.params.slotId,
        req.session.ownerId
      );

      return res.json(result);
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({
          error: error.message,
        });
      }

      return next(error);
    }
  }
);

// Upload an opening's flyer.
router.post(
  "/:slotId/flyer",
  express.raw({ type: "image/jpeg", limit: "1mb" }),
  async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    const ownerId = req.session.ownerId;

    if (!ownerId) {
      return res.status(401).json({
        error: "Reconnect Buffer before saving your flyer.",
      });
    }

    const expectedOrigin = new URL(
      process.env.BUFFER_REDIRECT_URI
    ).origin;

    if (req.get("origin") !== expectedOrigin) {
      return res.status(403).json({
        error: "Upload the flyer from your SlotBack dashboard.",
      });
    }

    const { slotId } = req.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(slotId)) {
      return res.status(404).json({
        error: "Opening not found.",
      });
    }

    const image = req.body;

    if (
      !req.is("image/jpeg") ||
      !Buffer.isBuffer(image) ||
      image.length < 4 ||
      image[0] !== 0xff ||
      image[1] !== 0xd8 ||
      image[2] !== 0xff
    ) {
      return res.status(400).json({
        error: "Generate a JPEG flyer and try again.",
      });
    }

    try {
      const opening = await pool.query(
        `
          SELECT flyer_url
          FROM slots
          WHERE id = $1 AND owner_id = $2
        `,
        [slotId, ownerId]
      );

      if (!opening.rowCount) {
        return res.status(404).json({
          error: "Opening not found.",
        });
      }

      if (opening.rows[0].flyer_url) {
        return res.json({
          flyerUrl: opening.rows[0].flyer_url,
        });
      }

      const imageHash = createHash("sha256")
        .update(image)
        .digest("hex");

      let uploaded;

      try {
        uploaded = await cloudinary.uploader.upload(
          `data:image/jpeg;base64,${image.toString("base64")}`,
          {
            resource_type: "image",
            public_id: `slotback-${slotId}-${imageHash}`,
            allowed_formats: ["jpg", "jpeg"],
            overwrite: false,
            timeout: 15000,
          }
        );
      } catch (error) {
        const status = Number(error?.http_code);

        let detail = String(
          error?.message ||
          error?.error?.message ||
          "No details returned"
        );

        for (const value of [
          process.env.CLOUDINARY_API_KEY,
          process.env.CLOUDINARY_API_SECRET,
        ]) {
          if (value) {
            detail = detail.replaceAll(value, "[redacted]");
          }
        }

        console.error(
          "Cloudinary upload failed:",
          status || "unknown",
          detail
        );

        const message = [401, 403].includes(status)
          ? "Cloudinary denied the upload. Check the API key and its upload permissions."
          : "Cloudinary could not save your flyer. Try again.";

        return res.status(502).json({
          error: message,
        });
      }

      if (!uploaded.secure_url?.startsWith("https://")) {
        return res.status(502).json({
          error: "Cloudinary did not return an HTTPS image link.",
        });
      }

      const saved = await pool.query(
        `
          UPDATE slots
          SET flyer_url = COALESCE(flyer_url, $3)
          WHERE id = $1 AND owner_id = $2
          RETURNING flyer_url
        `,
        [slotId, ownerId, uploaded.secure_url]
      );

      if (!saved.rowCount) {
        return res.status(404).json({
          error: "Opening not found.",
        });
      }

      res.json({
        flyerUrl: saved.rows[0].flyer_url,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.use("/", require("./publishing"));

module.exports = router;
