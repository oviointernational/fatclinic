# FatClinic EHR

Hospital information system: dashboard, front desk, clinical care & triage,
laboratory, pharmacy, radiology, physiotherapy, billing, AI assistant, admin.

## Run locally

```bash
npm install
npm run dev        # frontend on http://localhost:5173
```

Optional local API + Postgres:

```bash
# set DATABASE_PRIVATE_URL or DATABASE_URL, then:
node server/index.js   # API + production build on http://localhost:3001
```

## Deploy on Railway

1. Add a **Postgres** plugin to the project.
2. In this service → **Variables**, add a new variable referencing it:
   `DATABASE_PRIVATE_URL` = `${{ Postgres.DATABASE_PRIVATE_URL }}`
   (use your Postgres service's exact name).
3. Deploy. Build: `npm ci && npm run build`. Start: `npm start`.
4. On first boot the service auto-applies `database/fatclinic.sql`
   (idempotent) and serves the app + `/api` on `$PORT`.

API: `GET /api/health`, `POST /api/init`, generic CRUD at
`/api/:table` and `/api/:table/:id` over the allow-listed tables.

Set `PG_SSL=true` only if your Postgres requires SSL.
