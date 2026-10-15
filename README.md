# VersaPOS

A configurable point-of-sale workspace for retail, wholesale, cafés and service businesses. Built with Node.js 24, SQLite and a responsive browser interface. No external database or runtime packages are needed.

## Run

```sh
cd /workspace/pos-system
npm start
```

Open the application on port **3000** using your deployment's supported access route. On the first visit, create your business and administrator account. There is no preset password and no sample business data. Sri Lankan Rupee (`LKR`) is the default currency.

For local development use `npm run dev`. For validation use `npm run check` and `npm test`. Tests create isolated temporary databases and never touch your business data.

## Features

- First-run business setup, sign-in, password changes and administrator / manager / cashier roles.
- Product and service catalog: SKU, barcode, category, unit, cost, price, archive status and low-stock alerts. Decimal quantities support goods sold by weight or services sold by time.
- Inventory: opening stock, reasoned adjustments, movement history and atomic stock checks. Sales cannot create negative stock.
- Billing: product search, keyboard barcode scanners, quantities, order discounts, configurable tax, customer selection, order notes and table labels in Restaurant mode.
- Cash, card and bank payment records; cash change; partial payment and customer credit sales. Card and bank options record payments, rather than charging a bank account or payment terminal.
- Sequential invoices and browser-printable receipts. Held orders live in the browser session, do not reserve inventory, and are lost on refresh or sign-out.
- Customer and supplier records, stock purchase receiving and weighted average costs.
- Partial/full returns, proportionate discount and tax refunds, stock restoration, unpaid balance reduction and subsequent customer payments.
- Expenses, cash shift opening/closing and expected versus counted cash reconciliation. Optional enforcement requires a shift for money-handling operations.
- Sales history, date-range reports, estimated profit, net tax, payment summaries, outstanding invoices, top products and current stock value. Report date boundaries use UTC; individual transaction timestamps display in the browser's timezone.
- Team management, audit history, CSV exports and consistent SQLite backup downloads.
- Persistent data across restarts. Prices and totals are stored as integer minor currency units; product quantities support three decimal places. Repeated checkout requests with the same request key return the original invoice.

## Typical workflow

1. Create the first administrator, then review **Settings** for the business type, receipt details, currency and tax rate.
2. Add products under **Products & stock**. Uncheck stock tracking for services. Opening stock is only entered on product creation; later changes use purchases or stock adjustments.
3. Add customers and suppliers as needed. Add staff under **Team & access**.
4. Open a **Cash shift** with the starting float. Turn on shift enforcement if every transaction must belong to a shift.
5. Use **Point of sale**. A barcode scanner should send the barcode followed by Enter into the search field. Add products, choose a customer for credit/partial payments, apply discounts and complete the sale.
6. View/print invoices under **Sales history**. Managers can receive outstanding payments or process returns from the invoice.
7. Receive purchased inventory, record operating expenses, review reports and count the drawer when closing a shift.

## Configuration

| Variable        | Default                     | Purpose                                                               |
| --------------- | --------------------------- | --------------------------------------------------------------------- |
| `PORT`          | `3000`                      | HTTP listening port                                                   |
| `HOST`          | `127.0.0.1`                 | Bind address; use `0.0.0.0` behind a controlled deployment proxy      |
| `DATA_DIR`      | `./data` beside `server.js` | Persistent directory for `pos.sqlite` and its WAL files               |
| `COOKIE_SECURE` | unset                       | Set to `true` when serving over HTTPS so the session cookie is Secure |

Deploy behind an HTTPS reverse proxy, keep `DATA_DIR` on durable storage, and restrict access to the database files. The first-run setup screen should only be exposed to the intended owner until the administrator is created. Session cookies are HttpOnly and SameSite=Strict, passwords use salted scrypt hashes, and browser writes require same-origin JSON requests. Sessions last 12 hours. Password changes revoke other sessions; editing a staff account revokes that staff member's sessions.

The server is intended to run as a single instance against its local SQLite database. Do not put the database on a shared network filesystem or run independent servers against copied databases. A development server starting successfully does not establish production security, legal tax compliance or hardware compatibility.

## Back up and restore

An administrator can use **Settings → Download backup**. The download uses SQLite's consistent snapshot operation. Backups contain personal information, password hashes and session records, so protect them like your live database.

To restore, stop the server, preserve the existing data directory, and put the downloaded database at `<DATA_DIR>/pos.sqlite` in a clean directory. Do not combine a restored database with old `pos.sqlite-wal` or `pos.sqlite-shm` files. Before restarting, revoke the copied sessions:

```sh
node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.argv[1]); db.exec("DELETE FROM sessions"); db.close();' /path/to/data/pos.sqlite
```

Restart with the same `DATA_DIR`, sign in and verify the business totals. The restore path is a manual administrator operation; this app does not upload/restore backups through the browser.

## Scope

This version provides a working single-business, single-location POS core. It does not yet include multi-branch synchronization, offline billing, supplier payable/payment accounting, customer loyalty, batch/expiry or serial-number tracking, reservations, kitchen tickets, payment gateway integration, an electronic fiscal/tax invoice provider, or direct printer/cash-drawer drivers. Browser printing depends on the installed printer and paper settings. Businesses needing these workflows should extend and validate them before using the system live.

Returns assume items are returned to saleable inventory; use a stock adjustment for damaged goods. Profit is an estimate from stored item costs, net tax and recorded expenses, not a general ledger. Inventory adjustments are operational records rather than profit/loss journal entries. Settings currency changes only the display code and do not convert historical amounts.

## Tests

`npm test` runs an actual HTTP server against a temporary database. It verifies first-run setup, authentication, origin protection, catalog validation, transactional sales and stock limits, refunds, credit balances/payments, weighted purchase costs, inventory adjustments, service/fractional quantities, reporting arithmetic, cash reconciliation, role boundaries, session revocation, exports, backup integrity and restart persistence.

## Separate shop installations

For an online installation shared by multiple computers at one shop, see [Shop installation and operations](docs/SHOP-INSTALLATION.md). Includes Docker/Caddy HTTPS configuration, an installation key for first-run setup, isolated data volumes, online backups and recovery guidance. Each shop runs its own instance. Set `PUBLIC_ORIGIN` to the exact HTTPS origin and `SETUP_TOKEN_FILE` to a private key file (at least 32 characters); production also requires `COOKIE_SECURE=true`. Settings supports a shop logo on the workspace and receipts.
