const test = require("node:test"); const assert = require("node:assert/strict");
const { planReceiving, reconcile, planMirror, runSync } = require("../functions/dolanOrderSync.js");

const L = (itemId, name, cat, qty, unit) => ({ key: `${itemId}|${unit}`, itemId, name, cat, qty, unit });
const orders = [
  { date: "2026-11-12", unit: "DS", lines: [L("ayam-ayam-potong", "Ayam potong", "ayam", 6, "kg")] },
  { date: "2026-11-12", unit: "BA", lines: [L("ayam-ayam-potong", "Ayam potong", "ayam", 3, "kg"), L("ayam-ati", "Ati ampela", "ayam", 1, "kg")] },
  { date: "2026-11-12", unit: "PR", none: true, lines: [] },
];
const buy = (items) => ({ date: "2026-11-12", cat: "ayam", items });
const B = (key, name, unit, orderQty, st, qty, cost) => ({ key, name, unit, orderQty, st, qty, cost, note: "" });

test("dibagi sebanding pesanan, jumlah & biaya total tetap sama, tanggal = pesan + 1", () => {
  const m = planReceiving([buy({ a: B("ayam-ayam-potong|kg", "Ayam potong", "kg", 9, "kurang", 8.5, 340000) })], orders);
  const rows = [...m.values()]; assert.equal(rows.length, 2);
  const ds = rows.find((r) => r.outlet === "DS"), ba = rows.find((r) => r.outlet === "BA");
  assert.equal(ds.receivedQuantity, 5.667); assert.equal(ba.receivedQuantity, 2.833);
  assert.ok(Math.abs(ds.receivedQuantity + ba.receivedQuantity - 8.5) < 1e-9, "jumlah total sama");
  assert.equal(ds.cost + ba.cost, 340000, "biaya total sama (sisa pembulatan ke outlet terakhir)");
  assert.equal(ds.orderedQuantity, 6); assert.equal(ds.date, "2026-11-13"); assert.equal(ds.orderDate, "2026-11-12");
  assert.equal(ds.itemId, "ayam-ayam-potong"); assert.equal(ds.source, "dolan-order");
});
test("biaya kosong tetap null (bukan 0)", () => {
  const rows = [...planReceiving([buy({ a: B("ayam-ati|kg", "Ati ampela", "kg", 1, "ok", 1, null) })], orders).values()];
  assert.equal(rows.length, 1); assert.equal(rows[0].outlet, "BA"); assert.equal(rows[0].cost, null);
});
test("barang tiba tanpa pesanan outlet -> outlet SEMUA", () => {
  const rows = [...planReceiving([buy({ a: B("ayam-sayap|kg", "Sayap", "kg", 0, "ok", 2, 50000) })], orders).values()];
  assert.equal(rows.length, 1); assert.equal(rows[0].outlet, "SEMUA"); assert.equal(rows[0].receivedQuantity, 2);
});
test("satuan berbeda tidak dicampur (kunci memuat satuan)", () => {
  const o = [{ date: "2026-11-12", unit: "DS", lines: [L("x", "X", "ayam", 1, "kg")] }, { date: "2026-11-12", unit: "BA", lines: [L("x", "X", "ayam", 2, "ekor")] }];
  const rows = [...planReceiving([buy({ a: B("x|kg", "X", "kg", 1, "ok", 1, null), b: B("x|ekor", "X", "ekor", 2, "ok", 2, null) })], o).values()];
  assert.equal(rows.length, 2); assert.deepEqual(rows.map((r) => [r.outlet, r.unit]).sort(), [["BA", "ekor"], ["DS", "kg"]]);
});
test("id deterministik; rekonsiliasi: tanpa perubahan = nol tulis; ubah = tulis ulang; dibatalkan = hapus", () => {
  const items = { a: B("ayam-ayam-potong|kg", "Ayam potong", "kg", 9, "ok", 9, 300000), b: B("ayam-ati|kg", "Ati ampela", "kg", 1, "ok", 1, 40000) };
  const d1 = planReceiving([buy(items)], orders), d1b = planReceiving([buy(items)], orders);
  assert.deepEqual([...d1.keys()], [...d1b.keys()]);
  const existing = new Map(d1);
  assert.deepEqual(reconcile(d1b, existing), { set: [], del: [] });
  const changed = planReceiving([buy({ ...items, a: { ...items.a, qty: 8 } })], orders);
  const r = reconcile(changed, existing); assert.equal(r.set.length, 2); assert.equal(r.del.length, 0);
  const removed = planReceiving([buy({ b: items.b })], orders); const r2 = reconcile(removed, existing);
  assert.equal(r2.del.length, 2, "catatan ayam potong dibatalkan -> 2 baris outlet dihapus"); assert.equal(r2.set.length, 0);
});
test("cermin katalog: hanya yang baru/berubah ditulis", () => {
  const items = [{ id: "a", name: "A", cat: "ayam", unit: "kg" }, { id: "b", name: "B", cat: "sayur", unit: "ikat", active: false }];
  assert.equal(planMirror(items, new Map()).length, 2);
  const ex = new Map([["a", { name: "A", cat: "ayam", unit: "kg", active: true }]]);
  assert.deepEqual(planMirror(items, ex).map((x) => x[0]), ["b"]);
});

// ---- I/O dengan Firestore palsu di memori
function fakeDb(seed) {
  const cols = new Map(Object.entries(seed).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const col = (n) => cols.get(n) || cols.set(n, new Map()).get(n);
  const q = (n, conds) => ({ where: (f, op, v) => q(n, [...conds, [f, op, v]]), get: async () => { const docs = [...col(n)].filter(([, d]) => conds.every(([f, op, v]) => op === "==" ? d[f] === v : op === ">=" ? d[f] >= v : false)).map(([id, d]) => ({ id, data: () => d })); return { docs, size: docs.length }; } });
  return { _c: cols, collection: (n) => ({ ...q(n, []), get: () => q(n, []).get(), doc: (id) => ({ _n: n, id, set: async (d) => { col(n).set(id, d); } }) }),
    batch: () => { const ops = []; return { set: (ref, d) => ops.push(() => col(ref._n).set(ref.id, d)), delete: (ref) => ops.push(() => col(ref._n).delete(ref.id)), commit: async () => ops.forEach((f) => f()) }; } };
}
test("runSync: menulis, idempoten, tidak menyentuh receiving sumber lain, menghapus yang batal", async () => {
  const now = Date.parse("2026-11-13T03:00:00Z");
  const db = fakeDb({
    do_buys: { "2026-11-12_ayam": buy({ a: B("ayam-ayam-potong|kg", "Ayam potong", "kg", 9, "ok", 9, 300000) }) },
    do_orders: { "2026-11-12_DS": orders[0], "2026-11-12_BA": orders[1] },
    do_items: { "ayam-ayam-potong": { name: "Ayam potong", cat: "ayam", unit: "kg", active: true } },
    receiving: { manual1: { date: "2026-11-12", outlet: "DS", itemName: "Telur", receivedQuantity: 5, unit: "kg" } },
  });
  const s1 = await runSync(db, now); assert.equal(s1.rows, 2); assert.equal(s1.written, 2); assert.equal(s1.mirrorWritten, 1);
  assert.equal(db._c.get("receiving").size, 3, "2 baris sinkron + 1 manual");
  const s2 = await runSync(db, now); assert.equal(s2.written, 0, "putaran kedua tidak menulis apa pun"); assert.equal(s2.deleted, 0);
  db._c.get("do_buys").clear();   // catatan dibatalkan di Dolan Order
  const s3 = await runSync(db, now); assert.equal(s3.deleted, 2);
  assert.equal(db._c.get("receiving").size, 1); assert.ok(db._c.get("receiving").has("manual1"), "baris manual utuh");
  assert.equal(db._c.get("settings").get("doOrderSync").deleted, 2);
});
