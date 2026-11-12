require("dotenv").config();
const pool = require("./database");

const express = require("express");
const path = require("path");
const https = require("https");
const fs = require("fs");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bufferAuth = require("./buffer-auth");
const slotRoutes = require("./slots"); 
const requiredVariables = [
  "BUFFER_CLIENT_ID",
  "BUFFER_CLIENT_SECRET",
  "BUFFER_REDIRECT_URI",
  "SESSION_SECRET",
];

for (const name of requiredVariables) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
if (process.env.VERCEL === "1") {
  app.set("trust proxy", 1);
}

app.use(
  session({
    store: new PgSession({
      pool,
      createTableIfMissing: true,
    }),
    name: "slotback.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
    },
  })
);

app.use(bufferAuth);
app.use(express.json());
app.use("/api/slots", slotRoutes);


app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "SlotBack",
  });
});

app.get("/api/health/database", async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(`Request failed: ${req.method} ${req.path}`, error.stack || error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "Something went wrong. Return home and try again.",
  });
});

if (process.env.VERCEL !== "1" && require.main === module) {
  const certificates = {
    key: fs.readFileSync(
      path.join(__dirname, "../certs/localhost-key.pem")
    ),
    cert: fs.readFileSync(
      path.join(__dirname, "../certs/localhost.pem")
    ),
  };

  https.createServer(certificates, app).listen(PORT, () => {
    console.log(`SlotBack is running at https://localhost:${PORT}`);
  });
}

module.exports = app;