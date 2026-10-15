const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const checkoutKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, "0")).join("");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  pos: "M3 4h18v12H3z M7 20h10 M12 16v4 M7 8h4 M7 12h9",
  products: "M12 3 3 8v9l9 5 9-5V8z M3 8l9 5 9-5 M12 13v9 M7 5l9 5",
  sales: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3",
  customers:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-4",
  suppliers:
    "M3 7h11v10H3z M14 10h4l3 4v3h-7 M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  purchases: "M3 4h2l3 12h10l3-9H6 M9 20h.01 M17 20h.01",
  expenses: "M3 5h18v14H3z M3 9h18 M7 14h3 M16 14h2",
  reports: "M4 20h17 M7 16V9 M12 16V4 M17 16v-5",
  shifts: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2",
  users: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-2a8 8 0 0 1 16 0v2",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  plus: "M12 5v14 M5 12h14",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  logout: "M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  check: "M5 12l4 4L19 6",
};
const icon = (name, size = 17) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.products}"/></svg>`;
const state = {
  user: null,
  settings: {},
  page: "dashboard",
  products: [],
  contacts: [],
  sales: [],
  cart: [],
  category: "All",
  search: "",
  held: [],
  ticket: {
    discount: 0,
    customer_id: "",
    method: "cash",
    note: "",
    table_name: "",
    request_key: checkoutKey(),
  },
};
const money = (cents) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: state.settings.currency || "LKR",
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
const amount = (n) => Number((n || 0) / 100).toFixed(2);
const date = (s) =>
  new Date(s).toLocaleString("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const manager = () => ["admin", "manager"].includes(state.user?.role);
const admin = () => state.user?.role === "admin";
let toastTimer;
function toast(message, error = false) {
  const t = $("#toast");
  t.textContent = message;
  t.className = "show" + (error ? " error-toast" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.className = "";
  }, 4500);
}
async function api(path, method = "GET", data) {
  const res = await fetch("/api" + path, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) {
    if (res.status === 401 && state.user) {
      state.user = null;
      $("#modal").close();
      showAuth(false);
    }
    throw new Error(result.error || "Request failed.");
  }
  return result;
}
const btn = (label, action, primary = false, extra = "") =>
  `<button class="btn${primary ? " primary" : ""}" data-action="${action}" ${extra}>${label}</button>`;
const field = (
  label,
  name,
  value = "",
  type = "text",
  attrs = "",
  wide = false,
) =>
  `<div class="field${wide ? " wide" : ""}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
const select = (label, name, options, value = "", attrs = "") =>
  `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
const textarea = (label, name, value = "", wide = true) =>
  `<div class="field${wide ? " wide" : ""}"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" maxlength="500">${esc(value)}</textarea></div>`;
const check = (label, name, checked) =>
  `<label class="check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}>${label}</label>`;
const table = (head, rows, empty = "No records yet.") =>
  `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${head.length}"><div class="empty">${empty}</div></td></tr>`}</tbody></table></div>`;
const badge = (text, style = "") =>
  `<span class="badge ${style}">${esc(text)}</span>`;
function modal(title, content, onSubmit, width) {
  const d = $("#modal");
  d.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div><div class="modal-body">${content}</div>`;
  d.style.width = width ? `min(${width}px,calc(100% - 32px))` : "";
  if (!d.open) d.showModal();
  if (onSubmit)
    $("form", d).addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("button[type=submit]", d);
      b.disabled = true;
      const err = $(".form-error", d);
      if (err) err.textContent = "";
      try {
        await onSubmit(new FormData(e.target), e.target);
      } catch (error) {
        if (err) err.textContent = error.message;
        else toast(error.message, true);
      } finally {
        b.disabled = false;
      }
    });
}
const formEnd = (label) =>
  `<p class="error form-error" role="alert"></p><div class="modal-foot"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">${label}</button></div></form>`;
const dataOf = (f) => Object.fromEntries(f.entries());
function showAuth(setup, requiresSetupToken = false) {
  $("#app").innerHTML =
    `<div class="auth"><section class="auth-story"><div class="brand"><span class="brand-mark">v</span>VersaPOS<span class="small" style="font-weight:400;letter-spacing:0;margin-left:5px;opacity:.6">/ workspace</span></div><span class="pill">One workspace. Every kind of business.</span><h1>A little less busy.<br>A lot more business.</h1><p>From the first sale to the last stock count, keep everything moving in one simple workspace.</p></section><section class="auth-form"><form class="auth-card" id="auth-form"><div class="eyebrow">${setup ? "A fresh start" : "Welcome back"}</div><h2>${setup ? "Make it your own." : "Your business awaits."}</h2><p>${setup ? "Create your business and its first administrator. No default passwords." : "Sign in to your workspace to get things moving."}</p>${setup && requiresSetupToken ? field("Installation key", "setupToken", "", "password", 'required autocomplete="off" minlength="32"') : ""}${setup ? field("Business name", "businessName", "", "text", 'required maxlength="200" placeholder="e.g. Greenleaf Store"') + field("Your name", "name", "", "text", 'required autocomplete="name" maxlength="200"') : ""}${field("Username", "username", "", "text", 'required autocomplete="username" maxlength="60"')}${field("Password", "password", "", "password", `required autocomplete="${setup ? "new-password" : "current-password"}" ${setup ? 'minlength="10"' : ""} maxlength="200"`)}${
      setup
        ? select(
            "Currency",
            "currency",
            [
              ["LKR", "Sri Lankan Rupee · LKR"],
              ["USD", "US Dollar · USD"],
              ["EUR", "Euro · EUR"],
              ["GBP", "British Pound · GBP"],
              ["INR", "Indian Rupee · INR"],
              ["AUD", "Australian Dollar · AUD"],
            ],
            "LKR",
          )
        : ""
    }<p class="error form-error" role="alert"></p><button class="btn primary" type="submit">${setup ? "Create workspace" : "Sign in"} ${icon("arrow")}</button><div class="tagline">YOUR SALES. YOUR STOCK. YOUR BUSINESS.</div></form></section></div>`;
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("button[type=submit]", e.target);
    b.disabled = true;
    try {
      const data = dataOf(new FormData(e.target));
      if (setup) await api("/setup", "POST", data);
      await api("/login", "POST", data);
      await loadWorkspace();
    } catch (error) {
      $(".form-error", e.target).textContent = error.message;
    } finally {
      b.disabled = false;
    }
  });
}
async function refreshData() {
  const [products, contacts, sales] = await Promise.all([
    api("/products"),
    api("/contacts"),
    api("/sales"),
  ]);
  Object.assign(state, { products, contacts, sales });
  state.cart = state.cart.map((i) => ({
    ...i,
    product: products.find((p) => p.id === i.product.id) || i.product,
  }));
}
async function loadWorkspace() {
  const me = await api("/me");
  Object.assign(state, me);
  await refreshData();
  state.page = manager() ? "dashboard" : "pos";
  state.cart = [];
  state.held = [];
  resetTicket();
  renderShell();
  await renderPage();
}
function resetTicket() {
  state.ticket = {
    discount: 0,
    customer_id: "",
    method: "cash",
    note: "",
    table_name: "",
    request_key: checkoutKey(),
  };
}
const navItems = () =>
  [
    ["dashboard", "Overview", manager()],
    ["pos", "Point of sale", true],
    ["products", "Products & stock", manager()],
    ["sales", "Sales history", true],
    ["customers", "Customers", true],
    ["suppliers", "Suppliers", manager()],
    ["purchases", "Purchases", manager()],
    ["expenses", "Expenses", manager()],
    ["reports", "Reports", manager()],
    ["shifts", "Cash shifts", true],
    ["users", "Team & access", admin()],
    ["settings", "Settings", admin()],
  ].filter((x) => x[2]);
function renderShell() {
  $("#app").innerHTML =
    `<div class="shell"><div class="mobile-shade" data-action="toggle-menu"></div><aside class="sidebar"><div class="brand"><span class="brand-mark">v</span>VersaPOS</div><div class="workspace">${state.settings.logoData ? `<img class="shop-logo" src="${esc(state.settings.logoData)}" alt="Shop logo">` : ""}<span>Workspace</span><strong>${esc(state.settings.businessName)}</strong></div><div class="nav-caption">YOUR BUSINESS</div><nav class="nav">${navItems()
      .map(
        ([key, name]) =>
          `<button data-page="${key}" class="${state.page === key ? "active" : ""}">${icon(key)}${name}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-foot"><div class="note-box">Small details.<br>Better business days.</div><div class="user-card"><div class="avatar">${esc(state.user.name.slice(0, 2).toUpperCase())}</div><div><strong>${esc(state.user.name)}</strong><button class="icon-btn small" data-action="change-password" style="padding:0;font-size:10px">Password</button><span class="muted">${esc(state.user.role)}</span></div><button class="icon-btn" data-action="logout" aria-label="Sign out" style="margin-left:auto">${icon("logout")}</button></div></div></aside><main class="main"><header class="topbar"><div class="actions"><button class="icon-btn mobile-menu" data-action="toggle-menu" aria-label="Open menu">${icon("menu")}</button><span class="trail">Workspace <span style="margin:0 12px;color:#c4ccbd">/</span> <strong id="breadcrumb"></strong></span></div><div class="top-actions"><span class="date muted">${new Date().toLocaleDateString("en-LK", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</span><span><i class="live-dot"></i>Connected</span>${btn(icon("plus") + " New sale", "new-sale", true)}</div></header><div class="content" id="content"></div></main></div>`;
}
const pageHead = (title, description, actions = "") =>
  `<div class="page-head"><div><div class="eyebrow">${esc(state.settings.businessType || "Your business")} workspace</div><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
let navigationVersion = 0;
async function renderPage() {
  const version = ++navigationVersion;
  const page = state.page;
  $$(".nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.page === page),
  );
  $("#breadcrumb").textContent =
    navItems().find((x) => x[0] === page)?.[1] || "";
  $(".shell").classList.remove("menu-open");
  const content = $("#content");
  content.innerHTML = '<div class="loading">Loading…</div>';
  try {
    let html;
    if (page === "dashboard")
      html = dashboard(
        await api("/reports?from=" + new Date().toISOString().slice(0, 10)),
      );
    else if (page === "pos") html = posPage();
    else if (page === "products") html = productsPage();
    else if (page === "sales") html = salesPage();
    else if (["customers", "suppliers"].includes(page))
      html = contactsPage(page);
    else if (page === "purchases")
      html = purchasesPage(await api("/purchases"));
    else if (page === "expenses") html = expensesPage(await api("/expenses"));
    else if (page === "shifts") html = shiftsPage(await api("/shifts"));
    else if (page === "users") {
      state.users = await api("/users");
      html = usersPage();
    } else if (page === "settings") html = settingsPage();
    else if (page === "reports") {
      const from =
          state.reportFrom || new Date().toISOString().slice(0, 8) + "01",
        to = state.reportTo || new Date().toISOString().slice(0, 10);
      html = reportsPage(await api(`/reports?from=${from}&to=${to}`));
    }
    if (version !== navigationVersion) return;
    content.innerHTML = html;
    bindPage();
  } catch (e) {
    if (version === navigationVersion && state.user)
      content.innerHTML = `<div class="empty"><strong>Couldn’t load this page.</strong>${esc(e.message)}<p style="margin-top:20px">${btn("Try again", "refresh")}</p></div>`;
  }
}
const stat = (label, value, note, glyph) =>
  `<div class="stat"><div class="stat-label">${label}${icon(glyph)}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
function salesRows(sales) {
  return sales.map((s) => {
    const balance = Math.max(0, s.total - s.refunded - s.paid);
    return `<tr><td><strong>${esc(s.number)}</strong><span class="sub">${date(s.created_at)}</span></td><td>${esc(s.customer || "Walk-in customer")}</td><td class="mono">${money(s.total - s.refunded)}</td><td>${badge(s.refunded === s.total && s.refunded > 0 ? "Returned" : balance ? "Balance due" : "Paid", balance ? "warning" : s.refunded ? "neutral" : "")}</td><td>${esc(s.method)}</td><td><button class="btn small" data-action="view-sale" data-id="${s.id}">View receipt</button></td></tr>`;
  });
}
function dashboard(r) {
  return (
    pageHead(
      "A good day for business.",
      "Here’s what’s happening in your workspace today.",
      btn("Open register " + icon("arrow"), "new-sale", true),
    ) +
    `<div class="stats">${stat("Today’s net sales", money(r.netRevenue), `${r.count} completed transaction${r.count === 1 ? "" : "s"} · UTC day`, "sales")}${stat("Estimated profit", money(r.profit), "After tax, item costs & expenses", "reports")}${stat("Customer balances", money(r.outstanding), "Across all outstanding invoices", "customers")}${stat("Low-stock products", r.lowStock.length, "Products that need your attention", "products")}</div><div class="grid-two"><section class="panel"><div class="panel-head"><div><h2>Today, at a glance</h2><p class="small muted" style="margin-top:5px">Payments received, less refunds</p></div>${badge("Live")}</div><div class="panel-body">${r.payments.length ? `<div class="chart">${r.payments.map((x) => `<div class="chart-col"><span class="chart-value">${money(x.total)}</span><div class="bar" style="height:${Math.max(3, (Math.max(0, x.total) / Math.max(1, ...r.payments.map((x) => x.total))) * 125)}px"></div><span class="chart-label">${esc(x.method.toUpperCase())}</span></div>`).join("")}</div>` : '<div class="empty"><strong>Your next sale starts here.</strong>Complete a sale to see today’s activity.</div>'}</div></section><section class="panel"><div class="panel-head"><h2>Stock watch</h2><button class="icon-btn" data-page="products" aria-label="View products">${icon("arrow")}</button></div><div class="panel-body">${
      r.lowStock.length
        ? r.lowStock
            .slice(0, 4)
            .map(
              (p) =>
                `<div class="low-item"><div><strong>${esc(p.name)}</strong><span class="sub">${esc(p.sku)} · ${esc(p.category)}</span></div>${badge(p.stock + " " + p.unit + " left", p.stock === 0 ? "red" : "warning")}</div>`,
            )
            .join("")
        : '<div class="empty"><strong>All looking good.</strong>No products below their stock threshold.</div>'
    }</div></section></div><section class="panel"><div class="panel-head"><h2>Recent transactions</h2><button class="btn small" data-page="sales">View all ${icon("arrow")}</button></div>${table(["Invoice", "Customer", "Net total", "Status", "Payment", ""], salesRows(state.sales.slice(0, 6)), "Your first invoice will appear here.")}</section>${state.products.length === 0 ? `<div class="note-box section-gap">Start with your product catalog. Add physical products with stock tracking, or services without stock. ${btn("Add your first product", "add-product", true)}</div>` : ""}`
  );
}
function totals() {
  const subtotal = state.cart.reduce(
    (s, i) => s + Math.round(i.product.price * i.quantity),
    0,
  );
  const discount = Math.min(
    subtotal,
    Math.max(0, Math.round(Number(state.ticket.discount || 0) * 100)),
  );
  const tax = Math.round(
    ((subtotal - discount) * state.settings.taxRate) / 100,
  );
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}
function posPage() {
  const categories = [
    "All",
    ...new Set(state.products.filter((p) => p.active).map((p) => p.category)),
  ];
  return (
    pageHead(
      "Point of sale",
      "A smooth checkout, from the first item to the last.",
      btn(`Held orders (${state.held.length})`, "held-orders"),
    ) +
    `<div class="pos-layout"><div><div class="toolbar"><input id="pos-search" placeholder="Search products, SKU or scan a barcode…" aria-label="Search or scan products" value="${esc(state.search)}"><span class="table-count">${state.products.filter((p) => p.active).length} products</span></div><div class="category-tabs">${categories.map((c) => `<button data-action="category" data-category="${esc(c)}" class="${c === state.category ? "active" : ""}">${esc(c)}</button>`).join("")}</div><div class="product-grid" id="product-grid">${productCards()}</div></div><aside class="panel cart"><div class="cart-head"><h2>Current order <span class="small muted" id="cart-count">(${state.cart.length})</span></h2><button class="icon-btn" data-action="clear-cart">Clear</button></div><div id="cart-content">${cartContent()}</div></aside></div>`
  );
}
function productCards() {
  const search = state.search.toLowerCase();
  const products = state.products.filter(
    (p) =>
      p.active &&
      (state.category === "All" || p.category === state.category) &&
      [p.name, p.sku, p.barcode, p.category].some((v) =>
        v.toLowerCase().includes(search),
      ),
  );
  return products.length
    ? products
        .map(
          (p) =>
            `<button class="product-card" data-action="add-cart" data-id="${p.id}" ${p.tracked && p.stock === 0 ? "disabled" : ""}><span class="stock-tag">${p.tracked ? esc(p.stock + " " + p.unit) : "Service"}</span><div class="product-icon">${icon("products", 23)}</div><strong>${esc(p.name)}</strong><span class="sku">${esc(p.sku)}</span><div class="price-row"><b>${money(p.price)}</b><span class="muted">+</span></div></button>`,
        )
        .join("")
    : '<div class="empty filter-empty"><strong>No products here yet.</strong>Add products in Products & stock, or try another search.</div>';
}
function cartContent() {
  const t = totals();
  return `<div class="cart-items">${state.cart.length ? state.cart.map((i) => `<div class="cart-item"><div class="cart-item-top"><div><strong>${esc(i.product.name)}</strong><div class="sub">${money(i.product.price)} / ${esc(i.product.unit)}</div></div><button class="icon-btn" data-action="remove-cart" data-id="${i.product.id}" aria-label="Remove ${esc(i.product.name)}">✕</button></div><div class="cart-item-bottom"><div class="quantity-control"><button data-action="decrease-cart" data-id="${i.product.id}" aria-label="Decrease quantity">−</button><input type="number" min="0.001" step="0.001" value="${i.quantity}" data-quantity="${i.product.id}" aria-label="Quantity for ${esc(i.product.name)}"><button data-action="add-cart" data-id="${i.product.id}" aria-label="Increase quantity">+</button></div><strong class="small mono">${money(Math.round(i.product.price * i.quantity))}</strong></div></div>`).join("") : '<div class="empty">Your order is waiting.<br><br>Pick a product to get started.</div>'}</div><div class="cart-details"><div class="row">${select("Customer", "customer_id", [["", "Walk-in customer"], ...state.contacts.filter((c) => c.type === "customer").map((c) => [c.id, c.name])], state.ticket.customer_id)}<button class="icon-btn" data-action="add-customer" aria-label="Add customer" style="flex:0;margin-top:16px">${icon("plus")}</button></div>${state.settings.businessType === "Restaurant" ? field("Table / order name", "table_name", state.ticket.table_name, "text", 'maxlength="80" placeholder="e.g. Table 04 / Takeaway"') : ""}<div class="row">${field("Discount", "discount", state.ticket.discount || "", "number", 'min="0" step="0.01" placeholder="0.00"')}${select(
    "Payment",
    "method",
    [
      ["cash", "Cash"],
      ["card", "Card"],
      ["bank", "Bank transfer"],
      ["credit", "Credit / Pay later"],
    ],
    state.ticket.method,
  )}</div><div class="total-line"><span>Subtotal</span><span>${money(t.subtotal)}</span></div><div class="total-line"><span>Discount</span><span>−${money(t.discount)}</span></div><div class="total-line"><span>Tax (${state.settings.taxRate}%)</span><span>${money(t.tax)}</span></div><div class="grand-total"><span>Total</span><span class="mono">${money(t.total)}</span></div>${btn("Charge " + money(t.total) + " " + icon("arrow"), "checkout", true, `${state.cart.length ? "" : "disabled"} style="width:100%;padding:13px"`)}<div class="actions" style="margin-top:12px;justify-content:space-between"><button class="icon-btn small" data-action="hold-order">Hold order</button><button class="icon-btn small" data-action="order-note">Add note${state.ticket.note ? " •" : ""}</button></div></div>`;
}
function renderCart() {
  $("#cart-count").textContent = "(" + state.cart.length + ")";
  $("#cart-content").innerHTML = cartContent();
}
function addCart(n) {
  const p = state.products.find((p) => p.id === Number(n));
  if (!p?.active) return;
  const old = state.cart.find((i) => i.product.id === p.id),
    next = (old?.quantity || 0) + 1;
  if (p.tracked && next > p.stock)
    return toast("Not enough stock for " + p.name, true);
  if (old) old.quantity = next;
  else state.cart.push({ product: p, quantity: 1 });
  renderCart();
}
function productsPage() {
  return (
    pageHead(
      "Products & stock",
      "Your catalog, with every unit accounted for.",
      `<a class="btn" href="/api/export?type=products">Export CSV</a>${btn(icon("plus") + " Add product", "add-product", true)}`,
    ) +
    `<div class="toolbar"><input id="list-search" placeholder="Search products…" aria-label="Search products"><select id="product-filter" aria-label="Filter products"><option value="all">All products</option><option value="low">Low stock</option><option value="services">Services</option><option value="inactive">Archived</option></select><span class="table-count">${state.products.length} products</span>${btn("Stock movements", "stock-history")}</div><section class="panel" id="products-table">${productsTable()}</section>`
  );
}
function productsTable(search = "", filter = "all") {
  const rows = state.products.filter(
    (p) =>
      [p.name, p.sku, p.barcode, p.category].some((x) =>
        x.toLowerCase().includes(search.toLowerCase()),
      ) &&
      (filter === "all" ||
        (filter === "low" && p.active && p.tracked && p.stock <= p.low_stock) ||
        (filter === "services" && !p.tracked) ||
        (filter === "inactive" && !p.active)),
  );
  return table(
    ["Product", "Category", "Price", "Cost", "Stock", "Status", ""],
    rows.map(
      (p) =>
        `<tr><td><strong>${esc(p.name)}</strong><span class="sub">${esc(p.sku)}${p.barcode ? " · " + esc(p.barcode) : ""}</span></td><td>${esc(p.category)}</td><td class="mono">${money(p.price)}</td><td class="mono">${money(p.cost)}</td><td>${p.tracked ? esc(p.stock + " " + p.unit) : "— Service"}</td><td>${badge(!p.active ? "Archived" : p.tracked && p.stock <= p.low_stock ? "Low stock" : "Active", !p.active ? "neutral" : p.tracked && p.stock <= p.low_stock ? "warning" : "")}</td><td><div class="actions"><button class="btn small" data-action="edit-product" data-id="${p.id}">Edit</button>${p.tracked ? `<button class="btn small" data-action="adjust-stock" data-id="${p.id}">Adjust stock</button>` : ""}</div></td></tr>`,
    ),
    "No matching products. Add your first product to get started.",
  );
}
function productForm(product) {
  const p = product || {
    tracked: 1,
    active: 1,
    low_stock: 5,
    unit: "pcs",
    category: "General",
  };
  modal(
    product ? "Edit product" : "Add a product",
    `<form><div class="form-grid">${field("Product / service name", "name", p.name, "text", 'required maxlength="200"', true)}${field("SKU", "sku", p.sku, "text", 'required maxlength="80"')}${field("Barcode (optional)", "barcode", p.barcode, "text", 'maxlength="80"')}${field("Category", "category", p.category, "text", 'required maxlength="80" list="categories"')}<datalist id="categories">${[...new Set(state.products.map((x) => x.category))].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>${field("Unit", "unit", p.unit, "text", 'required maxlength="30" placeholder="pcs / kg / hour"')}${field("Selling price", "price", amount(p.price), "number", 'required min="0" step="0.01"')}${field("Unit cost", "cost", amount(p.cost), "number", 'required min="0" step="0.01"')}${!product ? field("Opening stock", "stock", 0, "number", 'required min="0" step="0.001"') : ""}${field("Low-stock threshold", "low_stock", p.low_stock, "number", 'required min="0" step="0.001"')}${check("Track stock (uncheck for services)", "tracked", p.tracked)}${check("Active in the register", "active", p.active)}</div>${formEnd("Save product")}`,
    async (f) => {
      const data = dataOf(f);
      ["price", "cost", "stock", "low_stock"].forEach((k) => {
        if (k in data) data[k] = Number(data[k]);
      });
      data.tracked = f.has("tracked");
      data.active = f.has("active");
      await api(
        "/products" + (product ? "/" + product.id : ""),
        product ? "PUT" : "POST",
        data,
      );
      $("#modal").close();
      await refreshData();
      await renderPage();
      toast("Product saved.");
    },
  );
}
function adjustStock(p) {
  modal(
    "Adjust stock",
    `<div class="inline-info">${esc(p.name)} · Current stock: ${p.stock} ${esc(p.unit)}</div><form>${field("Quantity change (+ add / − remove)", "quantity", "", "number", 'required step="0.001" placeholder="e.g. 5 or -2"')}${textarea("Reason", "reason")}${formEnd("Apply adjustment")}`,
    async (f) => {
      await api("/stock", "POST", {
        product_id: p.id,
        quantity: Number(f.get("quantity")),
        reason: f.get("reason"),
      });
      $("#modal").close();
      await refreshData();
      await renderPage();
      toast("Stock updated.");
    },
  );
}
function contactsPage(page) {
  const type = page === "customers" ? "customer" : "supplier";
  const list = state.contacts.filter((c) => c.type === type);
  return (
    pageHead(
      type === "customer" ? "Customers" : "Suppliers",
      type === "customer"
        ? "A familiar face behind every transaction."
        : "Keep your supply chain close.",
      `<a class="btn" href="/api/export?type=contacts">Export CSV</a>${btn(icon("plus") + " Add " + type, "add-" + type, true)}`,
    ) +
    `<div class="toolbar"><input id="contact-search" placeholder="Search ${page}…" aria-label="Search contacts"><span class="table-count">${list.length} ${page}</span></div><section class="panel">${table(
      ["Name", "Phone", "Email", "Address", ""],
      list.map(
        (c) =>
          `<tr data-contact-row="${esc([c.name, c.phone, c.email].join(" ").toLowerCase())}"><td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone || "—")}</td><td>${esc(c.email || "—")}</td><td>${esc(c.address || "—")}</td><td><button class="btn small" data-action="edit-contact" data-id="${c.id}">Edit</button></td></tr>`,
      ),
      "Add a " + type + " to get started.",
    )}</section>`
  );
}
function contactForm(type, c) {
  modal(
    c ? "Edit " + type : "Add " + type,
    `<form><div class="form-grid">${field("Name", "name", c?.name, "text", 'required maxlength="200"', true)}${field("Phone", "phone", c?.phone, "tel", 'maxlength="60"')}${field("Email", "email", c?.email, "email", 'maxlength="200"')}${textarea("Address", "address", c?.address)}</div>${formEnd("Save " + type)}`,
    async (f) => {
      const saved = await api(
        "/contacts" + (c ? "/" + c.id : ""),
        c ? "PUT" : "POST",
        { ...dataOf(f), type },
      );
      $("#modal").close();
      await refreshData();
      if (state.page === "pos" && type === "customer")
        state.ticket.customer_id = saved.id;
      await renderPage();
      toast(type === "customer" ? "Customer saved." : "Supplier saved.");
    },
  );
}
function salesPage() {
  return (
    pageHead(
      "Sales history",
      "Every invoice. Every payment. All in one place.",
      manager()
        ? '<a class="btn" href="/api/export?type=sales">Export CSV</a>'
        : "",
    ) +
    `<div class="toolbar"><input id="sale-search" placeholder="Search invoice, customer or cashier…" aria-label="Search sales"><select id="sale-filter" aria-label="Filter sales"><option value="all">All sales</option><option value="unpaid">Balance due</option><option value="returned">With returns</option></select><span class="table-count">Latest ${state.sales.length} transactions</span></div><section class="panel" id="sales-table">${table(["Invoice", "Customer", "Net total", "Status", "Payment", ""], salesRows(state.sales))}</section>`
  );
}
function receipt(s) {
  const t = state.settings;
  return `<div class="receipt">${t.logoData ? `<img class="shop-logo receipt-logo" src="${esc(t.logoData)}" alt="Shop logo">` : ""}<h2>${esc(t.businessName)}</h2><p class="center">${esc(t.address)}${t.phone ? "<br>" + esc(t.phone) : ""}</p><hr><p>${esc(s.number)}<br>${date(s.created_at)}<br>Cashier: ${esc(s.cashier)}<br>Customer: ${esc(s.customer || "Walk-in")}${s.table_name ? "<br>Order: " + esc(s.table_name) : ""}</p><hr>${s.items.map((i) => `<p><strong>${esc(i.name)}</strong></p><div class="receipt-line"><span>${i.quantity} × ${money(i.price)}</span><span>${money(i.total)}</span></div>${i.returned ? `<p>Returned: ${i.returned}</p>` : ""}`).join("")}<hr><div class="receipt-line"><span>Subtotal</span><span>${money(s.subtotal)}</span></div><div class="receipt-line"><span>Discount</span><span>−${money(s.discount)}</span></div><div class="receipt-line"><span>Tax</span><span>${money(s.tax)}</span></div><div class="receipt-line"><strong>Original total</strong><strong>${money(s.total)}</strong></div>${s.refunded ? `<div class="receipt-line"><span>Returns</span><span>−${money(s.refunded)}</span></div>` : ""}<div class="receipt-line"><strong>Net total</strong><strong>${money(s.total - s.refunded)}</strong></div><div class="receipt-line"><span>Net paid</span><span>${money(s.paid)}</span></div><div class="receipt-line"><span>Balance</span><span>${money(s.balance)}</span></div>${s.note ? "<hr><p>" + esc(s.note) + "</p>" : ""}<hr><p class="center">${esc(t.receiptFooter)}</p></div>`;
}
async function viewSale(n) {
  const s = await api("/sales/" + n);
  state.lastSale = s;
  modal(
    "Invoice " + esc(s.number),
    `<div class="receipt-preview">${receipt(s)}</div><div class="actions">${btn("Print receipt", "print-receipt", true)}${manager() && s.balance > 0 ? btn("Receive payment", "receive-payment", false, `data-id="${s.id}"`) : ""}${manager() && s.items.some((i) => i.returned < i.quantity) ? btn("Return items", "return-sale", false, `data-id="${s.id}"`) : ""}</div>`,
  );
}
function checkout() {
  if (!state.cart.length) return;
  const t = totals();
  if (Number(state.ticket.discount) * 100 > t.subtotal)
    return toast("Discount cannot exceed subtotal.", true);
  if (state.ticket.method === "credit" && !state.ticket.customer_id)
    return toast("Select a customer for a credit sale.", true);
  modal(
    "Complete the sale",
    `<div class="grand-total" style="border:0;margin:0 0 20px"><span>Amount due</span><span>${money(t.total)}</span></div><form>${select(
      "Payment method",
      "method",
      [
        ["cash", "Cash"],
        ["card", "Card"],
        ["bank", "Bank transfer"],
        ["credit", "Credit / Pay later"],
      ],
      state.ticket.method,
    )}${field("Amount received", "received", state.ticket.method === "credit" ? "0.00" : amount(t.total), "number", 'required min="0" step="0.01"')}<div id="change-info" class="inline-info">Cash overpayment is returned as change. Partial payment requires a customer.</div>${formEnd("Complete sale")}`,
    async (f) => {
      const received = Number(f.get("received")),
        pm = f.get("method");
      if (pm === "credit" && received !== 0)
        throw new Error("Set amount received to zero for credit.");
      if (pm !== "cash" && received * 100 > t.total)
        throw new Error("Only cash can include change.");
      const paid = Math.min(t.total, Math.round(received * 100)) / 100;
      const sale = await api("/sales", "POST", {
        ...state.ticket,
        method: pm,
        paid,
        items: state.cart.map((i) => ({
          product_id: i.product.id,
          quantity: i.quantity,
        })),
        discount: Number(state.ticket.discount || 0),
      });
      state.cart = [];
      resetTicket();
      await refreshData();
      await renderPage();
      await viewSale(sale.id);
      toast(
        received * 100 > t.total
          ? "Sale complete. Change: " +
              money(Math.round(received * 100) - t.total)
          : "Sale complete.",
      );
    },
  );
  const updateChange = () => {
    const pm = $("[name=method]", $("#modal")).value;
    const received = Math.round(
      Number($("[name=received]", $("#modal")).value || 0) * 100,
    );
    $("#change-info").textContent =
      received >= t.total
        ? "Change: " + money(received - t.total)
        : "Remaining balance: " +
          money(t.total - received) +
          ". Customer required.";
    if (pm === "credit")
      $("#change-info").textContent =
        "Credit sale: no money received. Customer required.";
  };
  $("[name=received]", $("#modal")).addEventListener("input", updateChange);
  $("[name=method]", $("#modal")).addEventListener("change", (e) => {
    $("[name=received]", $("#modal")).value =
      e.target.value === "credit" ? "0.00" : amount(t.total);
    updateChange();
  });
}
function paymentForm(s) {
  modal(
    "Receive a payment",
    `<div class="inline-info">${esc(s.number)} · Outstanding balance: ${money(s.balance)}</div><form>${field("Amount", "amount", amount(s.balance), "number", `required min="0.01" step="0.01" max="${amount(s.balance)}"`)}${select(
      "Payment method",
      "method",
      [
        ["cash", "Cash"],
        ["card", "Card"],
        ["bank", "Bank transfer"],
      ],
      "cash",
    )}${formEnd("Receive payment")}`,
    async (f) => {
      await api("/sales/" + s.id + "/payments", "POST", {
        amount: Number(f.get("amount")),
        method: f.get("method"),
      });
      await refreshData();
      await renderPage();
      await viewSale(s.id);
      toast("Payment received.");
    },
  );
}
function returnForm(s) {
  modal(
    "Return items",
    `<div class="inline-info">Refunds include the original discount and tax proportion. Unpaid balances are reduced before refunding money. Returned stock is added back.</div><form>${s.items
      .filter((i) => i.returned < i.quantity)
      .map((i) =>
        field(
          esc(i.name) + " · up to " + (i.quantity - i.returned),
          "item-" + i.id,
          "0",
          "number",
          `min="0" max="${i.quantity - i.returned}" step="0.001"`,
        ),
      )
      .join(
        "",
      )}${field("Reason", "reason", "", "text", 'required maxlength="500"')}${select(
      "Refund method",
      "method",
      [
        ["cash", "Cash"],
        ["card", "Card"],
        ["bank", "Bank transfer"],
      ],
      "cash",
    )}${formEnd("Confirm return")}`,
    async (f) => {
      const items = s.items
        .map((i) => ({
          sale_item_id: i.id,
          quantity: Number(f.get("item-" + i.id) || 0),
        }))
        .filter((i) => i.quantity > 0);
      await api("/sales/" + s.id + "/returns", "POST", {
        items,
        reason: f.get("reason"),
        method: f.get("method"),
      });
      await refreshData();
      await renderPage();
      await viewSale(s.id);
      toast("Return processed.");
    },
  );
}
function purchasesPage(list) {
  return (
    pageHead(
      "Purchases",
      "Receive stock and keep your costs up to date.",
      btn(icon("plus") + " Receive purchase", "add-purchase", true),
    ) +
    `<div class="note-box" style="margin-bottom:20px">Receiving a purchase increases stock and updates the weighted average unit cost. Purchase totals record stock acquisition; supplier payments and payables are outside this version.</div><section class="panel">${table(
      ["Purchase", "Supplier", "Reference", "Total"],
      list.map(
        (p) =>
          `<tr><td><strong>PUR-${String(p.id).padStart(6, "0")}</strong><span class="sub">${date(p.created_at)}</span></td><td>${esc(p.supplier || "Unspecified supplier")}</td><td>${esc(p.reference || "—")}</td><td class="mono">${money(p.total)}</td></tr>`,
      ),
      "Receive your first delivery to see it here.",
    )}</section>`
  );
}
function purchaseForm() {
  const products = state.products.filter((p) => p.tracked);
  if (!products.length)
    return toast("Add a stock-tracked product first.", true);
  const line = () =>
    `<div class="purchase-line"><select name="product" aria-label="Product">${products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><input name="quantity" type="number" min="0.001" step="0.001" value="1" required aria-label="Quantity"><input name="cost" type="number" min="0" step="0.01" value="${amount(products[0].cost)}" required aria-label="Unit cost"><button type="button" class="icon-btn" data-action="remove-purchase-line" aria-label="Remove line">✕</button></div>`;
  modal(
    "Receive purchase",
    `<form>${select("Supplier", "supplier_id", [["", "Unspecified supplier"], ...state.contacts.filter((c) => c.type === "supplier").map((c) => [c.id, c.name])])}${field("Reference / supplier invoice", "reference", "", "text", 'maxlength="200"')}<div class="small muted">Product · Quantity · Unit cost</div><div class="purchase-lines" id="purchase-lines">${line()}</div><button type="button" class="btn small" id="add-line">+ Add line</button><p class="small muted" style="margin-top:18px">Stock is received immediately when you save.</p>${formEnd("Receive stock")}`,
    async (f, form) => {
      const items = $$(".purchase-line", form).map((row) => ({
        product_id: Number($("[name=product]", row).value),
        quantity: Number($("[name=quantity]", row).value),
        cost: Number($("[name=cost]", row).value),
      }));
      await api("/purchases", "POST", {
        supplier_id: f.get("supplier_id"),
        reference: f.get("reference"),
        items,
      });
      $("#modal").close();
      await refreshData();
      await renderPage();
      toast("Purchase received.");
    },
  );
  $("#add-line").addEventListener("click", () =>
    $("#purchase-lines").insertAdjacentHTML("beforeend", line()),
  );
  $("#purchase-lines").addEventListener("change", (e) => {
    if (e.target.name === "product")
      $("[name=cost]", e.target.parentElement).value = amount(
        products.find((p) => p.id === Number(e.target.value)).cost,
      );
  });
}
function expensesPage(list) {
  return (
    pageHead(
      "Expenses",
      "The small costs matter. Keep them in sight.",
      btn(icon("plus") + " Add expense", "add-expense", true),
    ) +
    `<section class="panel">${table(
      ["Description", "Category", "Amount", "Payment", "Recorded by"],
      list.map(
        (e) =>
          `<tr><td><strong>${esc(e.description)}</strong><span class="sub">${date(e.created_at)}</span></td><td>${esc(e.category)}</td><td class="mono">${money(e.amount)}</td><td>${esc(e.method)}</td><td>${esc(e.actor)}</td></tr>`,
      ),
      "No expenses recorded.",
    )}</section>`
  );
}
function expenseForm() {
  modal(
    "Record an expense",
    `<form>${field("Description", "description", "", "text", 'required maxlength="500"')}${field("Category", "category", "", "text", 'required maxlength="80" placeholder="Rent / Utilities / Transport"')}${field("Amount", "amount", "", "number", 'required min="0.01" step="0.01"')}${select(
      "Payment method",
      "method",
      [
        ["cash", "Cash"],
        ["card", "Card"],
        ["bank", "Bank transfer"],
      ],
      "cash",
    )}${formEnd("Save expense")}`,
    async (f) => {
      await api("/expenses", "POST", {
        ...dataOf(f),
        amount: Number(f.get("amount")),
      });
      $("#modal").close();
      await renderPage();
      toast("Expense recorded.");
    },
  );
}
function shiftsPage(s) {
  state.shift = s.current;
  return (
    pageHead(
      "Cash shifts",
      "Open, count, close. A clearer cash drawer.",
      btn(
        s.current ? "Close your shift" : "Open your shift",
        s.current ? "close-shift" : "open-shift",
        true,
      ),
    ) +
    (s.current
      ? `<div class="stats">${stat("Opening cash", money(s.current.opening_cash), "Starting cash float", "shifts")}${stat("Expected cash", money(s.current.expected_cash), "Float + cash payments − refunds − expenses", "expenses")}${stat("Shift opened", new Date(s.current.opened_at).toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit" }), date(s.current.opened_at), "shifts")}${stat("Status", "Open", "Your register is active", "check")}</div>`
      : '<div class="note-box" style="margin-bottom:20px">You don’t have an open shift. Open one to track your cash drawer. When shift enforcement is off, transactions without a shift will not appear in a drawer reconciliation.</div>') +
    `<section class="panel">${table(
      [
        "Cashier",
        "Opened",
        "Status",
        "Opening",
        "Expected",
        "Counted",
        "Difference",
      ],
      s.history.map(
        (x) =>
          `<tr><td>${esc(x.cashier)}</td><td>${date(x.opened_at)}</td><td>${badge(x.closed_at ? "Closed" : "Open", x.closed_at ? "neutral" : "")}</td><td>${money(x.opening_cash)}</td><td>${x.expected_cash === null ? "—" : money(x.expected_cash)}</td><td>${x.closing_cash === null ? "—" : money(x.closing_cash)}</td><td>${x.closing_cash === null ? "—" : money(x.closing_cash - x.expected_cash)}</td></tr>`,
      ),
      "No shifts yet.",
    )}</section>`
  );
}
function shiftForm(close) {
  modal(
    close ? "Close your shift" : "Open your shift",
    `<form>${close ? `<div class="inline-info">Expected cash: ${money(state.shift.expected_cash)}. Count the physical cash in your drawer.</div>` : '<div class="inline-info">Enter the cash float in your drawer before starting sales.</div>'}${field(close ? "Counted closing cash" : "Opening cash", close ? "closing_cash" : "opening_cash", "", "number", 'required min="0" step="0.01"')}${formEnd(close ? "Close shift" : "Open shift")}`,
    async (f) => {
      const key = close ? "closing_cash" : "opening_cash";
      await api("/shifts/" + (close ? "close" : "open"), "POST", {
        [key]: Number(f.get(key)),
      });
      $("#modal").close();
      await renderPage();
      toast(close ? "Shift closed." : "Shift opened.");
    },
  );
}
function reportsPage(r) {
  const max = Math.max(1, ...r.daily.map((d) => d.total));
  return (
    pageHead(
      "A clearer picture.",
      "Sales, stock and cash flow in one view. Report dates use UTC.",
      `<div class="report-filters"><input type="date" id="report-from" value="${r.from}" aria-label="Report start date"><span>to</span><input type="date" id="report-to" value="${r.to}" aria-label="Report end date">${btn("Apply", "report-apply", true)}</div>`,
    ) +
    `<div class="stats">${stat("Net revenue", money(r.netRevenue), `${r.count} invoices · ${money(r.refunds)} returns`, "sales")}${stat("Estimated profit", money(r.profit), "Net sales − net tax − costs − expenses", "reports")}${stat("Expenses", money(r.expenses), "Recorded operating expenses", "expenses")}${stat("Inventory value", money(r.inventoryValue), "Current stock × average cost", "products")}</div><div class="grid-two"><section class="panel"><div class="panel-head"><h2>Daily gross sales</h2><span class="small muted">Before returns</span></div><div class="panel-body">${r.daily.length ? `<div class="chart" style="overflow:auto">${r.daily.map((d) => `<div class="chart-col" style="min-width:35px"><span class="chart-value">${amount(d.total)}</span><div class="bar" style="height:${(d.total / max) * 125}px"></div><span class="chart-label">${d.day.slice(5)}</span></div>`).join("")}</div>` : '<div class="empty">No sales in this date range.</div>'}</div></section><section class="panel"><div class="panel-head"><h2>Numbers that matter</h2></div><div class="panel-body">${[["Discounts given", r.discounts], ["Net tax collected", r.netTax], ["Cost of goods sold", r.cogs], ["Outstanding balances · all time", r.outstanding], ...r.payments.map((p) => [p.method + " · net receipts", p.total])].map(([l, v]) => `<div class="low-item"><span class="small">${esc(l)}</span><strong class="mono">${money(v)}</strong></div>`).join("")}</div></section></div><section class="panel"><div class="panel-head"><h2>Top products</h2><span class="small muted">Gross sales · before returns & discounts</span></div>${table(
      ["Product", "Units sold", "Gross sales"],
      r.topProducts.map(
        (p) =>
          `<tr><td>${esc(p.name)}</td><td>${p.quantity}</td><td>${money(p.total)}</td></tr>`,
      ),
    )}</section><section class="panel section-gap"><div class="panel-head"><h2>Customer balances</h2><span class="small muted">All-time outstanding invoices</span></div>${table(
      ["Invoice", "Customer", "Balance", ""],
      r.debtors.map(
        (d) =>
          `<tr><td>${esc(d.number)}</td><td>${esc(d.customer)}</td><td>${money(d.balance)}</td><td><button class="btn small" data-action="view-sale" data-id="${d.id}">View / pay</button></td></tr>`,
      ),
      "No outstanding balances.",
    )}</section>`
  );
}
function usersPage() {
  return (
    pageHead(
      "Team & access",
      "The right access for every person.",
      btn(icon("plus") + " Add team member", "add-user", true),
    ) +
    `<div class="note-box" style="margin-bottom:20px">Administrators manage everything. Managers handle stock, purchases, expenses, reports and returns. Cashiers can bill customers, view their own sales and manage their own shifts.</div><section class="panel">${table(
      ["Name", "Username", "Role", "Status", ""],
      state.users.map(
        (u) =>
          `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.username)}</td><td>${badge(u.role, "neutral")}</td><td>${badge(u.active ? "Active" : "Disabled", u.active ? "" : "red")}</td><td>${u.id !== state.user.id ? `<button class="btn small" data-action="edit-user" data-id="${u.id}">Edit access</button>` : '<span class="small muted">You</span>'}</td></tr>`,
      ),
    )}</section>`
  );
}
function userForm(u) {
  modal(
    u ? "Edit team member" : "Add team member",
    `<form><div class="form-grid">${field("Name", "name", u?.name, "text", 'required maxlength="200"')}${field("Username", "username", u?.username, "text", 'required maxlength="60" autocomplete="off"')}${field(u ? "New password (leave blank to keep)" : "Password", "password", "", "password", `${u ? "" : "required"} minlength="10" maxlength="200" autocomplete="new-password"`, true)}${select(
      "Role",
      "role",
      [
        ["cashier", "Cashier"],
        ["manager", "Manager"],
        ["admin", "Administrator"],
      ],
      u?.role || "cashier",
    )}${check("Active account", "active", u ? u.active : true)}</div>${formEnd("Save team member")}`,
    async (f) => {
      await api("/users" + (u ? "/" + u.id : ""), u ? "PUT" : "POST", {
        ...dataOf(f),
        active: f.has("active"),
      });
      $("#modal").close();
      await renderPage();
      toast("Team member saved.");
    },
  );
}
function settingsPage() {
  const s = state.settings;
  return (
    pageHead(
      "Built around your business.",
      "Make the workspace, register and receipts your own.",
    ) +
    `<div class="settings-layout"><section class="panel"><div class="panel-head"><h2>Business settings</h2></div><div class="panel-body"><form id="settings-form"><div class="form-grid"><div class="wide"><label for="shop-logo-file">Shop logo (PNG, JPEG or WebP, max 128 KB)</label><input id="shop-logo-file" type="file" accept="image/png,image/jpeg,image/webp">${s.logoData ? `<img class="shop-logo" src="${esc(s.logoData)}" alt="Current shop logo">` : ""}${check("Remove current logo", "removeLogo", false)}</div>${field("Business name", "businessName", s.businessName, "text", 'required maxlength="200"', true)}${select(
      "Business type",
      "businessType",
      [
        ["Retail", "Retail / General store"],
        ["Restaurant", "Restaurant / Café"],
        ["Services", "Services / Salon"],
        ["Wholesale", "Wholesale"],
        ["Other", "Other"],
      ],
      s.businessType,
    )}${field("Currency code", "currency", s.currency, "text", 'required pattern="[A-Z]{3}" maxlength="3"')}${field("Phone", "phone", s.phone, "text", 'maxlength="60"')}${field("Tax rate (%)", "taxRate", s.taxRate, "number", 'required min="0" max="100" step="0.01"')}${textarea("Business address", "address", s.address)}${textarea("Receipt footer", "receiptFooter", s.receiptFooter)}<div class="wide">${check("Require an open shift for sales, payments, returns and expenses", "requireShift", s.requireShift)}</div></div><p class="error form-error" role="alert"></p><button class="btn primary" type="submit">Save settings</button></form></div></section><div><section class="panel"><div class="panel-head"><h2>Your data & security</h2></div><div class="panel-body"><p class="muted small" style="line-height:1.8;margin-bottom:16px">Data is stored on this server in SQLite. Download a backup regularly and keep it in a secure location. Backups contain customer information and password hashes.</p><div class="actions"><a class="btn" href="/api/backup">Download backup</a>${btn("Activity log", "audit-log")}${btn("Change password", "change-password")}</div></div></section><div class="note-box section-gap">Restaurant mode adds table/order labels. For services, turn off stock tracking on individual products. Currency changes affect display only; finish or migrate existing accounts before changing currency. Tax is applied after the order discount.</div></div></div>`
  );
}
function bindPage() {
  if ($("#pos-search")) {
    $("#pos-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      $("#product-grid").innerHTML = productCards();
    });
    $("#pos-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = e.target.value.trim();
        const p = state.products.find(
          (p) =>
            p.active &&
            (p.barcode === value ||
              p.sku.toLowerCase() === value.toLowerCase()),
        );
        if (p) {
          addCart(p.id);
          state.search = "";
          e.target.value = "";
          $("#product-grid").innerHTML = productCards();
        } else toast("No exact barcode or SKU match.", true);
      }
    });
  }
  if ($("#list-search")) {
    const filter = () =>
      ($("#products-table").innerHTML = productsTable(
        $("#list-search").value,
        $("#product-filter").value,
      ));
    $("#list-search").addEventListener("input", filter);
    $("#product-filter").addEventListener("change", filter);
  }
  if ($("#contact-search"))
    $("#contact-search").addEventListener("input", (e) =>
      $$("[data-contact-row]").forEach(
        (row) =>
          (row.hidden = !row.dataset.contactRow.includes(
            e.target.value.toLowerCase(),
          )),
      ),
    );
  if ($("#sale-search")) {
    const filter = () => {
      const search = $("#sale-search").value.toLowerCase(),
        type = $("#sale-filter").value;
      const list = state.sales.filter(
        (s) =>
          [s.number, s.customer || "", s.cashier].some((v) =>
            v.toLowerCase().includes(search),
          ) &&
          (type === "all" ||
            (type === "unpaid" && s.total - s.refunded - s.paid > 0) ||
            (type === "returned" && s.refunded > 0)),
      );
      $("#sales-table").innerHTML = table(
        ["Invoice", "Customer", "Net total", "Status", "Payment", ""],
        salesRows(list),
      );
    };
    $("#sale-search").addEventListener("input", filter);
    $("#sale-filter").addEventListener("change", filter);
  }
  if ($("#settings-form"))
    $("#settings-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target),
        b = $("button[type=submit]", e.target);
      b.disabled = true;
      try {
        let logoData = state.settings.logoData || "";
        if (f.has("removeLogo")) logoData = "";
        const logo = $("#shop-logo-file", e.target).files[0];
        if (logo) {
          if (!["image/png", "image/jpeg", "image/webp"].includes(logo.type) || logo.size > 128 * 1024)
            throw new Error("Choose a PNG, JPEG or WebP image up to 128 KB.");
          logoData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Unable to read logo."));
            reader.readAsDataURL(logo);
          });
        }
        state.settings = await api("/settings", "PUT", {
          logoData,
          ...dataOf(f),
          taxRate: Number(f.get("taxRate")),
          requireShift: f.has("requireShift"),
        });
        renderShell();
        await renderPage();
        toast("Settings saved.");
      } catch (error) {
        $(".form-error", e.target).textContent = error.message;
      } finally {
        b.disabled = false;
      }
    });
}
document.addEventListener("change", (e) => {
  if (state.page !== "pos" || !e.target.closest("#cart-content")) return;
  if (e.target.dataset.quantity) {
    const line = state.cart.find(
        (i) => i.product.id === Number(e.target.dataset.quantity),
      ),
      q = Number(e.target.value);
    if (
      !Number.isFinite(q) ||
      q <= 0 ||
      (line.product.tracked && q > line.product.stock)
    )
      toast("Enter a positive quantity within available stock.", true);
    else line.quantity = q;
    renderCart();
    return;
  }
  const name = e.target.name;
  if (name in state.ticket) {
    state.ticket[name] =
      name === "discount" ? Number(e.target.value) : e.target.value;
    if (name === "discount" || name === "method") renderCart();
  }
});
document.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action],[data-page]");
  if (!target || target.disabled) return;
  const action = target.dataset.action,
    n = Number(target.dataset.id);
  try {
    if (target.dataset.page) {
      state.page = target.dataset.page;
      await refreshData();
      return await renderPage();
    }
    if (action === "close-modal") return $("#modal").close();
    if (action === "toggle-menu")
      return $(".shell").classList.toggle("menu-open");
    if (action === "logout") {
      if (
        (state.cart.length || state.held.length) &&
        !confirm("Sign out? Current and held orders will be discarded.")
      )
        return;
      await api("/logout", "POST", {});
      state.user = null;
      state.cart = [];
      state.held = [];
      showAuth(false);
    } else if (action === "new-sale") {
      state.page = "pos";
      await refreshData();
      await renderPage();
    } else if (action === "refresh") {
      await refreshData();
      await renderPage();
    } else if (action === "add-product") productForm();
    else if (action === "edit-product")
      productForm(state.products.find((p) => p.id === n));
    else if (action === "adjust-stock")
      adjustStock(state.products.find((p) => p.id === n));
    else if (action === "add-customer") contactForm("customer");
    else if (action === "add-supplier") contactForm("supplier");
    else if (action === "edit-contact") {
      const c = state.contacts.find((c) => c.id === n);
      contactForm(c.type, c);
    } else if (action === "add-cart") addCart(n);
    else if (action === "remove-cart") {
      state.cart = state.cart.filter((i) => i.product.id !== n);
      renderCart();
    } else if (action === "decrease-cart") {
      const line = state.cart.find((i) => i.product.id === n);
      line.quantity = Math.max(0, line.quantity - 1);
      if (!line.quantity)
        state.cart = state.cart.filter((i) => i.product.id !== n);
      renderCart();
    } else if (action === "clear-cart") {
      if (state.cart.length && !confirm("Clear the current order?")) return;
      state.cart = [];
      resetTicket();
      renderCart();
    } else if (action === "category") {
      state.category = target.dataset.category;
      $$(".category-tabs button").forEach((b) =>
        b.classList.toggle("active", b.dataset.category === state.category),
      );
      $("#product-grid").innerHTML = productCards();
    } else if (action === "checkout") checkout();
    else if (action === "view-sale") await viewSale(n);
    else if (action === "print-receipt") {
      $("#print-area").innerHTML = receipt(state.lastSale);
      window.print();
    } else if (action === "receive-payment") paymentForm(state.lastSale);
    else if (action === "return-sale") returnForm(state.lastSale);
    else if (action === "add-purchase") purchaseForm();
    else if (action === "remove-purchase-line")
      target.closest(".purchase-line").remove();
    else if (action === "add-expense") expenseForm();
    else if (action === "open-shift") shiftForm(false);
    else if (action === "close-shift") shiftForm(true);
    else if (action === "add-user") userForm();
    else if (action === "edit-user")
      userForm(state.users.find((u) => u.id === n));
    else if (action === "report-apply") {
      state.reportFrom = $("#report-from").value;
      state.reportTo = $("#report-to").value;
      await renderPage();
    } else if (action === "order-note")
      modal(
        "Order note",
        `<form>${textarea("Note for the receipt", "note", state.ticket.note)}${formEnd("Save note")}`,
        async (f) => {
          state.ticket.note = f.get("note");
          $("#modal").close();
          renderCart();
        },
      );
    else if (action === "hold-order") {
      if (!state.cart.length)
        return toast("Add items before holding an order.", true);
      const name = prompt(
        "Order name / table number",
        state.ticket.table_name || "Order " + (state.held.length + 1),
      );
      if (name === null) return;
      state.held.push({
        name: name.slice(0, 80),
        cart: structuredClone(state.cart),
        ticket: { ...state.ticket },
      });
      state.cart = [];
      resetTicket();
      await renderPage();
      toast("Order held for this session.");
    } else if (action === "held-orders")
      modal(
        "Held orders",
        `<div class="note-box">Held orders are kept in this browser session. They don’t reserve stock or survive a refresh. Complete them before signing out.</div>${state.held.length ? state.held.map((h, i) => `<div class="low-item"><div><strong>${esc(h.name)}</strong><span class="sub">${h.cart.length} products</span></div><div class="actions"><button class="btn small" data-action="resume-order" data-id="${i}">Resume</button><button class="icon-btn" data-action="delete-held" data-id="${i}" aria-label="Delete held order">✕</button></div></div>`).join("") : '<div class="empty">No held orders.</div>'}`,
      );
    else if (action === "resume-order") {
      if (state.cart.length)
        return toast("Hold or clear the current order first.", true);
      const held = state.held.splice(n, 1)[0];
      state.cart = held.cart.map((i) => ({
        ...i,
        product: state.products.find((p) => p.id === i.product.id) || i.product,
      }));
      state.ticket = held.ticket;
      $("#modal").close();
      await renderPage();
    } else if (action === "delete-held") {
      state.held.splice(n, 1);
      $("#modal").close();
      await renderPage();
    } else if (action === "stock-history") {
      const list = await api("/movements");
      modal(
        "Stock movements",
        table(
          ["Product", "Change", "Reason", "When"],
          list.map(
            (m) =>
              `<tr><td>${esc(m.product)}</td><td>${m.quantity > 0 ? "+" : ""}${m.quantity}</td><td>${esc(m.reason)}</td><td>${date(m.created_at)}</td></tr>`,
          ),
        ),
        null,
        900,
      );
    } else if (action === "audit-log") {
      const list = await api("/audit");
      modal(
        "Activity log",
        table(
          ["Action", "User", "Details", "When"],
          list.map(
            (a) =>
              `<tr><td>${esc(a.action)}</td><td>${esc(a.actor || "System")}</td><td>${esc(a.details)}</td><td>${date(a.created_at)}</td></tr>`,
          ),
        ),
        null,
        1000,
      );
    } else if (action === "change-password")
      modal(
        "Change password",
        `<form>${field("Current password", "currentPassword", "", "password", 'required autocomplete="current-password"')}${field("New password", "password", "", "password", 'required minlength="10" maxlength="200" autocomplete="new-password"')}${formEnd("Update password")}`,
        async (f) => {
          await api("/password", "POST", dataOf(f));
          $("#modal").close();
          toast("Password updated. Other sessions signed out.");
        },
      );
  } catch (error) {
    toast(error.message, true);
  }
});
window.addEventListener("beforeunload", (e) => {
  if (state.cart.length || state.held.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function init() {
  try {
    const bootstrap = await api("/bootstrap");
    if (bootstrap.needsSetup) return showAuth(true, bootstrap.requiresSetupToken);
    try {
      await loadWorkspace();
    } catch {
      showAuth(false);
    }
  } catch (e) {
    $("#app").innerHTML =
      `<div class="empty"><strong>Unable to connect.</strong>${esc(e.message)}<p>Check that the server is running, then refresh this page.</p></div>`;
  }
}
init();
