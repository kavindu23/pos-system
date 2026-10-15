# Separate online installations for shops

Each shop uses its own server, domain, Compose project, database volume, backup
volume and installation key. All computers at that shop open the same HTTPS URL.
They must not run independent copies of the server or databases. Internet access
is required. This edition does not provide offline synchronization.

## Install on a shop's server

Use a supported Linux host with Docker Engine and the Compose plugin. Point the
shop's DNS name to it and allow inbound TCP 80 and 443. Do not expose port 3000.
Caddy obtains and renews the domain's TLS certificate automatically. Certificate
issuance requires working public DNS and outbound access to its ACME provider.

1. Copy this repository to a dedicated installation directory.
2. Copy `.env.example` to `.env`. Set `SHOP_DOMAIN` to the real hostname (no
   scheme, path or port), and set a unique `COMPOSE_PROJECT_NAME`. Keep that name
   unchanged after installation: it determines which data volumes are used.
3. Create a private installation key, without overwriting an existing key:

   ```sh
   mkdir -m 700 secrets
   (umask 077; set -C; openssl rand -hex 32 > secrets/setup_token)
   chmod 444 secrets/setup_token
   ```

   The parent directory remains private; the mounted key must be readable by the
   container's non-root application user. Transfer the key privately to the owner.
   Do not commit it, put it in a URL, or send it in application support logs.

4. Run `docker compose config --quiet`, then `docker compose up -d --build`.
5. Check `docker compose ps` and `docker compose logs --tail=50 app proxy`.
   Request `https://YOUR_DOMAIN/api/health`; expect `{"status":"ok"}`.
6. Open the shop URL, enter the installation key and create the business and
   first administrator. There is no default password. Setup closes after this
   account is created. Keep the key file mounted for subsequent app restarts.
7. In Settings set the shop name, business mode, address, currency, tax and receipt
   footer. Create a separate staff login for each person. Add opening stock.

Before handover, test from two computers: sign in with separate staff accounts,
sell a test item, verify shared stock, print a receipt and perform a return.
Configure and test a backup schedule and restoration before storing real sales.

The Compose app runs as a non-root user with a read-only root filesystem. Only
the data and backup volumes are writable. The database is local to one app
process. Do not scale the app service to multiple replicas or mount its database
over a network filesystem.

## Back up while the shop is open

From the installation directory:

```sh
docker compose exec -T app node scripts/backup.js /backups
```

This uses SQLite's online backup API, verifies integrity and produces a standalone
database with private file permissions. It includes committed WAL transactions.
Each run uses a unique timestamped filename and never overwrites an earlier file.
The same command can be scheduled by the host's cron/systemd timer. Set up
monitoring for failed backups and disk usage; automatic scheduling and retention
are not enabled by the supplied Compose file.

Copy backups to encrypted storage on a different host. A backup volume on the same
server does not protect against server loss. The command prints the container
path of the completed backup. To export it, use that exact path:

```sh
mkdir -p backups
docker compose cp app:/backups/EXACT_FILENAME.sqlite backups/
```

Backups include customer data, password hashes and sessions. Restrict access.
Administrators can also download a consistent backup through Settings.

## Restore

1. Stop new sales and run `docker compose stop app proxy`.
2. Preserve the existing data volume and an additional verified backup. Never
   overwrite the only copy of a shop's data.
3. Prepare a clean data directory/volume containing the selected backup as
   `pos.sqlite`, without old `pos.sqlite-wal` or `pos.sqlite-shm` files. Ensure it
   belongs to UID/GID 1000 (the image's `node` user).
4. Before allowing access, revoke copied sessions with Node.js 24:

   ```sh
   node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.argv[1]); db.exec("DELETE FROM sessions"); db.close();' /path/to/restored/pos.sqlite
   ```

5. Mount the restored directory/volume as `/app/data`, start the services, sign in,
   and verify invoices, outstanding balances and stock before resuming trading.

Rehearse restoration on a separate test installation. Never validate a restore by
replacing a trading shop's live database.

## Update and maintain

Back up and verify it first. Record the deployed commit/image and keep the
previous image. Test the new version against a restored copy before rollout.
Run `docker compose up -d --build` in the same installation directory, with the
same project name and volumes. Check health and perform a sale/return smoke test.
Never run `docker compose down -v` on a shop installation: it deletes volumes.
Database schema changes can require a matching backup to roll back.

Maintain host OS, Docker and image security updates; monitor disk capacity,
service health, certificate renewal and backup success. The pinned runtime image
must be reviewed and updated regularly. Public TLS and recovery from off-host
backups must be verified on the actual customer host before commercial handover.

## Product scope

This is a configurable retail/wholesale/service core. Restaurant mode provides
table labels, not kitchen ticket routing. Pharmacy batch/expiry tracking, branches,
supplier payment ledgers, payment-terminal integrations, subscription/license
enforcement and electronic fiscal invoices are not implemented. Confirm each
customer's required workflow and local tax rules before sale. Card/bank entries
record payments; they do not charge a bank account.
