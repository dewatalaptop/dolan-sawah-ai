// ============================================================
// BELI vs PAKAI -- ke mana barang yang dibeli pergi
//
// Murni (tanpa Firestore/DOM) supaya bisa diuji dengan `node --test`.
//
//   datang (receiving, dari Dolan Order)
//   - terpakai teoritis (penjualan menu x resep)
//   - waste tercatat
//   = SELISIH BELUM TERJELASKAN  (qty, dan Rp bila harga beli diketahui)
//
// Tanpa stok opname (belum dipakai) selisih POSITIF bisa berupa stok yang masih ada, bukan hilang; selisih NEGATIF berarti
// pemakaian tercatat melebihi barang datang (stok lama / catatan kurang). Karena itu angka tidak pernah disebut "hilang pasti",
// dan bahan tanpa resep / satuan tak sebanding / menu tanpa resep dipisahkan -- bukan dihitung sebagai selisih.
// ============================================================

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter(Boolean);

// Satuan -> satuan dasar (kg / liter / pcs, selain itu satuannya sendiri). Satuan beda dasar TIDAK dikonversi diam-diam.
const TO_BASE = {
  kg: ["kg", 1], kilo: ["kg", 1], kilogram: ["kg", 1], gr: ["kg", 0.001], gram: ["kg", 0.001], g: ["kg", 0.001], ons: ["kg", 0.1],
  liter: ["liter", 1], l: ["liter", 1], ltr: ["liter", 1], ml: ["liter", 0.001],
  pcs: ["pcs", 1], pc: ["pcs", 1], biji: ["pcs", 1], buah: ["pcs", 1], bh: ["pcs", 1],
};
export function toBase(qty, unit) {
  const u = norm(unit); const t = TO_BASE[u];
  return t ? { v: Number(qty || 0) * t[1], base: t[0] } : { v: Number(qty || 0), base: u || "?" };
}

function dice(a, b) {
  const g = (s) => { const t = s.replace(/\s/g, ""); const m = new Map(); for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) || 0) + 1); return m; };
  if (!a || !b) return 0; if (a === b) return 1;
  const A = g(a), B = g(b); let inter = 0, na = 0, nb = 0;
  for (const [k, c] of A) { na += c; if (B.has(k)) inter += Math.min(c, B.get(k)); } for (const c of B.values()) nb += c;
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

// Saran barang katalog untuk nama bahan resep (urut paling mirip). mirror: [{id,name,cat,unit}]
export function suggestItems(name, mirror, limit = 5) {
  const q = norm(name), qt = tokens(name);
  if (!q) return [];
  return mirror.map((m) => {
    const n = norm(m.name), mt = tokens(m.name);
    const all = qt.every((x) => mt.some((y) => y === x || (x.length >= 4 && y.startsWith(x))));
    return { ...m, score: n === q ? 2 : all ? 1 + dice(q, n) * 0.5 : dice(q, n) };
  }).filter((x) => x.score >= 0.45).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Bahan resep -> id barang katalog. Urutan: tautan manual (links[namaTernormalisasi]: id | "none") > itemId resep yang dikenal >
// nama sama persis (unik) di katalog. Selain itu null (perlu ditautkan di halaman Tautan Bahan -- tidak ditebak).
export function resolveIngredient(ing, links, mirrorById, mirrorByName) {
  const n = norm(ing.itemName);
  const lk = links?.[n];
  if (lk === "none") return { id: null, how: "none" };
  if (lk && mirrorById.has(lk)) return { id: lk, how: "link" };
  if (ing.itemId && mirrorById.has(ing.itemId)) return { id: ing.itemId, how: "id" };
  const same = mirrorByName.get(n);
  if (same && same.length === 1) return { id: same[0].id, how: "auto" };
  return { id: null, how: "unlinked" };
}

const sum = (a) => a.reduce((s, x) => s + x, 0);
const inRange = (d, from, to) => { const s = String(d || ""); return (!from || s >= from) && (!to || s <= to); };

function classify(r, used, mismatch, tol) {
  if (mismatch) return "satuan-beda";
  if (!used) return "tanpa-resep";
  if (r.usage <= 0) return "belum-terpakai";
  const pct = r.recv > 0 ? (r.recv - r.usage - r.waste) / r.recv * 100 : null;
  if (pct === null) return "terpakai-melebihi";
  if (pct > tol) return "selisih-lebih";
  if (pct < -tol) return "terpakai-melebihi";
  return "wajar";
}

/**
 * @param {object} p  { receiving, sales, recipes, waste, links, mirror, from, to, outlet, tolerancePct }
 */
export function computeLoss(p) {
  const { receiving = [], sales = [], recipes = [], waste = [], links = {}, mirror = [], from = "", to = "", outlet = "ALL" } = p;
  const tol = Number.isFinite(p.tolerancePct) ? p.tolerancePct : 10;
  const mirrorById = new Map(mirror.map((m) => [m.id, m]));
  const mirrorByName = new Map(); for (const m of mirror) { const k = norm(m.name); (mirrorByName.get(k) || mirrorByName.set(k, []).get(k)).push(m); }
  const outOk = (o) => outlet === "ALL" || (o || "DS") === outlet;

  // ---- resep: nama menu -> bahan (sudah dipetakan ke id katalog, dalam satuan dasar, per 1 porsi)
  const recipeByMenu = new Map(); const unlinked = new Map(); const usedItems = new Map();   // id -> satuan dasar yang dipakai resep
  for (const r of recipes) {
    const portions = Number(r.portions) > 0 ? Number(r.portions) : 1;
    const ings = [];
    for (const ing of r.ingredients || []) {
      const res = resolveIngredient(ing, links, mirrorById, mirrorByName);
      const b = toBase(Number(ing.quantity || 0) / portions, ing.unit);
      if (res.how === "none") continue;   // sengaja tidak dilacak
      if (!res.id) {
        const k = norm(ing.itemName); const u = unlinked.get(k) || unlinked.set(k, { name: ing.itemName, menus: new Set() }).get(k); u.menus.add(r.menuName);
        continue;
      }
      ings.push({ id: res.id, v: b.v, base: b.base, how: res.how });
      if (!usedItems.has(res.id)) usedItems.set(res.id, new Set()); usedItems.get(res.id).add(b.base);
    }
    recipeByMenu.set(norm(r.menuName), { menuName: r.menuName, ings, hasIngredients: (r.ingredients || []).length > 0 });
  }

  // ---- rekaman per (outlet, barang)
  const rec = new Map();
  const get = (o, id, name, base) => {
    const k = `${o}|${id}`;
    if (!rec.has(k)) rec.set(k, { key: k, outlet: o, id, name, base, recv: 0, cost: 0, costQty: 0, usage: 0, waste: 0, costUnknownRows: 0 });
    return rec.get(k);
  };
  const catOf = (id) => mirrorById.get(id)?.cat || "";

  for (const x of receiving) {
    if (!inRange(x.date, from, to) || !outOk(x.outlet)) continue;
    const b = toBase(x.receivedQuantity, x.unit);
    const id = x.itemId || `nama:${norm(x.itemName)}`;
    const r = get(x.outlet || "DS", id, x.itemName, b.base);
    if (r.base !== b.base) r.baseConflict = true;
    r.recv += b.v; r.cat = r.cat || x.cat || catOf(id);
    if (x.cost === null || x.cost === undefined) r.costUnknownRows++; else { r.cost += Number(x.cost); r.costQty += b.v; }
  }

  // penjualan -> pemakaian teoritis; menu tanpa resep dicatat terpisah
  const menuSold = new Map(); let portionsAll = 0, portionsWithRecipe = 0; const mismatch = new Map();
  for (const s of sales) {
    if (!inRange(s.date, from, to) || !outOk(s.outlet)) continue;
    const q = Number(s.quantity || 0); portionsAll += q;
    const rc = recipeByMenu.get(norm(s.menuName));
    const m = menuSold.get(norm(s.menuName)) || menuSold.set(norm(s.menuName), { menuName: s.menuName, qty: 0, hasRecipe: !!(rc && rc.ings.length) }).get(norm(s.menuName)); m.qty += q;
    if (!rc || !rc.ings.length) continue;
    portionsWithRecipe += q;
    for (const ing of rc.ings) {
      const r = get(s.outlet || "DS", ing.id, mirrorById.get(ing.id)?.name || ing.id, ing.base);
      r.cat = r.cat || catOf(ing.id);
      if (r.base !== ing.base) { mismatch.set(ing.id, { recipeUnit: ing.base, itemUnit: r.base }); continue; }
      r.usage += ing.v * q;
    }
  }

  // waste tercatat (nama -> barang katalog lewat tautan/nama sama; yang tak dikenal diabaikan dari hitungan dan dihitung terpisah)
  let wasteUnmatched = 0;
  for (const w of waste) {
    if (!inRange(w.date, from, to) || !outOk(w.outlet)) continue;
    const res = resolveIngredient({ itemName: w.itemName, itemId: w.itemId }, links, mirrorById, mirrorByName);
    if (!res.id) { wasteUnmatched++; continue; }
    const b = toBase(w.quantity, w.unit); const r = get(w.outlet || "DS", res.id, mirrorById.get(res.id).name, b.base);
    if (r.base === b.base) r.waste += b.v;
  }

  const mismatchOf = (r) => { if (r.baseConflict) return { recipeUnit: "?", itemUnit: "campur" }; const u = usedItems.get(r.id); if (u && !u.has(r.base)) return { recipeUnit: [...u][0], itemUnit: r.base }; return mismatch.get(r.id) || null; };

  // ---- agregasi per barang (semua outlet dalam cakupan) dan per outlet
  const mk = (r, extra = {}) => {
    const usedBy = usedItems.has(r.id), mm = mismatchOf(r);
    const status = classify(r, usedBy, mm, tol);
    const unexplained = r.recv - r.usage - r.waste;
    const unitCost = r.costQty > 0 ? r.cost / r.costQty : null;
    return {
      id: r.id, name: r.name, cat: r.cat || "", unit: r.base, outlet: r.outlet, recv: r.recv, usage: r.usage, waste: r.waste, unexplained,
      pct: r.recv > 0 ? (unexplained / r.recv) * 100 : null, unitCost, recvValue: r.costQty > 0 ? r.cost : null, costUnknown: r.costUnknownRows > 0,
      unexplainedValue: unitCost === null ? null : unexplained * unitCost, status, mismatch: mm, ...extra,
    };
  };
  const byItem = new Map();
  for (const r of rec.values()) {
    const a = byItem.get(r.id) || byItem.set(r.id, { key: r.id, outlet: "ALL", id: r.id, name: r.name, base: r.base, cat: r.cat, recv: 0, cost: 0, costQty: 0, usage: 0, waste: 0, costUnknownRows: 0, baseConflict: false }).get(r.id);
    if (a.base !== r.base) a.baseConflict = true;
    a.recv += r.recv; a.cost += r.cost; a.costQty += r.costQty; a.usage += r.usage; a.waste += r.waste; a.costUnknownRows += r.costUnknownRows;
  }
  const rows = [...byItem.values()].map((r) => mk(r)).filter((r) => r.recv > 0 || r.usage > 0 || r.waste > 0);
  const perOutlet = [...rec.values()].map((r) => mk(r)).filter((r) => r.recv > 0 || r.usage > 0);

  // ---- ringkasan
  const analyzed = rows.filter((r) => ["wajar", "selisih-lebih", "terpakai-melebihi"].includes(r.status));
  const val = (a, f) => sum(a.map((r) => f(r) ?? 0));
  const receivedValue = val(rows, (r) => r.recvValue);
  const coveredValue = val(rows.filter((r) => usedItems.has(r.id)), (r) => r.recvValue);
  const kpi = {
    receivedValue, receivedValueUnknownItems: rows.filter((r) => r.costUnknown || r.recvValue === null).length,
    analyzedItems: analyzed.length, totalItems: rows.length,
    analyzedReceivedValue: val(analyzed, (r) => r.recvValue),
    usedValue: val(analyzed, (r) => (r.unitCost === null ? 0 : r.usage * r.unitCost)),
    wasteValue: val(analyzed, (r) => (r.unitCost === null ? 0 : r.waste * r.unitCost)),
    unexplainedValue: val(analyzed.filter((r) => r.unexplainedValue > 0), (r) => r.unexplainedValue),   // hanya selisih LEBIH (kandidat hilang/boros)
    overUsedValue: -val(analyzed.filter((r) => r.unexplainedValue < 0), (r) => r.unexplainedValue),
    unexplainedNoPrice: analyzed.filter((r) => r.unexplained > 0 && r.unexplainedValue === null).length,
  };
  const coverage = {
    portionsAll, portionsWithRecipe, portionsPct: portionsAll > 0 ? (portionsWithRecipe / portionsAll) * 100 : null,
    purchaseValuePct: receivedValue > 0 ? (coveredValue / receivedValue) * 100 : null, recipes: recipes.length,
    itemsWithRecipe: rows.filter((r) => usedItems.has(r.id)).length, itemsTotal: rows.length,
  };
  const noRecipeMenus = [...menuSold.values()].filter((m) => !m.hasRecipe).sort((a, b) => b.qty - a.qty);
  const unlinkedIngredients = [...unlinked.values()].map((u) => ({ name: u.name, menus: [...u.menus], candidates: suggestItems(u.name, mirror) }));

  const byCatMap = new Map();
  for (const r of rows) { const c = r.cat || "lain"; const x = byCatMap.get(c) || byCatMap.set(c, { cat: c, recvValue: 0, unexplainedValue: 0, items: 0 }).get(c); x.recvValue += r.recvValue ?? 0; x.items++; if (["selisih-lebih"].includes(r.status) && r.unexplainedValue > 0) x.unexplainedValue += r.unexplainedValue; }
  const byOutletMap = new Map();
  for (const r of perOutlet) { const x = byOutletMap.get(r.outlet) || byOutletMap.set(r.outlet, { outlet: r.outlet, recvValue: 0, unexplainedValue: 0, items: 0 }).get(r.outlet); x.recvValue += r.recvValue ?? 0; x.items++; if (r.status === "selisih-lebih" && r.unexplainedValue > 0) x.unexplainedValue += r.unexplainedValue; }

  return {
    rows: rows.sort((a, b) => (b.unexplainedValue ?? -1) - (a.unexplainedValue ?? -1) || b.recv - a.recv), kpi, coverage, noRecipeMenus, unlinkedIngredients,
    byCat: [...byCatMap.values()].sort((a, b) => b.unexplainedValue - a.unexplainedValue || b.recvValue - a.recvValue),
    byOutlet: [...byOutletMap.values()].sort((a, b) => b.unexplainedValue - a.unexplainedValue || b.recvValue - a.recvValue),
    wasteUnmatched, tolerancePct: tol,
  };
}
