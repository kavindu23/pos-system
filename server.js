import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, "data"));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "pos.sqlite"));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE COLLATE NOCASE, barcode TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'General', price INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0, stock REAL NOT NULL DEFAULT 0, low_stock REAL NOT NULL DEFAULT 5, unit TEXT NOT NULL DEFAULT 'pcs', tracked INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY, number TEXT UNIQUE, created_at TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), customer_id INTEGER REFERENCES contacts(id), subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL, paid INTEGER NOT NULL, method TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', table_name TEXT NOT NULL DEFAULT '', shift_id INTEGER);
CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, sku TEXT NOT NULL, quantity REAL NOT NULL, price INTEGER NOT NULL, cost INTEGER NOT NULL, total INTEGER NOT NULL, returned REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS returns (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, total INTEGER NOT NULL, reason TEXT NOT NULL, shift_id INTEGER, method TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS return_items (id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES returns(id), sale_item_id INTEGER NOT NULL REFERENCES sale_items(id), quantity REAL NOT NULL, total INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), amount INTEGER NOT NULL, method TEXT NOT NULL, created_at TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), shift_id INTEGER);
CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY, supplier_id INTEGER REFERENCES contacts(id), created_at TEXT NOT NULL, total INTEGER NOT NULL, reference TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS purchase_items (id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity REAL NOT NULL, cost INTEGER NOT NULL, total INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS movements (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), quantity REAL NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, created_at TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), shift_id INTEGER);
CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), opened_at TEXT NOT NULL, closed_at TEXT, opening_cash INTEGER NOT NULL, closing_cash INTEGER, expected_cash INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts(user_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkout_keys (key TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), sale_id INTEGER NOT NULL REFERENCES sales(id));
`);
const defaults = {
  businessName: "My Business",
  businessType: "Retail",
  currency: "LKR",
  address: "",
  phone: "",
  taxRate: 0,
  receiptFooter: "Thank you for shopping with us!",
  requireShift: false,
};
db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(
  JSON.stringify(defaults),
);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const now = () => new Date().toISOString();
const settings = () =>
  JSON.parse(get("SELECT json FROM settings WHERE id=1").json);
const hash = (p) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
};
const verify = (p, encoded) => {
  const [salt, h] = encoded.split(":");
  return timingSafeEqual(Buffer.from(h, "hex"), scryptSync(p, salt, 64));
};
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const assert = (ok, message, status) => {
  if (!ok) throw new AppError(message, status);
};
const str = (v, name, max = 200, required = true) => {
  const s = String(v ?? "").trim();
  assert(
    (!required || s.length > 0) && s.length <= max,
    `${name} is required and must be at most ${max} characters.`,
  );
  return s;
};
const num = (v, name, min = 0, max = 1e9) => {
  assert(
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max,
    `${name} must be between ${min} and ${max}.`,
  );
  return v;
};
const money = (v, name) => Math.round(num(v, name, 0, 1e8) * 100);
const qty = (v) => {
  const n = num(v, "Quantity", 0.001, 1e6);
  assert(
    Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001,
    "Quantity supports up to 3 decimal places.",
  );
  return n;
};
const id = (v) => {
  const n = Number(v);
  assert(Number.isSafeInteger(n) && n > 0, "Invalid ID.");
  return n;
};
const method = (v) => {
  assert(
    ["cash", "card", "bank", "credit"].includes(v),
    "Invalid payment method.",
  );
  return v;
};
const transaction = (fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
const audit = (u, action, details) =>
  run(
    "INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)",
    u?.id ?? null,
    action,
    JSON.stringify(details),
    now(),
  );
const contact = (v, type) => {
  if (!v) return null;
  const c = get("SELECT * FROM contacts WHERE id=? AND type=?", id(v), type);
  assert(c, `${type} does not exist.`);
  return c.id;
};
const activeShift = (u) =>
  get("SELECT * FROM shifts WHERE user_id=? AND closed_at IS NULL", u.id);
const shiftFor = (u) => {
  const s = activeShift(u);
  assert(!settings().requireShift || s, "Open a cash shift first.");
  return s?.id ?? null;
};
const movement = (u, p, q, reason) =>
  run(
    "INSERT INTO movements(product_id,quantity,reason,created_at,user_id) VALUES(?,?,?,?,?)",
    p,
    q,
    reason,
    now(),
    u.id,
  );
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  role: u.role,
  active: u.active,
});
const saleView = (n) => {
  const s = get(
    "SELECT s.*,c.name customer,u.name cashier FROM sales s LEFT JOIN contacts c ON c.id=s.customer_id JOIN users u ON u.id=s.user_id WHERE s.id=?",
    n,
  );
  assert(s, "Sale not found.", 404);
  s.items = all("SELECT * FROM sale_items WHERE sale_id=?", n);
  s.refunded = get(
    "SELECT COALESCE(SUM(total),0) total FROM returns WHERE sale_id=?",
    n,
  ).total;
  s.payments = all("SELECT * FROM payments WHERE sale_id=?", n);
  s.returns = all("SELECT * FROM returns WHERE sale_id=?", n);
  s.balance = Math.max(0, s.total - s.refunded - s.paid);
  return s;
};
const expectedCash = (s) =>
  s.opening_cash +
  get(
    "SELECT COALESCE(SUM(amount),0) n FROM payments WHERE shift_id=? AND method='cash'",
    s.id,
  ).n -
  get(
    "SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE shift_id=? AND method='cash'",
    s.id,
  ).n;
const rateLimits = new Map();

async function api(req, res, url) {
  let body = {};
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const origin = req.headers.origin;
    assert(
      !origin || new URL(origin).host === req.headers.host,
      "Cross-origin request denied.",
      403,
    );
    assert(
      (req.headers["content-type"] || "").startsWith("application/json"),
      "Use application/json.",
      415,
    );
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      assert(Buffer.byteLength(raw) <= 1024 * 1024, "Request too large.", 413);
    }
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      throw new AppError("Invalid JSON.");
    }
    assert(
      body && typeof body === "object" && !Array.isArray(body),
      "Invalid request.",
    );
  }
  const p = url.pathname,
    m = req.method;
  const reply = (data, status = 200, headers = {}) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(JSON.stringify(data));
  };
  const cookie = (token) =>
    `pos_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;
  if (p === "/api/health") return reply({ status: "ok" });
  if (p === "/api/bootstrap" && m === "GET")
    return reply({ needsSetup: get("SELECT COUNT(*) n FROM users").n === 0 });
  if (p === "/api/setup" && m === "POST") {
    assert(
      get("SELECT COUNT(*) n FROM users").n === 0,
      "Setup already completed.",
      409,
    );
    const name = str(body.name, "Name"),
      username = str(body.username, "Username", 60),
      password = str(body.password, "Password", 200);
    assert(password.length >= 10, "Password must have at least 10 characters.");
    transaction(() => {
      run(
        "INSERT INTO users(name,username,password,role) VALUES(?,?,?,?)",
        name,
        username,
        hash(password),
        "admin",
      );
      const s = {
        ...defaults,
        businessName: str(body.businessName, "Business name"),
        currency: str(body.currency || "LKR", "Currency", 3),
      };
      assert(
        /^[A-Z]{3}$/.test(s.currency),
        "Use a three-letter currency code.",
      );
      run("UPDATE settings SET json=? WHERE id=1", JSON.stringify(s));
    });
    return reply({ ok: true }, 201);
  }
  if (p === "/api/login" && m === "POST") {
    const address = req.socket.remoteAddress;
    const state = rateLimits.get(address) || {
      count: 0,
      until: Date.now() + 600000,
    };
    if (state.until < Date.now()) {
      state.count = 0;
      state.until = Date.now() + 600000;
    }
    assert(
      state.count < 15,
      "Too many attempts. Try again in 10 minutes.",
      429,
    );
    state.count++;
    rateLimits.set(address, state);
    const u = get(
      "SELECT * FROM users WHERE username=? AND active=1",
      str(body.username, "Username", 60),
    );
    assert(
      u && verify(str(body.password, "Password", 200), u.password),
      "Incorrect username or password.",
      401,
    );
    rateLimits.delete(address);
    const token = randomBytes(32).toString("hex");
    run("DELETE FROM sessions WHERE expires<?", Date.now());
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      token,
      u.id,
      Date.now() + 43200000,
    );
    audit(u, "login", {});
    return reply({ user: publicUser(u) }, 200, { "Set-Cookie": cookie(token) });
  }
  const token = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("pos_session="))
    ?.slice(12);
  const u =
    token &&
    get(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1",
      token,
      Date.now(),
    );
  assert(u, "Please sign in.", 401);
  const manager = () =>
    assert(
      ["admin", "manager"].includes(u.role),
      "Manager access required.",
      403,
    );
  const admin = () =>
    assert(u.role === "admin", "Administrator access required.", 403);
  if (p === "/api/me" && m === "GET")
    return reply({ user: publicUser(u), settings: settings() });
  if (p === "/api/logout" && m === "POST") {
    run("DELETE FROM sessions WHERE token=?", token);
    return reply({ ok: true }, 200, {
      "Set-Cookie":
        "pos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    });
  }
  if (p === "/api/password" && m === "POST") {
    assert(
      verify(str(body.currentPassword, "Current password", 200), u.password),
      "Current password is incorrect.",
    );
    const pass = str(body.password, "Password", 200);
    assert(pass.length >= 10, "Password must have at least 10 characters.");
    run("UPDATE users SET password=? WHERE id=?", hash(pass), u.id);
    run("DELETE FROM sessions WHERE user_id=? AND token<>?", u.id, token);
    return reply({ ok: true });
  }
  if (p === "/api/settings" && m === "PUT") {
    admin();
    const s = {
      businessName: str(body.businessName, "Business name"),
      businessType: str(body.businessType, "Business type", 60),
      currency: str(body.currency, "Currency", 3),
      address: str(body.address, "Address", 500, false),
      phone: str(body.phone, "Phone", 60, false),
      taxRate: num(body.taxRate, "Tax rate", 0, 100),
      receiptFooter: str(body.receiptFooter, "Receipt footer", 500, false),
      requireShift: !!body.requireShift,
    };
    assert(/^[A-Z]{3}$/.test(s.currency), "Use a three-letter currency code.");
    run("UPDATE settings SET json=? WHERE id=1", JSON.stringify(s));
    audit(u, "settings.update", {});
    return reply(s);
  }
  if (p === "/api/products" && m === "GET")
    return reply(all("SELECT * FROM products ORDER BY name"));
  if (
    (p === "/api/products" && m === "POST") ||
    (/^\/api\/products\/\d+$/.test(p) && m === "PUT")
  ) {
    manager();
    const v = [
      str(body.name, "Product name"),
      str(body.sku, "SKU", 80),
      str(body.barcode, "Barcode", 80, false),
      str(body.category || "General", "Category", 80),
      money(body.price, "Price"),
      money(body.cost, "Cost"),
      num(body.low_stock ?? 5, "Low stock threshold"),
      str(body.unit || "pcs", "Unit", 30),
      body.tracked === false || body.tracked === 0 ? 0 : 1,
      body.active === false || body.active === 0 ? 0 : 1,
    ];
    const result = transaction(() => {
      let n;
      if (m === "POST") {
        n = Number(
          run(
            "INSERT INTO products(name,sku,barcode,category,price,cost,low_stock,unit,tracked,active) VALUES(?,?,?,?,?,?,?,?,?,?)",
            ...v,
          ).lastInsertRowid,
        );
        const initial = num(body.stock ?? 0, "Opening stock");
        if (initial && v[8]) {
          run("UPDATE products SET stock=? WHERE id=?", initial, n);
          movement(u, n, initial, "Opening stock");
        }
      } else {
        n = id(p.split("/").pop());
        const old = get("SELECT * FROM products WHERE id=?", n);
        assert(old, "Product not found.", 404);
        assert(
          old.tracked === v[8] || old.stock === 0,
          "Stock must be zero before changing stock tracking.",
        );
        assert(old.tracked === v[8] || !get("SELECT id FROM sale_items WHERE product_id=? LIMIT 1", n), "Stock tracking cannot change after a product has been sold. Archive it and create a new product instead.");
        run(
          "UPDATE products SET name=?,sku=?,barcode=?,category=?,price=?,cost=?,low_stock=?,unit=?,tracked=?,active=? WHERE id=?",
          ...v,
          n,
        );
      }
      audit(u, "product.save", { id: n });
      return get("SELECT * FROM products WHERE id=?", n);
    });
    return reply(result, m === "POST" ? 201 : 200);
  }
  if (p === "/api/stock" && m === "POST") {
    manager();
    return reply(
      transaction(() => {
        const n = id(body.product_id),
          q = num(body.quantity, "Adjustment", -1e6, 1e6),
          reason = str(body.reason, "Reason", 500);
        assert(q !== 0, "Adjustment cannot be zero.");
        const product = get("SELECT * FROM products WHERE id=?", n);
        assert(product?.tracked, "Choose a stock-tracked product.");
        assert(product.stock + q >= 0, "Adjustment would make stock negative.");
        run("UPDATE products SET stock=ROUND(stock+?,3) WHERE id=?", q, n);
        movement(u, n, q, reason);
        audit(u, "stock.adjust", { product: n, quantity: q, reason });
        return get("SELECT * FROM products WHERE id=?", n);
      }),
    );
  }
  if (p === "/api/movements" && m === "GET") {
    manager();
    return reply(
      all(
        "SELECT m.*,p.name product,u.name actor FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 500",
      ),
    );
  }
  if (p === "/api/contacts" && m === "GET")
    return reply(all("SELECT * FROM contacts ORDER BY name"));
  if (
    (p === "/api/contacts" && m === "POST") ||
    (/^\/api\/contacts\/\d+$/.test(p) && m === "PUT")
  ) {
    assert(
      ["customer", "supplier"].includes(body.type),
      "Invalid contact type.",
    );
    if (body.type === "supplier") manager();
    const values = [
      body.type,
      str(body.name, "Name"),
      str(body.phone, "Phone", 60, false),
      str(body.email, "Email", 200, false),
      str(body.address, "Address", 500, false),
    ];
    let n;
    if (m === "POST")
      n = Number(
        run(
          "INSERT INTO contacts(type,name,phone,email,address) VALUES(?,?,?,?,?)",
          ...values,
        ).lastInsertRowid,
      );
    else {
      n = id(p.split("/").pop());
      const old = get("SELECT * FROM contacts WHERE id=?", n);
      assert(old, "Contact not found.", 404);
      assert(old.type === body.type, "Contact type cannot be changed.");
      run(
        "UPDATE contacts SET type=?,name=?,phone=?,email=?,address=? WHERE id=?",
        ...values,
        n,
      );
    }
    return reply(
      get("SELECT * FROM contacts WHERE id=?", n),
      m === "POST" ? 201 : 200,
    );
  }
  if (p === "/api/sales" && m === "GET")
    return reply(
      all(
        `SELECT s.*,c.name customer,u.name cashier,COALESCE((SELECT SUM(total) FROM returns r WHERE r.sale_id=s.id),0) refunded FROM sales s LEFT JOIN contacts c ON c.id=s.customer_id JOIN users u ON u.id=s.user_id ${u.role === "cashier" ? "WHERE s.user_id=?" : ""} ORDER BY s.id DESC LIMIT 500`,
        ...(u.role === "cashier" ? [u.id] : []),
      ),
    );
  if (/^\/api\/sales\/\d+$/.test(p) && m === "GET") {
    const s = saleView(id(p.split("/").pop()));
    assert(u.role !== "cashier" || s.user_id === u.id, "Access denied.", 403);
    return reply(s);
  }
  if (p === "/api/sales" && m === "POST") {
    return reply(
      transaction(() => {
        const key = body.request_key
          ? str(body.request_key, "Checkout key", 100)
          : null;
        if (key) {
          const previous = get("SELECT * FROM checkout_keys WHERE key=?", key);
          if (previous) {
            assert(
              previous.user_id === u.id,
              "Checkout key already used.",
              409,
            );
            return saleView(previous.sale_id);
          }
        }
        assert(
          Array.isArray(body.items) &&
            body.items.length > 0 &&
            body.items.length <= 200,
          "Add between 1 and 200 items.",
        );
        const seen = new Set();
        const lines = body.items.map((i) => {
          const n = id(i.product_id);
          assert(!seen.has(n), "Combine duplicate products into one line.");
          seen.add(n);
          const product = get(
            "SELECT * FROM products WHERE id=? AND active=1",
            n,
          );
          assert(product, "Product is unavailable.");
          const quantity = qty(i.quantity);
          assert(
            !product.tracked || product.stock + 0.000001 >= quantity,
            `Not enough stock for ${product.name}.`,
          );
          return {
            product,
            quantity,
            total: Math.round(product.price * quantity),
          };
        });
        const subtotal = lines.reduce((a, i) => a + i.total, 0),
          discount = money(body.discount ?? 0, "Discount");
        assert(discount <= subtotal, "Discount exceeds subtotal.");
        const tax = Math.round(
            ((subtotal - discount) * settings().taxRate) / 100,
          ),
          total = subtotal - discount + tax,
          paid = money(body.paid ?? 0, "Paid amount");
        assert(
          paid <= total,
          "Paid amount exceeds total; enter the sale total and return change.",
        );
        const customer = contact(body.customer_id, "customer");
        assert(
          paid === total || customer,
          "Select a customer for unpaid balances.",
        );
        const payMethod = method(body.method);
        assert(
          payMethod !== "credit" || paid === 0,
          "Credit sales cannot have an initial payment.",
        );
        const shift = shiftFor(u);
        const n = Number(
          run(
            "INSERT INTO sales(created_at,user_id,customer_id,subtotal,discount,tax,total,paid,method,note,table_name,shift_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            now(),
            u.id,
            customer,
            subtotal,
            discount,
            tax,
            total,
            paid,
            payMethod,
            str(body.note, "Note", 500, false),
            str(body.table_name, "Table/order", 80, false),
            shift,
          ).lastInsertRowid,
        );
        run(
          "UPDATE sales SET number=? WHERE id=?",
          "INV-" + String(n).padStart(6, "0"),
          n,
        );
        for (const l of lines) {
          const p = l.product;
          run(
            "INSERT INTO sale_items(sale_id,product_id,name,sku,quantity,price,cost,total) VALUES(?,?,?,?,?,?,?,?)",
            n,
            p.id,
            p.name,
            p.sku,
            l.quantity,
            p.price,
            p.cost,
            l.total,
          );
          if (p.tracked) {
            run(
              "UPDATE products SET stock=ROUND(stock-?,3) WHERE id=?",
              l.quantity,
              p.id,
            );
            movement(u, p.id, -l.quantity, "Sale " + n);
          }
        }
        if (paid > 0)
          run(
            "INSERT INTO payments(sale_id,amount,method,created_at,user_id,shift_id) VALUES(?,?,?,?,?,?)",
            n,
            paid,
            payMethod,
            now(),
            u.id,
            shift,
          );
        if (key)
          run(
            "INSERT INTO checkout_keys(key,user_id,sale_id) VALUES(?,?,?)",
            key,
            u.id,
            n,
          );
        audit(u, "sale.create", { id: n, total });
        return saleView(n);
      }),
      201,
    );
  }
  if (/^\/api\/sales\/\d+\/payments$/.test(p) && m === "POST") {
    manager();
    return reply(
      transaction(() => {
        const n = id(p.split("/")[3]),
          s = saleView(n),
          amount = money(body.amount, "Payment");
        assert(
          amount > 0 && amount <= s.balance,
          "Payment must be positive and no greater than the balance.",
        );
        const pm = method(body.method);
        assert(pm !== "credit", "Choose a payment method.");
        run(
          "INSERT INTO payments(sale_id,amount,method,created_at,user_id,shift_id) VALUES(?,?,?,?,?,?)",
          n,
          amount,
          pm,
          now(),
          u.id,
          shiftFor(u),
        );
        run("UPDATE sales SET paid=paid+? WHERE id=?", amount, n);
        audit(u, "sale.payment", { id: n, amount });
        return saleView(n);
      }),
    );
  }
  if (/^\/api\/sales\/\d+\/returns$/.test(p) && m === "POST") {
    manager();
    return reply(
      transaction(() => {
        const n = id(p.split("/")[3]),
          s = saleView(n);
        assert(
          Array.isArray(body.items) && body.items.length > 0,
          "Select return items.",
        );
        const seen = new Set();
        const lines = body.items.map((i) => {
          const itemId = id(i.sale_item_id);
          assert(!seen.has(itemId), "Duplicate return item.");
          seen.add(itemId);
          const item = s.items.find((x) => x.id === itemId);
          assert(item, "Item is not in this sale.");
          const quantity = qty(i.quantity);
          assert(
            quantity <= item.quantity - item.returned + 0.000001,
            "Return quantity exceeds remaining quantity.",
          );
          const before = Math.round(
            s.total *
              (item.total / (s.subtotal || 1)) *
              (item.returned / item.quantity),
          );
          const after = Math.round(
            s.total *
              (item.total / (s.subtotal || 1)) *
              ((item.returned + quantity) / item.quantity),
          );
          return { item, quantity, total: after - before };
        });
        const rawTotal = lines.reduce((a, l) => a + l.total, 0),
          fullyReturned = s.items.every(
            (i) =>
              i.returned +
                (lines.find((l) => l.item.id === i.id)?.quantity || 0) >=
              i.quantity - 0.000001,
          );
        const total = fullyReturned
          ? s.total - s.refunded
          : Math.min(rawTotal, s.total - s.refunded);
        const cashRefund = Math.max(0, total - s.balance);
        const pm = method(body.method || "cash");
        assert(pm !== "credit", "Choose a refund method.");
        const reason = str(body.reason, "Return reason", 500);
        const shift = shiftFor(u);
        const ret = Number(
          run(
            "INSERT INTO returns(sale_id,user_id,created_at,total,reason,shift_id,method) VALUES(?,?,?,?,?,?,?)",
            n,
            u.id,
            now(),
            total,
            reason,
            shift,
            pm,
          ).lastInsertRowid,
        ); // Only actual money refunded belongs in cash ledger; adjust paid to net receipts.
        if (cashRefund > 0) {
          run("UPDATE sales SET paid=paid-? WHERE id=?", cashRefund, n);
          run(
            "INSERT INTO payments(sale_id,amount,method,created_at,user_id,shift_id) VALUES(?,?,?,?,?,?)",
            n,
            -cashRefund,
            pm,
            now(),
            u.id,
            shift,
          );
        }
        for (const l of lines) {
          run(
            "INSERT INTO return_items(return_id,sale_item_id,quantity,total) VALUES(?,?,?,?)",
            ret,
            l.item.id,
            l.quantity,
            l.total,
          );
          run(
            "UPDATE sale_items SET returned=ROUND(returned+?,3) WHERE id=?",
            l.quantity,
            l.item.id,
          );
          const product = get(
            "SELECT * FROM products WHERE id=?",
            l.item.product_id,
          );
          if (product.tracked) {
            run(
              "UPDATE products SET stock=ROUND(stock+?,3) WHERE id=?",
              l.quantity,
              product.id,
            );
            movement(u, product.id, l.quantity, "Return " + ret);
          }
        }
        audit(u, "sale.return", { id: n, total, cashRefund });
        return saleView(n);
      }),
    );
  }
  if (p === "/api/purchases" && m === "GET") {
    manager();
    return reply(
      all(
        "SELECT p.*,c.name supplier FROM purchases p LEFT JOIN contacts c ON c.id=p.supplier_id ORDER BY p.id DESC LIMIT 500",
      ),
    );
  }
  if (p === "/api/purchases" && m === "POST") {
    manager();
    return reply(
      transaction(() => {
        const supplier = contact(body.supplier_id, "supplier");
        assert(
          Array.isArray(body.items) &&
            body.items.length > 0 &&
            body.items.length <= 200,
          "Add purchase items.",
        );
        const seen = new Set();
        const lines = body.items.map((i) => {
          const n = id(i.product_id);
          assert(!seen.has(n), "Duplicate purchase product.");
          seen.add(n);
          const product = get(
            "SELECT * FROM products WHERE id=? AND tracked=1",
            n,
          );
          assert(product, "Purchases require stock-tracked products.");
          const quantity = qty(i.quantity),
            cost = money(i.cost, "Unit cost");
          return {
            product,
            quantity,
            cost,
            total: Math.round(cost * quantity),
          };
        });
        const total = lines.reduce((a, l) => a + l.total, 0);
        const n = Number(
          run(
            "INSERT INTO purchases(supplier_id,created_at,total,reference,user_id) VALUES(?,?,?,?,?)",
            supplier,
            now(),
            total,
            str(body.reference, "Reference", 200, false),
            u.id,
          ).lastInsertRowid,
        );
        for (const l of lines) {
          run(
            "INSERT INTO purchase_items(purchase_id,product_id,quantity,cost,total) VALUES(?,?,?,?,?)",
            n,
            l.product.id,
            l.quantity,
            l.cost,
            l.total,
          );
          const average = Math.round(
            (l.product.cost * l.product.stock + l.total) /
              (l.product.stock + l.quantity),
          );
          run(
            "UPDATE products SET stock=ROUND(stock+?,3),cost=? WHERE id=?",
            l.quantity,
            average,
            l.product.id,
          );
          movement(u, l.product.id, l.quantity, "Purchase " + n);
        }
        audit(u, "purchase.create", { id: n, total });
        return get("SELECT * FROM purchases WHERE id=?", n);
      }),
      201,
    );
  }
  if (p === "/api/expenses" && m === "GET") {
    manager();
    return reply(
      all(
        "SELECT e.*,u.name actor FROM expenses e JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 500",
      ),
    );
  }
  if (p === "/api/expenses" && m === "POST") {
    manager();
    const amount = money(body.amount, "Amount");
    assert(amount > 0, "Amount must be positive.");
    const pm = method(body.method);
    assert(pm !== "credit", "Choose a payment method.");
    const n = Number(
      run(
        "INSERT INTO expenses(category,description,amount,method,created_at,user_id,shift_id) VALUES(?,?,?,?,?,?,?)",
        str(body.category, "Category", 80),
        str(body.description, "Description", 500),
        amount,
        pm,
        now(),
        u.id,
        shiftFor(u),
      ).lastInsertRowid,
    );
    audit(u, "expense.create", { id: n, amount });
    return reply(get("SELECT * FROM expenses WHERE id=?", n), 201);
  }
  if (p === "/api/shifts" && m === "GET") {
    const open = activeShift(u);
    return reply({
      current: open ? { ...open, expected_cash: expectedCash(open) } : null,
      history: all(
        `SELECT s.*,u.name cashier FROM shifts s JOIN users u ON u.id=s.user_id ${u.role === "cashier" ? "WHERE s.user_id=?" : ""} ORDER BY s.id DESC LIMIT 100`,
        ...(u.role === "cashier" ? [u.id] : []),
      ),
    });
  }
  if (p === "/api/shifts/open" && m === "POST") {
    assert(!activeShift(u), "You already have an open shift.");
    const n = Number(
      run(
        "INSERT INTO shifts(user_id,opened_at,opening_cash) VALUES(?,?,?)",
        u.id,
        now(),
        money(body.opening_cash, "Opening cash"),
      ).lastInsertRowid,
    );
    return reply(get("SELECT * FROM shifts WHERE id=?", n), 201);
  }
  if (p === "/api/shifts/close" && m === "POST") {
    const s = activeShift(u);
    assert(s, "No open shift.");
    run(
      "UPDATE shifts SET closed_at=?,closing_cash=?,expected_cash=? WHERE id=?",
      now(),
      money(body.closing_cash, "Closing cash"),
      expectedCash(s),
      s.id,
    );
    return reply(get("SELECT * FROM shifts WHERE id=?", s.id));
  }
  if (p === "/api/users" && m === "GET") {
    admin();
    return reply(
      all("SELECT id,name,username,role,active FROM users ORDER BY name"),
    );
  }
  if (
    (p === "/api/users" && m === "POST") ||
    (/^\/api\/users\/\d+$/.test(p) && m === "PUT")
  ) {
    admin();
    assert(
      ["admin", "manager", "cashier"].includes(body.role),
      "Invalid role.",
    );
    const name = str(body.name, "Name"),
      username = str(body.username, "Username", 60),
      active = body.active === false || body.active === 0 ? 0 : 1;
    let n;
    transaction(() => {
      if (m === "POST") {
        const pass = str(body.password, "Password", 200);
        assert(pass.length >= 10, "Password must have at least 10 characters.");
        n = Number(
          run(
            "INSERT INTO users(name,username,password,role,active) VALUES(?,?,?,?,?)",
            name,
            username,
            hash(pass),
            body.role,
            active,
          ).lastInsertRowid,
        );
      } else {
        n = id(p.split("/").pop());
        assert(
          get("SELECT id FROM users WHERE id=?", n),
          "User not found.",
          404,
        );
        assert(
          n !== u.id || (active && body.role === "admin"),
          "You cannot disable or demote yourself.",
        );
        const admins = get(
          "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?",
          n,
        ).n;
        assert(
          admins > 0 || (active && body.role === "admin"),
          "Keep at least one active administrator.",
        );
        run(
          "UPDATE users SET name=?,username=?,role=?,active=? WHERE id=?",
          name,
          username,
          body.role,
          active,
          n,
        );
        if (body.password) {
          const pass = str(body.password, "Password", 200);
          assert(
            pass.length >= 10,
            "Password must have at least 10 characters.",
          );
          run("UPDATE users SET password=? WHERE id=?", hash(pass), n);
        }
        run("DELETE FROM sessions WHERE user_id=?", n);
      }
      audit(u, "user.save", { id: n });
    });
    return reply(publicUser(get("SELECT * FROM users WHERE id=?", n)));
  }
  if (p === "/api/reports" && m === "GET") {
    manager();
    const from = url.searchParams.get("from") || now().slice(0, 10),
      to = url.searchParams.get("to") || now().slice(0, 10);
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(to) &&
        from <= to,
      "Choose a valid date range.",
    );
    const range = [from + "T00:00:00.000Z", to + "T23:59:59.999Z"];
    const sales = get(
      "SELECT COUNT(*) count,COALESCE(SUM(total),0) revenue,COALESCE(SUM(discount),0) discounts,COALESCE(SUM(tax),0) tax FROM sales WHERE created_at BETWEEN ? AND ?",
      ...range,
    );
    const refunds = get(
      "SELECT COALESCE(SUM(total),0) n FROM returns WHERE created_at BETWEEN ? AND ?",
      ...range,
    ).n;
    const expenses = get(
      "SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE created_at BETWEEN ? AND ?",
      ...range,
    ).n;
    const cogs =
      get(
        "SELECT COALESCE(SUM(ROUND(i.cost*i.quantity)),0) n FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.created_at BETWEEN ? AND ?",
        ...range,
      ).n -
      get(
        "SELECT COALESCE(SUM(ROUND(i.cost*r.quantity)),0) n FROM return_items r JOIN sale_items i ON i.id=r.sale_item_id JOIN returns t ON t.id=r.return_id WHERE t.created_at BETWEEN ? AND ?",
        ...range,
      ).n;
    const refundTax = get(
      "SELECT COALESCE(SUM(CASE WHEN s.total>0 THEN ROUND(r.total*s.tax*1.0/s.total) ELSE 0 END),0) n FROM returns r JOIN sales s ON s.id=r.sale_id WHERE r.created_at BETWEEN ? AND ?",
      ...range,
    ).n;
    const outstanding = get(
      "SELECT COALESCE(SUM(MAX(0,s.total-s.paid-COALESCE((SELECT SUM(r.total) FROM returns r WHERE r.sale_id=s.id),0))),0) n FROM sales s",
    ).n;
    return reply({
      from,
      to,
      ...sales,
      refunds,
      expenses,
      cogs,
      netRevenue: sales.revenue - refunds,
      netTax: sales.tax - refundTax,
      profit: sales.revenue - refunds - sales.tax + refundTax - cogs - expenses,
      outstanding,
      inventoryValue: get(
        "SELECT COALESCE(SUM(ROUND(stock*cost)),0) n FROM products WHERE tracked=1",
      ).n,
      lowStock: all(
        "SELECT * FROM products WHERE active=1 AND tracked=1 AND stock<=low_stock ORDER BY stock",
      ),
      daily: all(
        "SELECT substr(created_at,1,10) day,SUM(total) total,COUNT(*) count FROM sales WHERE created_at BETWEEN ? AND ? GROUP BY day ORDER BY day",
        ...range,
      ),
      topProducts: all(
        "SELECT i.name,SUM(i.quantity) quantity,SUM(i.total) total FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.created_at BETWEEN ? AND ? GROUP BY i.product_id ORDER BY total DESC LIMIT 10",
        ...range,
      ),
      payments: all(
        "SELECT method,SUM(amount) total FROM payments WHERE created_at BETWEEN ? AND ? GROUP BY method",
        ...range,
      ),
      debtors: all(
        "SELECT s.id,s.number,c.name customer,MAX(0,s.total-s.paid-COALESCE((SELECT SUM(total) FROM returns WHERE sale_id=s.id),0)) balance FROM sales s JOIN contacts c ON c.id=s.customer_id WHERE balance>0 ORDER BY s.id DESC",
      ),
    });
  }
  if (p === "/api/audit" && m === "GET") {
    admin();
    return reply(
      all(
        "SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300",
      ),
    );
  }
  if (p === "/api/export" && m === "GET") {
    manager();
    const kind = url.searchParams.get("type");
    assert(
      ["products", "sales", "contacts"].includes(kind),
      "Invalid export type.",
    );
    const rows =
      kind === "sales"
        ? all(
            "SELECT number,created_at,subtotal,discount,tax,total,paid,method FROM sales ORDER BY id",
          )
        : kind === "products"
          ? all(
              "SELECT name,sku,barcode,category,price,cost,stock,unit,tracked,active FROM products",
            )
          : all("SELECT type,name,phone,email,address FROM contacts");
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const cell = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    res.writeHead(200, {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${kind}.csv"`,
      "Cache-Control": "no-store",
    });
    return res.end(
      [
        columns.map(cell).join(","),
        ...rows.map((r) => columns.map((c) => cell(r[c])).join(",")),
      ].join("\r\n"),
    );
  }
  if (p === "/api/backup" && m === "GET") {
    admin();
    const path = join(
      dataDir,
      "download-" + randomBytes(8).toString("hex") + ".sqlite",
    );
    db.prepare("VACUUM INTO ?").run(path);
    const bytes = readFileSync(path);
    unlinkSync(path);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="versapos-backup.sqlite"',
      "Cache-Control": "no-store",
    });
    return res.end(bytes);
  }
  throw new AppError("Endpoint not found.", 404);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    assert(
      req.method === "GET" || req.method === "HEAD",
      "Method not allowed.",
      405,
    );
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/styles.css": "styles.css",
    };
    const file = files[url.pathname];
    assert(file, "Not found.", 404);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.setHeader("Cache-Control", "no-cache");
    res.end(
      req.method === "HEAD"
        ? undefined
        : readFileSync(join(root, "public", file)),
    );
  } catch (e) {
    const duplicate = /UNIQUE constraint failed/.test(e.message);
    const status = duplicate ? 409 : e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent)
      res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: duplicate
          ? "This SKU, username, or record already exists."
          : status === 500
            ? "Unexpected server error."
            : e.message,
      }),
    );
  }
});
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () => console.log(`VersaPOS listening on port ${server.address().port}`),
);
const stop = () =>
  server.close(() => {
    db.close();
    process.exit(0);
  });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
