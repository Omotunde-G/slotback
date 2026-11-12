const express = require("express");
const pool = require("./database");
const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");

  const { ownerId, buffer } = req.session;

  if (
    !ownerId ||
    !buffer?.accessToken ||
    buffer.expiresAt <= Date.now()
  ) {
    return res.status(401).json({
      error: "Reconnect Buffer and try again.",
    });
  }

  const expectedOrigin = new URL(
    process.env.BUFFER_REDIRECT_URI
  ).origin;

  if (
    req.method !== "GET" &&
    req.get("origin") !== expectedOrigin
  ) {
    return res.status(403).json({
      error: "Use your SlotBack dashboard.",
    });
  }

  next();
});

async function bufferAPI(token, query, input) {
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { input },
    }),
    signal: AbortSignal.timeout(8000),
  });

  const body = await response.json();

  if (!response.ok || body.errors?.length) {
    throw new Error(
      body.errors?.[0]?.message ||
      `Buffer returned HTTP ${response.status}.`
    );
  }

  return body.data;
}

async function readOpening(req) {
  const id = req.params.slotId;

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(id)) {
    throw Object.assign(new Error("Opening not found."), {
      status: 404,
    });
  }

  const result = await pool.query(
    `
      SELECT
        id,
        business_name,
        service_name,
        starts_at,
        duration_minutes,
        price,
        location,
        status,
        flyer_url
      FROM slots
      WHERE id = $1 AND owner_id = $2
    `,
    [id, req.session.ownerId]
  );

  if (!result.rowCount) {
    throw Object.assign(new Error("Opening not found."), {
      status: 404,
    });
  }

  const opening = result.rows[0];

  opening.channels = (
    await pool.query(
      `
        SELECT
          channel_id AS id,
          channel_name AS name,
          service,
          buffer_post_id AS "postId",
          buffer_status AS status
        FROM slot_channels
        WHERE slot_id = $1
        ORDER BY channel_name, channel_id
      `,
      [id]
    )
  ).rows;

  const origin = new URL(
    process.env.PUBLIC_APP_URL ||
    process.env.BUFFER_REDIRECT_URI
  ).origin;

  const bookingUrl = new URL("/slot.html", origin);
  bookingUrl.searchParams.set("id", id);

  opening.bookingUrl = bookingUrl.href;

  const appointmentDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(opening.starts_at));

  opening.caption =
    `Opening available: ${opening.service_name}\n` +
    `${appointmentDate} WAT`;

  return opening;
}

function fail(error, res, next) {
  if (error.status) {
    return res.status(error.status).json({
      error: error.message,
    });
  }

  return next(error);
}

router.get(
  "/:slotId/publishing-preview",
  async (req, res, next) => {
    try {
      return res.json(await readOpening(req));
    } catch (error) {
      return fail(error, res, next);
    }
  }
);

router.post("/:slotId/publish", async (req, res, next) => {
  try {
    const opening = await readOpening(req);

    const {
      action,
      caption,
      channelIds,
      dueAt,
    } = req.body || {};

    function reject(message, status = 400) {
      throw Object.assign(new Error(message), { status });
    }

    if (!["draft", "now", "schedule"].includes(action)) {
      reject("Choose a publishing option.");
    }

    if (
      opening.status !== "open" ||
      new Date(opening.starts_at).getTime() <= Date.now()
    ) {
      reject("This opening is no longer available.", 409);
    }

    if (
      typeof caption !== "string" ||
      !caption.trim() ||
      caption.length > 5000
    ) {
      reject("Enter a caption of 1–5,000 characters.");
    }

    if (
      !Array.isArray(channelIds) ||
      !channelIds.length ||
      channelIds.some(
        id => !opening.channels.some(channel => channel.id === id)
      )
    ) {
      reject("Choose at least one saved channel.");
    }

    const scheduled =
      typeof dueAt === "string" ? new Date(dueAt) : null;

    if (
      action === "schedule" &&
      (
        !scheduled ||
        !Number.isFinite(scheduled.getTime()) ||
        scheduled.getTime() < Date.now() + 60000 ||
        scheduled >= new Date(opening.starts_at)
      )
    ) {
      reject(
        "Schedule at least one minute ahead and before the appointment."
      );
    }

    if (
      !opening.flyer_url?.startsWith(
        "https://res.cloudinary.com/"
      )
    ) {
      reject("Save the flyer first.", 409);
    }

    const host = new URL(opening.bookingUrl).hostname;

    if (
      action !== "draft" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(host)
    ) {
      reject(
        "Post from the deployed site so customers can open the booking link."
      );
    }

    const text =
      `${caption.trim()}\n\n` +
      `Request this opening:\n${opening.bookingUrl}`;

    const results = [];
    const deadline = Date.now() + 18000;

    const selectedChannels = opening.channels.filter(
      channel => channelIds.includes(channel.id)
    );

    for (const channel of selectedChannels) {
      if (Date.now() > deadline) {
        results.push({
          channel: channel.name,
          message:
            "Not attempted yet. Review and send this channel again.",
        });

        continue;
      }

      const editable =
        channel.postId && channel.status === "draft";

      const fresh =
        !channel.postId &&
        [null, "rejected"].includes(channel.status);

      if (!editable && !fresh) {
        results.push({
          channel: channel.name,
          message:
            "Already submitted or needs checking in Buffer. No duplicate created.",
        });

        continue;
      }

      // Only one request can claim this channel at a time.
      const claim = await pool.query(
        `
          UPDATE slot_channels c
          SET buffer_status = 'submitting'
          FROM slots s
          WHERE c.slot_id = s.id
            AND s.id = $1
            AND s.owner_id = $2
            AND s.status = 'open'
            AND s.starts_at > NOW()
            AND c.channel_id = $3
            AND c.buffer_post_id IS NOT DISTINCT FROM $4
            AND c.buffer_status IS NOT DISTINCT FROM $5
          RETURNING c.channel_id
        `,
        [
          opening.id,
          req.session.ownerId,
          channel.id,
          channel.postId,
          channel.status,
        ]
      );

      if (!claim.rowCount) {
        results.push({
          channel: channel.name,
          message:
            "Changed or being submitted. Refresh before trying again.",
        });

        continue;
      }

      let postId = channel.postId;
      let status = "unknown";
      let message =
        "Result uncertain. Check Buffer before retrying.";

      let mutationStarted = false;

      try {
        let maySend = true;

        // Check that an existing draft has not already been
        // scheduled or published directly inside Buffer.
        if (editable) {
          const current = await bufferAPI(
            req.session.buffer.accessToken,
            `
              query CurrentPost($input: PostInput!) {
                post(input: $input) {
                  id
                  status
                }
              }
            `,
            { id: postId }
          );

          if (!current?.post) {
            throw new Error(
              "Could not check the existing draft."
            );
          }

          if (current.post.status !== "draft") {
            status = current.post.status;
            message =
              `Already ${status} in Buffer. No changes made.`;

            maySend = false;
          }
        }

        if (maySend) {
          if (
            action === "schedule" &&
            scheduled.getTime() <= Date.now()
          ) {
            throw new Error(
              "The scheduled time has passed. Choose a later time."
            );
          }

          const field = editable ? "editPost" : "createPost";
          const inputType = editable
            ? "EditPostInput"
            : "CreatePostInput";

          const input = {
            ...(editable
              ? { id: postId }
              : {
                  channelId: channel.id,
                  needsApproval: false,
                }),

            text,

            assets: [
              {
                image: {
                  url: opening.flyer_url,
                },
              },
            ],

            mode:
              action === "now"
                ? "shareNow"
                : action === "schedule"
                  ? "customScheduled"
                  : "addToQueue",

            saveToDraft: action === "draft",
            schedulingType: "automatic",

            ...(action === "schedule"
              ? { dueAt: scheduled.toISOString() }
              : {}),

            ...(channel.service === "facebook"
              ? {
                  metadata: {
                    facebook: {
                      type: "post",
                    },
                  },
                }
              : {}),

            ...(channel.service === "instagram"
              ? {
                  metadata: {
                    instagram: {
                      type: "post",
                      shouldShareToFeed: true,
                    },
                  },
                }
              : {}),
          };

          mutationStarted = true;

          const data = await bufferAPI(
            req.session.buffer.accessToken,
            `
              mutation PublishOpening($input: ${inputType}!) {
                ${field}(input: $input) {
                  ... on PostActionSuccess {
                    post {
                      id
                      status
                    }
                  }
                  ... on MutationError {
                    message
                  }
                }
              }
            `,
            input
          );

          const outcome = data?.[field];

          if (outcome?.post?.id) {
            postId = outcome.post.id;
            status = outcome.post.status || "unknown";

            const messages = {
              draft: "Draft saved.",
              scheduled: "Accepted by Buffer for publishing.",
              sending: "Buffer is publishing the post.",
              sent: "Published.",
              needs_approval: "Awaiting approval in Buffer.",
              error:
                "Buffer reported a publishing error. Check Buffer.",
            };

            message = messages[status] || message;

            if (
              action === "schedule" &&
              status === "scheduled"
            ) {
              const date = new Intl.DateTimeFormat("en-GB", {
                timeZone: "Africa/Lagos",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(scheduled);

              message = `Scheduled for ${date} WAT.`;
            }
          } else if (outcome?.message) {
            // An explicit rejection can be reviewed and retried.
            status = editable ? "draft" : "rejected";
            message = outcome.message;
          }
        }
      } catch (error) {
        // Before a mutation starts, nothing has been published.
        // After it starts, a timeout is an uncertain result:
        // do not automatically create another post.
        if (!mutationStarted) {
          status = channel.status;
          message = error.message;
        }

        console.error(
          "Buffer publishing attempt:",
          error.name
        );
      }

      await pool.query(
        `
          UPDATE slot_channels
          SET buffer_post_id = $3,
              buffer_status = $4
          WHERE slot_id = $1
            AND channel_id = $2
            AND buffer_status = 'submitting'
        `,
        [opening.id, channel.id, postId, status]
      );

      results.push({
        channel: channel.name,
        message,
      });
    }

    return res.json({
      results,
      channels: (await readOpening(req)).channels,
    });
  } catch (error) {
    return fail(error, res, next);
  }
});

module.exports = router;
