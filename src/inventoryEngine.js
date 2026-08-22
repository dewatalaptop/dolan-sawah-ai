// ============================================================
// DOLAN SAWAH AI
// INVENTORY ENGINE
// ============================================================

import {
  collection,
  getDocs
} from "firebase/firestore";

import { db } from "./firebase";

import {
  COLLECTIONS
} from "./dataModel";

// ============================================================
// GET COLLECTION
// ============================================================

async function getCollection(name) {
  const snapshot = await getDocs(
    collection(db, name)
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

// ============================================================
// LOAD ALL INVENTORY DATA
// ============================================================

export async function loadInventoryData() {
  const [
    items,
    recipes,
    openingStock,
    purchases,
    receiving,
    sales,
    stockOpname,
    waste,
    adjustments
  ] = await Promise.all([
    getCollection(COLLECTIONS.ITEMS),
    getCollection(COLLECTIONS.RECIPES),
    getCollection(COLLECTIONS.OPENING_STOCK),
    getCollection(COLLECTIONS.PURCHASES),
    getCollection(COLLECTIONS.RECEIVING),
    getCollection(COLLECTIONS.SALES),
    getCollection(COLLECTIONS.STOCK_OPNAME),
    getCollection(COLLECTIONS.WASTE),
    getCollection(COLLECTIONS.ADJUSTMENTS)
  ]);

  return {
    items,
    recipes,
    openingStock,
    purchases,
    receiving,
    sales,
    stockOpname,
    waste,
    adjustments
  };
}

// ============================================================
// CALCULATE THEORETICAL STOCK
// ============================================================

export function calculateTheoreticalStock(
  data
) {
  const result = {};

  function ensure(key, seed) {
    if (!result[key]) {
      result[key] = {
        itemId: seed.itemId || "",
        itemName: seed.itemName || "",
        unit: seed.unit || "",
        opening: 0,
        receiving: 0,
        usage: 0,
        waste: 0,
        adjustment: 0,
        theoretical: 0,
        actual: null,
        variance: null
      };
    }
  }

  // ----------------------------------------------------------
  // BASELINE: cari stock opname TERBARU (by tanggal, bukan urutan
  // array) per item, dan opname SEBELUMNYA (kalau ada) sebagai
  // titik awal periode. Ini mencegah stok teoritis menumpuk
  // seluruh histori transaksi sejak awal waktu -- setiap opname
  // baru me-reset perhitungan mulai dari opname sebelumnya, bukan
  // dari hari pertama aplikasi dipakai.
  // ----------------------------------------------------------

  const opnameByItem = {};
  for (const opname of data.stockOpname) {
    const key = opname.itemId || opname.itemName;
    if (!opnameByItem[key]) opnameByItem[key] = [];
    opnameByItem[key].push(opname);
  }

  const baselineInfo = {};
  Object.entries(opnameByItem).forEach(([key, records]) => {
    const sorted = [...records].sort((a, b) =>
      String(a.date || "").localeCompare(String(b.date || ""))
    );
    const latest = sorted[sorted.length - 1];
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;

    ensure(key, latest);
    result[key].actual = Number(latest.actualQuantity || 0);

    baselineInfo[key] = {
      latestDate: latest.date || "",
      baselineValue: previous ? Number(previous.actualQuantity || 0) : null,
      baselineDate: previous ? previous.date || "" : null
    };
  });

  // Transaksi dihitung ke periode ini kalau tanggalnya SETELAH
  // baseline (opname sebelumnya, kalau ada) dan TIDAK SETELAH
  // opname terbaru. Item tanpa opname sama sekali tetap
  // mengakumulasi seluruh histori seperti sebelumnya.
  function withinPeriod(key, date) {
    const info = baselineInfo[key];
    if (!info) return true;
    const d = String(date || "");
    const afterBaseline = info.baselineDate === null || d > info.baselineDate;
    const notAfterLatest = d <= info.latestDate;
    return afterBaseline && notAfterLatest;
  }

  // ----------------------------------------------------------
  // OPENING STOCK -- hanya relevan kalau belum ada opname
  // sebelumnya untuk item ini (kalau sudah ada, opname itu sendiri
  // yang jadi baseline, bukan stok awal).
  // ----------------------------------------------------------

  for (const item of data.openingStock) {
    const key = item.itemId || item.itemName;
    ensure(key, item);
    const info = baselineInfo[key];
    if (!info || info.baselineValue === null) {
      result[key].opening += Number(item.quantity || 0);
    }
  }

  // ----------------------------------------------------------
  // RECEIVING
  // ----------------------------------------------------------

  for (const item of data.receiving) {
    const key = item.itemId || item.itemName;
    ensure(key, item);
    if (withinPeriod(key, item.date)) {
      result[key].receiving += Number(item.receivedQuantity || 0);
    }
  }

  // ----------------------------------------------------------
  // WASTE
  // ----------------------------------------------------------

  for (const item of data.waste) {
    const key = item.itemId || item.itemName;
    ensure(key, item);
    if (withinPeriod(key, item.date)) {
      result[key].waste += Number(item.quantity || 0);
    }
  }

  // ----------------------------------------------------------
  // ADJUSTMENTS
  // ----------------------------------------------------------

  for (const item of data.adjustments) {
    const key = item.itemId || item.itemName;
    ensure(key, item);
    if (withinPeriod(key, item.date)) {
      result[key].adjustment += Number(item.quantity || 0);
    }
  }

  // ----------------------------------------------------------
  // SALES + RECIPES
  // ----------------------------------------------------------

  for (const sale of data.sales) {
    const recipe = data.recipes.find(
      (r) => r.menuName === sale.menuName
    );

    if (!recipe) {
      continue;
    }

    for (const ingredient of recipe.ingredients) {
      const key = ingredient.itemId || ingredient.itemName;
      ensure(key, ingredient);

      if (withinPeriod(key, sale.date)) {
        const amount =
          Number(ingredient.quantity || 0) *
          Number(sale.quantity || 0);

        result[key].usage += amount;
      }
    }
  }

  // ----------------------------------------------------------
  // FINAL CALCULATION
  // ----------------------------------------------------------

  Object.values(result).forEach((item) => {
    const key = item.itemId || item.itemName;
    const info = baselineInfo[key];
    const baseline =
      info && info.baselineValue !== null
        ? info.baselineValue
        : item.opening;

    item.theoretical =
      baseline +
      item.receiving -
      item.usage -
      item.waste +
      item.adjustment;

    if (item.actual !== null) {
      item.variance = item.actual - item.theoretical;
    }
  });

  return Object.values(result);
}

// ============================================================
// GENERATE VARIANCE REPORT
// ============================================================

export function generateVarianceReport(
  inventory
) {
  const analyzed =
    inventory.filter(
      (item) =>
        item.actual !== null
    );

  const variance =
    analyzed.filter(
      (item) =>
        Math.abs(
          item.variance
        ) > 0.0001
    );

  return {
    totalItems:
      inventory.length,

    itemsWithOpname:
      analyzed.length,

    varianceItems:
      variance.length,

    items: variance
  };
}