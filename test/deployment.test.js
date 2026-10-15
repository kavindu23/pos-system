import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

test("independent online shop installations", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pos-deploy-"));
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const closed = once(child, "exit");
      child.kill("SIGTERM");
      await closed;
    }
    rmSync(root, { recursive: true, force: true });
  });
  async function shop(name) {
    const token = randomBytes(32).toString("hex");
    const tokenFile = join(root, name + "-key");
    const data = join(root, name);
    const origin = `https://${name}.example.com`;
    writeFileSync(tokenFile, token, { mode: 0o600 });
    const child = spawn(process.execPath, ["server.js"], {
      env: { ...process.env, NODE_ENV: "production", DATA_DIR: data,
        PORT: "0", HOST: "127.0.0.1", PUBLIC_ORIGIN: origin,
        COOKIE_SECURE: "true", SETUP_TOKEN_FILE: tokenFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Startup timeout")), 10000);
      child.once("error", reject);
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Startup failed")); });
      child.stdout.on("data", (chunk) => {
        const match = String(chunk).match(/port (\d+)/);
        if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
      });
    });
    return { base, token, data, origin };
  }
  async function request(shop, path, body, cookie, origin = shop.origin) {
    return fetch(shop.base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const a = await shop("alpha"), b = await shop("beta");
  const owner = { businessName: "Alpha Store", name: "Owner", username: "owner",
    password: "test-owner-password", currency: "LKR" };
  await t.test("installation key and exact HTTPS origin protect first-run setup", async () => {
    assert.equal((await (await request(a, "/bootstrap")).json()).requiresSetupToken, true);
    assert.equal((await request(a, "/setup", owner)).status, 403);
    assert.equal((await request(a, "/setup", { ...owner, setupToken: b.token })).status, 403);
    assert.equal((await request(a, "/setup", { ...owner, setupToken: a.token }, null,
      "http://alpha.example.com")).status, 403);
    assert.equal((await request(a, "/setup", { ...owner, setupToken: a.token })).status, 201);
    assert.equal((await request(a, "/setup", { ...owner, setupToken: a.token })).status, 409);
    assert.equal((await request(b, "/bootstrap")).status, 200);
    assert.equal((await (await request(b, "/bootstrap")).json()).needsSetup, true);
    assert.equal((await request(b, "/setup", { ...owner, businessName: "Beta Store", setupToken: b.token })).status, 201);
  });
  const loginA = await request(a, "/login", owner);
  assert.equal(loginA.status, 200);
  assert.match(loginA.headers.get("set-cookie"), /; Secure/);
  const cookieA = loginA.headers.get("set-cookie").split(";")[0];
  const loginA2 = await request(a, "/login", owner);
  const cookieA2 = loginA2.headers.get("set-cookie").split(";")[0];
  const loginB = await request(b, "/login", owner);
  const cookieB = loginB.headers.get("set-cookie").split(";")[0];
  let product;
  await t.test("shops cannot share sessions, settings or products", async () => {
    assert.equal((await request(b, "/me", undefined, cookieA)).status, 401);
    assert.equal((await (await request(b, "/me", undefined, cookieB)).json()).settings.businessName, "Beta Store");
    const created = await request(a, "/products", { name: "Last item", sku: "LAST",
      price: 10, cost: 4, stock: 1 }, cookieA);
    assert.equal(created.status, 201);
    product = await created.json();
    assert.deepEqual(await (await request(b, "/products", undefined, cookieB)).json(), []);
    const staff = await request(a, "/users", { name: "Till operator", username: "cashier",
      password: "test-cashier-password", role: "cashier", active: true }, cookieA);
    assert.equal(staff.status, 200, "Admin creates staff without reusing installation key");
  });
  await t.test("shop logo persists and rejects executable image formats", async () => {
    const current = await (await request(a, "/me", undefined, cookieA)).json();
    const logoData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const save = (logo) => fetch(a.base + "/api/settings", {
      method: "PUT", headers: { Origin: a.origin, Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ ...current.settings, logoData: logo }),
    });
    assert.equal((await save("data:image/svg+xml;base64,PHN2Zz4=")).status, 400);
    assert.equal((await save(logoData)).status, 200);
    assert.equal((await (await request(a, "/me", undefined, cookieA)).json()).settings.logoData, logoData);
    assert.equal((await (await request(b, "/me", undefined, cookieB)).json()).settings.logoData, "");
  });
  await t.test("two tills compete for final item without overselling; retries are idempotent", async () => {
    const sale = (key) => ({ items: [{ product_id: product.id, quantity: 1 }],
      method: "cash", paid: 10, request_key: key });
    const responses = await Promise.all([
      request(a, "/sales", sale("till-one"), cookieA),
      request(a, "/sales", sale("till-two"), cookieA2),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 400]);
    const winner = responses.findIndex(r => r.status === 201);
    const invoice = await responses[winner].json();
    const retry = await request(a, "/sales", sale(winner === 0 ? "till-one" : "till-two"), winner === 0 ? cookieA : cookieA2);
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).id, invoice.id);
    const stock = await (await request(a, "/products", undefined, cookieA)).json();
    assert.equal(stock[0].stock, 0);
    assert.equal((await (await request(a, "/sales", undefined, cookieA)).json()).length, 1);
  });
  await t.test("live database backup includes committed WAL data and passes integrity checks", () => {
    const destination = join(root, "backups");
    execFileSync(process.execPath, ["scripts/backup.js", destination], {
      env: { ...process.env, DATA_DIR: a.data },
    });
    const files = readdirSync(destination);
    assert.equal(files.length, 1);
    const path = join(destination, files[0]);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sales").get().n, 1);
      assert.equal(db.prepare("SELECT stock FROM products").get().stock, 0);
    } finally { db.close(); }
  });
});
