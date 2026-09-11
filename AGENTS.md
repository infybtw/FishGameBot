# FishCatcher Bot

## Tooling and checks

- Use Bun (the Docker image and lockfile target Bun 1.4); install dependencies with `bun install --frozen-lockfile`.
- Run `bun run typecheck` and `bun test` after TypeScript changes. There is no lint or formatter script.
- Run a focused test file with `bun test src/features/fishing/commands.test.ts` (or another test-file path).
- Database integration tests in `src/db/index.integration.test.ts` are skipped unless `TEST_DATABASE_URL` is set. It must point to a disposable database whose name ends in `_test`; the suite drops and recreates its `public` schema before each test.

## Runtime and data

- `src/index.ts` is the process entrypoint: it validates config, runs the PostgreSQL schema migration, seeds only an empty fish catalog, loads that catalog into memory, then starts grammY polling and the net notifier.
- Schema changes belong in the ordered `SCHEMA_STATEMENTS` list in `src/db/index.ts`; migrations are applied on every normal startup and by both maintenance scripts.
- For host development, start only PostgreSQL with `docker compose -f docker-compose.dev.yml up -d`, configure root `.env`, then use `bun run dev`. The host default database is `postgres://fishbot:testpass@localhost:5432/fishbot`.
- `bun run seed` is idempotent and migrates first. `bun run migrate-legacy -- <parser.db path>` imports legacy SQLite data into `DATABASE_URL` after migrating the target.

## Structure and bot conventions

- Register new Telegram behavior from `src/bot.ts`; feature modules are organized under `src/features/`, while all persistence stays behind the `Repo` returned by `src/db/index.ts`.
- Game state is scoped by both Telegram `userId` and `chatId`; preserve that boundary in repository calls and queries.
- Outgoing bot messages default to Telegram HTML parse mode in `createBot`; escape dynamic text unless it is intentionally trusted markup.
- Keep callback payloads within Telegram's 64-byte limit and validate decoded callback data before any state mutation; existing feature callback modules and tests define the pattern.
