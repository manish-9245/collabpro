# Baselining the production database

## Why this is required

The production database was created with `prisma db push`, not with migrations.
Verified against production on 2026-07-25:

- `public` schema contains 14 tables
- `_prisma_migrations` **does not exist**
- `Team.userId` is **not** present, so `20260723204037_migrate_fk_to_user_id`
  has genuinely not been applied

Because Prisma has no migration ledger there, running `prisma migrate deploy`
would attempt `20260723204037_init` first — which issues `CREATE TABLE "User"`
and friends against tables that already exist — and abort on the first
statement. The migration history must be baselined before `migrate deploy` is
ever run against production.

## One-time baseline procedure

Run against production **once**, before the first `migrate deploy`:

```bash
# 1. Take a backup first. This is not optional.
pg_dump "$DATABASE_PUBLIC_URL" > collabpro-pre-baseline-$(date +%F).sql

# 2. Record _init as already applied, without executing it.
#    This creates _prisma_migrations and inserts the row.
npx prisma migrate resolve --applied 20260723204037_init

# 3. Confirm only the FK migration is pending.
npx prisma migrate status

# 4. Apply the remaining migration for real.
npx prisma migrate deploy
```

Step 2 executes no DDL — it only writes the ledger entry. Step 4 is what
actually adds the `userId` columns and backfills them.

## Do not skip to `migrate deploy`

If `migrate deploy` is run before step 2 it fails fast on `_init` and leaves
`_prisma_migrations` holding a failed row, which then blocks subsequent runs
until it is resolved manually with `prisma migrate resolve --rolled-back`.

## Removing `db push` from the deploy path

Startup commands must not run `prisma db push --accept-data-loss`; it silently
drops columns to match the schema and bypasses this ledger entirely. Track that
cleanup separately from this migration.
