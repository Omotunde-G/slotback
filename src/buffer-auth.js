const express = require("express");
const crypto = require("node:crypto");
const pool = require("./database");

const router = express.Router();

const scopes = "account:read posts:read posts:write";

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

// Start the connection.
router.get("/auth/buffer", async (req, res, next) => {
  try {
    const verifier = crypto.randomBytes(32).toString("base64url");

    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    const state = crypto.randomBytes(32).toString("hex");

    req.session.bufferOAuth = {
      verifier,
      state,
      createdAt: Date.now(),
    };

    await saveSession(req);

    const url = new URL("https://auth.buffer.com/auth");

    url.search = new URLSearchParams({
      client_id: process.env.BUFFER_CLIENT_ID,
      redirect_uri: process.env.BUFFER_REDIRECT_URI,
      response_type: "code",
      scope: scopes,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    res.redirect(url.toString());
  } catch (error) {
    next(error);
  }
});

// Receive the result from Buffer.
router.get("/auth/buffer/callback", async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");

  try {
    const pending = req.session.bufferOAuth;
    const { state, code, error } = req.query;

    if (
      !pending ||
      typeof state !== "string" ||
      state !== pending.state ||
      Date.now() - pending.createdAt > 10 * 60 * 1000
    ) {
      return res.status(400).send(
        "This login attempt is invalid or expired. Return home and connect again."
      );
    }

    // Each login attempt can be used only once.
    delete req.session.bufferOAuth;
    await saveSession(req);

    if (error) {
      return res.redirect("/?buffer=cancelled");
    }

    if (typeof code !== "string" || !code) {
      return res.status(400).send("Buffer did not return a login code.");
    }

    const tokenResponse = await fetch("https://auth.buffer.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.BUFFER_CLIENT_ID,
        client_secret: process.env.BUFFER_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.BUFFER_REDIRECT_URI,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!tokenResponse.ok) {
      console.error("Buffer token exchange failed:", tokenResponse.status);
      return res.status(502).send(
        "Could not connect to Buffer. Return home and try again."
      );
    }

    const tokens = await tokenResponse.json();
    const expiresIn = Number(tokens.expires_in);

    if (
      typeof tokens.access_token !== "string" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      return res.status(502).send("Buffer returned an unexpected response.");
    }

    // Issue a fresh session after successful authorization.
    // Identify the owner directly through Buffer.
const accountResponse = await fetch("https://api.buffer.com", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query: `
      query SlotBackOwner {
        account {
          id
        }
      }
    `,
  }),
  signal: AbortSignal.timeout(15000),
});

if (!accountResponse.ok) {
  return res.status(502).send(
    "Could not verify your Buffer account. Return home and reconnect."
  );
}

const accountResult = await accountResponse.json();
const bufferAccountId = accountResult.data?.account?.id;

if (
  accountResult.errors?.length ||
  typeof bufferAccountId !== "string" ||
  !bufferAccountId
) {
  return res.status(502).send(
    "Could not identify your Buffer account. Return home and reconnect."
  );
}

// Create the owner, or reuse their existing record.
const ownerResult = await pool.query(
  `
    INSERT INTO business_owners (buffer_account_id)
    VALUES ($1)
    ON CONFLICT (buffer_account_id)
    DO UPDATE SET buffer_account_id = EXCLUDED.buffer_account_id
    RETURNING id
  `,
  [bufferAccountId]
);

const ownerId = ownerResult.rows[0].id;
    await regenerateSession(req);
    
    req.session.ownerId = ownerId;

    req.session.buffer = {
      accessToken: tokens.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    await saveSession(req);

    res.redirect("/dashboard.html");
  } catch (error) {
    next(error);
  }
});

// Return connection status without exposing the token.
router.get("/api/connection", (req, res) => {
  res.set("Cache-Control", "no-store");

  const connection = req.session.buffer;

  res.json({
    connected: Boolean(
      connection && connection.expiresAt > Date.now() + 30000
    ),
    signedIn: Boolean(req.session.ownerId),
  });
});

router.get("/api/buffer/account", async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  const connection = req.session.buffer;

  if (
    !connection ||
    connection.expiresAt <= Date.now() + 30000
  ) {
    return res.status(401).json({
      error: "Please connect Buffer again.",
    });
  }

  try {
    const response = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query SlotBackAccount {
            account {
              id
              email
              name
              organizations {
                id
                name
                channelCount
              }
            }
          }
        `,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 401) {
      return res.status(401).json({
        error: "Your Buffer connection expired. Please reconnect.",
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        error: "Could not read your Buffer account. Try again shortly.",
      });
    }

    const result = await response.json();

    if (result.errors?.length || !result.data?.account) {
      console.error(
        "Buffer account query failed:",
        result.errors?.map((error) => error.message)
      );

      return res.status(502).json({
        error: "Buffer could not return your account details.",
      });
    }

    res.json(result.data.account);
  } catch (error) {
    next(error);
  }
});

router.get("/api/buffer/channels", async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  const connection = req.session.buffer;
  const { organizationId } = req.query;

  if (
    !connection ||
    connection.expiresAt <= Date.now() + 30000
  ) {
    return res.status(401).json({
      error: "Please connect Buffer again.",
    });
  }

  if (
    typeof organizationId !== "string" ||
    !organizationId.trim()
  ) {
    return res.status(400).json({
      error: "An organizationId is required.",
    });
  }

  try {
    const response = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query SlotBackChannels($organizationId: OrganizationId!) {
            channels(input: { organizationId: $organizationId }) {
              id
              name
              displayName
              service
              isQueuePaused
            }
          }
        `,
        variables: {
          organizationId,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 401) {
      return res.status(401).json({
        error: "Your Buffer connection expired. Please reconnect.",
      });
    }

    if (response.status === 429) {
      return res.status(429).json({
        error: "Buffer's request limit was reached. Try again later.",
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        error: "Could not load your Buffer channels.",
      });
    }

    const result = await response.json();

    if (result.errors?.length || !Array.isArray(result.data?.channels)) {
      console.error(
        "Buffer channel query failed:",
        result.errors?.map((error) => error.message)
      );

      return res.status(502).json({
        error: "Buffer could not return your channels.",
      });
    }
   req.session.allowedChannelsByOrg ??= {};
req.session.channelDetailsByOrg ??= {};

req.session.allowedChannelsByOrg[organizationId] =
  result.data.channels.map((channel) => channel.id);

req.session.channelDetailsByOrg[organizationId] =
  result.data.channels.map((channel) => ({
    id: channel.id,
    name: channel.displayName || channel.name || channel.service,
    service: channel.service,
  }));

await saveSession(req);

    res.json({ channels: result.data.channels });
  } catch (error) {
    next(error);
  }
}); 
router.post("/auth/logout", (req, res, next) => {
  const expectedOrigin = new URL(process.env.BUFFER_REDIRECT_URI).origin;

  if (req.get("origin") !== expectedOrigin) {
    return res.status(403).send("Please log out from the SlotBack dashboard.");
  }

  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie("slotback.sid", {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });

    res.redirect(303, "/");
  });
});

module.exports = router;