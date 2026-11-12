const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (process.env.VERCEL === "1" && !connectionString) {
  throw new Error("Set DATABASE_URL in the Vercel project settings.");
}

const pool = new Pool(connectionString ? { connectionString } : {});

pool.on("error", (error) => {
  console.error("Unexpected database connection error:", error.message);
});

module.exports = pool;