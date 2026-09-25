# FatClinic EHR

Hospital information system: dashboard, front desk, clinical care & triage,
laboratory, pharmacy, radiology, physiotherapy, billing, AI assistant, admin.

## Run locally

```bash
npm install
npm run dev        # frontend on http://localhost:5173
```

## Connect Supabase (external Postgres)

1. Supabase dashboard → your project → **Project Settings → Database** →
   copy the **Connection string** (Direct connection, port **5432** —
   not the pooler — for first boot so the schema can apply).
2. Set it as `DATABASE_URL` in your `.env` (local) or as an environment
   variable on your host (Render / Fly / VPS / etc.).
3. Build and start:
   ```bash
   npm run build
   npm start        # API + app on $PORT (local default 3001)
   ```
4. On first boot the service auto-applies `database/fatclinic.sql`
   (idempotent). Check the logs for:
   `[fatclinic] Postgres schema applied.`
5. Verify: open `<your-host>/api/health` → `{"ok":true,"db":true,...}`.

SSL is automatic for public hosts. Tables created: `users`, `patients`,
`visits`, `invoices`, `payments`, `audit_logs`, etc. (34 tables, views
included — see `database/fatclinic.sql`).

API: `GET /api/health`, `POST /api/init`, generic CRUD at
`/api/:table` and `/api/:table/:id` over the allow-listed tables.
