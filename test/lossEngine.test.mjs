import test from "node:test"; import assert from "node:assert/strict";
import { computeLoss, toBase, suggestItems, resolveIngredient, norm } from "../src/lossEngine.js";

const mirror = [
  { id: "ayam-paha-bawah", name: "Paha bawah", cat: "ayam", unit: "kg" },
  { id: "ayam-fillet-dada-ayam", name: "Fillet dada ayam", cat: "ayam", unit: "kg" },
  { id: "pasar-daging-sapi", name: "Daging sapi", cat: "pasar", unit: "kg" },
  { id: "pasar-santan", name: "Santan", cat: "pasar", unit: "pcs" },
];
const R = (date, outlet, itemId, itemName, qty, unit, cost) => ({ date, outlet, itemId, itemName, receivedQuantity: qty, unit, cost, cat: "ayam" });
const S = (date, outlet, menuName, quantity) => ({ date, outlet, menuName, quantity });
const recipes = [
  { menuName: "Ayam Kremes", portions: 1, ingredients: [{ itemName: "Paha Bawah", quantity: 0.125, unit: "kg" }] },
  { menuName: "Soto Sapi", portions: 1, ingredients: [{ itemName: "Daging Sapi", quantity: 50, unit: "gr" }] },
  { menuName: "Ayam Bakar", portions: 1, ingredients: [{ itemName: "Paha Tepong", quantity: 0.25, unit: "kg" }] },   // tidak ada di katalog
];
const base = { mirror, recipes, from: "2026-11-01", to: "2026-11-30", tolerancePct: 10 };

test("satuan dasar: gr -> kg, ons -> kg, ml -> liter, ikat tetap ikat", () => {
  assert.deepEqual(toBase(50, "gr"), { v: 0.05, base: "kg" }); assert.equal(toBase(5, "ons").v, 0.5); assert.deepEqual(toBase(500, "ml"), { v: 0.5, base: "liter" }); assert.equal(toBase(3, "ikat").base, "ikat");
});

test("selisih = datang - (penjualan x resep) - waste, dalam qty dan Rp (hitungan tangan)", () => {
  // Paha bawah: datang 12 kg @ Rp 40.000/kg; terjual 80 porsi x 0,125 = 10 kg; waste 0,5 kg -> selisih 1,5 kg = Rp 60.000 (12,5%)
  const r = computeLoss({ ...base,
    receiving: [R("2026-11-13", "DS", "ayam-paha-bawah", "Paha bawah", 12, "kg", 480000)],
    sales: [S("2026-11-14", "DS", "Ayam Kremes", 50), S("2026-11-15", "DS", "ayam kremes", 30)],
    waste: [{ date: "2026-11-15", outlet: "DS", itemName: "Paha bawah", quantity: 0.5, unit: "kg" }] });
  const row = r.rows.find((x) => x.id === "ayam-paha-bawah");
  assert.equal(row.recv, 12); assert.equal(row.usage, 10); assert.equal(row.waste, 0.5); assert.equal(row.unexplained, 1.5);
  assert.equal(row.unitCost, 40000); assert.equal(row.unexplainedValue, 60000); assert.ok(Math.abs(row.pct - 12.5) < 1e-9);
  assert.equal(row.status, "selisih-lebih"); assert.equal(r.kpi.unexplainedValue, 60000); assert.equal(r.kpi.wasteValue, 20000); assert.equal(r.kpi.usedValue, 400000);
});

test("dalam toleransi = wajar; pakai melebihi datang = terpakai-melebihi", () => {
  const ok = computeLoss({ ...base, receiving: [R("2026-11-13", "DS", "ayam-paha-bawah", "Paha bawah", 10.5, "kg", 420000)], sales: [S("2026-11-14", "DS", "Ayam Kremes", 80)] });
  assert.equal(ok.rows[0].status, "wajar");   // selisih 0,5 kg = 4,8%
  const over = computeLoss({ ...base, receiving: [R("2026-11-13", "DS", "ayam-paha-bawah", "Paha bawah", 8, "kg", 320000)], sales: [S("2026-11-14", "DS", "Ayam Kremes", 80)] });
  assert.equal(over.rows[0].status, "terpakai-melebihi"); assert.equal(over.kpi.overUsedValue, 80000); assert.equal(over.kpi.unexplainedValue, 0);
});

test("resep gram vs datang kg dikonversi benar", () => {
  const r = computeLoss({ ...base, receiving: [R("2026-11-13", "DS", "pasar-daging-sapi", "Daging sapi", 5, "kg", 600000)], sales: [S("2026-11-14", "DS", "Soto Sapi", 90)] });
  const row = r.rows[0]; assert.equal(row.usage, 4.5); assert.equal(row.unexplained, 0.5); assert.equal(row.status, "wajar");   // 10%: tepat di batas, bukan 'lebih'
});

test("bahan resep tanpa tautan: tidak dihitung, muncul di daftar tautan dengan saran", () => {
  const r = computeLoss({ ...base, receiving: [], sales: [S("2026-11-14", "DS", "Ayam Bakar", 40)] });
  assert.equal(r.unlinkedIngredients.length, 1); assert.equal(r.unlinkedIngredients[0].name, "Paha Tepong"); assert.deepEqual(r.unlinkedIngredients[0].menus, ["Ayam Bakar"]);
  assert.equal(r.rows.length, 0, "tidak ada angka palsu untuk bahan yang belum tertaut");
  assert.equal(r.coverage.portionsPct, 0, "40 porsi terjual, 0 punya resep tertaut");
});

test("tautan manual menyelesaikan bahan; 'none' = sengaja tidak dilacak", () => {
  const withLink = computeLoss({ ...base, links: { "paha tepong": "ayam-paha-bawah" }, receiving: [R("2026-11-13", "DS", "ayam-paha-bawah", "Paha bawah", 20, "kg", 800000)], sales: [S("2026-11-14", "DS", "Ayam Bakar", 40)] });
  assert.equal(withLink.unlinkedIngredients.length, 0); assert.equal(withLink.rows[0].usage, 10);   // 40 x 0,25
  const none = computeLoss({ ...base, links: { "paha tepong": "none" }, sales: [S("2026-11-14", "DS", "Ayam Bakar", 40)] });
  assert.equal(none.unlinkedIngredients.length, 0); assert.equal(none.coverage.portionsWithRecipe, 0);
});

test("barang datang tanpa resep: status tanpa-resep, tidak masuk selisih", () => {
  const r = computeLoss({ ...base, receiving: [R("2026-11-13", "DS", "pasar-santan", "Santan", 30, "pcs", 150000)] });
  assert.equal(r.rows[0].status, "tanpa-resep"); assert.equal(r.kpi.unexplainedValue, 0); assert.equal(r.kpi.analyzedItems, 0);
  assert.equal(r.coverage.purchaseValuePct, 0, "0% nilai pembelian punya resep");
});

test("satuan resep tidak sebanding dengan satuan beli -> satuan-beda, tidak dihitung", () => {
  const rc = [{ menuName: "Es Kelapa", portions: 1, ingredients: [{ itemName: "Santan", quantity: 0.1, unit: "kg" }] }];
  const r = computeLoss({ ...base, recipes: rc, receiving: [R("2026-11-13", "DS", "pasar-santan", "Santan", 30, "pcs", 150000)], sales: [S("2026-11-14", "DS", "Es Kelapa", 20)] });
  assert.equal(r.rows[0].status, "satuan-beda"); assert.equal(r.kpi.analyzedItems, 0);
});

test("menu terjual tanpa resep dicatat terpisah, berurut", () => {
  const r = computeLoss({ ...base, sales: [S("2026-11-14", "DS", "Es Teh", 100), S("2026-11-14", "DS", "Nasi Goreng", 30), S("2026-11-14", "DS", "Ayam Kremes", 10)] });
  assert.deepEqual(r.noRecipeMenus.map((m) => [m.menuName, m.qty]), [["Es Teh", 100], ["Nasi Goreng", 30]]);
});

test("biaya kosong: Rp tidak dikarang (null), tidak jadi Rp 0", () => {
  const r = computeLoss({ ...base, receiving: [R("2026-11-13", "DS", "ayam-paha-bawah", "Paha bawah", 12, "kg", null)], sales: [S("2026-11-14", "DS", "Ayam Kremes", 80)] });
  assert.equal(r.rows[0].unitCost, null); assert.equal(r.rows[0].unexplainedValue, null); assert.equal(r.kpi.unexplainedNoPrice, 1);
  assert.equal(r.kpi.receivedValueUnknownItems, 1);
});

test("rentang tanggal & outlet memfilter data", () => {
  const rec = [R("2026-10-31", "DS", "ayam-paha-bawah", "Paha bawah", 99, "kg", 1), R("2026-11-13", "DS", "ayam-paha-bawah", "Paha bawah", 10, "kg", 400000), R("2026-11-13", "BA", "ayam-paha-bawah", "Paha bawah", 5, "kg", 200000)];
  const sl = [S("2026-11-14", "DS", "Ayam Kremes", 80), S("2026-11-14", "BA", "Ayam Kremes", 8)];
  const all = computeLoss({ ...base, receiving: rec, sales: sl }); assert.equal(all.rows[0].recv, 15); assert.equal(all.rows[0].usage, 11);
  const ds = computeLoss({ ...base, outlet: "DS", receiving: rec, sales: sl }); assert.equal(ds.rows[0].recv, 10); assert.equal(ds.rows[0].usage, 10);
  assert.deepEqual(all.byOutlet.map((o) => o.outlet).sort(), ["BA", "DS"]);
  const ba = all.byOutlet.find((o) => o.outlet === "BA"); assert.equal(ba.unexplainedValue, 160000, "BA: datang 5 kg, pakai 1 kg -> 4 kg x Rp 40.000");
});

test("porsi resep membagi jumlah bahan", () => {
  const rc = [{ menuName: "Sop", portions: 4, ingredients: [{ itemName: "Daging Sapi", quantity: 1, unit: "kg" }] }];
  const r = computeLoss({ ...base, recipes: rc, receiving: [R("2026-11-13", "DS", "pasar-daging-sapi", "Daging sapi", 2, "kg", 200000)], sales: [S("2026-11-14", "DS", "Sop", 8)] });
  assert.equal(r.rows[0].usage, 2);
});

test("saran tautan: nama mirip diurutkan; resolve manual/auto", () => {
  assert.equal(suggestItems("Fillet Dada Ayam", mirror)[0].id, "ayam-fillet-dada-ayam");
  assert.equal(suggestItems("paha", mirror)[0].id, "ayam-paha-bawah");
  const byId = new Map(mirror.map((m) => [m.id, m])), byName = new Map(mirror.map((m) => [norm(m.name), [m]]));
  assert.equal(resolveIngredient({ itemName: "Daging Sapi" }, {}, byId, byName).how, "auto");
  assert.equal(resolveIngredient({ itemName: "Daging Sapi" }, { "daging sapi": "none" }, byId, byName).how, "none");
  assert.equal(resolveIngredient({ itemName: "Paha Tepong" }, {}, byId, byName).how, "unlinked");
});
