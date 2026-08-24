// ============================================================
// DOLAN SAWAH AI
// DATA MODEL
// ============================================================

export const COLLECTIONS = {
  ITEMS: "master_items",
  RECIPES: "master_recipes",

  OPENING_STOCK: "opening_stock",

  PURCHASES: "purchases",
  RECEIVING: "receiving",

  SALES: "sales",

  STOCK_OPNAME: "stock_opname",

  WASTE: "waste",
  ADJUSTMENTS: "adjustments",

  CHAT: "chat_messages",

  PURCHASE_CATEGORIES: "purchase_categories",

  ACTIVITY_LOG: "activity_log"
};

// ============================================================
// CHAT MESSAGE (riwayat chat, dikelompokkan per tanggal)
// ============================================================

export function createChatMessage(data = {}) {
  return {
    date: data.date || "",
    role: data.role || "user",
    text: data.text || "",
    tags: Array.isArray(data.tags) ? data.tags : [],
    createdAt: new Date().toISOString()
  };
}

// ============================================================
// ITEM
// ============================================================

export function createItem(data = {}) {
  return {
    name: data.name || "",
    category: data.category || "",
    unit: data.unit || "",
    sku: data.sku || "",
    active:
      data.active !== undefined
        ? data.active
        : true,

    createdAt:
      data.createdAt ||
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()
  };
}

// ============================================================
// RECIPE
// ============================================================

export function createRecipe(data = {}) {
  return {
    menuName: data.menuName || "",

    ingredients:
      Array.isArray(data.ingredients)
        ? data.ingredients
        : [],

    portions:
      Number(data.portions || 1),

    sellPrice:
      Number(data.sellPrice || 0),

    createdAt:
      data.createdAt ||
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()
  };
}

// ============================================================
// OPENING STOCK
// ============================================================

export function createOpeningStock(data = {}) {
  return {
    date: data.date || "",

    itemId: data.itemId || "",

    itemName: data.itemName || "",

    quantity:
      Number(data.quantity || 0),

    unit: data.unit || "",

    value:
      Number(data.value || 0),

    outlet:
      data.outlet || "DS",

    source:
      data.source || "AI",

    createdAt:
      new Date().toISOString()
  };
}

// ============================================================
// PURCHASE
// ============================================================

export function createPurchase(data = {}) {
  return {
    date: data.date || "",

    supplier:
      data.supplier || "",

    itemId:
      data.itemId || "",

    itemName:
      data.itemName || "",

    quantity:
      Number(data.quantity || 0),

    unit:
      data.unit || "",

    price:
      Number(data.price || 0),

    total:
      Number(data.total || 0),

    category:
      data.category || "",

    outlet:
      data.outlet || "DS",

    createdAt:
      new Date().toISOString()
  };
}

// ============================================================
// PURCHASE CATEGORY (dibuat manual oleh pengguna)
// ============================================================

export function createPurchaseCategory(data = {}) {
  return {
    name: data.name || "",
    createdAt: new Date().toISOString()
  };
}

// ============================================================
// ACTIVITY LOG (satu entri per aksi simpan -- dipakai untuk undo)
// ============================================================

export function createActivityLog(data = {}) {
  return {
    createdAt: new Date().toISOString(),
    actionType: data.actionType || "",
    collectionName: data.collectionName || "",
    documentIds: Array.isArray(data.documentIds) ? data.documentIds : [],
    summary: data.summary || "",

    // "create" (default, dokumen baru -- undo = hapus), "edit" (undo =
    // kembalikan nilai field lama), "delete" (undo = buat ulang dokumen
    // yang sama). `previousData` cuma dipakai untuk "edit"/"delete": objek
    // { [documentId]: dataLamaDokumenItu }.
    undoType: data.undoType || "create",
    previousData: data.previousData || null,

    undone: false,
    undoneAt: null
  };
}

// ============================================================
// RECEIVING / BARANG DATANG
// ============================================================

export function createReceiving(data = {}) {
  return {
    date: data.date || "",

    purchaseId:
      data.purchaseId || "",

    supplier:
      data.supplier || "",

    itemId:
      data.itemId || "",

    itemName:
      data.itemName || "",

    orderedQuantity:
      Number(data.orderedQuantity || 0),

    receivedQuantity:
      Number(data.receivedQuantity || 0),

    unit:
      data.unit || "",

    difference:
      Number(
        data.receivedQuantity || 0
      ) -
      Number(
        data.orderedQuantity || 0
      ),

    outlet:
      data.outlet || "DS",

    createdAt:
      new Date().toISOString()
  };
}

// ============================================================
// SALES
// ============================================================

export function createSale(data = {}) {
  return {
    date: data.date || "",

    menuId:
      data.menuId || "",

    menuName:
      data.menuName || "",

    quantity:
      Number(data.quantity || 0),

    outlet:
      data.outlet || "DS",

    source:
      data.source || "AI",

    createdAt:
      new Date().toISOString()
  };
}

// ============================================================
// STOCK OPNAME
// ============================================================

export function createStockOpname(data = {}) {
  return {
    date: data.date || "",

    itemId:
      data.itemId || "",

    itemName:
      data.itemName || "",

    actualQuantity:
      Number(data.actualQuantity || 0),

    unit:
      data.unit || "",

    outlet:
      data.outlet || "DS",

    createdAt:
      new Date().toISOString()
  };
}

// ============================================================
// WASTE
// ============================================================

export function createWaste(data = {}) {
  return {
    date: data.date || "",

    itemId:
      data.itemId || "",

    itemName:
      data.itemName || "",

    quantity:
      Number(data.quantity || 0),

    unit:
      data.unit || "",

    reason:
      data.reason || "",

    outlet:
      data.outlet || "DS",

    createdAt:
      new Date().toISOString()
  };
}

// ============================================================
// ADJUSTMENT
// ============================================================

export function createAdjustment(data = {}) {
  return {
    date: data.date || "",

    itemId:
      data.itemId || "",

    itemName:
      data.itemName || "",

    quantity:
      Number(data.quantity || 0),

    unit:
      data.unit || "",

    reason:
      data.reason || "",

    outlet:
      data.outlet || "DS",

    createdAt:
      new Date().toISOString()
  };
}