# SlotBack

### A cancellation shouldn’t cancel your earnings.

SlotBack helps appointment-based businesses turn unexpected openings into social posts, collect customer requests, and confirm a replacement customer.

Built for service providers who reach their customers through social media.

**[Try SlotBack](https://slotback-five.vercel.app)**

Built for **Buffer Commit 2026** using the Buffer API.

## The problem

When an appointment gets cancelled, the business still has an empty slot to fill.

The owner needs to create a promotional image, write a post, share it across social accounts, collect responses, choose a customer, and notify everyone else.

SlotBack brings those steps into one workflow.

## How it works

1. **Connect Buffer**  
   Sign in through Buffer OAuth and choose your workspace and supported social channels.

2. **Create an opening**  
   Add the business name, service, appointment time, timezone, location, duration, and price.

3. **Review and share**  
   Generate a flyer, edit the caption, and save a draft, publish immediately, or schedule through Buffer.

4. **Collect requests**  
   Customers follow the booking link and request the opening without needing a Buffer account.

5. **Confirm a customer**  
   Review applicants, verify the business reply email, and edit the notification messages before confirming.

6. **Notify applicants**  
   The selected customer receives appointment details. Other applicants receive a message that the opening has been filled. The opening closes to further requests.

## Features

- Buffer OAuth authentication
- Workspace and social-channel selection
- Multiple channels per opening
- Generated, downloadable appointment flyers
- Public customer request pages
- Editable social captions with booking links
- Buffer drafts, immediate publishing, and scheduling
- Applicant review and appointment confirmation
- One-time-code verification for business reply email addresses
- Editable confirmation and other-applicant email messages
- Database-backed email outbox
- Open and historical appointment views
- Responsive dashboard and review dialogs

Submitting a request does not automatically book an appointment. The business owner makes the final selection.

## Buffer integration

SlotBack uses the Buffer API to:

- Authenticate business owners through OAuth.
- Retrieve workspace and channel information.
- Create promotional posts with a flyer and booking link.
- Save drafts, publish immediately, or schedule posts.

Publishing availability depends on the connected channel and its supported capabilities.

SlotBack is an independent project built on the Buffer API, not an official Buffer product.

## Email delivery

SlotBack sends transactional emails through Resend using a verified sending domain.

Each business verifies its own reply email using a one-time code. That address is used as the reply destination for customer notifications; it is not automatically used as the sending address.

This allows businesses to receive customer replies without configuring their own sending domain.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Node.js and Express |
| Database | PostgreSQL |
| Sessions | express-session and connect-pg-simple |
| Social publishing | Buffer API |
| Flyer hosting | Cloudinary |
| Transactional email | Resend |
| Production hosting | Vercel |
| Production database | Neon |

## Run locally

### Prerequisites

- A current Node.js LTS release and npm
- PostgreSQL with the `psql` and `createdb` commands available
- A Buffer account and OAuth app client
- A Cloudinary account
- A Resend API key and verified sending domain
- Locally trusted HTTPS certificates

### 1. Clone the repository

```bash
git clone https://github.com/Omotunde-G/slotback.git
cd slotback
npm ci
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```dotenv
PORT=3000

DATABASE_URL=postgresql://YOUR_DATABASE_USER:YOUR_DATABASE_PASSWORD@localhost:5432/slotback

BUFFER_CLIENT_ID=YOUR_BUFFER_CLIENT_ID
BUFFER_CLIENT_SECRET=YOUR_BUFFER_CLIENT_SECRET
BUFFER_REDIRECT_URI=https://localhost:3000/auth/buffer/callback

SESSION_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET

CLOUDINARY_CLOUD_NAME=YOUR_CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY=YOUR_CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET=YOUR_CLOUDINARY_API_SECRET

RESEND_API_KEY=YOUR_RESEND_API_KEY
SLOTBACK_EMAIL_FROM="SlotBack <bookings@YOUR_VERIFIED_SENDING_DOMAIN>"

PUBLIC_APP_URL=https://localhost:3000
```

Replace every placeholder with your own configuration.

Generate a session secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Register this exact local callback URL in your Buffer app client:

```text
https://localhost:3000/auth/buffer/callback
```

Never commit `.env`, API secrets, database credentials, or private certificate keys.

### 3. Create the database

For a fresh local database:

```bash
createdb slotback
```

Apply the migrations in order:

```bash
psql -X -v ON_ERROR_STOP=1 -d slotback \
  -f sql/001-initial-schema.sql \
  -f sql/002-request-email.sql \
  -f sql/003-multiple-channels.sql \
  -f sql/004-add-flyer-url.sql \
  -f sql/005-add-business-email-senders.sql \
  -f sql/006-add-reply-email-verification.sql \
  -f sql/007-add-booking-email-outbox.sql
```

These commands use your local PostgreSQL connection settings. Add the appropriate host and user options if your installation requires them.

Make sure the database matches the connection configured in `.env`.

Most migrations are intended to run once. For an existing database, apply only migrations that have not already been applied.

### 4. Configure local HTTPS

The local server expects these files:

```text
certs/localhost.pem
certs/localhost-key.pem
```

If you use `mkcert`, generate them from the project root:

```bash
mkcert -install
mkdir -p certs

mkcert \
  -key-file certs/localhost-key.pem \
  -cert-file certs/localhost.pem \
  localhost 127.0.0.1 ::1
```

HTTPS is needed locally because the application uses secure session cookies.

### 5. Start the application

```bash
npm run dev
```

Open:

```text
https://localhost:3000
```

To run without automatic restarts:

```bash
npm start
```

### Local publishing note

A `localhost` booking link cannot be opened by customers on other devices.

Immediate publishing and scheduling require a publicly accessible booking URL. For a complete end-to-end test, use a deployed instance with its own correctly configured callback URL and database.

Changing the URL alone does not transfer appointments from a local database to the production database.

## Deploy to Vercel

1. Create a PostgreSQL database and apply the required migrations.
2. Add the environment variables to the Vercel project.
3. Set `DATABASE_URL` to the hosted database connection string.
4. Set `PUBLIC_APP_URL` to your public application origin.
5. Set `BUFFER_REDIRECT_URI` to that origin followed by `/auth/buffer/callback`.
6. Register the exact production callback URL in Buffer.
7. Configure Cloudinary and the verified Resend sending address.
8. Deploy:

```bash
npx vercel deploy --prod
```

Vercel provides HTTPS in production. Local certificate files are not required there.

Keep `.env`, `.env.*`, `certs/`, and `node_modules/` excluded from deployment uploads as appropriate.

## Project structure

```text
slotback/
├── public/
│   ├── index.html
│   ├── dashboard.html
│   ├── dashboard.js
│   ├── slot.html
│   ├── slot.js
│   ├── flyer.js
│   ├── publishing-ui.js
│   ├── social-ui.js
│   ├── styles.css
│   └── favicon.png
├── src/
│   ├── server.js
│   ├── database.js
│   ├── buffer-auth.js
│   ├── slots.js
│   ├── publishing.js
│   ├── cloudinary.js
│   └── booking-email-sender.js
├── sql/
├── package.json
├── package-lock.json
├── .gitignore
└── .vercelignore
```

## Health checks

Application:

```text
/api/health
```

Database connectivity:

```text
/api/health/database
```

A successful database check returns:

```json
{
  "status": "ok",
  "database": "connected"
}
```

## Manual verification

The repository does not currently include an automated test suite.

For an end-to-end check:

- Connect Buffer and load channels.
- Create a future appointment opening.
- Confirm the flyer and public booking page show the correct details.
- Save a draft or schedule a clearly labelled test post.
- Check the result in Buffer.
- Submit requests using two email addresses you control.
- Verify the business reply email.
- Confirm one applicant.
- Check that both notification emails arrive.
- Confirm that replies are addressed to the business.
- Verify that the filled opening stops accepting requests.
- Check the dashboard and dialogs on mobile.

## Planned improvements

- Calendar integrations
- More robust publishing-status reconciliation
- Reporting on which channels lead to confirmed bookings
- Automated tests for key booking and publishing flows

## Author

Built by [Gabriel Omotunde](https://github.com/Omotunde-G).