// ============================================================
// SINKRON DOLAN ORDER -> DOLAN SAWAH AI
//
// Dolan Order (koleksi do_*, project yang sama) mencatat barang yang BENAR-BENAR datang per kategori untuk semua
// outlet sekaligus. Dolan Sawah AI menghitung per outlet, jadi:
//   do_buys (tanggal PESAN D, kategori, item{key -> qty datang, biaya Rp, status})
//   + do_orders (pesanan tiap outlet pada tanggal D)
//   => baris `receiving` per outlet, tanggal = hari TIBA (D + 1), jumlah & biaya dibagi SEBANDING jumlah yang dipesan tiap outlet
//      (perkiraan -- Dolan Order tidak mencatat pembagian nyata). Barang yang tiba tanpa ada pesanan outlet -> outlet "SEMUA".
//
// Idempoten: id dokumen deterministik (do_{D}_{outlet}_{hash}), tiap putaran direkonsiliasi untuk 30 hari terakhir:
// baris yang berubah ditulis ulang, yang dibatalkan di Dolan Order dihapus. Baris receiving dari sumber lain (tanpa
// field orderDate) tidak pernah disentuh.
// Logika murni dipisah dari I/O supaya bisa diuji tanpa Firestore.
// ============================================================
const crypto = require("crypto");

const WINDOW_DAYS = 30;
const SOURCE = "dolan-order";
const pad = (n) => String(n).padStart(2, "0");
const todayWib = (ms = Date.now()) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const hashKey = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
const r3 = (x) => Math.round(x * 1000) / 1000;

// Baris receiving yang diinginkan -> Map(id -> baris)
function planReceiving(buys, orders) {
  const ordered = new Map();   // "tanggal|key" -> [{unit, qty}] (urut tetap supaya pembulatan stabil)
  for (const o of orders) {
    if (o.none) continue;
    for (const l of o.lines || []) {
      const k = `${o.date}|${l.key}`;
      const arr = ordered.get(k) || ordered.set(k, []).get(k);
      const ex = arr.find((a) => a.unit === o.unit);
      if (ex) ex.qty += l.qty; else arr.push({ unit: o.unit, qty: l.qty });
    }
  }
  for (const arr of ordered.values()) arr.sort((a, b) => a.unit.localeCompare(b.unit));

  const out = new Map();
  for (const buy of buys) {
    for (const it of Object.values(buy.items || {})) {
      const parts = ordered.get(`${buy.date}|${it.key}`) || [];
      const total = parts.reduce((s, p) => s + p.qty, 0);
      const base = { source: SOURCE, orderDate: buy.date, date: addDays(buy.date, 1), itemId: String(it.key).split("|")[0], itemName: it.name, unit: it.unit, cat: buy.cat, status: it.st, note: it.note || "", purchaseId: "", supplier: "" };
      const emit = (outlet, orderedQty, recv, cost) => {
        const id = `do_${buy.date}_${outlet}_${hashKey(it.key)}`;
        out.set(id, { ...base, outlet, orderedQuantity: r3(orderedQty), receivedQuantity: r3(recv), difference: r3(recv - orderedQty), cost });
      };
      if (!parts.length || total <= 0) { emit("SEMUA", it.orderQty || 0, it.qty, it.cost ?? null); continue; }
      let leftQ = it.qty, leftC = it.cost ?? null;
      parts.forEach((p, i) => {
        const last = i === parts.length - 1, share = p.qty / total;
        const q = last ? leftQ : r3(it.qty * share);
        const c = leftC === null ? null : last ? leftC : Math.round(it.cost * share);
        leftQ = r3(leftQ - q); if (leftC !== null) leftC -= c;
        emit(p.unit, p.qty, q, c);
      });
    }
  }
  return out;
}

// Bandingkan dengan yang sudah ada -> { set: [[id,row]], del: [id] }. `existing`: Map(id -> data) untuk orderDate >= from.
const SIG = ["orderDate", "date", "outlet", "itemId", "itemName", "unit", "cat", "status", "note", "orderedQuantity", "receivedQuantity", "cost"];
const sig = (r) => JSON.stringify(SIG.map((k) => r?.[k] ?? null));
function reconcile(desired, existing) {
  const set = [], del = [];
  for (const [id, row] of desired) if (sig(existing.get(id)) !== sig(row)) set.push([id, row]);
  for (const id of existing.keys()) if (!desired.has(id)) del.push(id);
  return { set, del };
}

// Cermin katalog Dolan Order (id, nama, kategori, satuan) supaya halaman Dolan Sawah AI bisa menautkan bahan resep.
function planMirror(items, existingMirror) {
  const set = [];
  for (const it of items) {
    const row = { name: it.name, cat: it.cat, unit: it.unit, active: it.active !== false };
    const ex = existingMirror.get(it.id);
    if (!ex || ex.name !== row.name || ex.cat !== row.cat || ex.unit !== row.unit || ex.active !== row.active) set.push([it.id, row]);
  }
  return set;
}

async function commit(db, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
}

// I/O: satu putaran sinkron. Mengembalikan ringkasan.
async function runSync(db, nowMs = Date.now()) {
  const from = addDays(todayWib(nowMs), -WINDOW_DAYS);
  const [bs, os, is, ex, mir] = await Promise.all([
    db.collection("do_buys").where("date", ">=", from).get(),
    db.collection("do_orders").where("date", ">=", from).get(),
    db.collection("do_items").get(),
    db.collection("receiving").where("orderDate", ">=", from).get(),
    db.collection("order_items_mirror").get(),
  ]);
  const desired = planReceiving(bs.docs.map((d) => d.data()), os.docs.map((d) => d.data()));
  const existing = new Map(ex.docs.filter((d) => d.data().source === SOURCE).map((d) => [d.id, d.data()]));
  const { set, del } = reconcile(desired, existing);
  const mset = planMirror(is.docs.map((d) => ({ id: d.id, ...d.data() })), new Map(mir.docs.map((d) => [d.id, d.data()])));
  const now = new Date(nowMs).toISOString();
  await commit(db, [
    ...set.map(([id, row]) => (b) => b.set(db.collection("receiving").doc(id), { ...row, createdAt: existing.get(id)?.createdAt || now, syncedAt: now })),
    ...del.map((id) => (b) => b.delete(db.collection("receiving").doc(id))),
    ...mset.map(([id, row]) => (b) => b.set(db.collection("order_items_mirror").doc(id), row)),
  ]);
  const summary = { at: now, from, rows: desired.size, written: set.length, deleted: del.length, mirrorWritten: mset.length, buyDocs: bs.size, orderDocs: os.size };
  await db.collection("settings").doc("doOrderSync").set(summary);
  return summary;
}

module.exports = { planReceiving, reconcile, planMirror, runSync, WINDOW_DAYS, SOURCE, addDays, todayWib };
