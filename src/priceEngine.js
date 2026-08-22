// ============================================================
// DOLAN SAWAH AI
// PRICE ENGINE
// ============================================================

import {
  collection,
  addDoc,
  getDocs
} from "firebase/firestore";

import { db } from "./firebase";

const PRICE_HISTORY =
  "price_history";

// ============================================================
// GET PRICE HISTORY
// ============================================================

export async function getPriceHistory() {
  const snapshot =
    await getDocs(
      collection(
        db,
        PRICE_HISTORY
      )
    );

  return snapshot.docs.map(
    (doc) => ({
      id: doc.id,
      ...doc.data()
    })
  );
}

// ============================================================
// SAVE PRICE
// ============================================================

export async function savePrice(
  data
) {
  if (!data.itemName) {
    throw new Error(
      "Nama barang wajib diisi."
    );
  }

  if (
    Number(data.price) <= 0
  ) {
    throw new Error(
      "Harga harus lebih dari 0."
    );
  }

  const priceData = {
    itemId:
      data.itemId || "",

    itemName:
      data.itemName,

    unit:
      data.unit || "",

    price:
      Number(data.price),

    supplier:
      data.supplier || "",

    effectiveDate:
      data.effectiveDate ||
      new Date()
        .toISOString()
        .slice(0, 10),

    source:
      data.source || "AI",

    createdAt:
      new Date().toISOString()
  };

  const ref =
    await addDoc(
      collection(
        db,
        PRICE_HISTORY
      ),
      priceData
    );

  return {
    id: ref.id,
    ...priceData
  };
}

// ============================================================
// GET CURRENT PRICE
// ============================================================

export function getCurrentPrice(
  itemName,
  priceHistory,
  date = null
) {
  const targetDate =
    date ||
    new Date()
      .toISOString()
      .slice(0, 10);

  const normalized =
    String(
      itemName || ""
    )
      .trim()
      .toLowerCase();

  const candidates =
    priceHistory
      .filter(
        (item) =>
          String(
            item.itemName || ""
          )
            .trim()
            .toLowerCase() ===
          normalized
      )
      .filter(
        (item) =>
          String(
            item.effectiveDate ||
            ""
          ) <= targetDate
      )
      .sort(
        (a, b) =>
          String(
            b.effectiveDate || ""
          ).localeCompare(
            String(
              a.effectiveDate || ""
            )
          )
      );

  return candidates[0] || null;
}

// ============================================================
// PRICE CHANGE
// ============================================================

export function comparePrices(
  previous,
  current
) {
  if (!previous || !current) {
    return null;
  }

  const oldPrice =
    Number(previous.price || 0);

  const newPrice =
    Number(current.price || 0);

  const difference =
    newPrice - oldPrice;

  const percentage =
    oldPrice > 0
      ? (difference /
          oldPrice) *
        100
      : null;

  return {
    oldPrice,
    newPrice,
    difference,
    percentage
  };
}