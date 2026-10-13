import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

test("POS workflow, accounting, permissions and persistence", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "versapos-test-"));
  let child,
    base,
    cookie = "";
  const start = async () => {
    child = spawn(process.execPath, ["server.js"], {
      env: { ...process.env, DATA_DIR: dir, PORT: "0", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Server startup timed out: " + output)),
        10000,
      );
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/port (\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve("http://127.0.0.1:" + match[1]);
        }
      });
      child.stderr.on("data", (c) => {
        output += c;
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error("Server exited: " + code + " " + output));
      });
    });
  };
  const stop = async () => {
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    await closed;
  };
  const request = async (
    path,
    method = "GET",
    body,
    expected = 200,
    session = cookie,
  ) => {
    const res = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Cookie: session } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    if (res.headers.get("set-cookie"))
      cookie = res.headers.get("set-cookie").split(";")[0];
    return data;
  };
  t.after(async () => {
    if (child?.exitCode === null) await stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await start();
  let product, customer, supplier, sale, adminCookie, cashier;
  await t.test(
    "first-run setup, authentication and input security",
    async () => {
      assert.equal((await request("/bootstrap")).needsSetup, true);
      await request("/products", "GET", undefined, 401);
      await request(
        "/setup",
        "POST",
        {
          businessName: "Test Shop",
          name: "Owner",
          username: "owner",
          password: "test-password-123",
          currency: "LKR",
        },
        201,
      );
      await request("/setup", "POST", {}, 409);
      await request(
        "/login",
        "POST",
        { username: "owner", password: "wrong-password" },
        401,
      );
      await request("/login", "POST", {
        username: "owner",
        password: "test-password-123",
      });
      adminCookie = cookie;
      const res = await fetch(base + "/api/settings", {
        method: "PUT",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Origin: "http://evil.example",
        },
        body: "{}",
      });
      assert.equal(res.status, 403);
      const me = await request("/me");
      await request("/settings", "PUT", {
        ...me.settings,
        taxRate: 10,
        requireShift: true,
      });
      await request("/shifts/open", "POST", { opening_cash: 100 }, 201);
    },
  );
  await t.test("catalog, customers and suppliers", async () => {
    product = await request(
      "/products",
      "POST",
      {
        name: "Tea",
        sku: "TEA-1",
        barcode: "123456",
        category: "Grocery",
        price: 10,
        cost: 4,
        stock: 10,
        tracked: true,
        unit: "pcs",
      },
      201,
    );
    assert.equal(product.price, 1000);
    assert.equal(product.stock, 10);
    await request(
      "/products",
      "POST",
      { name: "Duplicate", sku: "tea-1", price: 10, cost: 4 },
      409,
    );
    await request(
      "/products",
      "POST",
      { name: "Bad", sku: "BAD", price: -1, cost: 0 },
      400,
    );
    customer = await request(
      "/contacts",
      "POST",
      { name: "Regular Customer", type: "customer", phone: "0710000000" },
      201,
    );
    supplier = await request(
      "/contacts",
      "POST",
      { name: "Tea Supplier", type: "supplier" },
      201,
    );
  });
  await t.test(
    "sale pricing, discount, tax and atomic stock deduction",
    async () => {
      const checkout = {
        request_key: "test-checkout-1",
        items: [{ product_id: product.id, quantity: 2 }],
        discount: 2,
        paid: 19.8,
        method: "cash",
      };
      sale = await request("/sales", "POST", checkout, 201);
      const repeated = await request("/sales", "POST", checkout, 201);
      assert.equal(repeated.id, sale.id);
      assert.equal(sale.subtotal, 2000);
      assert.equal(sale.discount, 200);
      assert.equal(sale.tax, 180);
      assert.equal(sale.total, 1980);
      assert.equal(sale.balance, 0);
      assert.equal((await request("/products"))[0].stock, 8);
      await request(
        "/sales",
        "POST",
        {
          items: [{ product_id: product.id, quantity: 20 }],
          paid: 220,
          method: "cash",
        },
        400,
      );
      await request(
        "/sales",
        "POST",
        {
          items: [
            { product_id: product.id, quantity: 1 },
            { product_id: product.id, quantity: 1 },
          ],
          paid: 22,
          method: "cash",
        },
        400,
      );
      await request(
        "/sales",
        "POST",
        {
          items: [{ product_id: product.id, quantity: 1 }],
          paid: 0,
          method: "credit",
        },
        400,
      );
      assert.equal((await request("/products"))[0].stock, 8);
      assert.equal((await request("/sales")).length, 1);
    },
  );
  await t.test(
    "partial and full returns restore inventory, discounts and cash exactly",
    async () => {
      const partial = await request("/sales/" + sale.id + "/returns", "POST", {
        reason: "Damaged packaging",
        method: "cash",
        items: [{ sale_item_id: sale.items[0].id, quantity: 1 }],
      });
      assert.equal(partial.refunded, 990);
      assert.equal(partial.paid, 990);
      assert.equal(partial.balance, 0);
      assert.equal((await request("/shifts")).current.expected_cash, 10990);
      const full = await request("/sales/" + sale.id + "/returns", "POST", {
        reason: "Customer returned remainder",
        method: "cash",
        items: [{ sale_item_id: sale.items[0].id, quantity: 1 }],
      });
      assert.equal(full.refunded, full.total);
      assert.equal(full.paid, 0);
      assert.equal((await request("/products"))[0].stock, 10);
      assert.equal((await request("/shifts")).current.expected_cash, 10000);
      await request(
        "/sales/" + sale.id + "/returns",
        "POST",
        {
          reason: "Duplicate",
          items: [{ sale_item_id: sale.items[0].id, quantity: 1 }],
        },
        400,
      );
    },
  );
  await t.test(
    "credit balances, later payments and unpaid returns",
    async () => {
      const credit = await request(
        "/sales",
        "POST",
        {
          customer_id: customer.id,
          items: [{ product_id: product.id, quantity: 2 }],
          paid: 0,
          method: "credit",
        },
        201,
      );
      assert.equal(credit.balance, 2200);
      const paid = await request("/sales/" + credit.id + "/payments", "POST", {
        amount: 5,
        method: "cash",
      });
      assert.equal(paid.balance, 1700);
      const partial = await request(
        "/sales/" + credit.id + "/returns",
        "POST",
        {
          reason: "No longer needed",
          method: "cash",
          items: [{ sale_item_id: credit.items[0].id, quantity: 1 }],
        },
      );
      assert.equal(partial.refunded, 1100);
      assert.equal(partial.balance, 600);
      assert.equal(partial.paid, 500);
      assert.equal((await request("/shifts")).current.expected_cash, 10500);
      await request(
        "/sales/" + credit.id + "/payments",
        "POST",
        { amount: 6.01, method: "cash" },
        400,
      );
      const settled = await request(
        "/sales/" + credit.id + "/payments",
        "POST",
        { amount: 6, method: "cash" },
      );
      assert.equal(settled.balance, 0);
    },
  );
  await t.test(
    "purchase receiving, weighted cost and stock adjustments",
    async () => {
      await request(
        "/purchases",
        "POST",
        {
          supplier_id: supplier.id,
          reference: "S-001",
          items: [{ product_id: product.id, quantity: 3, cost: 8 }],
        },
        201,
      );
      let p = (await request("/products"))[0];
      assert.equal(p.stock, 12);
      assert.equal(p.cost, 500);
      await request("/stock", "POST", {
        product_id: p.id,
        quantity: -2,
        reason: "Stock count correction",
      });
      p = (await request("/products"))[0];
      assert.equal(p.stock, 10);
      await request(
        "/stock",
        "POST",
        { product_id: p.id, quantity: -11, reason: "Invalid" },
        400,
      );
      assert(
        (await request("/movements")).some(
          (m) => m.reason === "Stock count correction",
        ),
      );
    },
  );
  await t.test(
    "service products, fractional quantity and reporting",
    async () => {
      const service = await request(
        "/products",
        "POST",
        {
          name: "Consultation",
          sku: "SERVICE",
          price: 20,
          cost: 2,
          tracked: false,
          unit: "hour",
        },
        201,
      );
      const s = await request(
        "/sales",
        "POST",
        {
          items: [{ product_id: service.id, quantity: 0.5 }],
          method: "card",
          paid: 11,
        },
        201,
      );
      assert.equal(s.total, 1100);
      await request(
        "/expenses",
        "POST",
        {
          category: "Utilities",
          description: "Electricity",
          amount: 2,
          method: "cash",
        },
        201,
      );
      const today = new Date().toISOString().slice(0, 10);
      const report = await request("/reports?from=" + today + "&to=" + today);
      assert.equal(report.count, 3);
      assert.equal(report.netRevenue, 2200);
      assert.equal(report.netTax, 200);
      assert.equal(report.cogs, 500);
      assert.equal(report.expenses, 200);
      assert.equal(report.profit, 1300);
      assert.equal(report.outstanding, 0);
      assert.equal(report.inventoryValue, 5000);
    },
  );
  await t.test("cash reconciliation", async () => {
    const current = (await request("/shifts")).current;
    assert.equal(current.expected_cash, 10900);
    const closed = await request("/shifts/close", "POST", {
      closing_cash: 109,
    });
    assert.equal(closed.expected_cash, closed.closing_cash);
    await request(
      "/sales",
      "POST",
      {
        items: [{ product_id: product.id, quantity: 1 }],
        method: "cash",
        paid: 11,
      },
      400,
    );
  });
  await t.test(
    "role boundaries, session revocation and personal sale visibility",
    async () => {
      cashier = await request("/users", "POST", {
        name: "Cashier",
        username: "cashier",
        password: "cashier-password-123",
        role: "cashier",
        active: true,
      });
      await request("/login", "POST", {
        username: "cashier",
        password: "cashier-password-123",
      });
      await request("/products", "POST", { name: "Forbidden" }, 403);
      await request("/reports", "GET", undefined, 403);
      await request("/users", "GET", undefined, 403);
      await request("/settings", "PUT", {}, 403);
      assert.equal((await request("/sales")).length, 0);
      await request("/sales/" + sale.id, "GET", undefined, 403);
      const cashierCookie = cookie;
      cookie = adminCookie;
      await request("/users/" + cashier.id, "PUT", {
        ...cashier,
        active: false,
      });
      await request("/me", "GET", undefined, 401, cashierCookie);
      await request(
        "/users/1",
        "PUT",
        { name: "Owner", username: "owner", role: "cashier", active: true },
        400,
      );
    },
  );
  await t.test("CSV export and recoverable database backup", async () => {
    const res = await fetch(base + "/api/export?type=sales", {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /INV-000001/);
    const backup = await fetch(base + "/api/backup", {
      headers: { Cookie: cookie },
    });
    assert.equal(backup.status, 200);
    const path = join(dir, "verify.sqlite");
    writeFileSync(path, Buffer.from(await backup.arrayBuffer()));
    const restored = new DatabaseSync(path);
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(restored.prepare("SELECT COUNT(*) n FROM sales").get().n, 3);
    restored.close();
    assert((await request("/audit")).length > 10);
  });
  await t.test("restart retains data and renders the application", async () => {
    await stop();
    await start();
    assert.equal((await request("/bootstrap")).needsSetup, false);
    assert.equal((await request("/sales")).length, 3);
    assert.equal((await request("/products")).length, 2);
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /VersaPOS/);
  });
});
