# FishCatcher Bot

A Telegram group-chat fishing game built with [Bun](https://bun.sh/), [grammY](https://grammy.dev/), and PostgreSQL. Players catch fish, build a balance, view personal statistics, and compete on a per-chat leaderboard.

The bot creates its PostgreSQL schema on startup and seeds a default fish catalog when the catalog is empty.

## Features

- Group fishing with a configurable success chance and per-user, per-chat cooldown
- Per-chat balances, catch history, player statistics, and leaderboard
- Default catalog with multiple rarity tiers
- Admin commands to add, remove, import, export, and reload fish templates
- PostgreSQL persistence with automatic schema creation
- Docker Compose setup for the bot, PostgreSQL, and Adminer
- Structured JSON logs and graceful shutdown

## Quick start with Docker Compose

This is the shortest path to a complete deployment.

### 1. Prerequisites

- Docker Engine with the Docker Compose plugin
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your numeric Telegram user ID for the administrator account

`ADMIN_USER_ID` must be a number, not a Telegram username. Obtain it with a Telegram client or another trusted method that shows account IDs.

### 2. Clone and configure

```bash
git clone https://github.com/infybtw/FishGameBot.git
cd FishGameBot
cp .env.example .env
```

Open `.env` and set at least these values:

```dotenv
BOT_TOKEN=123456789:replace-with-your-token
ADMIN_USER_ID=123456789
POSTGRES_PASSWORD=replace-with-a-strong-password
```

The remaining values already have development-friendly defaults. `POSTGRES_PASSWORD` is used only by `docker-compose.yml`; if omitted, Compose falls back to `testpass`.

### 3. Start the stack

```bash
docker compose up -d --build
```

Compose starts PostgreSQL first, waits for its health check, and then starts the bot. On its first startup, the bot creates the schema and inserts the default fish catalog.

Follow the bot logs until `Bot started` appears:

```bash
docker compose logs -f bot
```

### 4. Add the bot to a group

1. Add the bot to a Telegram group.
2. Send `/info` to confirm that it is online.
3. Send `/fish` to make the first catch attempt.

Fishing commands intentionally work only in groups and supergroups.

### 5. Stop or reset the stack

Stop containers without deleting data:

```bash
docker compose down
```

PostgreSQL data is stored in the `postgres-data` volume. To delete all bot data and start from an empty database, remove that volume explicitly:

```bash
docker compose down -v
```

> `down -v` permanently deletes fishers, balances, catches, cooldowns, and catalog changes.

## Local development

Run PostgreSQL in Docker while running the bot on the host with Bun.

### Requirements

- [Bun 1.4](https://bun.sh/) or a compatible newer release
- Docker Engine with the Docker Compose plugin

### Setup

```bash
cp .env.example .env
```

Set `BOT_TOKEN` and `ADMIN_USER_ID` in `.env`. The example `DATABASE_URL` points to the development PostgreSQL container on `localhost:5432`.

Start PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Install the locked dependencies:

```bash
bun install --frozen-lockfile
```

Start the bot in watch mode:

```bash
bun run dev
```

Bun automatically loads the root `.env` file. Source changes restart the process because the development script uses `bun --watch`.

For a non-watching process, run:

```bash
bun run start
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BOT_TOKEN` | Yes | — | Telegram bot token issued by @BotFather. |
| `ADMIN_USER_ID` | Yes | — | Numeric Telegram user ID allowed to use admin commands. |
| `CATCH_SUCCESS_CHANCE` | Yes for host runs | `50` in Compose | Integer from `0` to `100`. |
| `CATCH_DELAY` | Yes for host runs | `3600` in Compose | Non-negative cooldown in seconds, scoped to each user and chat. |
| `DATABASE_URL` | No | `postgres://localhost:5432/fishbot` | PostgreSQL connection string. The provided host-development value includes the Compose credentials. |
| `LOG_LEVEL` | No | `info` | One of `debug`, `info`, `warn`, or `error`. |
| `POSTGRES_PASSWORD` | Docker Compose only | `testpass` | Password shared by the Compose PostgreSQL and bot services. Use a strong value outside local development. |

`docker-compose.yml` constructs the bot's internal `DATABASE_URL` from `POSTGRES_PASSWORD`; the `DATABASE_URL` entry in `.env` is used when the bot or maintenance scripts run on the host.

## Commands

### Player commands

These commands are available in groups and supergroups:

| Command | Description |
| --- | --- |
| `/fish` | Attempt to catch a fish. |
| `/fishtop` | Show the current chat's fishing leaderboard. |
| `/stats` | Show your statistics for the current chat. |
| `/info` | Show bot version, command help, and repository information. |

### Administrator commands

Only the account matching `ADMIN_USER_ID` can use these commands:

| Command | Description |
| --- | --- |
| `/add_new_fish` | Add a fish template through a conversation. |
| `/remove_fish` | Remove a fish template by ID. |
| `/get_fish_list` | Display the stored fish templates. |
| `/reload_fish_list` | Reload the in-memory catalog from PostgreSQL. |
| `/import_fish` | Replace the catalog from an uploaded JSON file. |
| `/export_fish` | Download the catalog as JSON. |
| `/cancel` | Exit active admin conversations. |

Import files must contain an array of objects with this shape:

```json
[
  {
    "name": "Окунь",
    "rarity": "Обычный",
    "point": 1
  }
]
```

The import operation replaces the current fish catalog after validating the file. Exported files use the same format.

## Database tools

Schema creation and default catalog seeding happen automatically during normal startup. The manual seed command is safe on a populated catalog and inserts defaults only when no templates exist:

```bash
bun run seed
```

To copy supported data from the legacy SQLite `parser.db` into PostgreSQL:

```bash
bun scripts/migrate-legacy.ts ./path/to/parser.db
```

Both commands read `DATABASE_URL` from the environment or the root `.env` file.

Adminer is included in the full Docker Compose stack at <http://127.0.0.1:8080>. It binds only to loopback; use an SSH tunnel or an authenticated reverse proxy for remote access.

## Quality checks

```bash
bun run typecheck
bun test
```

## Troubleshooting

### `Invalid environment configuration`

Read every item in the startup error. The bot validates all required variables together: the token must be non-empty, the admin ID must be an integer, the catch chance must be between `0` and `100`, and the delay must be non-negative.

### PostgreSQL connection errors

For local development, confirm that the database container is healthy:

```bash
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs postgres
```

Also confirm that `DATABASE_URL` matches the credentials and exposed port in `docker-compose.dev.yml`.

### The bot ignores `/fish`, `/fishtop`, or `/stats`

Those commands are group-only. Add the bot to a group or supergroup and run them there. `/stats` also requires a Telegram user identity on the update.

### The full stack does not start

Validate interpolated Compose configuration and inspect service logs:

```bash
docker compose config
docker compose logs bot postgres
```

`BOT_TOKEN` and `ADMIN_USER_ID` must be present in `.env` before Compose can render `docker-compose.yml`.

## Project layout

```text
src/
  db/                 PostgreSQL schema, repository, and default catalog seed
  features/admin/     Administrator conversations and catalog management
  features/fishing/   Catch generation, cooldowns, messages, and player commands
  bot.ts              grammY middleware and command registration
  config.ts           Environment validation
  index.ts            Startup, migration, seeding, and shutdown
scripts/               Manual seed and legacy SQLite migration tools
```
