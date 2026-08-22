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

  // ----------------------------------------------------------
  // OPENING STOCK
  // ----------------------------------------------------------

  for (const item of data.openingStock) {
    const key =
      item.itemId ||
      item.itemName;

    if (!result[key]) {
      result[key] = {
        itemId: item.itemId || "",
        itemName:
          item.itemName || "",
        unit:
          item.unit || "",
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

    result[key].opening +=
      Number(item.quantity || 0);
  }

  // ----------------------------------------------------------
  // RECEIVING
  // ----------------------------------------------------------

  for (const item of data.receiving) {
    const key =
      item.itemId ||
      item.itemName;

    if (!result[key]) {
      result[key] = {
        itemId: item.itemId || "",
        itemName:
          item.itemName || "",
        unit:
          item.unit || "",
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

    result[key].receiving +=
      Number(
        item.receivedQuantity || 0
      );
  }

  // ----------------------------------------------------------
  // WASTE
  // ----------------------------------------------------------

  for (const item of data.waste) {
    const key =
      item.itemId ||
      item.itemName;

    if (!result[key]) {
      result[key] = {
        itemId: item.itemId || "",
        itemName:
          item.itemName || "",
        unit:
          item.unit || "",
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

    result[key].waste +=
      Number(item.quantity || 0);
  }

  // ----------------------------------------------------------
  // ADJUSTMENTS
  // ----------------------------------------------------------

  for (const item of data.adjustments) {
    const key =
      item.itemId ||
      item.itemName;

    if (!result[key]) {
      result[key] = {
        itemId: item.itemId || "",
        itemName:
          item.itemName || "",
        unit:
          item.unit || "",
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

    result[key].adjustment +=
      Number(item.quantity || 0);
  }

  // ----------------------------------------------------------
  // SALES + RECIPES
  // ----------------------------------------------------------

  for (const sale of data.sales) {
    const recipe =
      data.recipes.find(
        (r) =>
          r.menuName ===
          sale.menuName
      );

    if (!recipe) {
      continue;
    }

    for (
      const ingredient
      of recipe.ingredients
    ) {
      const key =
        ingredient.itemId ||
        ingredient.itemName;

      if (!result[key]) {
        result[key] = {
          itemId:
            ingredient.itemId || "",
          itemName:
            ingredient.itemName || "",
          unit:
            ingredient.unit || "",
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

      const amount =
        Number(
          ingredient.quantity || 0
        ) *
        Number(
          sale.quantity || 0
        );

      result[key].usage += amount;
    }
  }

  // ----------------------------------------------------------
  // ACTUAL STOCK
  // ----------------------------------------------------------

  for (const opname of data.stockOpname) {
    const key =
      opname.itemId ||
      opname.itemName;

    if (!result[key]) {
      result[key] = {
        itemId:
          opname.itemId || "",
        itemName:
          opname.itemName || "",
        unit:
          opname.unit || "",
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

    result[key].actual =
      Number(
        opname.actualQuantity || 0
      );
  }

  // ----------------------------------------------------------
  // FINAL CALCULATION
  // ----------------------------------------------------------

  Object.values(result).forEach(
    (item) => {
      item.theoretical =
        item.opening +
        item.receiving -
        item.usage -
        item.waste +
        item.adjustment;

      if (item.actual !== null) {
        item.variance =
          item.actual -
          item.theoretical;
      }
    }
  );

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