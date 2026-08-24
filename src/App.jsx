import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, addDoc, getDocs, query, limit, where, doc, writeBatch, updateDoc, deleteDoc } from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";

import { db, auth } from "./firebase";
import "./App.css";

import {
  COLLECTIONS,
  createOpeningStock,
  createPurchase,
  createPurchaseCategory,
  createReceiving,
  createSale,
  createStockOpname,
  createWaste,
  createAdjustment,
  createChatMessage,
  createActivityLog
} from "./dataModel";

import {
  loadInventoryData,
  calculateTheoreticalStock,
  generateVarianceReport
} from "./inventoryEngine";

import { saveRecipe, updateRecipe, deleteRecipe, calculateUsageFromSales } from "./recipeEngine";

import { getPriceHistory, savePrice, getCurrentPrice } from "./priceEngine";

import { processExcelFile } from "./excelEngine";

import { parseWhatsAppExport } from "./whatsappImportEngine";

import { findSimilarName, findPrefixCandidate } from "./similarityEngine";

import { buildReportWorkbook, downloadReportWorkbook } from "./reportEngine";

import { askAI, buildReportPrompt, analyzeIngredientPairs } from "./aiEngine";

/* =========================================================
   KONSTANTA
   ========================================================= */

// Tanggal kalender LOKAL (bukan UTC) dari sebuah Date. WAJIB dipakai untuk
// apa pun yang berarti "hari ini" menurut jam pengguna -- new Date().toISOString()
// selalu memakai UTC, jadi untuk pengguna di WIB (UTC+7) tanggalnya baru
// berganti jam 7 pagi, bukan tengah malam (chat/entri jadi tidak reset tepat
// waktu kalau dihitung lewat toISOString()).
function toLocalISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const TODAY = toLocalISODate(new Date());

// TODAY di atas cuma dihitung sekali saat modul di-load -- kalau tab
// dibiarkan terbuka melewati tengah malam, TODAY tetap tanggal lama
// selamanya. Untuk apa pun yang perlu tanggal "sekarang" yang akurat
// di tengah sesi (bukan cuma nilai awal/default), pakai fungsi ini,
// bukan konstanta TODAY.
function getTodayISO() {
  return toLocalISODate(new Date());
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toLocalISODate(d);
}

function buildWelcomeMessage() {
  return {
    id: "welcome",
    role: "assistant",
    text:
      "Halo, saya Dolan Sawah AI.\n\n" +
      "Kirim data operasional dalam bahasa biasa — stok awal, pembelian, barang datang, " +
      "penjualan, stock opname, resep, waste, atau harga bahan — dan saya catat otomatis " +
      "ke database untuk 3 outlet (Dolan Sawah, Sawah Senja, Soto Pagi).\n\n" +
      "Saya juga bisa menjawab pertanyaan seperti \"apa saja yang perlu dibeli besok?\" atau " +
      "\"item mana selisihnya paling besar minggu ini?\"."
  };
}

const OUTLETS = [
  { id: "ALL", label: "Semua Outlet" },
  { id: "DS", label: "Dolan Sawah" },
  { id: "SS", label: "Sawah Senja" },
  { id: "SP", label: "Soto Pagi" }
];

const MENU = [
  { id: "chat", label: "AI Assistant", icon: "chat" },
  { section: "OPERASIONAL" },
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "stok-awal", label: "Stok Awal", icon: "box" },
  { id: "pembelian", label: "Pembelian", icon: "cart" },
  { id: "barang-datang", label: "Barang Datang", icon: "truck" },
  { id: "penjualan", label: "Penjualan", icon: "coin" },
  { id: "stok", label: "Stock Opname", icon: "box" },
  { section: "ANALISIS" },
  { id: "kebutuhan", label: "Kebutuhan Bahan", icon: "leaf" },
  { id: "variance", label: "Variance & Waste", icon: "trend" },
  { id: "harga", label: "Harga Bahan", icon: "tag" },
  { id: "resep", label: "Resep", icon: "book" },
  { id: "import", label: "Import Excel", icon: "upload" },
  { id: "import-wa", label: "Import Chat WA", icon: "chat" },
  { id: "riwayat", label: "Riwayat Aktivitas", icon: "trend" },
  { id: "laporan", label: "Laporan AI", icon: "doc" }
];

const MOBILE_NAV = ["chat", "dashboard", "kebutuhan", "variance"];

/* =========================================================
   HELPER DASAR
   ========================================================= */

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[""]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNumber(value, maxDecimals = 1) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: maxDecimals
  }).format(n);
}

function formatDateID(date) {
  const value = date || TODAY;
  const [y, m, d] = String(value).split("-");
  if (!y || !m || !d) return value;
  return `${d}-${m}-${y}`;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let text = String(value || "").trim();

  if (text.includes(".") && text.includes(",")) {
    // format Indonesia lengkap: 25.000,50
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(".")) {
    // "." bisa berarti ribuan (25.000) atau desimal (4.5) -- hanya
    // dianggap pemisah ribuan kalau persis 3 digit di belakang titik,
    // sama seperti logika parseNumber() di excelEngine.js.
    const parts = text.split(".");
    if (parts.length === 2 && parts[1].length === 3) {
      text = parts.join("");
    }
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  return Number(text.replace(/[^\d.-]/g, "")) || 0;
}

function unitNormalize(unit) {
  const u = normalizeText(unit);
  if (u.includes("mililiter") || u.includes("milliliter") || u === "ml") return "ml";
  if (u.includes("liter") || u === "l" || u === "ltr") return "liter";
  if (u.includes("gram") || u === "gr" || u === "g") return "gram";
  if (u.includes("kg") || u.includes("kilo")) return "kg";
  if (
    u.includes("pcs") ||
    u.includes("buah") ||
    u.includes("butir") ||
    u.includes("ekor") ||
    u.includes("porsi") ||
    u.includes("pack") ||
    u.includes("bungkus") ||
    u.includes("kemasan") ||
    u.includes("ikat") ||
    u.includes("dus") ||
    u.includes("krat") ||
    u.includes("bal") ||
    u.includes("sak") ||
    u.includes("kotak") ||
    u.includes("kranjang") ||
    u.includes("keranjang") ||
    u.includes("botol") ||
    u.includes("karton")
  ) {
    return "unit";
  }
  return u || "unit";
}

// Konversi ke satuan dasar: kg->gram, liter tetap liter, unit tetap unit.
// Ini dipakai supaya perhitungan kebutuhan bahan & variance tidak
// mencampur kg dengan gram secara diam-diam (lihat catatan di bawah).
function convertToBase(value, unit) {
  const n = Number(value || 0);
  const u = unitNormalize(unit);
  if (u === "kg") return { value: n * 1000, base: "gram" };
  if (u === "gram") return { value: n, base: "gram" };
  if (u === "liter") return { value: n, base: "liter" };
  if (u === "ml") return { value: n / 1000, base: "liter" };
  return { value: n, base: "unit" };
}

function displayQuantity(value, base) {
  const n = Number(value || 0);
  if (base === "gram" && Math.abs(n) >= 1000) {
    return `${formatNumber(n / 1000, 2)} kg`;
  }
  if (base === "gram") return `${formatNumber(n)} gram`;
  if (base === "liter") return `${formatNumber(n, 2)} liter`;
  return `${formatNumber(n)} unit`;
}

/* =========================================================
   ALIAS BAHAN
   ========================================================= */

const INGREDIENT_ALIASES = {
  ayam: "Ayam",
  "ayam potong": "Ayam",
  "ayam broiler": "Ayam",
  "daging sapi": "Daging Sapi",
  sapi: "Daging Sapi",
  beras: "Beras",
  nasi: "Beras",
  "minyak goreng": "Minyak Goreng",
  minyak: "Minyak Goreng",
  gula: "Gula",
  telur: "Telur",
  tepung: "Tepung",
  kikil: "Kikil",
  babat: "Babat",
  tetelan: "Tetelan"
};

function normalizeIngredient(name) {
  const raw = normalizeText(name);
  return INGREDIENT_ALIASES[raw] || titleCase(name);
}

/* =========================================================
   DETEKSI OUTLET
   ========================================================= */

function detectOutlet(text, fallback) {
  const t = normalizeText(text);
  if (/sawah senja/.test(t) || /\bss\b/.test(t)) return "SS";
  if (/soto pagi|soto sawah/.test(t) || /\bsp\b/.test(t)) return "SP";
  if (/dolan sawah/.test(t) || /\bds\b/.test(t)) return "DS";
  return fallback === "ALL" ? "DS" : fallback;
}

/* =========================================================
   PARSER TANGGAL
   ========================================================= */

function extractDate(text) {
  const source = String(text);

  let match = source.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) {
    return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(
      match[1]
    ).padStart(2, "0")}`;
  }

  match = source.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) {
    return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(
      match[3]
    ).padStart(2, "0")}`;
  }

  const bulanMap = {
    januari: "01", februari: "02", maret: "03", april: "04",
    mei: "05", juni: "06", juli: "07", agustus: "08",
    september: "09", oktober: "10", november: "11", desember: "12"
  };
  match = normalizeText(source).match(
    /(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/
  );
  if (match) {
    return `${match[3]}-${bulanMap[match[2]]}-${String(match[1]).padStart(2, "0")}`;
  }

  if (/\bkemarin\b/.test(normalizeText(source))) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toLocalISODate(d);
  }

  return TODAY;
}

/* =========================================================
   DETEKSI: apakah pesan ini pertanyaan/permintaan laporan?
   Dicek PALING AWAL, sebelum kata kunci data-entry -- supaya
   pertanyaan natural seperti "apa menu dengan penjualan
   tertinggi?" tidak salah dianggap sebagai input data hanya
   karena mengandung kata "penjualan". Tanpa ini, kata benda
   topik (penjualan/pembelian/stok/harga/dst.) selalu menang
   duluan meskipun kalimatnya jelas-jelas sebuah pertanyaan.
   ========================================================= */

function looksLikeReportRequest(t) {
  if (t.trim().endsWith("?")) return true;

  const starters = [
    "apa ", "apa saja", "apakah", "berapa", "bagaimana", "gimana",
    "kenapa", "mengapa", "kapan", "siapa", "coba ", "tolong ",
    "buatkan", "tampilkan", "tunjukkan", "rangkum", "ringkas",
    "ringkasan", "jelaskan", "kasih tau", "kasih tahu", "beritahu",
    "info ", "cek "
  ];
  if (starters.some((w) => t.startsWith(w))) return true;

  const anywhere = [" mana yang ", " yang mana ", " adakah ", " apakah "];
  return anywhere.some((w) => t.includes(w));
}

/* =========================================================
   DETEKSI JENIS DATA
   Urutan penting: cek yang paling spesifik dulu supaya tidak
   salah tangkap (mis. "stock opname" jangan kebaca sebagai "stok").
   ========================================================= */

function detectDataType(text) {
  const t = normalizeText(text);

  if (looksLikeReportRequest(t)) {
    return "report";
  }

  if (t.includes("stock opname") || t.includes("stok opname") || t.includes("opname")) {
    return "stock_opname";
  }

  if (
    t.includes("barang datang") ||
    t.includes("barang yang datang") ||
    t.includes("barang diterima") ||
    t.includes("diterima") ||
    t.includes("terima barang")
  ) {
    return "receiving";
  }

  if (t.includes("stok awal") || t.includes("stock awal") || t.includes("saldo awal")) {
    return "opening_stock";
  }

  if (
    t.includes("waste") ||
    t.includes("rusak") ||
    t.includes("terbuang") ||
    t.includes("busuk") ||
    t.includes("kadaluarsa") ||
    t.includes("basi")
  ) {
    return "waste";
  }

  if (t.includes("penyesuaian") || t.includes("koreksi stok") || t.includes("adjustment")) {
    return "adjustment";
  }

  if (
    t.includes("pembelian") ||
    t.includes("pembelanjaan") ||
    t.includes("belanja") ||
    t.includes("pesan barang") ||
    t.includes("po ke") ||
    t.includes("order barang") ||
    /\bbeli\b/.test(t)
  ) {
    return "purchase";
  }

  if (t.includes("penjualan") || t.includes("terjual") || t.includes("laku")) {
    return "sales";
  }

  if (t.includes("resep") || (t.includes("per porsi") && !t.includes("penjualan"))) {
    return "recipe";
  }

  if (t.includes("harga") || t.includes("update harga") || t.includes("price")) {
    return "price";
  }

  if (
    t.includes("laporan") ||
    t.includes("variance") ||
    t.includes("selisih") ||
    t.includes("analisa") ||
    t.includes("analisis") ||
    t.includes("kebutuhan") ||
    t.includes("rekomendasi") ||
    t.includes("saran")
  ) {
    return "report";
  }

  return "unknown";
}

// Ekspor WhatsApp asli (header "===== DD/MM/YY =====", header pesan
// "[DD/MM/YY, HH.MM.SS] Pengirim:", atau banyak baris outlet berdiri
// sendiri) mengandung BANYAK tanggal/outlet sekaligus dalam satu teks --
// beda dari asumsi chat biasa di sini (satu pesan = satu tanggal + satu
// outlet). Kalau dipaksa diproses lewat parser satu-tanggal biasa, semua
// baris dari berbagai tanggal/outlet akan tergabung salah jadi SATU
// tanggal/outlet -- makanya perlu dideteksi lebih dulu dan diarahkan ke
// menu "Import Chat WA" yang memang dibuat khusus untuk format ini.
function looksLikeWhatsAppExport(text) {
  const dateHeaders = (text.match(/^=+\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*=+$/gm) || []).length;
  const msgHeaders = (text.match(/^\[?\d{1,2}\/\d{1,2}\/\d{2,4},\s*[\d.:]+\]/gm) || []).length;
  const outletLines = (text.match(/^(DS|SS|SP)$/gim) || []).length;
  return dateHeaders >= 2 || msgHeaders >= 2 || outletLines >= 2;
}

/* =========================================================
   PARSER BARIS "BARANG + JUMLAH + SATUAN"
   Dipakai untuk stok awal, pembelian, barang datang, stock
   opname, waste, adjustment.
   ========================================================= */

function parseItemLines(text) {
  const lines = String(text)
    .split(/\n|;/)
    .map((x) => x.trim())
    .filter(Boolean);

  const result = [];

  for (const line of lines) {
    // Satuan wajib match di sini (bukan opsional). Baris header/tanggal
    // ("Stok awal 21 Agustus 2026 DS", "21-08-2026", "Untuk outlet DS
    // tanggal 21 Agustus 2026", dll.) selalu punya angka tapi angka itu
    // tidak pernah diikuti langsung oleh kata satuan — jadi mewajibkan
    // satuan di sini otomatis mencegah angka tanggal/metadata terbaca
    // sebagai quantity barang, tanpa perlu parser tanggal terpisah.
    const match = line.match(
      /([\d.,]+)\s*(kg|kilogram|gram|gr|g|liter|ltr|l|ml|porsi|pcs|buah|butir|ekor|pack|bungkus|kemasan|ikat|dus|krat|bal|sak|kotak|kranjang|keranjang|botol|karton)\b/i
    );

    if (!match || !match[1]) continue;

    let clean = line
      .replace(match[0], "")
      .replace(/^[-•*:\s]+/, "")
      .trim();

    if (!clean) continue;

    // baris "supplier: xxx" / "alasan: xxx" bukan baris barang
    if (/^(supplier|vendor|alasan|keterangan|catatan)\s*:/i.test(clean)) continue;

    result.push({
      itemName: normalizeIngredient(clean),
      quantity: toNumber(match[1]),
      unit: unitNormalize(match[2])
    });
  }

  return result;
}

function extractLabeledValue(text, labels) {
  const lines = String(text).split(/\n/);
  for (const line of lines) {
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, "i");
      const match = line.trim().match(re);
      if (match) return match[1].trim();
    }
  }
  return "";
}

/* =========================================================
   PARSER PENJUALAN
   ========================================================= */

function parseSalesLines(text) {
  const lines = String(text)
    .split(/\n|;/)
    .map((x) => x.trim())
    .filter(Boolean);

  const result = [];

  for (const line of lines) {
    // Satuan wajib ada (bukan opsional) supaya baris header/tanggal tanpa
    // outlet (mis. "Penjualan 21 Agustus 2026") tidak salah terbaca jadi
    // penjualan dengan menuName ngawur dan quantity = tahunnya.
    const match = line.match(/^[-•*]?\s*(.+?)\s+([\d.,]+)\s*(porsi|pcs|buah|unit)$/i);
    if (!match) continue;

    const name = match[1].replace(/^penjualan\s*/i, "").trim();
    const quantity = toNumber(match[2]);
    if (!name || !quantity) continue;

    result.push({ menuName: titleCase(name), quantity });
  }

  return result;
}

/* =========================================================
   PARSER RESEP -> dikelompokkan per menu
   ========================================================= */

function parseRecipeGroups(text) {
  const lines = String(text)
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const groups = {};
  let currentMenu = null;

  for (const rawLine of lines) {
    const clean = rawLine.replace(/^[-•*]\s*/, "").trim();
    if (!clean) continue;

    const match = clean.match(
      /([\d.,]+)\s*(kg|kilogram|gram|gr|g|liter|ltr|l|ml)\s*per\s+porsi/i
    );

    if (match) {
      // Potong di tanda akhir kalimat pertama (., ?, !) supaya kalimat lain
      // yang ikut terbawa dalam satu pesan (mis. "Ayam Bakar 250 gram per
      // porsi. Apa yang perlu dibeli besok?") tidak ikut menempel jadi
      // bagian dari nama menu/bahan -- sebelumnya seluruh kalimat kedua
      // ikut tersimpan sebagai nama resep.
      const remainingText = clean
        .replace(match[0], "")
        .trim()
        .split(/[.?!]/)[0]
        .trim();

      if (!currentMenu) {
        // Format singkat satu baris: "<Nama Menu> <qty> <satuan> per porsi"
        // (nama menu & bahan digabung di baris yang sama, tanpa baris nama
        // menu terpisah sebelumnya). Karena tidak ada nama bahan lain yang
        // disebutkan, nama menu dipakai juga sebagai nama bahannya.
        if (!remainingText) continue;

        const menuName = titleCase(remainingText.replace(/:$/, ""));

        if (!groups[menuName]) groups[menuName] = [];

        groups[menuName].push({
          itemName: normalizeIngredient(remainingText),
          quantity: toNumber(match[1]),
          unit: unitNormalize(match[2])
        });

        // Reset supaya baris berikutnya (resep lain dalam format singkat
        // yang sama) tidak ikut nyambung ke menu ini.
        currentMenu = null;
        continue;
      }

      // Format lama: baris ini bahan dari menu yang sudah ditentukan oleh
      // baris nama menu sebelumnya. Kalau tidak ada nama bahan sebelum
      // angkanya (mis. "250 gram per porsi" saja), baris ini bukan bahan
      // yang valid -- lewati supaya tidak masuk sebagai itemName kosong.
      if (!remainingText) continue;

      if (!groups[currentMenu]) groups[currentMenu] = [];

      groups[currentMenu].push({
        itemName: normalizeIngredient(remainingText),
        quantity: toNumber(match[1]),
        unit: unitNormalize(match[2])
      });

      continue;
    }

    if (!/resep/i.test(clean)) {
      currentMenu = titleCase(clean.replace(/:$/, ""));
    }
  }

  return Object.entries(groups).map(([menuName, ingredients]) => ({
    menuName,
    ingredients
  }));
}

/* =========================================================
   PARSER HARGA
   ========================================================= */

function parsePriceLines(text) {
  const lines = String(text)
    .split(/\n|;/)
    .map((x) => x.trim())
    .filter(Boolean);

  const result = [];

  for (const line of lines) {
    if (/^(supplier|update harga)\s*:?/i.test(line) && !/rp/i.test(line)) continue;

    // Baris header/tanggal (mis. "Harga update 21 Agustus 2026", "21-08-2026")
    // bukan baris harga bahan -- lewati supaya angka tanggal tidak salah
    // terbaca sebagai harga (satuan di sini memang opsional by design,
    // jadi tidak bisa diandalkan mewajibkan satuan seperti parser lain).
    if (
      /\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(line) ||
      /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(line) ||
      /\d{1,2}\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+\d{4}/i.test(line)
    ) {
      continue;
    }

    const match = line.match(
      /^[-•*]?\s*(.+?)\s*(?:Rp\.?|rp\.?)?\s*([\d.,]+)(?:\s*\/\s*(\w+))?$/i
    );

    if (!match) continue;

    const item = match[1].trim();
    const price = toNumber(match[2]);
    if (!item || !price) continue;

    result.push({
      itemName: normalizeIngredient(item),
      price,
      unit: unitNormalize(match[3] || "kg")
    });
  }

  return result;
}

/* =========================================================
   FIRESTORE: SIMPAN
   ========================================================= */

async function saveRows(collectionName, rows, onProgress) {
  // writeBatch commits every row in one network round-trip instead of one
  // per row -- a chat message with dozens of items (a long shopping list,
  // a full day's sales) used to take one sequential await per line, which
  // made response time scale linearly with item count. Chunk size is kept
  // well under Firestore's 500-op batch cap AND small enough that
  // onProgress gives a reasonably smooth percentage on large imports
  // (WhatsApp/Excel), not just one jump from 0 to 100.
  const CHUNK_SIZE = 100;
  const ids = [];
  let done = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    const refs = chunk.map((row) => {
      const ref = doc(collection(db, collectionName));
      batch.set(ref, row);
      return ref;
    });
    await batch.commit();
    refs.forEach((ref) => ids.push(ref.id));
    done += chunk.length;
    if (onProgress) onProgress(done, rows.length);
  }

  return ids;
}

async function deleteDocsBatched(collectionName, ids, onProgress) {
  const CHUNK_SIZE = 100;
  let done = 0;

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((id) => batch.delete(doc(db, collectionName, id)));
    await batch.commit();
    done += chunk.length;
    if (onProgress) onProgress(done, ids.length);
  }
}

/* =========================================================
   RIWAYAT CHAT (hybrid: chat hari ini live di memori, histori
   tersimpan di Firestore per tanggal, bisa dicari kapan saja).
   ========================================================= */

async function persistChatMessage(date, role, text, tags) {
  try {
    await addDoc(
      collection(db, COLLECTIONS.CHAT),
      createChatMessage({ date, role, text, tags })
    );
  } catch (error) {
    // Gagal simpan riwayat tidak boleh mengganggu chat yang sedang
    // berjalan -- cukup dicatat di console.
    console.error("Gagal menyimpan riwayat chat:", error);
  }
}

async function loadChatByDate(date) {
  const q = query(collection(db, COLLECTIONS.CHAT), where("date", "==", date));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

/* =========================================================
   BUSINESS LOGIC: NORMALISASI SATUAN UNTUK PERHITUNGAN
   inventoryEngine & recipeEngine menjumlahkan field quantity
   apa adanya tanpa konversi satuan. Supaya kg tidak tercampur
   gram (mis. stok dicatat kg, resep dicatat gram/porsi), kita
   samakan dulu ke satuan dasar sebelum dikirim ke engine.
   ========================================================= */

function toBaseUnitDataset(data) {
  const convertList = (rows, qtyField) =>
    rows.map((row) => {
      const converted = convertToBase(row[qtyField], row.unit);
      return { ...row, [qtyField]: converted.value, unit: converted.base };
    });

  const receiving = data.receiving.map((row) => {
    const ordered = convertToBase(row.orderedQuantity, row.unit);
    const received = convertToBase(row.receivedQuantity, row.unit);
    return {
      ...row,
      orderedQuantity: ordered.value,
      receivedQuantity: received.value,
      unit: ordered.base
    };
  });

  const recipes = data.recipes.map((recipe) => ({
    ...recipe,
    ingredients: (recipe.ingredients || []).map((ing) => {
      const converted = convertToBase(ing.quantity, ing.unit);
      return { ...ing, quantity: converted.value, unit: converted.base };
    })
  }));

  return {
    ...data,
    openingStock: convertList(data.openingStock, "quantity"),
    purchases: convertList(data.purchases, "quantity"),
    receiving,
    stockOpname: convertList(data.stockOpname, "actualQuantity"),
    waste: convertList(data.waste, "quantity"),
    adjustments: convertList(data.adjustments, "quantity"),
    recipes
  };
}

function filterDataByOutlet(data, outlet) {
  if (outlet === "ALL") return data;
  const byOutlet = (row) => (row.outlet || "DS") === outlet;
  return {
    ...data,
    openingStock: data.openingStock.filter(byOutlet),
    purchases: data.purchases.filter(byOutlet),
    receiving: data.receiving.filter(byOutlet),
    sales: data.sales.filter(byOutlet),
    stockOpname: data.stockOpname.filter(byOutlet),
    waste: data.waste.filter(byOutlet),
    adjustments: data.adjustments.filter(byOutlet)
  };
}

/* =========================================================
   OMZET & MARGIN
   Harga jual disimpan per resep (recipe.sellPrice). Harga bahan
   diambil dari price_history (harga bahan terakhir yang berlaku
   pada tanggal transaksi) -- bukan dari master_items yang memang
   tidak pernah diisi aplikasi ini.
   ========================================================= */

function findRecipeByMenu(menuName, recipes) {
  const key = normalizeText(menuName);
  return recipes.find((r) => normalizeText(r.menuName) === key) || null;
}

function computeRevenue(sales, recipes) {
  return sales.reduce((sum, s) => {
    const recipe = findRecipeByMenu(s.menuName, recipes);
    const price = recipe ? Number(recipe.sellPrice || 0) : 0;
    return sum + price * Number(s.quantity || 0);
  }, 0);
}

// Kumpulan semua nama bahan yang sudah pernah tercatat di mana pun --
// dipakai sebagai "kosakata dikenal" untuk deteksi nama mirip (typo,
// variasi ejaan) supaya tidak diam-diam terpecah jadi bahan berbeda.
function getKnownIngredientNames(rawData) {
  const names = new Set();
  (rawData.purchases || []).forEach((p) => names.add(p.itemName));
  (rawData.receiving || []).forEach((p) => names.add(p.itemName));
  (rawData.stockOpname || []).forEach((p) => names.add(p.itemName));
  (rawData.waste || []).forEach((p) => names.add(p.itemName));
  (rawData.adjustments || []).forEach((p) => names.add(p.itemName));
  (rawData.openingStock || []).forEach((p) => names.add(p.itemName));
  (rawData.recipes || []).forEach((r) => (r.ingredients || []).forEach((i) => names.add(i.itemName)));
  names.delete("");
  names.delete(undefined);
  return [...names];
}

// Menghitung daftar "kandidat mirip" untuk sekumpulan nama bahan baru,
// dibanding `pool` (nama-nama yang sudah dikenal -- akan bertambah terus
// selagi diproses, supaya nama yang mirip ANTAR baris dalam batch yang
// sama juga tertangkap). Dua cara mendeteksi KANDIDAT: (1) kemiripan
// tulisan (typo/ejaan, mis. "Bawang Puith" vs "Bawang Putih"), dan (2)
// "kata tambahan di belakang" (mis. "Kelapa Parut" vs "Kelapa Parut
// 30rb"). SEMUA kandidat -- termasuk yang dari kemiripan tulisan --
// diverifikasi AI sebelum ditanyakan ke pengguna: skor tulisan tinggi
// TERNYATA bisa salah untuk nama pendek yang cuma beda satu kata tapi
// beda produk (mis. "Daging Ayam Giling" vs "Daging Sapi Giling" = 78%
// mirip padahal jelas dua bahan berbeda) -- AI menyaring kasus begini
// sebelum sampai ke pengguna. Kalau AI gagal dipanggil: kandidat dari
// kemiripan tulisan tetap ditanyakan (skor tinggi cukup dipercaya tanpa
// AI), tapi kandidat "kata tambahan" dilewati saja (terlalu rawan salah
// tanpa penilaian AI).
// Jumlah pasangan per panggilan AI. Waktu AI menjawab bertambah seiring
// jumlah pasangan yang dikirim (respons JSON-nya makin panjang) -- untuk
// rekap panjang (ratusan bahan baru) satu panggilan berisi SEMUA kandidat
// pernah butuh 3+ menit. Dipecah jadi beberapa panggilan lebih kecil yang
// jalan BERSAMAAN (Promise.all) supaya total waktu tunggu jauh lebih
// pendek (dibatasi oleh chunk paling lambat, bukan jumlah semua chunk).
const SIMILARITY_AI_CHUNK_SIZE = 10;

async function computeSimilarityChecks(names, pool, onProgress) {
  const seenLower = new Set(pool.map((n) => n.toLowerCase()));
  const levenshteinCandidates = [];
  const prefixCandidates = [];

  names.forEach((name) => {
    if (!name) return;
    const key = String(name).toLowerCase();
    if (seenLower.has(key)) return;

    const similar = findSimilarName(name, pool);
    if (similar) {
      if (!levenshteinCandidates.some((c) => c.name.toLowerCase() === key)) {
        levenshteinCandidates.push({ name, matchedName: similar.match, score: similar.score });
      }
    } else {
      const prefixMatch = findPrefixCandidate(name, pool);
      if (prefixMatch && !prefixCandidates.some((c) => c.name.toLowerCase() === key)) {
        prefixCandidates.push({ name, matchedName: prefixMatch, score: null });
      }
    }

    seenLower.add(key);
    pool.push(name);
  });

  const allCandidates = [...levenshteinCandidates, ...prefixCandidates];
  if (allCandidates.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < allCandidates.length; i += SIMILARITY_AI_CHUNK_SIZE) {
    chunks.push(allCandidates.slice(i, i + SIMILARITY_AI_CHUNK_SIZE));
  }

  let doneChunks = 0;
  if (onProgress) onProgress(0, chunks.length);
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      analyzeIngredientPairs(chunk).then((result) => {
        doneChunks += 1;
        if (onProgress) onProgress(doneChunks, chunks.length);
        return result;
      })
    )
  );

  const succeededChunks = chunkResults.filter(Array.isArray);
  if (succeededChunks.length === 0) {
    // AI gagal/tidak tersedia sama sekali -- fallback aman: kandidat
    // kemiripan tulisan tetap ditanyakan (skor tinggi), kandidat "kata
    // tambahan" dilewati.
    return levenshteinCandidates.map((c) => ({
      name: c.name, matchedName: c.matchedName, score: c.score, choice: null, source: "typo"
    }));
  }
  const verdicts = succeededChunks.flat();

  const verdictMap = new Map(verdicts.map((v) => [String(v.name || "").toLowerCase(), v]));
  const checks = [];
  allCandidates.forEach((c) => {
    const key = c.name.toLowerCase();
    const v = verdictMap.get(key);
    if (v) {
      if (!v.same) return; // AI yakin ini bahan berbeda -- tidak perlu ditanyakan
      checks.push({
        name: c.name,
        matchedName: v.matchedName || c.matchedName,
        score: c.score,
        choice: null,
        source: "ai",
        reason: v.reason || ""
      });
    } else if (c.score != null) {
      // AI tidak sempat menilai pasangan ini (mis. respons terpotong) --
      // tetap tanyakan berdasar skor kemiripan tulisan yang sudah tinggi.
      checks.push({ name: c.name, matchedName: c.matchedName, score: c.score, choice: null, source: "typo" });
    }
    // kandidat "kata tambahan" tanpa verdict AI: dilewati, terlalu rawan
    // salah kalau ditanyakan tanpa penilaian AI.
  });
  return checks;
}

function computeRecipeCost(recipe, priceHistory, date = TODAY) {
  const lines = (recipe.ingredients || []).map((ing) => {
    const priceEntry = getCurrentPrice(ing.itemName, priceHistory, date);
    const unitPrice = priceEntry ? Number(priceEntry.price || 0) : null;
    const converted = convertToBase(ing.quantity, ing.unit);
    const priceConverted = priceEntry ? convertToBase(1, priceEntry.unit) : null;
    // harga per satuan dasar (mis. Rp/gram) supaya konsisten dengan qty resep yang juga dikonversi ke satuan dasar
    const unitPriceBase = unitPrice !== null && priceConverted ? unitPrice / priceConverted.value : null;
    const cost = unitPriceBase !== null ? unitPriceBase * converted.value : null;
    return { ...ing, unitPrice, cost };
  });
  const known = lines.filter((l) => l.cost !== null);
  const totalCost = known.reduce((s, l) => s + l.cost, 0);
  return {
    lines,
    totalCost,
    complete: lines.length > 0 && known.length === lines.length
  };
}

function computeVarianceValue(item, priceHistory) {
  const priceEntry = getCurrentPrice(item.itemName, priceHistory);
  if (!priceEntry) return null;
  const priceConverted = convertToBase(1, priceEntry.unit);
  if (priceConverted.base !== item.unit) return null;
  const unitPriceBase = Number(priceEntry.price || 0) / priceConverted.value;
  return unitPriceBase * item.variance;
}

// Bahan yang muncul di data pembelian tapi tidak pernah dipakai di
// resep mana pun -- kemungkinan besar bahan itu dipakai oleh menu
// yang resepnya belum lengkap. Perkiraan KASAR: total bahan yang
// dibeli dibagi total porsi menu ini terjual, dengan asumsi SELURUH
// pembelian bahan itu habis untuk menu ini. Kalau bahan yang sama
// juga dipakai menu lain, angka ini akan lebih besar dari kebutuhan
// sebenarnya -- makanya ditandai sebagai perkiraan, bukan kepastian.
function estimateMissingIngredients(menuName, rawData) {
  const usedIngredientNames = new Set();
  rawData.recipes.forEach((r) => {
    (r.ingredients || []).forEach((ing) => {
      const key = normalizeText(ing.itemName);
      if (key) usedIngredientNames.add(key);
    });
  });

  const purchasedTotals = {};
  rawData.purchases.forEach((p) => {
    const key = normalizeText(p.itemName);
    if (!key || usedIngredientNames.has(key)) return;
    const converted = convertToBase(p.quantity, p.unit);
    if (!purchasedTotals[key]) {
      purchasedTotals[key] = { itemName: p.itemName, base: converted.base, qty: 0 };
    }
    if (purchasedTotals[key].base !== converted.base) return;
    purchasedTotals[key].qty += converted.value;
  });

  const totalPortions = rawData.sales
    .filter((s) => normalizeText(s.menuName) === normalizeText(menuName))
    .reduce((sum, s) => sum + Number(s.quantity || 0), 0);

  if (totalPortions <= 0) return [];

  return Object.values(purchasedTotals)
    .filter((x) => x.qty > 0)
    .map((x) => ({
      itemName: x.itemName,
      unit: x.base,
      estimatedQtyPerPortion: x.qty / totalPortions
    }))
    .sort((a, b) => b.estimatedQtyPerPortion - a.estimatedQtyPerPortion);
}

function computeAvgDailySales(sales, days = 7) {
  const dates = sales.map((s) => String(s.date || "")).filter(Boolean);
  if (dates.length === 0) return {};

  // Anchor on the latest date actually present in the data (not the real
  // wall-clock date) so the window stays correct once "today" moves past
  // the last recorded sale -- otherwise it would silently start averaging
  // in phantom zero-sales days instead of the days that actually happened.
  const anchorStr = dates.reduce((max, d) => (d > max ? d : max));
  const anchor = new Date(`${anchorStr}T00:00:00Z`);
  const cutoff = new Date(anchor);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recent = sales.filter((s) => {
    const d = String(s.date || "");
    return d >= cutoffStr && d <= anchorStr;
  });
  const totals = {};

  for (const row of recent) {
    const key = row.menuName;
    if (!key) continue;
    totals[key] = (totals[key] || 0) + Number(row.quantity || 0);
  }

  const avg = {};
  Object.entries(totals).forEach(([menu, total]) => {
    avg[menu] = total / days;
  });

  return avg;
}

function computeDailySalesStats(sales, recipes) {
  const byDate = {};
  for (const s of sales) {
    const d = String(s.date || "");
    if (!d) continue;
    byDate[d] = byDate[d] || [];
    byDate[d].push(s);
  }
  const dates = Object.keys(byDate).sort();

  if (dates.length === 0) {
    return {
      dariTanggal: null,
      sampaiTanggal: null,
      jumlahHari: 0,
      rataRataPorsiPerHari: 0,
      rataRataOmzetPerHari: 0,
      hariKerja: { jumlahHari: 0, porsi: 0, omzet: 0 },
      akhirPekan: { jumlahHari: 0, porsi: 0, omzet: 0 },
      perBulan: {}
    };
  }

  const isWeekendDate = (d) => {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
  };

  let totalPortions = 0;
  let totalOmzet = 0;
  let weekdayPortions = 0;
  let weekdayOmzet = 0;
  let weekdayCount = 0;
  let weekendPortions = 0;
  let weekendOmzet = 0;
  let weekendCount = 0;
  const perBulan = {};

  for (const d of dates) {
    const daySales = byDate[d];
    const dayPortions = daySales.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
    const dayOmzet = computeRevenue(daySales, recipes);
    totalPortions += dayPortions;
    totalOmzet += dayOmzet;

    if (isWeekendDate(d)) {
      weekendPortions += dayPortions;
      weekendOmzet += dayOmzet;
      weekendCount++;
    } else {
      weekdayPortions += dayPortions;
      weekdayOmzet += dayOmzet;
      weekdayCount++;
    }

    const bulan = d.slice(0, 7);
    perBulan[bulan] = perBulan[bulan] || { hari: 0, porsi: 0, omzet: 0 };
    perBulan[bulan].hari++;
    perBulan[bulan].porsi += dayPortions;
    perBulan[bulan].omzet += dayOmzet;
  }

  Object.values(perBulan).forEach((b) => {
    b.porsi = Math.round(b.porsi);
    b.omzet = Math.round(b.omzet);
  });

  return {
    dariTanggal: dates[0],
    sampaiTanggal: dates[dates.length - 1],
    jumlahHari: dates.length,
    rataRataPorsiPerHari: Math.round(totalPortions / dates.length),
    rataRataOmzetPerHari: Math.round(totalOmzet / dates.length),
    hariKerja: {
      jumlahHari: weekdayCount,
      porsi: weekdayCount ? Math.round(weekdayPortions / weekdayCount) : 0,
      omzet: weekdayCount ? Math.round(weekdayOmzet / weekdayCount) : 0
    },
    akhirPekan: {
      jumlahHari: weekendCount,
      porsi: weekendCount ? Math.round(weekendPortions / weekendCount) : 0,
      omzet: weekendCount ? Math.round(weekendOmzet / weekendCount) : 0
    },
    perBulan
  };
}

function buildPurchaseSuggestions(ingredientForecast, theoreticalStock) {
  const stockMap = {};
  theoreticalStock.forEach((item) => {
    stockMap[normalizeText(item.itemName)] = item;
  });

  return ingredientForecast
    .map((need) => {
      const stockItem = stockMap[normalizeText(need.itemName)];
      const saldoTeoritis = stockItem ? stockItem.theoretical : 0;
      const sourceIsOpname = !!stockItem && stockItem.actual !== null && stockItem.actual !== undefined;

      // STOK TERSEDIA: pakai hasil stock opname (actual) kalau bahan ini
      // sudah pernah di-opname -- itu lebih bisa dipercaya daripada saldo
      // teoritis yang murni akumulasi historis dan tidak pernah dikoreksi
      // fisik. Kalau belum pernah opname, fallback ke saldo teoritis.
      const stokTersedia = sourceIsOpname ? stockItem.actual : saldoTeoritis;

      const base = need.unit || (stockItem ? stockItem.unit : "unit");
      const suggested = Math.max(0, need.quantity - stokTersedia);

      return {
        itemName: need.itemName,
        base,
        dailyNeed: need.quantity,
        currentStock: stokTersedia,
        saldoTeoritis,
        sourceIsOpname,
        suggestedPurchase: suggested,
        sourceMenus: need.sourceMenus || []
      };
    })
    .sort((a, b) => b.suggestedPurchase - a.suggestedPurchase);
}

/* =========================================================
   ANALISIS KUALITAS DATA
   Dijalankan murni dari data yang sudah ada -- tidak menebak,
   cuma mendeteksi pola yang secara struktural berisiko membuat
   perhitungan (variance, kebutuhan bahan) jadi tidak akurat.
   ========================================================= */

// Tanggal ada aktivitas lain (pembelian/barang datang/opname/waste/
// penyesuaian/stok awal) di suatu outlet, tapi tidak ada penjualan
// tercatat di tanggal yang sama -- indikasi penjualan lupa diinput.
function checkSalesGaps(rawData) {
  const activityDates = {};
  const salesDates = {};

  function mark(map, outlet, date) {
    if (!date || !outlet) return;
    const key = outlet;
    if (!map[key]) map[key] = new Set();
    map[key].add(date);
  }

  ["purchases", "receiving", "stockOpname", "waste", "adjustments", "openingStock"].forEach((field) => {
    (rawData[field] || []).forEach((row) => mark(activityDates, row.outlet, row.date));
  });
  (rawData.sales || []).forEach((row) => mark(salesDates, row.outlet, row.date));

  const issues = [];
  Object.entries(activityDates).forEach(([outlet, dates]) => {
    const sold = salesDates[outlet] || new Set();
    [...dates]
      .filter((date) => !sold.has(date))
      .sort()
      .forEach((date) => {
        issues.push({
          type: "sales-gap",
          message: `Outlet ${outlet}: ada aktivitas tercatat pada ${formatDateID(date)}, tapi tidak ada data penjualan di tanggal itu.`
        });
      });
  });

  return issues;
}

// Resep tanpa bahan sama sekali, atau semua bahannya tidak valid
// (nama kosong / jumlah 0) -- kebutuhan bahan & variance untuk menu
// itu tidak akan pernah bisa dihitung.
function checkEmptyRecipes(rawData) {
  return (rawData.recipes || [])
    .filter(
      (r) =>
        !Array.isArray(r.ingredients) ||
        r.ingredients.length === 0 ||
        r.ingredients.every((ing) => !ing.itemName || !Number(ing.quantity))
    )
    .map((r) => ({
      type: "empty-recipe",
      message: `Resep "${r.menuName}" tidak punya bahan yang valid -- kebutuhan bahan & variance untuk menu ini tidak bisa dihitung.`
    }));
}

// Menu yang pernah terjual tapi belum punya resep sama sekali --
// pemakaian bahannya tidak pernah ikut mengurangi stok teoritis.
function checkMenusWithoutRecipe(rawData) {
  const recipeNames = new Set(
    (rawData.recipes || []).map((r) => normalizeText(r.menuName))
  );
  const soldNames = new Map();
  (rawData.sales || []).forEach((s) => {
    const name = String(s.menuName || "").trim();
    if (name) soldNames.set(normalizeText(name), name);
  });

  return [...soldNames.entries()]
    .filter(([key]) => !recipeNames.has(key))
    .map(([, name]) => ({
      type: "menu-without-recipe",
      message: `Menu "${name}" pernah terjual tapi belum punya resep -- pemakaian bahannya tidak ikut terhitung.`
    }));
}

// Bahan yang dipakai di suatu resep tapi tidak pernah muncul di stok
// awal maupun barang datang -- stok teoritisnya akan selalu negatif
// karena tidak pernah ada pemasukan yang tercatat.
function checkUnstockedIngredients(rawData) {
  const stockedNames = new Set();
  (rawData.openingStock || []).forEach((r) => stockedNames.add(normalizeText(r.itemName)));
  (rawData.receiving || []).forEach((r) => stockedNames.add(normalizeText(r.itemName)));
  (rawData.purchases || []).forEach((r) => stockedNames.add(normalizeText(r.itemName)));

  const seen = new Set();
  const issues = [];
  (rawData.recipes || []).forEach((r) => {
    (r.ingredients || []).forEach((ing) => {
      const name = String(ing.itemName || "").trim();
      if (!name) return;
      const key = normalizeText(name);
      if (stockedNames.has(key) || seen.has(key)) return;
      seen.add(key);
      issues.push({
        type: "unstocked-ingredient",
        message: `Bahan "${name}" dipakai di resep tapi belum pernah dicatat stok awal/pembelian -- stok teoritisnya akan selalu negatif.`
      });
    });
  });

  return issues;
}

function analyzeDataQuality(rawData) {
  return [
    ...checkSalesGaps(rawData),
    ...checkEmptyRecipes(rawData),
    ...checkMenusWithoutRecipe(rawData),
    ...checkUnstockedIngredients(rawData)
  ];
}

/* =========================================================
   LAPORAN LOKAL (fallback jika AI belum tersambung)
   ========================================================= */

function buildLocalReport(question, ctx) {
  const q = normalizeText(question);

  if (q.includes("kebutuhan") || q.includes("saran") || q.includes("besok")) {
    if (!ctx.purchaseSuggestions.length) {
      return "Belum ada saran pembelian karena data resep dan/atau penjualan masih kosong.";
    }
    const top = ctx.purchaseSuggestions.slice(0, 8);
    return (
      "SARAN PEMBELIAN (berdasarkan rata-rata penjualan 7 hari terakhir vs stok berjalan):\n\n" +
      top
        .map(
          (x) =>
            `- ${x.itemName}: kebutuhan/hari ${displayQuantity(x.dailyNeed, x.base)}, ` +
            `stok saat ini ${displayQuantity(x.currentStock, x.base)} → ` +
            `beli sekitar ${displayQuantity(x.suggestedPurchase, x.base)}`
        )
        .join("\n") +
      "\n\nCatatan: perkiraan ini akan lebih akurat jika resep dan stock opname rutin diperbarui."
    );
  }

  if (q.includes("variance") || q.includes("selisih") || q.includes("waste")) {
    if (!ctx.varianceReport.items.length) {
      return "Belum ada data variance yang bisa dianalisa (stock opname belum lengkap).";
    }
    const items = [...ctx.varianceReport.items]
      .sort((a, b) => a.variance - b.variance)
      .slice(0, 8);
    return (
      "ITEM DENGAN VARIANCE TERBESAR (aktual dibanding teoritis):\n\n" +
      items
        .map(
          (x) =>
            `- ${x.itemName}: teoritis ${displayQuantity(x.theoretical, x.unit)}, ` +
            `aktual ${displayQuantity(x.actual, x.unit)}, ` +
            `selisih ${displayQuantity(x.variance, x.unit)} ` +
            `${x.variance < 0 ? "(kemungkinan waste/kurang tercatat)" : "(surplus, periksa pencatatan)"}`
        )
        .join("\n")
    );
  }

  if (q.includes("penjualan") || q.includes("laku") || q.includes("terlaris")) {
    const allEntries = Object.entries(ctx.avgDailySales);
    if (!allEntries.length) return "Belum ada data penjualan pada periode ini.";

    const wantsLowest =
      q.includes("terendah") ||
      q.includes("tersepi") ||
      q.includes("kurang laku") ||
      q.includes("tidak laku") ||
      q.includes("paling sedikit") ||
      q.includes("paling jarang");
    const wantsHighest =
      q.includes("tertinggi") ||
      q.includes("terlaris") ||
      q.includes("paling laku") ||
      q.includes("terbanyak");

    const sorted = [...allEntries].sort((a, b) => (wantsLowest ? a[1] - b[1] : b[1] - a[1]));
    const entries = sorted.slice(0, 8);

    if (wantsLowest || wantsHighest) {
      const [topMenu, topAvg] = sorted[0];
      const label = wantsLowest ? "PALING RENDAH" : "PALING TINGGI";
      return (
        `MENU DENGAN PENJUALAN ${label}: ${topMenu} (${formatNumber(topAvg, 1)} porsi/hari, rata-rata 7 hari terakhir)\n\n` +
        "Selengkapnya:\n" +
        entries.map(([menu, avg], i) => `${i + 1}. ${menu}: ${formatNumber(avg, 1)} porsi/hari`).join("\n")
      );
    }

    const totalPerHari7Hari = allEntries.reduce((sum, [, avg]) => sum + avg, 0);
    const overall = ctx.dailyStats;
    const overallLine =
      overall && overall.jumlahHari > 0
        ? `TOTAL GABUNGAN SEMUA MENU: ${formatNumber(totalPerHari7Hari, 1)} porsi/hari (rata-rata 7 hari terakhir) ` +
          `-- rata-rata seluruh periode data (${overall.dariTanggal} s/d ${overall.sampaiTanggal}, ${overall.jumlahHari} hari): ` +
          `${formatNumber(overall.rataRataPorsiPerHari, 0)} porsi/hari.\n\n`
        : `TOTAL GABUNGAN SEMUA MENU: ${formatNumber(totalPerHari7Hari, 1)} porsi/hari (rata-rata 7 hari terakhir).\n\n`;

    return (
      overallLine +
      "RATA-RATA PENJUALAN HARIAN PER MENU (7 hari terakhir):\n\n" +
      entries.map(([menu, avg]) => `- ${menu}: ${formatNumber(avg, 1)} porsi/hari`).join("\n")
    );
  }

  if (q.includes("harga")) {
    if (!ctx.priceHistory.length) return "Belum ada data harga bahan yang tersimpan.";
    const latestByItem = {};
    ctx.priceHistory.forEach((p) => {
      const key = normalizeText(p.itemName);
      if (!latestByItem[key] || p.effectiveDate > latestByItem[key].effectiveDate) {
        latestByItem[key] = p;
      }
    });
    const rows = Object.values(latestByItem).slice(0, 10);
    return (
      "HARGA BAHAN TERBARU:\n\n" +
      rows.map((p) => `- ${p.itemName}: Rp ${formatNumber(p.price)} / ${p.unit}`).join("\n")
    );
  }

  if (q.includes("barang datang") || q.includes("diterima") || q.includes("pengecekan")) {
    const issues = ctx.receivingIssues;
    if (!issues.length) return "Semua barang yang diterima sesuai dengan pemesanan (tidak ada selisih tercatat).";
    return (
      "SELISIH BARANG DATANG vs PEMESANAN:\n\n" +
      issues
        .slice(0, 8)
        .map(
          (r) =>
            `- ${r.itemName} (${r.date}): pesan ${formatNumber(r.orderedQuantity)} ${r.unit}, ` +
            `diterima ${formatNumber(r.receivedQuantity)} ${r.unit}, selisih ${formatNumber(r.difference)} ${r.unit}`
        )
        .join("\n")
    );
  }

  return (
    "Saya belum menemukan AI API key yang aktif, jadi jawaban ini dihasilkan " +
    "dari perhitungan lokal saja.\n\n" +
    "Saya bisa menjawab langsung untuk topik: kebutuhan bahan/saran pembelian, variance & waste, " +
    "penjualan, harga bahan, dan pengecekan barang datang. Coba spesifikkan salah satu topik itu, " +
    "atau sambungkan AI API key untuk jawaban bebas."
  );
}

/* =========================================================
   IKON (SVG inline ringan, tanpa dependency)
   ========================================================= */

const ICONS = {
  chat: "M4 4h16v12H7l-3 3V4z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  cart: "M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18H18a2 2 0 0 0 2-1.6L21.5 8H6",
  truck: "M2 7h11v9H2zM13 10h5l3 3v3h-8zM6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M9 9.5c0-1 1-1.8 3-1.8s3 .8 3 1.8-1 1.5-3 1.8-3 .8-3 1.9 1 1.8 3 1.8 3-.8 3-1.8",
  box: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  leaf: "M20 4C10 4 4 10 4 18c8 0 14-6 16-14zM4 20c4-4 8-8 16-16",
  trend: "M3 17l6-6 4 4 8-8M15 6h6v6",
  tag: "M20 12l-8 8-9-9V4h7l10 8zM7 7h.01",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6M9 8h2",
  book: "M4 5c0-1 1-2 3-2h5v16H7c-2 0-3 1-3 2zM12 3h5c2 0 3 1 3 2v14c0-1-1-2-3-2h-5z"
};

function Icon({ name, size = 17 }) {
  const path = ICONS[name] || ICONS.doc;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/* =========================================================
   KOMPONEN KECIL
   ========================================================= */

function StatCard({ title, value, subtitle, icon, tone = "green" }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon tone-${tone}`}>
        <Icon name={icon} size={19} />
      </div>
      <div>
        <div className="stat-title">{title}</div>
        <div className="stat-value">{value}</div>
        {subtitle && <div className="stat-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

function HealthBar({ ratio }) {
  // ratio: aktual/teoritis. 1 = sehat, <1 = menipis, negatif/0 = kritis.
  const pct = Math.max(0, Math.min(1, ratio));
  const tone = ratio < 0.15 ? "critical" : ratio < 0.4 ? "watch" : "healthy";
  return (
    <div className="health-bar">
      <div className={`health-bar-fill tone-${tone}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function DataTable({ columns, rows, emptyText = "Belum ada data." }) {
  return (
    <div className="table-wrapper">
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="box" size={26} /></div>
          <div className="empty-title">{emptyText}</div>
          <div className="empty-description">Kirim data melalui AI Assistant atau import Excel.</div>
        </div>
      ) : (
        <table>
          <thead>
            <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FilterBar({ search, onSearchChange, searchPlaceholder, start, onStartChange, end, onEndChange, summary }) {
  const hasFilter = Boolean(search || start || end);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder || "Cari nama..."}
        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", minWidth: 180 }}
      />
      <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Dari</span>
      <input
        type="date"
        value={start}
        max={end || undefined}
        onChange={(e) => onStartChange(e.target.value)}
        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
      />
      <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>s/d</span>
      <input
        type="date"
        value={end}
        min={start || undefined}
        onChange={(e) => onEndChange(e.target.value)}
        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
      />
      {hasFilter && (
        <button
          className="secondary-button"
          onClick={() => {
            onSearchChange("");
            onStartChange("");
            onEndChange("");
          }}
        >
          Reset Filter
        </button>
      )}
      {summary && <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--ink-soft)" }}>{summary}</span>}
    </div>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={`chat-row ${isUser ? "chat-row-user" : "chat-row-ai"}`}>
      {!isUser && <div className="chat-avatar">DS</div>}
      <div className={`chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-ai"}`}>
        {message.text}
        {message.tags?.length > 0 && (
          <div className="chat-tags">
            {message.tags.map((tag, i) => (
              <span key={i} className="chat-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   APP
   ========================================================= */

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthChecked(true);
    });
    return unsubscribe;
  }, []);

  function describeAuthError(error) {
    switch (error?.code) {
      case "auth/invalid-email":
        return "Format email tidak valid.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Email atau password salah.";
      case "auth/too-many-requests":
        return "Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.";
      case "auth/user-disabled":
        return "Akun ini dinonaktifkan.";
      case "auth/network-request-failed":
        return "Tidak ada koneksi internet ke server Firebase. Periksa jaringan Anda.";
      case "auth/unauthorized-domain":
        return "Domain ini belum diizinkan untuk login (Authorized domains di Firebase Console).";
      default:
        return `Gagal login: ${error?.message || "terjadi kesalahan tidak dikenal"} (${error?.code || "no-code"})`;
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    setLoginBusy(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setLoginPassword("");
    } catch (error) {
      console.error("Login error:", error);
      setLoginError(describeAuthError(error));
    } finally {
      setLoginBusy(false);
    }
  }

  const [activeMenu, setActiveMenu] = useState("chat");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeOutlet, setActiveOutlet] = useState("ALL");
  const [chatOutlet, setChatOutlet] = useState("DS");
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(message, type = "error") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);

  async function loadCategories() {
    const snapshot = await getDocs(collection(db, COLLECTIONS.PURCHASE_CATEGORIES));
    const list = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setCategories(list);
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      showToast(`Kategori "${name}" sudah ada.`);
      return;
    }
    setCategoryBusy(true);
    try {
      const ref = await addDoc(collection(db, COLLECTIONS.PURCHASE_CATEGORIES), createPurchaseCategory({ name }));
      setCategories((prev) => [...prev, { id: ref.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCategoryName("");
    } catch (error) {
      console.error(error);
      showToast("Gagal menambah kategori: " + (error?.message || "unknown error"));
    } finally {
      setCategoryBusy(false);
    }
  }

  /* =======================================================
     PROGRESS SIMPAN + RIWAYAT AKTIVITAS (UNDO)
     ======================================================= */

  const [saveProgress, setSaveProgress] = useState(null); // { done, total } | null
  const [activityLog, setActivityLog] = useState([]);
  const [undoBusyId, setUndoBusyId] = useState(null);

  async function loadActivityLog() {
    const snapshot = await getDocs(collection(db, COLLECTIONS.ACTIVITY_LOG));
    const list = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setActivityLog(list);
  }

  // Bungkus saveRows: mengurus progress (%) dan mencatat aksi ke riwayat
  // aktivitas supaya bisa di-undo nanti. Dipakai di semua titik simpan data
  // (chat, import Excel, import WhatsApp) -- satu tempat, konsisten.
  async function saveRowsTracked(collectionName, rows, actionType, summary) {
    if (!rows.length) return [];
    setSaveProgress({ done: 0, total: rows.length });
    try {
      const ids = await saveRows(collectionName, rows, (done, total) => setSaveProgress({ done, total }));
      const logEntry = createActivityLog({ actionType, collectionName, documentIds: ids, summary });
      const ref = await addDoc(collection(db, COLLECTIONS.ACTIVITY_LOG), logEntry);
      setActivityLog((prev) => [{ id: ref.id, ...logEntry }, ...prev]);
      return ids;
    } finally {
      setSaveProgress(null);
    }
  }

  async function undoActivity(logEntry) {
    if (logEntry.undone || undoBusyId) return;
    setUndoBusyId(logEntry.id);
    setSaveProgress({ done: 0, total: logEntry.documentIds.length });
    try {
      await deleteDocsBatched(logEntry.collectionName, logEntry.documentIds, (done, total) =>
        setSaveProgress({ done, total })
      );
      await updateDoc(doc(db, COLLECTIONS.ACTIVITY_LOG, logEntry.id), {
        undone: true,
        undoneAt: new Date().toISOString()
      });
      setActivityLog((prev) =>
        prev.map((a) => (a.id === logEntry.id ? { ...a, undone: true, undoneAt: new Date().toISOString() } : a))
      );
      await refreshData();
      showToast(`Berhasil di-undo: ${logEntry.summary}`, "success");
    } catch (error) {
      console.error(error);
      showToast("Gagal undo: " + (error?.message || "unknown error"));
    } finally {
      setUndoBusyId(null);
      setSaveProgress(null);
    }
  }

  /* =======================================================
     EDIT/HAPUS BARIS -- generik, dipakai di semua halaman data
     (Pembelian, Barang Datang, Penjualan, Stock Opname, Waste,
     Stok Awal, Harga Bahan) supaya satu pola konsisten.
     ======================================================= */

  const [editingRow, setEditingRow] = useState(null); // { collectionName, id, fields }
  const [rowEditBusy, setRowEditBusy] = useState(false);
  const [rowDeleteConfirmId, setRowDeleteConfirmId] = useState(null);
  const [rowDeleteBusy, setRowDeleteBusy] = useState(false);

  function startRowEdit(collectionName, row, fieldKeys) {
    const fields = {};
    fieldKeys.forEach((key) => {
      fields[key] = row[key] ?? "";
    });
    setRowDeleteConfirmId(null);
    setEditingRow({ collectionName, id: row.id, fields });
  }

  function updateRowEditField(key, value) {
    setEditingRow((prev) => (prev ? { ...prev, fields: { ...prev.fields, [key]: value } } : prev));
  }

  function cancelRowEdit() {
    setEditingRow(null);
  }

  async function saveRowEdit(numericKeys = []) {
    if (!editingRow) return;
    setRowEditBusy(true);
    try {
      const changes = { ...editingRow.fields };
      numericKeys.forEach((key) => {
        changes[key] = Number(changes[key]) || 0;
      });
      await updateDoc(doc(db, editingRow.collectionName, editingRow.id), changes);
      await refreshData();
      showToast("Perubahan tersimpan.", "success");
      setEditingRow(null);
    } catch (error) {
      console.error(error);
      showToast("Gagal menyimpan perubahan: " + (error?.message || "unknown error"));
    } finally {
      setRowEditBusy(false);
    }
  }

  async function deleteRow(collectionName, id) {
    setRowDeleteBusy(true);
    try {
      await deleteDoc(doc(db, collectionName, id));
      await refreshData();
      showToast("Data berhasil dihapus.", "success");
      setRowDeleteConfirmId(null);
    } catch (error) {
      console.error(error);
      showToast("Gagal menghapus: " + (error?.message || "unknown error"));
    } finally {
      setRowDeleteBusy(false);
    }
  }

  function fieldInput(key, type, options) {
    const value = editingRow.fields[key];
    const style = { padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", width: type === "date" ? 130 : type === "number" ? 80 : 120 };
    if (type === "date") {
      return <input type="date" value={value || ""} onChange={(e) => updateRowEditField(key, e.target.value)} style={style} />;
    }
    if (type === "number") {
      return <input type="number" value={value ?? ""} onChange={(e) => updateRowEditField(key, e.target.value)} style={style} />;
    }
    if (type === "select") {
      return (
        <select value={value || ""} onChange={(e) => updateRowEditField(key, e.target.value)} style={style}>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }
    return <input type="text" value={value || ""} onChange={(e) => updateRowEditField(key, e.target.value)} style={{ ...style, width: 140 }} />;
  }

  function actionCell(collectionName, row, fieldKeys, numericKeys = []) {
    if (editingRow?.id === row.id) {
      return (
        <div style={{ display: "flex", gap: 4 }}>
          <button className="primary-button" onClick={() => saveRowEdit(numericKeys)} disabled={rowEditBusy}>
            {rowEditBusy ? "..." : "Simpan"}
          </button>
          <button className="secondary-button" onClick={cancelRowEdit} disabled={rowEditBusy}>Batal</button>
        </div>
      );
    }
    if (rowDeleteConfirmId === row.id) {
      return (
        <div style={{ display: "flex", gap: 4 }}>
          <button className="primary-button" style={{ background: "#c0392b", borderColor: "#c0392b" }} onClick={() => deleteRow(collectionName, row.id)} disabled={rowDeleteBusy}>
            {rowDeleteBusy ? "..." : "Yakin?"}
          </button>
          <button className="secondary-button" onClick={() => setRowDeleteConfirmId(null)} disabled={rowDeleteBusy}>Batal</button>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", gap: 4 }}>
        <button className="secondary-button" onClick={() => startRowEdit(collectionName, row, fieldKeys)}>Edit</button>
        <button className="secondary-button" onClick={() => setRowDeleteConfirmId(row.id)}>Hapus</button>
      </div>
    );
  }

  /* =======================================================
     KONFIRMASI NAMA BAHAN MIRIP (chat) -- sebelum menyimpan bahan
     baru yang mirip dengan yang sudah tercatat, tanya dulu apakah
     ini bahan yang sama atau memang berbeda. Dipakai oleh semua
     handler item-based di processMessage (bukan penjualan, karena
     itu berbasis nama menu resep, bukan nama bahan mentah).
     ======================================================= */

  const [pendingSimilarity, setPendingSimilarity] = useState(null); // { collectionName, rows, actionType, summary, nameKey, checks }

  // Kalau tidak ada nama yang mirip (tapi belum identik) dengan yang
  // sudah dikenal, langsung simpan seperti biasa. Kalau ada, tunda dulu
  // dan minta konfirmasi lewat UI di bawah chat sebelum benar-benar
  // menyimpan apa pun.
  async function saveWithSimilarityCheck(collectionName, rows, actionType, summary, nameKey = "itemName") {
    // `pool` menyimpan nama dengan kapitalisasi ASLI (bukan lowercase)
    // supaya hasil pencocokan yang ditampilkan/disimpan tetap rapi
    // (mis. "Paha Tepong", bukan "paha tepong").
    const pool = getKnownIngredientNames(rawData);
    const names = rows.map((row) => row[nameKey]).filter(Boolean);
    const checks = await computeSimilarityChecks(names, pool);

    if (checks.length > 0) {
      setPendingSimilarity({ collectionName, rows, actionType, summary, nameKey, checks });
      return { deferred: true, count: checks.length };
    }

    await saveRowsTracked(collectionName, rows, actionType, summary);
    return { deferred: false, count: 0 };
  }

  function choosePendingSimilarity(index, choice) {
    setPendingSimilarity((prev) => {
      if (!prev) return prev;
      return { ...prev, checks: prev.checks.map((c, i) => (i === index ? { ...c, choice } : c)) };
    });
  }

  async function confirmPendingSimilarity() {
    if (!pendingSimilarity) return;
    const { collectionName, rows, actionType, summary, nameKey, checks } = pendingSimilarity;
    const renameMap = new Map();
    checks.forEach((c) => {
      if (c.choice === "merge") renameMap.set(c.name.toLowerCase(), c.matchedName);
    });
    const finalRows = rows.map((row) => {
      const name = row[nameKey];
      const renamed = renameMap.get(String(name || "").toLowerCase());
      return renamed ? { ...row, [nameKey]: renamed } : row;
    });

    setPendingSimilarity(null);
    await saveRowsTracked(collectionName, finalRows, actionType, summary);
    await refreshData();

    const sendDate = chatDate;
    const successText = `${finalRows.length} baris berhasil disimpan setelah konfirmasi kemiripan nama bahan.`;
    setMessages((prev) => [...prev, { id: `assistant-${Date.now()}`, role: "assistant", text: successText, tags: ["TERSIMPAN"] }]);
    persistChatMessage(sendDate, "assistant", successText, ["TERSIMPAN"]);
  }

  function cancelPendingSimilarity() {
    setPendingSimilarity(null);
    const sendDate = chatDate;
    const cancelText = "Dibatalkan — data tidak disimpan. Kirim ulang dengan nama bahan yang lebih jelas kalau perlu.";
    setMessages((prev) => [...prev, { id: `assistant-${Date.now()}`, role: "assistant", text: cancelText, tags: [] }]);
    persistChatMessage(sendDate, "assistant", cancelText, []);
  }

  const [reportStart, setReportStart] = useState(daysAgoISO(29));
  const [reportEnd, setReportEnd] = useState(TODAY);
  const [reportOutlet, setReportOutlet] = useState("ALL");
  const [reportBusy, setReportBusy] = useState(false);

  const [salesFilterStart, setSalesFilterStart] = useState(daysAgoISO(29));
  const [salesFilterEnd, setSalesFilterEnd] = useState(TODAY);
  const [salesSearch, setSalesSearch] = useState("");

  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [purchaseFilterStart, setPurchaseFilterStart] = useState("");
  const [purchaseFilterEnd, setPurchaseFilterEnd] = useState("");

  const [receivingSearch, setReceivingSearch] = useState("");
  const [receivingFilterStart, setReceivingFilterStart] = useState("");
  const [receivingFilterEnd, setReceivingFilterEnd] = useState("");

  const [opnameSearch, setOpnameSearch] = useState("");
  const [opnameFilterStart, setOpnameFilterStart] = useState("");
  const [opnameFilterEnd, setOpnameFilterEnd] = useState("");

  const [wasteSearch, setWasteSearch] = useState("");
  const [wasteFilterStart, setWasteFilterStart] = useState("");
  const [wasteFilterEnd, setWasteFilterEnd] = useState("");

  const [openingSearch, setOpeningSearch] = useState("");
  const [openingFilterStart, setOpeningFilterStart] = useState("");
  const [openingFilterEnd, setOpeningFilterEnd] = useState("");

  const [priceSearch, setPriceSearch] = useState("");
  const [priceFilterStart, setPriceFilterStart] = useState("");
  const [priceFilterEnd, setPriceFilterEnd] = useState("");

  const [messages, setMessages] = useState(() => [buildWelcomeMessage()]);
  const [chatDate, setChatDate] = useState(TODAY);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [systemOnline, setSystemOnline] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataLoadError, setDataLoadError] = useState("");

  const [rawData, setRawData] = useState({
    items: [], recipes: [], openingStock: [], purchases: [],
    receiving: [], sales: [], stockOpname: [], waste: [], adjustments: []
  });
  const [priceHistory, setPriceHistory] = useState([]);

  async function updatePurchaseCategory(purchaseId, category) {
    const prevRows = rawData.purchases;
    setRawData((prev) => ({
      ...prev,
      purchases: prev.purchases.map((p) => (p.id === purchaseId ? { ...p, category } : p))
    }));
    try {
      await updateDoc(doc(db, COLLECTIONS.PURCHASES, purchaseId), { category });
    } catch (error) {
      console.error(error);
      setRawData((prev) => ({ ...prev, purchases: prevRows }));
      showToast("Gagal menyimpan kategori: " + (error?.message || "unknown error"));
    }
  }

  const [importResult, setImportResult] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  const [waText, setWaText] = useState("");
  const [waResult, setWaResult] = useState(null);
  const [waSaveBusy, setWaSaveBusy] = useState(false);
  const [waAnalyzing, setWaAnalyzing] = useState(false);
  const [waAnalyzeProgress, setWaAnalyzeProgress] = useState(null); // { done, total }
  const [waShowReview, setWaShowReview] = useState(false);

  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [editMenuName, setEditMenuName] = useState("");
  const [editIngredients, setEditIngredients] = useState([]);
  const [editSellPrice, setEditSellPrice] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const chatRef = useRef(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState("");
  const [historyMessages, setHistoryMessages] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  async function searchChatHistory() {
    if (!historyDate) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const results = await loadChatByDate(historyDate);
      setHistoryMessages(results);
    } catch (error) {
      console.error("Gagal memuat riwayat chat:", error);
      setHistoryError(error?.message || "Gagal memuat riwayat chat.");
      setHistoryMessages(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryOpen(false);
    setHistoryDate("");
    setHistoryMessages(null);
    setHistoryError("");
  }

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  async function checkConnection() {
    try {
      await getDocs(query(collection(db, COLLECTIONS.SALES), limit(1)));
      setSystemOnline(true);
    } catch (error) {
      console.error("Firebase connection error:", error);
      setSystemOnline(false);
    }
  }

  async function refreshData() {
    const [inventory, prices] = await Promise.all([
      loadInventoryData(),
      getPriceHistory()
    ]);
    setRawData(inventory);
    setPriceHistory(prices);
  }

  const loadInitialData = useCallback(() => {
    queueMicrotask(() => {
      setDataLoading(true);
      setDataLoadError("");
      Promise.all([checkConnection(), refreshData(), loadCategories(), loadActivityLog()])
        .catch((error) => {
          console.error("Gagal memuat data awal:", error);
          setDataLoadError(error?.message || "Gagal memuat data dari Firestore.");
        })
        .finally(() => setDataLoading(false));
    });
  }, []);

  useEffect(() => {
    if (!authUser) return;
    loadInitialData();
  }, [authUser, loadInitialData]);

  useEffect(() => {
    if (!authUser) return;
    loadChatByDate(TODAY)
      .then((history) => {
        if (history.length > 0) {
          setMessages(history.map((m) => ({ id: m.id, role: m.role, text: m.text, tags: m.tags })));
        }
      })
      .catch((error) => console.error("Gagal memuat chat hari ini:", error));
  }, [authUser]);

  // Kalau tab tetap terbuka melewati tengah malam, mulai obrolan baru
  // untuk tanggal baru secara otomatis -- chat tanggal lama tetap utuh
  // di Firestore, bisa dibuka lagi lewat Riwayat Chat. Dicek tiap 30
  // detik: cukup sering untuk terasa "otomatis", tanpa perlu penjadwalan
  // presisi ke tengah malam (dan tetap benar walau laptop sempat tidur).
  function rolloverChatDate(newDate) {
    setChatDate(newDate);
    loadChatByDate(newDate)
      .then((history) => {
        setMessages(history.length > 0 ? history.map((m) => ({ id: m.id, role: m.role, text: m.text, tags: m.tags })) : [buildWelcomeMessage()]);
      })
      .catch((error) => {
        console.error("Gagal memuat chat untuk tanggal baru:", error);
        setMessages([buildWelcomeMessage()]);
      });
  }

  useEffect(() => {
    if (!authUser) return;
    const interval = setInterval(() => {
      const now = getTodayISO();
      if (now !== chatDate) rolloverChatDate(now);
    }, 30000);
    return () => clearInterval(interval);
  }, [authUser, chatDate]);


  /* =======================================================
     PERHITUNGAN TURUNAN
     ======================================================= */

  const filteredData = useMemo(
    () => filterDataByOutlet(rawData, activeOutlet),
    [rawData, activeOutlet]
  );

  const dataQualityIssues = useMemo(() => analyzeDataQuality(rawData), [rawData]);
  const [qualityBannerExpanded, setQualityBannerExpanded] = useState(false);

  const normalizedData = useMemo(() => toBaseUnitDataset(filteredData), [filteredData]);

  const theoreticalStock = useMemo(
    () => calculateTheoreticalStock(normalizedData),
    [normalizedData]
  );

  const varianceReport = useMemo(
    () => generateVarianceReport(theoreticalStock),
    [theoreticalStock]
  );

  const avgDailySales = useMemo(
    () => computeAvgDailySales(filteredData.sales, 7),
    [filteredData.sales]
  );

  const ingredientForecast = useMemo(() => {
    const syntheticSales = Object.entries(avgDailySales).map(([menuName, quantity]) => ({
      menuName,
      quantity
    }));
    return calculateUsageFromSales(syntheticSales, normalizedData.recipes);
  }, [avgDailySales, normalizedData.recipes]);

  const purchaseSuggestions = useMemo(
    () => buildPurchaseSuggestions(ingredientForecast, theoreticalStock),
    [ingredientForecast, theoreticalStock]
  );

  const receivingIssues = useMemo(
    () => filteredData.receiving.filter((r) => Math.abs(Number(r.difference || 0)) > 0.0001),
    [filteredData.receiving]
  );

  /* =======================================================
     PROSES PESAN CHAT
     ======================================================= */

  async function processMessage(text) {
    const dataType = detectDataType(text);

    const ITEM_BASED_TYPES = ["opening_stock", "purchase", "receiving", "stock_opname", "waste", "adjustment", "sales"];
    if (ITEM_BASED_TYPES.includes(dataType) && looksLikeWhatsAppExport(text)) {
      return {
        text:
          "Teks ini sepertinya rekap WhatsApp dengan BANYAK tanggal dan/atau outlet sekaligus. Chat AI Assistant " +
          "di sini menganggap satu pesan = satu tanggal + satu outlet, jadi kalau dipaksa diproses di sini semua " +
          "barisnya bisa tergabung salah jadi satu tanggal/outlet saja.\n\n" +
          "Silakan pakai menu \"Import Chat WA\" di sebelah kiri — itu dibuat khusus untuk rekap seperti ini, " +
          "lengkap dengan deteksi tanggal dan outlet masing-masing baris.",
        tags: ["PERLU IMPORT WA"]
      };
    }

    const date = extractDate(text);
    const outlet = detectOutlet(text, chatOutlet);

    if (dataType === "opening_stock") {
      const items = parseItemLines(text);
      if (!items.length) {
        return {
          text:
            "Saya kenali ini sebagai STOK AWAL, tapi belum menemukan pasangan barang + jumlah.\n\n" +
            "Contoh:\nStok awal 21 Agustus 2026 DS\nAyam 35 kg\nDaging sapi 18 kg",
          tags: ["STOK AWAL"]
        };
      }
      const rows = items.map((x) => createOpeningStock({ ...x, date, outlet }));
      const saveResult = await saveWithSimilarityCheck(COLLECTIONS.OPENING_STOCK, rows, "Stok Awal (chat)", `${rows.length} bahan, ${outlet}, ${formatDateID(date)}`);
      if (saveResult.deferred) {
        return {
          text: `Ada ${saveResult.count} nama bahan yang mirip dengan yang sudah tercatat. Mohon konfirmasi dulu di bawah sebelum saya simpan.`,
          tags: ["STOK AWAL", "PERLU KONFIRMASI"]
        };
      }
      await refreshData();
      return {
        text:
          `STOK AWAL (${outlet}) tersimpan.\n\nTanggal: ${formatDateID(date)}\n\n` +
          items.map((x) => `- ${x.itemName}: ${formatNumber(x.quantity)} ${x.unit}`).join("\n"),
        tags: ["STOK AWAL", "TERSIMPAN"]
      };
    }

    if (dataType === "purchase") {
      const items = parseItemLines(text);
      const supplier = extractLabeledValue(text, ["supplier", "vendor", "pemasok"]);
      if (!items.length) {
        return {
          text:
            "Saya kenali ini sebagai PEMBELIAN, tapi jumlah barang belum terbaca.\n\n" +
            "Contoh:\nPembelian 21 Agustus 2026 DS\nSupplier: PT Ternak Jaya\nAyam 20 kg\nBeras 25 kg",
          tags: ["PEMBELIAN"]
        };
      }
      const rows = items.map((x) => createPurchase({ ...x, date, outlet, supplier }));
      const saveResult = await saveWithSimilarityCheck(COLLECTIONS.PURCHASES, rows, "Pembelian (chat)", `${rows.length} bahan, ${outlet}, ${formatDateID(date)}`);
      if (saveResult.deferred) {
        return {
          text: `Ada ${saveResult.count} nama bahan yang mirip dengan yang sudah tercatat. Mohon konfirmasi dulu di bawah sebelum saya simpan.`,
          tags: ["PEMBELIAN", "PERLU KONFIRMASI"]
        };
      }
      await refreshData();
      return {
        text:
          `PEMBELIAN (${outlet}) tersimpan — jumlah ini otomatis dianggap sudah diterima sesuai pesanan ` +
          `dan langsung masuk stok. Kirim "barang datang" HANYA kalau jumlah yang diterima berbeda dari pesanan.` +
          `\n\nTanggal: ${formatDateID(date)}${supplier ? `\nSupplier: ${supplier}` : ""}\n\n` +
          items.map((x) => `- ${x.itemName}: ${formatNumber(x.quantity)} ${x.unit}`).join("\n"),
        tags: ["PEMBELIAN", "TERSIMPAN"]
      };
    }

    if (dataType === "receiving") {
      const items = parseItemLines(text);
      if (!items.length) {
        return {
          text:
            "Saya kenali ini sebagai BARANG DATANG, tapi jumlah belum terbaca.\n\n" +
            "Contoh:\nBarang datang 22 Agustus 2026 DS\nAyam 20 kg\nBeras 25 kg",
          tags: ["BARANG DATANG"]
        };
      }

      const relevantPurchases = filteredData.purchases.filter((p) => p.outlet === outlet);
      const rows = [];
      const noteLines = [];

      for (const item of items) {
        const candidates = relevantPurchases
          .filter((p) => normalizeText(p.itemName) === normalizeText(item.itemName) && p.date <= date)
          .sort((a, b) => (a.date < b.date ? 1 : -1));

        const matched = candidates[0];
        const orderedQuantity = matched ? Number(matched.quantity) : 0;

        rows.push(
          createReceiving({
            date,
            outlet,
            purchaseId: matched?.id || "",
            supplier: matched?.supplier || "",
            itemName: item.itemName,
            orderedQuantity,
            receivedQuantity: item.quantity,
            unit: item.unit
          })
        );

        if (matched) {
          const diff = item.quantity - orderedQuantity;
          if (Math.abs(diff) > 0.0001) {
            noteLines.push(
              `⚠️ ${item.itemName}: dipesan ${formatNumber(orderedQuantity)} ${item.unit}, diterima ${formatNumber(
                item.quantity
              )} ${item.unit} (selisih ${formatNumber(diff)})`
            );
          } else {
            noteLines.push(`✅ ${item.itemName}: sesuai pesanan`);
          }
        } else {
          noteLines.push(`ℹ️ ${item.itemName}: tidak ditemukan pembelian yang cocok — dicatat apa adanya`);
        }
      }

      const saveResult = await saveWithSimilarityCheck(COLLECTIONS.RECEIVING, rows, "Barang Datang (chat)", `${rows.length} bahan, ${outlet}, ${formatDateID(date)}`);
      if (saveResult.deferred) {
        return {
          text: `Ada ${saveResult.count} nama bahan yang mirip dengan yang sudah tercatat. Mohon konfirmasi dulu di bawah sebelum saya simpan.`,
          tags: ["BARANG DATANG", "PERLU KONFIRMASI"]
        };
      }
      await refreshData();

      return {
        text:
          `BARANG DATANG (${outlet}) tersimpan.\n\nTanggal: ${formatDateID(date)}\n\n` +
          noteLines.join("\n"),
        tags: ["BARANG DATANG", "TERSIMPAN"]
      };
    }

    if (dataType === "sales") {
      const items = parseSalesLines(text);
      if (!items.length) {
        return {
          text:
            "Saya kenali ini sebagai PENJUALAN, tapi menu + jumlah porsi belum terbaca.\n\n" +
            "Contoh:\nPenjualan 21 Agustus 2026 DS\nAyam Bakar 45 porsi\nAyam Geprek 32 porsi",
          tags: ["PENJUALAN"]
        };
      }
      const rows = items.map((x) => createSale({ ...x, date, outlet, source: "AI" }));
      await saveRowsTracked(COLLECTIONS.SALES, rows, "Penjualan (chat)", `${rows.length} menu, ${outlet}, ${formatDateID(date)}`);
      await refreshData();
      const total = items.reduce((sum, x) => sum + x.quantity, 0);
      return {
        text:
          `PENJUALAN (${outlet}) tersimpan.\n\nTanggal: ${formatDateID(date)}\n\n` +
          items.map((x) => `- ${x.menuName}: ${formatNumber(x.quantity)} porsi`).join("\n") +
          `\n\nTotal porsi: ${formatNumber(total)}. Data ini otomatis dipakai untuk menghitung ` +
          `kebutuhan bahan besok berdasarkan resep.`,
        tags: ["PENJUALAN", "TERSIMPAN"]
      };
    }

    if (dataType === "stock_opname") {
      const items = parseItemLines(text);
      if (!items.length) {
        return {
          text:
            "Saya kenali ini sebagai STOCK OPNAME, tapi jumlah fisik belum terbaca.\n\n" +
            "Contoh:\nStock opname 21 Agustus 2026 DS\nAyam 28 kg\nBeras 42 kg",
          tags: ["STOCK OPNAME"]
        };
      }
      const rows = items.map((x) =>
        createStockOpname({
          date,
          outlet,
          itemName: x.itemName,
          actualQuantity: x.quantity,
          unit: x.unit
        })
      );
      const saveResult = await saveWithSimilarityCheck(COLLECTIONS.STOCK_OPNAME, rows, "Stock Opname (chat)", `${rows.length} bahan, ${outlet}, ${formatDateID(date)}`);
      if (saveResult.deferred) {
        return {
          text: `Ada ${saveResult.count} nama bahan yang mirip dengan yang sudah tercatat. Mohon konfirmasi dulu di bawah sebelum saya simpan.`,
          tags: ["STOCK OPNAME", "PERLU KONFIRMASI"]
        };
      }
      await refreshData();
      return {
        text:
          `STOCK OPNAME (${outlet}) tersimpan.\n\nTanggal: ${formatDateID(date)}\n\n` +
          items.map((x) => `- ${x.itemName}: ${formatNumber(x.quantity)} ${x.unit}`).join("\n") +
          `\n\nBuka menu Variance & Waste untuk melihat selisih dengan stok teoritis.`,
        tags: ["STOCK OPNAME", "TERSIMPAN"]
      };
    }

    if (dataType === "waste") {
      const items = parseItemLines(text);
      const reason = extractLabeledValue(text, ["alasan", "keterangan", "sebab"]);
      if (!items.length) {
        return {
          text:
            "Saya kenali ini sebagai WASTE, tapi jumlah belum terbaca.\n\n" +
            "Contoh:\nWaste 21 Agustus 2026 DS\nAlasan: basi\nAyam 2 kg",
          tags: ["WASTE"]
        };
      }
      const rows = items.map((x) => createWaste({ ...x, date, outlet, reason }));
      const saveResult = await saveWithSimilarityCheck(COLLECTIONS.WASTE, rows, "Waste (chat)", `${rows.length} bahan, ${outlet}, ${formatDateID(date)}`);
      if (saveResult.deferred) {
        return {
          text: `Ada ${saveResult.count} nama bahan yang mirip dengan yang sudah tercatat. Mohon konfirmasi dulu di bawah sebelum saya simpan.`,
          tags: ["WASTE", "PERLU KONFIRMASI"]
        };
      }
      await refreshData();
      return {
        text:
          `WASTE (${outlet}) tersimpan.\n\nTanggal: ${formatDateID(date)}${reason ? `\nAlasan: ${reason}` : ""}\n\n` +
          items.map((x) => `- ${x.itemName}: ${formatNumber(x.quantity)} ${x.unit}`).join("\n"),
        tags: ["WASTE", "TERSIMPAN"]
      };
    }

    if (dataType === "adjustment") {
      const items = parseItemLines(text);
      const reason = extractLabeledValue(text, ["alasan", "keterangan"]);
      if (!items.length) {
        return {
          text: "Saya kenali ini sebagai PENYESUAIAN STOK, tapi jumlah belum terbaca.",
          tags: ["PENYESUAIAN"]
        };
      }
      const rows = items.map((x) => createAdjustment({ ...x, date, outlet, reason }));
      const saveResult = await saveWithSimilarityCheck(COLLECTIONS.ADJUSTMENTS, rows, "Penyesuaian Stok (chat)", `${rows.length} bahan, ${outlet}, ${formatDateID(date)}`);
      if (saveResult.deferred) {
        return {
          text: `Ada ${saveResult.count} nama bahan yang mirip dengan yang sudah tercatat. Mohon konfirmasi dulu di bawah sebelum saya simpan.`,
          tags: ["PENYESUAIAN", "PERLU KONFIRMASI"]
        };
      }
      await refreshData();
      return {
        text: `PENYESUAIAN STOK (${outlet}) tersimpan.`,
        tags: ["PENYESUAIAN", "TERSIMPAN"]
      };
    }

    if (dataType === "recipe") {
      const groups = parseRecipeGroups(text);
      if (!groups.length) {
        return {
          text:
            "Saya kenali ini sebagai RESEP, tapi formatnya belum terbaca.\n\n" +
            "Contoh:\nSoto Ayam\nAyam 50 gram per porsi\nBeras 100 gram per porsi",
          tags: ["RESEP"]
        };
      }
      for (const group of groups) {
        await saveRecipe({ menuName: group.menuName, ingredients: group.ingredients, portions: 1 });
      }
      await refreshData();
      const output = groups
        .map(
          (g) =>
            `${g.menuName}\n` +
            g.ingredients.map((x) => `- ${x.itemName}: ${formatNumber(x.quantity)} ${x.unit} / porsi`).join("\n")
        )
        .join("\n\n");
      return {
        text: `RESEP tersimpan.\n\n${output}`,
        tags: ["RESEP", "TERSIMPAN"]
      };
    }

    if (dataType === "price") {
      const items = parsePriceLines(text);
      if (!items.length) {
        return {
          text:
            "Saya kenali ini sebagai UPDATE HARGA, tapi format harga belum terbaca.\n\n" +
            "Contoh:\nHarga update\nAyam Rp 35.000 / kg\nBeras Rp 15.000 / kg",
          tags: ["HARGA"]
        };
      }
      for (const item of items) {
        await savePrice({ ...item, effectiveDate: date, source: "AI" });
      }
      await refreshData();
      return {
        text:
          "UPDATE HARGA tersimpan.\n\n" +
          items.map((x) => `- ${x.itemName}: Rp ${formatNumber(x.price)} / ${x.unit}`).join("\n"),
        tags: ["HARGA", "TERSIMPAN"]
      };
    }

    if (dataType === "report") {
      const dailyStats = computeDailySalesStats(filteredData.sales, rawData.recipes);

      const ctx = {
        varianceReport,
        purchaseSuggestions,
        avgDailySales,
        priceHistory,
        receivingIssues,
        dailyStats
      };

      const omzetRataRataPerMenu = Object.fromEntries(
        Object.entries(avgDailySales).map(([menu, avgQty]) => {
          const recipe = findRecipeByMenu(menu, rawData.recipes);
          const price = recipe ? Number(recipe.sellPrice || 0) : 0;
          return [menu, Math.round(avgQty * price)];
        })
      );

      const marginPerMenu = rawData.recipes
        .filter((r) => Number(r.sellPrice || 0) > 0)
        .map((r) => {
          const cost = computeRecipeCost(r, priceHistory);
          const sellPrice = Number(r.sellPrice || 0);
          return {
            menu: r.menuName,
            harga_jual: sellPrice,
            estimasi_hpp: cost.complete ? Math.round(cost.totalCost) : null,
            margin: cost.complete ? Math.round(sellPrice - cost.totalCost) : null
          };
        });

      // Total gabungan (semua menu dijumlahkan) untuk jendela 7 hari terakhir --
      // dihitung di sini, bukan diserahkan ke AI untuk menjumlahkan sendiri
      // angka per-menu, karena model kecil sering salah hitung penjumlahan.
      const totalPorsi7HariTerakhir = Object.values(avgDailySales).reduce((a, b) => a + b, 0);
      const totalOmzet7HariTerakhir = Object.values(omzetRataRataPerMenu).reduce((a, b) => a + b, 0);

      const outletBreakdown = OUTLETS.filter((o) => o.id !== "ALL").map((o) => {
        const outletSales = rawData.sales.filter((s) => (s.outlet || "DS") === o.id);
        const stats = computeDailySalesStats(outletSales, rawData.recipes);
        return {
          outlet: o.id,
          nama: o.label,
          total_porsi: outletSales.reduce((sum, s) => sum + Number(s.quantity || 0), 0),
          total_omzet: Math.round(computeRevenue(outletSales, rawData.recipes)),
          rata_rata_porsi_per_hari: stats.rataRataPorsiPerHari,
          rata_rata_omzet_per_hari: stats.rataRataOmzetPerHari
        };
      });

      const contextText = JSON.stringify({
        outlet_terpilih: activeOutlet,
        tanggal_sistem: getTodayISO(),
        catatan_penting:
          "Untuk pertanyaan 'rata-rata penjualan per hari' TANPA sebutan menu tertentu, " +
          "JAWAB LANGSUNG memakai field rata_rata_harian_seluruh_periode (total gabungan semua menu) " +
          "-- JANGAN menjumlahkan sendiri angka per-menu. Field rata_rata_penjualan_harian_per_menu " +
          "hanya dipakai kalau pengguna tanya spesifik per-menu. Selalu sebutkan periode/tanggal data " +
          "yang dipakai (field dari/sampai) agar jelas rentang waktunya.",
        rata_rata_harian_seluruh_periode: {
          dari: dailyStats.dariTanggal,
          sampai: dailyStats.sampaiTanggal,
          jumlah_hari: dailyStats.jumlahHari,
          rata_rata_porsi_per_hari: dailyStats.rataRataPorsiPerHari,
          rata_rata_omzet_per_hari: dailyStats.rataRataOmzetPerHari,
          rata_rata_hari_kerja: dailyStats.hariKerja,
          rata_rata_akhir_pekan: dailyStats.akhirPekan
        },
        rata_rata_harian_7_hari_terakhir: {
          total_porsi_per_hari: Math.round(totalPorsi7HariTerakhir),
          total_omzet_per_hari: Math.round(totalOmzet7HariTerakhir)
        },
        omzet_dan_porsi_per_bulan: dailyStats.perBulan,
        omzet_per_outlet: outletBreakdown,
        item_variance_terbesar: varianceReport.items
          .slice()
          .sort((a, b) => a.variance - b.variance)
          .slice(0, 10)
          .map((x) => ({
            item: x.itemName,
            teoritis: Math.round(x.theoretical),
            aktual: Math.round(x.actual),
            selisih: Math.round(x.variance),
            satuan: x.unit
          })),
        saran_pembelian: purchaseSuggestions.slice(0, 10).map((x) => ({
          item: x.itemName,
          kebutuhan_harian: Math.round(x.dailyNeed),
          stok_sekarang: Math.round(x.currentStock),
          saran_beli: Math.round(x.suggestedPurchase),
          satuan: x.base
        })),
        rata_rata_penjualan_harian_per_menu: avgDailySales,
        omzet_rata_rata_harian_per_menu: omzetRataRataPerMenu,
        total_omzet_tercatat: Math.round(computeRevenue(filteredData.sales, rawData.recipes)),
        margin_per_menu: marginPerMenu,
        selisih_barang_datang: receivingIssues.slice(0, 10)
      });

      let answerText;
      let usedFallback = false;
      try {
        answerText = await askAI(buildReportPrompt(text, contextText));
      } catch (error) {
        console.warn("AI fallback:", error.message);
        answerText = buildLocalReport(text, ctx);
        usedFallback = true;
      }

      return {
        text: answerText,
        tags: usedFallback ? ["LAPORAN AI", "MODE LOKAL"] : ["LAPORAN AI"]
      };
    }

    const lower = normalizeText(text);
    if (lower.includes("status") || lower.includes("database")) {
      return {
        text:
          `STATUS SISTEM\n\n` +
          `Firebase: ${systemOnline ? "Terhubung" : "Periksa koneksi"}\n\n` +
          `Penjualan: ${rawData.sales.length} record\n` +
          `Pembelian: ${rawData.purchases.length} record\n` +
          `Barang datang: ${rawData.receiving.length} record\n` +
          `Stok awal: ${rawData.openingStock.length} record\n` +
          `Stock opname: ${rawData.stockOpname.length} record\n` +
          `Resep: ${rawData.recipes.length} menu\n` +
          `Harga tersimpan: ${priceHistory.length} record`,
        tags: ["STATUS"]
      };
    }

    return {
      text:
        "Saya bisa mengenali: stok awal, pembelian, barang datang, penjualan, stock opname, " +
        "waste, penyesuaian stok, resep, dan update harga — cukup ketik dalam bahasa biasa.\n\n" +
        "Untuk laporan, coba tanya misalnya \"apa yang perlu dibeli besok?\" atau " +
        "\"item mana yang variance-nya paling besar?\".",
      tags: ["AI ASSISTANT"]
    };
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const sendDate = chatDate;

    setInput("");
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: "user", text }]);
    persistChatMessage(sendDate, "user", text, []);
    setLoading(true);

    try {
      const response = await processMessage(text);
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", text: response.text, tags: response.tags }
      ]);
      persistChatMessage(sendDate, "assistant", response.text, response.tags || []);
    } catch (error) {
      console.error(error);
      const errorText = `Terjadi kesalahan saat memproses data.\n\nDetail: ${error?.message || "Unknown error"}`;
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          text: errorText,
          tags: ["ERROR"]
        }
      ]);
      persistChatMessage(sendDate, "assistant", errorText, ["ERROR"]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function quickAction(text) {
    setInput(text);
  }

  /* =======================================================
     IMPORT EXCEL
     ======================================================= */

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportBusy(true);
    try {
      const result = await processExcelFile(file);
      setImportResult(result);
    } catch (error) {
      console.error(error);
      setImportResult([{ sheetName: "Error", type: "UNKNOWN", rows: [], valid: false, errors: [error.message] }]);
    } finally {
      setImportBusy(false);
    }
  }

  async function handleSaveImport() {
    if (!importResult) return;
    setImportBusy(true);
    try {
      const typeToCollection = {
        SALES: COLLECTIONS.SALES,
        PURCHASE: COLLECTIONS.PURCHASES,
        RECEIVING: COLLECTIONS.RECEIVING,
        OPENING_STOCK: COLLECTIONS.OPENING_STOCK,
        STOCK_OPNAME: COLLECTIONS.STOCK_OPNAME,
        WASTE: COLLECTIONS.WASTE
      };

      for (const sheet of importResult) {
        const target = typeToCollection[sheet.type];
        if (!target || !sheet.rows.length) continue;
        // Buang baris tanpa identitas (itemName/menuName kosong) sebelum
        // disimpan -- validateImport() menandainya sebagai error, tapi
        // sheet yang tidak valid tetap bisa ditekan "Simpan" oleh user,
        // jadi baris kosong harus disaring di sini juga.
        const rows = sheet.rows
          .filter((r) => r.itemName || r.menuName)
          .map((r) => ({ ...r, outlet: r.outlet || "DS" }));
        if (!rows.length) continue;
        await saveRowsTracked(target, rows, `${sheet.type} (Import Excel)`, `${rows.length} baris dari sheet "${sheet.sheetName}"`);
      }

      await refreshData();
      setImportResult(null);
    } catch (error) {
      console.error(error);
      showToast(`Gagal menyimpan hasil import: ${error.message}`);
    } finally {
      setImportBusy(false);
    }
  }

  /* =======================================================
     IMPORT CHAT WHATSAPP (rekap belanja multi-tanggal/outlet)
     ======================================================= */

  async function handleWaParse() {
    const result = parseWhatsAppExport(waText);

    // Deteksi nama bahan yang mirip -- baik terhadap yang sudah tercatat
    // di database, MAUPUN antar baris di dalam batch import ini sendiri
    // (rekap WhatsApp panjang sering menulis bahan yang sama dengan ejaan
    // berbeda, atau catatan tambahan seperti harga/takaran, di hari yang
    // berbeda-beda).
    const pool = getKnownIngredientNames(rawData);
    const allNames = [];
    result.groups.forEach((g) => g.items.forEach((item) => allNames.push(item.itemName)));
    result.reviewItems.forEach((item) => allNames.push(item.itemName));

    setWaAnalyzing(true);
    setWaAnalyzeProgress(null);
    try {
      const similarityChecks = await computeSimilarityChecks(allNames, pool, (done, total) => {
        setWaAnalyzeProgress({ done, total });
      });
      setWaResult({ ...result, similarityChecks });
      setWaShowReview(false);
    } finally {
      setWaAnalyzing(false);
      setWaAnalyzeProgress(null);
    }
  }

  function updateWaReviewItem(index, field, value) {
    setWaResult((prev) => ({
      ...prev,
      reviewItems: prev.reviewItems.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    }));
  }

  // Baris review yang tebakan namanya PERSIS sama (mis. "Bunga Pepaya
  // Seadanya" yang muncul di banyak tanggal) dikelompokkan supaya cukup
  // ditinjau/diperbaiki sekali -- perbaikan nama/jumlah/satuan otomatis
  // berlaku ke semua baris dalam grup itu. Tanggal & outlet tetap per
  // baris (memang beda-beda), bisa dibuka & diedit satu-satu kalau perlu.
  function groupWaReviewItems(reviewItems) {
    const map = new Map();
    reviewItems.forEach((item, index) => {
      const key = String(item.itemName || "").trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, { key, itemName: item.itemName, quantity: item.quantity, unit: item.unit, indices: [] });
      }
      map.get(key).indices.push(index);
    });
    return [...map.values()];
  }

  function updateWaReviewGroupField(indices, field, value) {
    setWaResult((prev) => ({
      ...prev,
      reviewItems: prev.reviewItems.map((item, i) => (indices.includes(i) ? { ...item, [field]: value } : item))
    }));
  }

  function chooseWaSimilarity(index, choice) {
    setWaResult((prev) => ({
      ...prev,
      similarityChecks: prev.similarityChecks.map((c, i) => (i === index ? { ...c, choice } : c))
    }));
  }

  async function handleWaSave() {
    if (!waResult) return;
    const totalRows = waResult.totalConfident + waResult.reviewItems.length;
    if (!totalRows) return;
    if (waResult.similarityChecks.some((c) => !c.choice)) return;
    setWaSaveBusy(true);
    try {
      const renameMap = new Map();
      waResult.similarityChecks.forEach((c) => {
        if (c.choice === "merge") renameMap.set(c.name.toLowerCase(), c.matchedName);
      });
      const applyRename = (name) => renameMap.get(String(name || "").toLowerCase()) || name;

      const rows = [];
      waResult.groups.forEach((g) => {
        g.items.forEach((item) => {
          rows.push(
            createPurchase({
              date: g.date,
              outlet: g.outlet,
              itemName: applyRename(item.itemName),
              quantity: item.quantity,
              unit: item.unit
            })
          );
        });
      });
      // Baris "perlu ditinjau" tetap ikut tersimpan memakai tebakan
      // terbaik (atau editan pengguna) -- tanggal/outlet kosong di-default
      // ke hari ini/DS supaya tidak ada data yang batal tersimpan hanya
      // karena belum sempat ditinjau.
      waResult.reviewItems.forEach((item) => {
        rows.push(
          createPurchase({
            date: item.date || getTodayISO(),
            outlet: item.outlet || "DS",
            itemName: applyRename(item.itemName),
            quantity: Number(item.quantity) || 1,
            unit: item.unit
          })
        );
      });
      const dates = [...new Set(rows.map((r) => r.date))].sort();
      const summary =
        dates.length === 1
          ? `${rows.length} baris pembelian, ${dates[0]}`
          : `${rows.length} baris pembelian, ${dates[0]} s/d ${dates[dates.length - 1]}`;
      await saveRowsTracked(COLLECTIONS.PURCHASES, rows, "Pembelian (Import WhatsApp)", summary);
      await refreshData();
      showToast(`${rows.length} baris pembelian berhasil disimpan.`, "success");
      setWaText("");
      setWaResult(null);
      setWaShowReview(false);
    } catch (error) {
      console.error(error);
      showToast(`Gagal menyimpan hasil import chat: ${error.message}`);
    } finally {
      setWaSaveBusy(false);
    }
  }

  /* =======================================================
     EDIT / HAPUS RESEP
     ======================================================= */

  function startEditRecipe(recipe) {
    setDeleteConfirmId(null);
    setEditError("");
    setEditingRecipeId(recipe.id);
    setEditMenuName(recipe.menuName || "");
    setEditIngredients(
      (recipe.ingredients || []).map((ing) => ({
        itemName: ing.itemName || "",
        quantity: ing.quantity ?? "",
        unit: ing.unit || "gram"
      }))
    );
    setEditSellPrice(recipe.sellPrice ? String(recipe.sellPrice) : "");
  }

  function cancelEditRecipe() {
    setEditingRecipeId(null);
    setEditError("");
  }

  function updateEditIngredientField(index, field, value) {
    setEditIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing))
    );
  }

  function addEditIngredientRow() {
    setEditIngredients((prev) => [...prev, { itemName: "", quantity: "", unit: "gram" }]);
  }

  function addSuggestedIngredient(suggestion) {
    setEditIngredients((prev) => [
      ...prev,
      {
        itemName: suggestion.itemName,
        quantity: Math.round(suggestion.estimatedQtyPerPortion * 100) / 100,
        unit: suggestion.unit
      }
    ]);
  }

  function removeEditIngredientRow(index) {
    setEditIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveEditRecipe() {
    setEditError("");

    const cleanedIngredients = editIngredients
      .map((ing) => ({
        itemName: String(ing.itemName || "").trim(),
        quantity: Number(ing.quantity) || 0,
        unit: String(ing.unit || "").trim() || "gram"
      }))
      .filter((ing) => ing.itemName && ing.quantity > 0);

    if (!editMenuName.trim()) {
      setEditError("Nama menu wajib diisi.");
      return;
    }

    if (cleanedIngredients.length === 0) {
      setEditError("Resep harus punya minimal satu bahan dengan nama dan jumlah valid.");
      return;
    }

    setEditBusy(true);
    try {
      await updateRecipe(editingRecipeId, {
        menuName: editMenuName.trim(),
        ingredients: cleanedIngredients,
        sellPrice: Number(editSellPrice) || 0
      });
      setEditingRecipeId(null);
      await refreshData();
    } catch (error) {
      console.error("Gagal update resep:", error);
      setEditError(error?.message || "Gagal menyimpan perubahan.");
    } finally {
      setEditBusy(false);
    }
  }

  async function confirmDeleteRecipe(id) {
    setDeleteBusy(true);
    try {
      await deleteRecipe(id);
      setDeleteConfirmId(null);
      await refreshData();
    } catch (error) {
      console.error("Gagal hapus resep:", error);
      showToast(`Gagal menghapus resep: ${error.message}`);
    } finally {
      setDeleteBusy(false);
    }
  }

  /* =======================================================
     RENDER HALAMAN
     ======================================================= */

  function renderDashboard() {
    const totalSalesPortions = filteredData.sales.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const criticalCount = varianceReport.items.filter((x) => x.variance < 0).length;
    const totalRevenue = computeRevenue(filteredData.sales, rawData.recipes);
    const hasAnyPrice = rawData.recipes.some((r) => Number(r.sellPrice || 0) > 0);

    const outletBreakdown = OUTLETS.filter((o) => o.id !== "ALL").map((o) => {
      const outletSales = rawData.sales.filter((s) => (s.outlet || "DS") === o.id);
      return {
        outlet: o.id,
        label: o.label,
        portions: outletSales.reduce((s, r) => s + Number(r.quantity || 0), 0),
        revenue: computeRevenue(outletSales, rawData.recipes)
      };
    });

    const trendDays = 14;
    const trendDates = [];
    {
      const cursor = new Date(`${getTodayISO()}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() - (trendDays - 1));
      for (let i = 0; i < trendDays; i++) {
        trendDates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    const trend = trendDates.map((d) => {
      const daySales = filteredData.sales.filter((s) => s.date === d);
      return { date: d, revenue: computeRevenue(daySales, rawData.recipes) };
    });
    const maxTrendRevenue = Math.max(1, ...trend.map((t) => t.revenue));

    return (
      <div className="page">
        <div className="section-header">
          <div>
            <h1>Dashboard</h1>
            <p>Ringkasan operasional — {OUTLETS.find((o) => o.id === activeOutlet)?.label}.</p>
          </div>
        </div>

        <div className="stat-grid">
          <StatCard title="Omzet" value={`Rp ${formatNumber(totalRevenue)}`} subtitle="total tercatat" icon="coin" tone="orange" />
          <StatCard title="Penjualan" value={formatNumber(totalSalesPortions)} subtitle="total porsi tercatat" icon="cart" tone="green" />
          <StatCard title="Pembelian" value={rawData.purchases.length} subtitle="record" icon="cart" tone="green" />
          <StatCard title="Item Bervariance" value={criticalCount} subtitle="perlu ditinjau" icon="trend" tone={criticalCount > 0 ? "orange" : "green"} />
        </div>

        {!hasAnyPrice && (
          <div className="logic-card">
            <div className="logic-icon"><Icon name="leaf" size={20} /></div>
            <div>
              Omzet menampilkan Rp 0 karena belum ada resep dengan <strong>harga jual</strong> terisi. Buka halaman{" "}
              <strong>Resep</strong>, klik <strong>Edit</strong> pada tiap menu, lalu isi harga jual per porsi.
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-title">Tren omzet 14 hari terakhir</div>
          <div className="card-description">Berdasarkan tanggal transaksi penjualan, outlet: {OUTLETS.find((o) => o.id === activeOutlet)?.label}.</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, marginTop: 14 }}>
            {trend.map((t) => {
              const heightPct = Math.max((t.revenue / maxTrendRevenue) * 100, 2);
              return (
                <div key={t.date} title={`${formatDateID(t.date)}: Rp ${formatNumber(t.revenue)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <div style={{ width: "100%", height: 90, display: "flex", alignItems: "flex-end" }}>
                    <div style={{ width: "100%", height: `${heightPct}%`, background: "var(--green-500)", borderRadius: "4px 4px 0 0", minHeight: 2 }} />
                  </div>
                  <span style={{ fontSize: 9, color: "var(--ink-faint)" }}>{t.date.slice(8, 10)}/{t.date.slice(5, 7)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {activeOutlet === "ALL" && (
          <div className="card">
            <div className="card-title">Performa per outlet</div>
            <DataTable
              columns={["Outlet", "Porsi Terjual", "Omzet"]}
              rows={outletBreakdown
                .slice()
                .sort((a, b) => b.revenue - a.revenue)
                .map((o) => [o.label, formatNumber(o.portions), `Rp ${formatNumber(o.revenue)}`])}
            />
          </div>
        )}

        <div className="card">
          <div className="card-title">Saran pembelian teratas</div>
          <div className="card-description">Berdasarkan rata-rata penjualan 7 hari terakhir dikurangi stok berjalan.</div>
          <DataTable
            columns={["Bahan", "Kebutuhan/hari", "Stok sekarang", "Saran beli"]}
            rows={purchaseSuggestions.slice(0, 6).map((x) => [
              x.itemName,
              displayQuantity(x.dailyNeed, x.base),
              displayQuantity(x.currentStock, x.base),
              displayQuantity(x.suggestedPurchase, x.base)
            ])}
          />
        </div>

        <div className="card">
          <div className="card-title">Status database</div>
          <p className="card-description">
            Firebase: <strong>{systemOnline ? "Terhubung" : "Belum terhubung"}</strong>
          </p>
          <button className="secondary-button" onClick={refreshData}>Refresh data</button>
        </div>
      </div>
    );
  }

  function renderStokAwal() {
    const openingRows = filteredData.openingStock
      .filter((x) => !openingSearch.trim() || normalizeText(x.itemName).includes(normalizeText(openingSearch)))
      .filter((x) => !openingFilterStart || x.date >= openingFilterStart)
      .filter((x) => !openingFilterEnd || x.date <= openingFilterEnd)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return (
      <div className="page">
        <div className="section-header"><div><h1>Stok Awal</h1><p>Saldo awal bahan yang jadi titik mulai perhitungan stok teoritis.</p></div></div>
        <FilterBar
          search={openingSearch}
          onSearchChange={setOpeningSearch}
          searchPlaceholder="Cari nama bahan..."
          start={openingFilterStart}
          onStartChange={setOpeningFilterStart}
          end={openingFilterEnd}
          onEndChange={setOpeningFilterEnd}
          summary={`${openingRows.length} baris`}
        />
        <DataTable
          columns={["Tanggal", "Outlet", "Bahan", "Jumlah", "Satuan", "Aksi"]}
          rows={openingRows.map((x) => {
            const editing = editingRow?.id === x.id;
            return [
              editing ? fieldInput("date", "date") : formatDateID(x.date),
              editing ? fieldInput("outlet", "select", ["DS", "SS", "SP"]) : x.outlet,
              editing ? fieldInput("itemName", "text") : x.itemName,
              editing ? fieldInput("quantity", "number") : formatNumber(x.quantity),
              editing ? fieldInput("unit", "text") : x.unit,
              actionCell(COLLECTIONS.OPENING_STOCK, x, ["date", "outlet", "itemName", "quantity", "unit"], ["quantity"])
            ];
          })}
        />
      </div>
    );
  }

  function renderPembelian() {
    return (
      <div className="page">
        <div className="section-header"><div><h1>Pembelian</h1><p>Barang yang dipesan ke supplier.</p></div></div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Kategori Pembelian</div>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 12px" }}>
            Buat kategori sendiri (mis. Bahan Baku, Kemasan, Kebersihan), lalu pilih kategori untuk tiap bahan di
            tabel pembelian di bawah.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCategory();
              }}
              placeholder="Nama kategori baru..."
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", minWidth: 200 }}
            />
            <button className="primary-button" onClick={addCategory} disabled={categoryBusy || !newCategoryName.trim()}>
              + Tambah Kategori
            </button>
            {categories.length > 0 && (
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {categories.map((c) => c.name).join(", ")}
              </span>
            )}
          </div>
        </div>

        {(() => {
          const purchaseRows = filteredData.purchases
            .filter((x) => !purchaseSearch.trim() || normalizeText(x.itemName).includes(normalizeText(purchaseSearch)))
            .filter((x) => !purchaseFilterStart || x.date >= purchaseFilterStart)
            .filter((x) => !purchaseFilterEnd || x.date <= purchaseFilterEnd)
            .sort((a, b) => (a.date < b.date ? 1 : -1));
          return (
            <>
              <FilterBar
                search={purchaseSearch}
                onSearchChange={setPurchaseSearch}
                searchPlaceholder="Cari nama bahan..."
                start={purchaseFilterStart}
                onStartChange={setPurchaseFilterStart}
                end={purchaseFilterEnd}
                onEndChange={setPurchaseFilterEnd}
                summary={`${purchaseRows.length} baris`}
              />
              <DataTable
                columns={["Tanggal", "Outlet", "Barang", "Jumlah", "Satuan", "Supplier", "Kategori", "Aksi"]}
                rows={purchaseRows.map((x) => {
                  const editing = editingRow?.id === x.id;
                  return [
                    editing ? fieldInput("date", "date") : formatDateID(x.date),
                    editing ? fieldInput("outlet", "select", ["DS", "SS", "SP"]) : x.outlet,
                    editing ? fieldInput("itemName", "text") : x.itemName,
                    editing ? fieldInput("quantity", "number") : formatNumber(x.quantity),
                    editing ? fieldInput("unit", "text") : x.unit,
                    editing ? fieldInput("supplier", "text") : (x.supplier || "-"),
                    editing ? (
                      <select
                        key="cat"
                        value={editingRow.fields.category || ""}
                        onChange={(e) => updateRowEditField("category", e.target.value)}
                        style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)" }}
                      >
                        <option value="">Belum dikategorikan</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        key="cat"
                        value={x.category || ""}
                        onChange={(e) => updatePurchaseCategory(x.id, e.target.value)}
                        style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)" }}
                      >
                        <option value="">Belum dikategorikan</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    ),
                    actionCell(COLLECTIONS.PURCHASES, x, ["date", "outlet", "itemName", "quantity", "unit", "supplier", "category"], ["quantity"])
                  ];
                })}
              />
            </>
          );
        })()}
      </div>
    );
  }

  function renderBarangDatang() {
    const receivingRows = filteredData.receiving
      .filter((x) => !receivingSearch.trim() || normalizeText(x.itemName).includes(normalizeText(receivingSearch)))
      .filter((x) => !receivingFilterStart || x.date >= receivingFilterStart)
      .filter((x) => !receivingFilterEnd || x.date <= receivingFilterEnd)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return (
      <div className="page">
        <div className="section-header"><div><h1>Barang Datang</h1><p>Opsional — hanya perlu diisi kalau jumlah yang diterima berbeda dari pesanan. Tanpa laporan ini, pembelian otomatis dianggap sesuai dan sudah masuk stok.</p></div></div>
        <FilterBar
          search={receivingSearch}
          onSearchChange={setReceivingSearch}
          searchPlaceholder="Cari nama bahan..."
          start={receivingFilterStart}
          onStartChange={setReceivingFilterStart}
          end={receivingFilterEnd}
          onEndChange={setReceivingFilterEnd}
          summary={`${receivingRows.length} baris`}
        />
        <DataTable
          columns={["Tanggal", "Outlet", "Barang", "Dipesan", "Diterima", "Selisih", "Aksi"]}
          rows={receivingRows
            .map((x) => {
              const editing = editingRow?.id === x.id;
              return [
              editing ? fieldInput("date", "date") : formatDateID(x.date),
              editing ? fieldInput("outlet", "select", ["DS", "SS", "SP"]) : x.outlet,
              editing ? fieldInput("itemName", "text") : x.itemName,
              editing ? fieldInput("orderedQuantity", "number") : `${formatNumber(x.orderedQuantity)} ${x.unit}`,
              editing ? fieldInput("receivedQuantity", "number") : `${formatNumber(x.receivedQuantity)} ${x.unit}`,
              Math.abs(x.difference) > 0.0001
                ? <span key="d" className="badge badge-warning">{formatNumber(x.difference)} {x.unit}</span>
                : <span key="d" className="badge badge-ok">Sesuai</span>,
              actionCell(COLLECTIONS.RECEIVING, x, ["date", "outlet", "itemName", "orderedQuantity", "receivedQuantity"], ["orderedQuantity", "receivedQuantity"])
              ];
            })}
        />
      </div>
    );
  }

  function renderPenjualan() {
    const periodSales = filteredData.sales
      .filter((s) => (!salesFilterStart || s.date >= salesFilterStart) && (!salesFilterEnd || s.date <= salesFilterEnd))
      .filter((s) => !salesSearch.trim() || normalizeText(s.menuName).includes(normalizeText(salesSearch)));
    const periodPortions = periodSales.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const periodRevenue = computeRevenue(periodSales, rawData.recipes);

    return (
      <div className="page">
        <div className="section-header"><div><h1>Penjualan</h1><p>Data penjualan yang masuk melalui chat atau import.</p></div></div>

        <div className="card">
          <FilterBar
            search={salesSearch}
            onSearchChange={setSalesSearch}
            searchPlaceholder="Cari nama menu..."
            start={salesFilterStart}
            onStartChange={setSalesFilterStart}
            end={salesFilterEnd}
            onEndChange={setSalesFilterEnd}
            summary={`${formatNumber(periodPortions)} porsi · Rp ${formatNumber(periodRevenue)}`}
          />

          <DataTable
            columns={["Tanggal", "Outlet", "Menu", "Jumlah", "Total", "Aksi"]}
            rows={periodSales
              .slice()
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((x) => {
                const recipe = findRecipeByMenu(x.menuName, rawData.recipes);
                const price = recipe ? Number(recipe.sellPrice || 0) : 0;
                const editing = editingRow?.id === x.id;
                return [
                  editing ? fieldInput("date", "date") : formatDateID(x.date),
                  editing ? fieldInput("outlet", "select", ["DS", "SS", "SP"]) : x.outlet,
                  editing ? fieldInput("menuName", "text") : x.menuName,
                  editing ? fieldInput("quantity", "number") : `${formatNumber(x.quantity)} porsi`,
                  price > 0 ? `Rp ${formatNumber(x.quantity * price)}` : "-",
                  actionCell(COLLECTIONS.SALES, x, ["date", "outlet", "menuName", "quantity"], ["quantity"])
                ];
              })}
          />
        </div>
      </div>
    );
  }

  function renderStok() {
    const opnameRows = filteredData.stockOpname
      .filter((x) => !opnameSearch.trim() || normalizeText(x.itemName).includes(normalizeText(opnameSearch)))
      .filter((x) => !opnameFilterStart || x.date >= opnameFilterStart)
      .filter((x) => !opnameFilterEnd || x.date <= opnameFilterEnd)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return (
      <div className="page">
        <div className="section-header"><div><h1>Stock Opname</h1><p>Stok fisik terakhir yang dilaporkan.</p></div></div>
        <FilterBar
          search={opnameSearch}
          onSearchChange={setOpnameSearch}
          searchPlaceholder="Cari nama bahan..."
          start={opnameFilterStart}
          onStartChange={setOpnameFilterStart}
          end={opnameFilterEnd}
          onEndChange={setOpnameFilterEnd}
          summary={`${opnameRows.length} baris`}
        />
        <DataTable
          columns={["Tanggal", "Outlet", "Barang", "Jumlah", "Satuan", "Aksi"]}
          rows={opnameRows.map((x) => {
            const editing = editingRow?.id === x.id;
            return [
              editing ? fieldInput("date", "date") : formatDateID(x.date),
              editing ? fieldInput("outlet", "select", ["DS", "SS", "SP"]) : x.outlet,
              editing ? fieldInput("itemName", "text") : x.itemName,
              editing ? fieldInput("actualQuantity", "number") : formatNumber(x.actualQuantity),
              editing ? fieldInput("unit", "text") : x.unit,
              actionCell(COLLECTIONS.STOCK_OPNAME, x, ["date", "outlet", "itemName", "actualQuantity", "unit"], ["actualQuantity"])
            ];
          })}
        />
      </div>
    );
  }

  function renderKebutuhan() {
    return (
      <div className="page">
        <div className="section-header">
          <div><h1>Kebutuhan Bahan</h1><p>Proyeksi kebutuhan harian dari resep × rata-rata penjualan 7 hari, dibandingkan stok berjalan.</p></div>
        </div>

        {purchaseSuggestions.length === 0 && (
          <div className="logic-card">
            <div className="logic-icon"><Icon name="leaf" size={20} /></div>
            <div>
              <div className="logic-title">Belum ada proyeksi</div>
              <div className="logic-text">
                Proyeksi ini butuh minimal: <strong>data resep</strong> per menu dan <strong>data penjualan</strong> beberapa hari terakhir. Kirim keduanya lewat AI Assistant untuk mulai melihat saran pembelian di sini.
              </div>
            </div>
          </div>
        )}

        <DataTable
          columns={["Bahan", "Kebutuhan / hari", "Stok berjalan", "Saran pembelian", "Dipakai di menu"]}
          rows={purchaseSuggestions.map((x) => [
            x.itemName,
            displayQuantity(x.dailyNeed, x.base),
            displayQuantity(x.currentStock, x.base),
            <strong key="s">{displayQuantity(x.suggestedPurchase, x.base)}</strong>,
            x.sourceMenus.slice(0, 3).join(", ") || "-"
          ])}
        />
      </div>
    );
  }

  function renderVariance() {
    const items = varianceReport.items.slice().sort((a, b) => a.variance - b.variance);
    const wasteRows = filteredData.waste
      .filter((x) => !wasteSearch.trim() || normalizeText(x.itemName).includes(normalizeText(wasteSearch)))
      .filter((x) => !wasteFilterStart || x.date >= wasteFilterStart)
      .filter((x) => !wasteFilterEnd || x.date <= wasteFilterEnd)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return (
      <div className="page">
        <div className="section-header">
          <div><h1>Variance & Waste</h1><p>Stok teoritis (stok awal + pembelian/barang datang − pemakaian resep − waste + penyesuaian) dibanding stock opname aktual.</p></div>
        </div>
        <DataTable
          columns={["Bahan", "Teoritis", "Aktual", "Selisih", "Nilai Selisih", "Status"]}
          rows={items.map((x) => {
            const ratio = x.theoretical > 0 ? x.actual / x.theoretical : x.actual >= 0 ? 1 : 0;
            const value = computeVarianceValue(x, priceHistory);
            return [
              x.itemName,
              displayQuantity(x.theoretical, x.unit),
              displayQuantity(x.actual, x.unit),
              displayQuantity(x.variance, x.unit),
              value !== null
                ? <span style={{ color: value < 0 ? "#c6392e" : "#1f7a4c", fontWeight: 600 }}>Rp {formatNumber(value)}</span>
                : <span style={{ color: "#999" }}>harga bahan belum ada</span>,
              <div key="h" style={{ minWidth: 90 }}><HealthBar ratio={ratio} /></div>
            ];
          })}
        />

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Catatan Waste</div>
          <FilterBar
            search={wasteSearch}
            onSearchChange={setWasteSearch}
            searchPlaceholder="Cari nama bahan..."
            start={wasteFilterStart}
            onStartChange={setWasteFilterStart}
            end={wasteFilterEnd}
            onEndChange={setWasteFilterEnd}
            summary={`${wasteRows.length} baris`}
          />
          <DataTable
            columns={["Tanggal", "Outlet", "Bahan", "Jumlah", "Satuan", "Alasan", "Aksi"]}
            rows={wasteRows.map((x) => {
              const editing = editingRow?.id === x.id;
              return [
                editing ? fieldInput("date", "date") : formatDateID(x.date),
                editing ? fieldInput("outlet", "select", ["DS", "SS", "SP"]) : x.outlet,
                editing ? fieldInput("itemName", "text") : x.itemName,
                editing ? fieldInput("quantity", "number") : formatNumber(x.quantity),
                editing ? fieldInput("unit", "text") : x.unit,
                editing ? fieldInput("reason", "text") : (x.reason || "-"),
                actionCell(COLLECTIONS.WASTE, x, ["date", "outlet", "itemName", "quantity", "unit", "reason"], ["quantity"])
              ];
            })}
          />
        </div>
      </div>
    );
  }

  function renderHarga() {
    const latestByItem = {};
    priceHistory.forEach((p) => {
      const key = normalizeText(p.itemName);
      if (!latestByItem[key] || p.effectiveDate > latestByItem[key].effectiveDate) latestByItem[key] = p;
    });
    const latestRows = Object.values(latestByItem).sort((a, b) => a.itemName.localeCompare(b.itemName));

    const historyRows = priceHistory
      .filter((x) => !priceSearch.trim() || normalizeText(x.itemName).includes(normalizeText(priceSearch)))
      .filter((x) => !priceFilterStart || x.effectiveDate >= priceFilterStart)
      .filter((x) => !priceFilterEnd || x.effectiveDate <= priceFilterEnd)
      .slice()
      .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));

    return (
      <div className="page">
        <div className="section-header"><div><h1>Harga Bahan</h1><p>Harga terbaru per bahan (riwayat lengkap tersimpan untuk perbandingan biaya resep).</p></div></div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Harga Terbaru</div>
          <DataTable
            columns={["Bahan", "Harga", "Satuan", "Berlaku sejak"]}
            rows={latestRows.map((x) => [x.itemName, `Rp ${formatNumber(x.price)}`, x.unit, formatDateID(x.effectiveDate)])}
          />
        </div>

        <div className="card">
          <div className="card-title">Riwayat Lengkap</div>
          <FilterBar
            search={priceSearch}
            onSearchChange={setPriceSearch}
            searchPlaceholder="Cari nama bahan..."
            start={priceFilterStart}
            onStartChange={setPriceFilterStart}
            end={priceFilterEnd}
            onEndChange={setPriceFilterEnd}
            summary={`${historyRows.length} baris`}
          />
          <DataTable
            columns={["Bahan", "Harga", "Satuan", "Berlaku sejak", "Aksi"]}
            rows={historyRows.map((x) => {
              const editing = editingRow?.id === x.id;
              return [
                editing ? fieldInput("itemName", "text") : x.itemName,
                editing ? fieldInput("price", "number") : `Rp ${formatNumber(x.price)}`,
                editing ? fieldInput("unit", "text") : x.unit,
                editing ? fieldInput("effectiveDate", "date") : formatDateID(x.effectiveDate),
                actionCell("price_history", x, ["itemName", "price", "unit", "effectiveDate"], ["price"])
              ];
            })}
          />
        </div>
      </div>
    );
  }

  function renderResep() {
    const editingRecipe = rawData.recipes.find((r) => r.id === editingRecipeId);

    return (
      <div className="page">
        <div className="section-header"><div><h1>Resep</h1><p>Resep yang sudah tersimpan, lengkap dengan bahan per porsi. Bisa diedit atau dihapus.</p></div></div>

        {editingRecipe && (
          <div className="card">
            <div className="card-title">Edit resep: {editingRecipe.menuName}</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>Nama menu</label>
                <input
                  type="text"
                  value={editMenuName}
                  onChange={(e) => setEditMenuName(e.target.value)}
                  style={{ width: 260, padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>Harga jual / porsi (Rp)</label>
                <input
                  type="number"
                  placeholder="mis. 25000"
                  value={editSellPrice}
                  onChange={(e) => setEditSellPrice(e.target.value)}
                  style={{ width: 160, padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>Bahan</label>
            {editIngredients.map((ing, index) => (
              <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Nama bahan"
                  value={ing.itemName}
                  onChange={(e) => updateEditIngredientField(index, "itemName", e.target.value)}
                  style={{ flex: "1 1 160px", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                />
                <input
                  type="number"
                  placeholder="Jumlah"
                  value={ing.quantity}
                  onChange={(e) => updateEditIngredientField(index, "quantity", e.target.value)}
                  style={{ width: 100, padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                />
                <input
                  type="text"
                  placeholder="Satuan"
                  value={ing.unit}
                  onChange={(e) => updateEditIngredientField(index, "unit", e.target.value)}
                  style={{ width: 100, padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                />
                <button
                  onClick={() => removeEditIngredientRow(index)}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", background: "transparent", color: "#c0392b", cursor: "pointer" }}
                >
                  Hapus
                </button>
              </div>
            ))}
            <button
              onClick={addEditIngredientRow}
              style={{ marginBottom: 12, padding: "6px 12px", borderRadius: 8, border: "1px dashed #aaa", background: "transparent", cursor: "pointer" }}
            >
              + Tambah bahan
            </button>

            {(() => {
              const addedNames = new Set(editIngredients.map((ing) => normalizeText(ing.itemName)));
              const suggestions = estimateMissingIngredients(editingRecipe.menuName, rawData).filter(
                (s) => !addedNames.has(normalizeText(s.itemName))
              );
              if (!suggestions.length) return null;
              return (
                <div style={{ background: "var(--orange-050)", border: "1px solid var(--orange-100)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--orange-600)", marginBottom: 4 }}>
                    Kemungkinan bahan yang belum tercatat
                  </div>
                  <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>
                    Bahan-bahan ini dibeli tapi belum dipakai di resep manapun. Perkiraan jumlah/porsi dihitung dari
                    total pembelian dibagi total penjualan menu ini — <strong>perkiraan kasar</strong>, asumsi seluruh
                    pembelian bahan itu habis untuk menu ini saja. Periksa dan sesuaikan sebelum disimpan.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {suggestions.slice(0, 8).map((s) => (
                      <div key={s.itemName} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13 }}>
                          <strong>{s.itemName}</strong> — sekitar {displayQuantity(s.estimatedQtyPerPortion, s.unit)} / porsi
                        </span>
                        <button
                          onClick={() => addSuggestedIngredient(s)}
                          style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--orange-500)", background: "transparent", color: "var(--orange-600)", cursor: "pointer", fontSize: 12 }}
                        >
                          + Tambahkan
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {editError && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 10 }}>{editError}</div>}

            <div className="form-footer">
              <button className="secondary-button" onClick={cancelEditRecipe} disabled={editBusy}>Batal</button>
              <button className="primary-button" onClick={saveEditRecipe} disabled={editBusy}>
                {editBusy ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            </div>
          </div>
        )}

        <DataTable
          columns={["Nama Menu", "Daftar Bahan", "Harga Jual", "Estimasi HPP", "Margin", "Aksi"]}
          rows={rawData.recipes
            .slice()
            .sort((a, b) => String(a.menuName || "").localeCompare(String(b.menuName || "")))
            .map((r) => {
              const cost = computeRecipeCost(r, priceHistory);
              const sellPrice = Number(r.sellPrice || 0);
              const margin = sellPrice > 0 && cost.complete ? sellPrice - cost.totalCost : null;
              const marginPct = margin !== null && sellPrice > 0 ? (margin / sellPrice) * 100 : null;
              return [
              r.menuName,
              (r.ingredients || [])
                .map((ing) => {
                  const converted = convertToBase(ing.quantity, ing.unit);
                  return `${ing.itemName} ${displayQuantity(converted.value, converted.base)}`;
                })
                .join(", ") || "-",
              sellPrice > 0 ? `Rp ${formatNumber(sellPrice)}` : <span style={{ color: "#999" }}>belum diisi</span>,
              cost.complete ? `Rp ${formatNumber(cost.totalCost)}` : <span style={{ color: "#999" }}>data harga bahan belum lengkap</span>,
              margin !== null
                ? <span style={{ color: margin >= 0 ? "#1f7a4c" : "#c6392e", fontWeight: 600 }}>
                    Rp {formatNumber(margin)} ({formatNumber(marginPct, 0)}%)
                  </span>
                : "-",
              deleteConfirmId === r.id ? (
                <div key="del" style={{ display: "flex", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "#c0392b" }}>Yakin?</span>
                  <button
                    onClick={() => confirmDeleteRecipe(r.id)}
                    disabled={deleteBusy}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#c0392b", color: "#fff", cursor: "pointer" }}
                  >
                    {deleteBusy ? "..." : "Ya, hapus"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "transparent", cursor: "pointer" }}
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <div key="actions" style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => startEditRecipe(r)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "transparent", cursor: "pointer" }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(r.id)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "transparent", color: "#c0392b", cursor: "pointer" }}
                  >
                    Hapus
                  </button>
                </div>
              )
              ];
            })}
          emptyText="Belum ada resep tersimpan."
        />
      </div>
    );
  }

  function renderImport() {
    return (
      <div className="page">
        <div className="section-header"><div><h1>Import Excel / CSV</h1><p>Deteksi otomatis jenis data per sheet: penjualan, pembelian, barang datang, stok awal, stock opname, atau waste.</p></div></div>

        <div className="card">
          <label className="file-drop">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelected} disabled={importBusy} />
            <Icon name="upload" size={22} />
            <span>{importBusy ? "Memproses..." : "Pilih file Excel / CSV"}</span>
          </label>
        </div>

        {importResult && (
          <div className="card">
            <div className="card-title">Hasil deteksi</div>
            <DataTable
              columns={["Sheet", "Jenis terdeteksi", "Baris", "Valid"]}
              rows={importResult.map((s) => [
                s.sheetName,
                s.type === "UNKNOWN" ? <span key="u" className="badge badge-warning">Tidak dikenali</span> : <span key="t" className="badge badge-ok">{s.type}</span>,
                s.rows.length,
                s.valid ? "Ya" : `Tidak (${s.errors.length} error)`
              ])}
            />
            <div className="form-footer">
              <span className="message">Outlet default: DS (bisa diedit manual setelah tersimpan).</span>
              <button className="primary-button" onClick={handleSaveImport} disabled={importBusy}>
                Simpan ke database
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderImportWa() {
    return (
      <div className="page">
        <div className="section-header">
          <div>
            <h1>Import Chat WhatsApp</h1>
            <p>
              Tempel apa adanya rekap belanja dari WhatsApp — boleh berisi banyak tanggal dan banyak outlet
              sekaligus. Semua dicatat sebagai pembelian; kirim "barang datang" terpisah hanya kalau jumlah yang
              diterima berbeda dari yang dicatat di sini.
            </p>
          </div>
        </div>

        <div className="card">
          <textarea
            value={waText}
            onChange={(e) => setWaText(e.target.value)}
            placeholder={"Tempel ekspor chat WhatsApp di sini...\n\nContoh:\n[01/08/26, 14.08.09] Ana Checker:\nDS\n* Bawang merah 5 kg\n* Tempe 20"}
            rows={10}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
          />
          <div className="form-footer">
            <span className="message">
              {waAnalyzing &&
                (waAnalyzeProgress && waAnalyzeProgress.total > 0
                  ? `Sedang memeriksa nama bahan dengan AI... (${waAnalyzeProgress.done}/${waAnalyzeProgress.total} batch selesai)`
                  : "Sedang memeriksa nama bahan dengan AI, mohon tunggu...")}
            </span>
            <button className="primary-button" onClick={handleWaParse} disabled={!waText.trim() || waAnalyzing}>
              {waAnalyzing ? "Menganalisa..." : "Proses Teks"}
            </button>
          </div>
        </div>

        {waResult && (
          <>
            <div className="card">
              <div className="card-title">
                Akan disimpan: {waResult.totalConfident + waResult.reviewItems.length} baris pembelian
                ({waResult.groups.length} kombinasi tanggal/outlet sudah pasti
                {waResult.reviewItems.length > 0 && `, ${waResult.reviewItems.length} pakai tebakan otomatis`})
              </div>
              {waResult.groups.length > 0 && (
                <DataTable
                  columns={["Tanggal", "Outlet", "Jumlah Item"]}
                  rows={waResult.groups.map((g) => [formatDateID(g.date), g.outlet, g.items.length])}
                />
              )}

              {waResult.reviewItems.length > 0 && (
                <div style={{ margin: "12px 0" }}>
                  <button className="secondary-button" onClick={() => setWaShowReview(true)}>
                    ⚠️ Tinjau &amp; Perbaiki ({waResult.reviewItems.length} baris pakai tebakan)
                  </button>
                  <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "8px 0 0" }}>
                    Baris ini tetap akan tersimpan memakai tebakan otomatis (jumlah 1, satuan "unit", atau
                    tanggal/outlet default) kalau tidak Anda perbaiki dulu di sini.
                  </p>
                </div>
              )}

              {waResult.totalConfident + waResult.reviewItems.length > 0 && (
                <div className="form-footer">
                  <span className="message">
                    {waResult.similarityChecks.length > 0 &&
                      `Konfirmasi dulu ${waResult.similarityChecks.filter((c) => !c.choice).length} kemiripan nama bahan di bawah sebelum menyimpan.`}
                  </span>
                  <button
                    className="primary-button"
                    onClick={handleWaSave}
                    disabled={waSaveBusy || waResult.similarityChecks.some((c) => !c.choice)}
                  >
                    {waSaveBusy ? "Menyimpan..." : "Simpan Semua ke Database"}
                  </button>
                </div>
              )}
            </div>

            {waResult.similarityChecks.length > 0 && (
              <div className="similarity-confirm-card">
                <div className="similarity-confirm-title">
                  ⚠️ {waResult.similarityChecks.length} nama bahan mirip dengan yang sudah tercatat
                </div>
                <p className="similarity-confirm-desc">
                  Konfirmasi satu per satu sebelum bisa menyimpan: apakah bahan baru ini sama dengan yang sudah
                  ada, atau memang bahan yang berbeda?
                </p>
                <div className="similarity-confirm-list">
                  {waResult.similarityChecks.map((c, i) => (
                    <div key={i} className="similarity-confirm-item">
                      <div className="similarity-confirm-names">
                        <span className="similarity-confirm-new">"{c.name}"</span>
                        <span className="similarity-confirm-vs">mirip dengan</span>
                        <span className="similarity-confirm-existing">"{c.matchedName}"</span>
                        {c.source === "ai" ? (
                          <span className="similarity-confirm-score similarity-confirm-score-ai">🤖 dinilai AI</span>
                        ) : (
                          <span className="similarity-confirm-score">({Math.round(c.score * 100)}% mirip)</span>
                        )}
                      </div>
                      {c.reason && <p className="similarity-confirm-reason">{c.reason}</p>}
                      <div className="similarity-confirm-choices">
                        <button
                          className={`chip-choice ${c.choice === "merge" ? "active" : ""}`}
                          onClick={() => chooseWaSimilarity(i, "merge")}
                        >
                          Sama, pakai "{c.matchedName}"
                        </button>
                        <button
                          className={`chip-choice ${c.choice === "separate" ? "active" : ""}`}
                          onClick={() => chooseWaSimilarity(i, "separate")}
                        >
                          Bahan berbeda, tetap "{c.name}"
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {waResult.excludedPr.length > 0 && (
              <div className="card">
                <div className="card-title">
                  ℹ️ {waResult.excludedPr.length} baris diabaikan (rencana/PR, bukan realisasi belanja)
                </div>
                <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 12px" }}>
                  Baris di bawah "*PR*" dianggap rencana, bukan belanja yang sudah terjadi — sengaja tidak
                  disimpan. Kalau sebagian sudah benar-benar dibeli, masukkan manual lewat chat AI Assistant.
                </p>
                <DataTable columns={["Baris Asli"]} rows={waResult.excludedPr.map((s) => [s.line])} />
              </div>
            )}
          </>
        )}

        {waShowReview && waResult && (
          <div
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 70,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 16
            }}
            onClick={() => setWaShowReview(false)}
          >
            <div
              className="card"
              style={{ maxWidth: 900, width: "100%", maxHeight: "85vh", overflowY: "auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const groups = groupWaReviewItems(waResult.reviewItems);
                const groupCount = groups.length;
                return (
                  <>
                    <div className="card-title">
                      Tinjau &amp; Perbaiki {waResult.reviewItems.length} Baris
                      {groupCount < waResult.reviewItems.length && ` (${groupCount} nama unik)`}
                    </div>
                    <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 12px" }}>
                      Baris dengan tebakan nama yang sama (mis. muncul di banyak tanggal) dikelompokkan jadi satu --
                      perbaiki nama/jumlah/satuan sekali, otomatis berlaku untuk semua baris dalam grup itu. Buka
                      "Lihat semua tanggal" untuk mengedit tanggal/outlet per baris kalau perlu.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {groups.map((group) => (
                        <div key={group.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
                            {group.indices.length > 1
                              ? `${group.indices.length} baris pakai nama ini`
                              : `Baris asli: "${waResult.reviewItems[group.indices[0]].rawLine}" — ${waResult.reviewItems[group.indices[0]].reason}`}
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {group.indices.length === 1 && (
                              <>
                                <input
                                  type="date"
                                  value={waResult.reviewItems[group.indices[0]].date}
                                  onChange={(e) => updateWaReviewItem(group.indices[0], "date", e.target.value)}
                                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
                                />
                                <select
                                  value={waResult.reviewItems[group.indices[0]].outlet}
                                  onChange={(e) => updateWaReviewItem(group.indices[0], "outlet", e.target.value)}
                                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
                                >
                                  <option value="">(default DS)</option>
                                  {OUTLETS.filter((o) => o.id !== "ALL").map((o) => (
                                    <option key={o.id} value={o.id}>{o.id}</option>
                                  ))}
                                </select>
                              </>
                            )}
                            <input
                              type="text"
                              value={group.itemName}
                              onChange={(e) => updateWaReviewGroupField(group.indices, "itemName", e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", flex: "1 1 160px" }}
                            />
                            <input
                              type="number"
                              value={group.quantity}
                              onChange={(e) => updateWaReviewGroupField(group.indices, "quantity", e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", width: 80 }}
                            />
                            <input
                              type="text"
                              value={group.unit}
                              onChange={(e) => updateWaReviewGroupField(group.indices, "unit", e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", width: 70 }}
                            />
                          </div>
                          {group.indices.length > 1 && (
                            <details style={{ marginTop: 8 }}>
                              <summary style={{ fontSize: 12, color: "var(--ink-soft)", cursor: "pointer" }}>
                                Lihat semua tanggal ({group.indices.length})
                              </summary>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                                {group.indices.map((i) => (
                                  <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                    <input
                                      type="date"
                                      value={waResult.reviewItems[i].date}
                                      onChange={(e) => updateWaReviewItem(i, "date", e.target.value)}
                                      style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
                                    />
                                    <select
                                      value={waResult.reviewItems[i].outlet}
                                      onChange={(e) => updateWaReviewItem(i, "outlet", e.target.value)}
                                      style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
                                    >
                                      <option value="">(default DS)</option>
                                      {OUTLETS.filter((o) => o.id !== "ALL").map((o) => (
                                        <option key={o.id} value={o.id}>{o.id}</option>
                                      ))}
                                    </select>
                                    <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                                      "{waResult.reviewItems[i].rawLine}"
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              <div className="form-footer">
                <button className="secondary-button" onClick={() => setWaShowReview(false)}>Tutup</button>
                <button className="primary-button" onClick={handleWaSave} disabled={waSaveBusy}>
                  {waSaveBusy ? "Menyimpan..." : "Simpan Semua ke Database"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderRiwayat() {
    return (
      <div className="page">
        <div className="section-header">
          <div>
            <h1>Riwayat Aktivitas</h1>
            <p>
              Setiap kali data disimpan lewat chat, Import Excel, atau Import Chat WA, aksinya tercatat di sini
              dan bisa di-undo. Undo menghapus baris yang tersimpan pada aksi itu saja, tidak menyentuh data
              lain. Data yang sudah ada di database sebelum fitur ini aktif tidak tercatat di sini — perbaiki
              lewat halaman masing-masing (Pembelian, Penjualan, dst).
            </p>
          </div>
        </div>

        <div className="card">
          {activityLog.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Icon name="trend" size={26} /></div>
              <div className="empty-title">Belum ada aktivitas tercatat.</div>
            </div>
          ) : (
            <DataTable
              columns={["Waktu", "Aksi", "Ringkasan", "Jumlah Baris", "Status", ""]}
              rows={activityLog.map((a) => [
                new Date(a.createdAt).toLocaleString("id-ID"),
                a.actionType,
                a.summary,
                a.documentIds.length,
                a.undone ? (
                  <span key="s" className="badge badge-warning">Sudah di-undo</span>
                ) : (
                  <span key="s" className="badge badge-ok">Aktif</span>
                ),
                a.undone ? null : (
                  <button
                    key="u"
                    className="secondary-button"
                    onClick={() => undoActivity(a)}
                    disabled={undoBusyId === a.id}
                  >
                    {undoBusyId === a.id ? "Meng-undo..." : "Undo"}
                  </button>
                )
              ])}
            />
          )}
        </div>
      </div>
    );
  }

  async function handleDownloadReport() {
    if (reportStart && reportEnd && reportStart > reportEnd) {
      showToast("Tanggal mulai tidak boleh lebih besar dari tanggal akhir.");
      return;
    }
    setReportBusy(true);
    try {
      const workbook = buildReportWorkbook({
        rawData: filterDataByOutlet(rawData, reportOutlet),
        startDate: reportStart,
        endDate: reportEnd,
        outlet: reportOutlet,
        dataQualityIssues,
        purchaseSuggestions,
        recipes: rawData.recipes,
        generatedAt: new Date().toLocaleString("id-ID")
      });
      const filename = `Laporan_DolanSawahAI_${reportOutlet}_${reportStart || "awal"}_sampai_${reportEnd || "sekarang"}.xlsx`;
      downloadReportWorkbook(workbook, filename);
      showToast("Laporan Excel berhasil diunduh.", "success");
    } catch (error) {
      console.error("Gagal membuat laporan Excel:", error);
      showToast(`Gagal membuat laporan Excel: ${error.message}`);
    } finally {
      setReportBusy(false);
    }
  }

  function renderLaporan() {
    const prompts = [
      "Apa saja yang perlu dibeli besok?",
      "Item mana yang variance-nya paling besar minggu ini?",
      "Menu apa yang paling laku 7 hari terakhir?",
      "Apakah ada selisih antara barang datang dan pesanan?",
      "Buatkan ringkasan performa hari ini untuk semua outlet."
    ];

    function setPresetRange(days) {
      const today = getTodayISO();
      setReportEnd(today);
      const cursor = new Date(`${today}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() - (days - 1));
      setReportStart(cursor.toISOString().slice(0, 10));
    }

    return (
      <div className="page">
        <div className="section-header"><div><h1>Laporan AI</h1><p>Tanyakan apa saja berdasarkan data yang sudah tersimpan.</p></div></div>

        <div className="card">
          <div className="card-title">Unduh Laporan Excel</div>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 14px" }}>
            Laporan lengkap (ringkasan, variance & waste, indikator masalah data, saran pembelian, performa
            harian per tanggal, detail penjualan per hari per menu dalam bentuk matriks, dan detail seluruh
            transaksi per tanggal — bukan total) untuk rentang tanggal pilihan Anda — siap diunduh atau
            dikirim ke AI untuk dianalisa ulang.
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="outlet-switch small">
              {OUTLETS.map((o) => (
                <button
                  key={o.id}
                  className={`outlet-chip ${reportOutlet === o.id ? "active" : ""}`}
                  onClick={() => setReportOutlet(o.id)}
                >
                  {o.id === "ALL" ? "Semua" : o.id}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Dari</span>
            <input
              type="date"
              value={reportStart}
              max={reportEnd || undefined}
              onChange={(e) => setReportStart(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>s/d</span>
            <input
              type="date"
              value={reportEnd}
              min={reportStart || undefined}
              onChange={(e) => setReportEnd(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            <button className="prompt-chip" onClick={() => setPresetRange(7)}>7 hari</button>
            <button className="prompt-chip" onClick={() => setPresetRange(30)}>30 hari</button>
            <button className="prompt-chip" onClick={() => setPresetRange(90)}>90 hari</button>
          </div>

          <button
            onClick={handleDownloadReport}
            disabled={reportBusy}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "var(--green-600)",
              color: "#fff",
              fontWeight: 600,
              cursor: reportBusy ? "default" : "pointer",
              opacity: reportBusy ? 0.7 : 1
            }}
          >
            {reportBusy ? "Menyiapkan laporan..." : "⬇ Unduh Laporan Excel"}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Pertanyaan cepat</div>
          <div className="prompt-list">
            {prompts.map((p) => (
              <button key={p} className="prompt-chip" onClick={() => { setActiveMenu("chat"); setInput(p); }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderContent() {
    switch (activeMenu) {
      case "dashboard": return renderDashboard();
      case "stok-awal": return renderStokAwal();
      case "pembelian": return renderPembelian();
      case "barang-datang": return renderBarangDatang();
      case "penjualan": return renderPenjualan();
      case "stok": return renderStok();
      case "kebutuhan": return renderKebutuhan();
      case "variance": return renderVariance();
      case "harga": return renderHarga();
      case "resep": return renderResep();
      case "import": return renderImport();
      case "import-wa": return renderImportWa();
      case "riwayat": return renderRiwayat();
      case "laporan": return renderLaporan();
      default: return null;
    }
  }

  /* =======================================================
     RENDER UTAMA
     ======================================================= */

  if (!authChecked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#666" }}>
        <div className="ds-spinner" />
        Memuat...
      </div>
    );
  }

  if (!authUser) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", background: "#f5f5f0" }}>
        <form
          onSubmit={handleLogin}
          style={{ background: "#fff", padding: 32, borderRadius: 12, width: 320, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
        >
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Dolan Sawah AI</div>
          <div style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>Masuk untuk melanjutkan</div>
          <input
            type="email"
            placeholder="Email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            required
            style={{ width: "100%", padding: "10px 12px", marginBottom: 10, borderRadius: 8, border: "1px solid #ddd", boxSizing: "border-box" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            required
            style={{ width: "100%", padding: "10px 12px", marginBottom: 10, borderRadius: 8, border: "1px solid #ddd", boxSizing: "border-box" }}
          />
          {loginError && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 10 }}>{loginError}</div>}
          <button
            type="submit"
            disabled={loginBusy}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {loginBusy && <div className="ds-spinner ds-spinner-light" />}
            {loginBusy ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </div>
    );
  }

  if (dataLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#666" }}>
        <div className="ds-spinner" />
        Memuat data dari Firestore...
      </div>
    );
  }

  if (dataLoadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#666", textAlign: "center", padding: 24 }}>
        <div style={{ color: "#c0392b", fontWeight: 600 }}>Gagal memuat data dari Firestore</div>
        <div style={{ fontSize: 13, maxWidth: 400 }}>{dataLoadError}</div>
        <button
          onClick={loadInitialData}
          style={{ marginTop: 8, padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert">
          <span className="toast-icon">{toast.type === "error" ? "⚠️" : "✓"}</span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)} aria-label="Tutup notifikasi">✕</button>
        </div>
      )}

      {saveProgress && (
        <div className="save-progress-toast" role="status">
          <div className="save-progress-label">
            Menyimpan... {Math.round((saveProgress.done / saveProgress.total) * 100)}%
            ({formatNumber(saveProgress.done)}/{formatNumber(saveProgress.total)})
          </div>
          <div className="save-progress-track">
            <div
              className="save-progress-fill"
              style={{ width: `${Math.round((saveProgress.done / saveProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {mobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-logo">DS</div>
          <div>
            <div className="brand-title">Dolan Sawah AI</div>
            <div className="brand-subtitle">Business Intelligence</div>
          </div>
          <button
            className="sidebar-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Tutup menu"
          >
            ✕
          </button>
        </div>

        <nav className="menu-container">
          {MENU.map((item, i) => {
            if (item.section) return <div key={`s-${i}`} className="menu-title">{item.section}</div>;
            const active = activeMenu === item.id;
            return (
              <button
                key={item.id}
                className={`menu-item ${active ? "active" : ""}`}
                onClick={() => {
                  setActiveMenu(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <span className="menu-icon"><Icon name={item.icon} /></span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection">
            <span className={`online-dot ${systemOnline ? "" : "offline"}`} />
            {systemOnline ? "Firebase Connected" : "Connecting..."}
          </div>
          <div className="powered">by Nuvora Systems</div>
          <button
            onClick={() => signOut(auth)}
            style={{ marginTop: 8, width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", background: "transparent", color: "#888", fontSize: 12, cursor: "pointer" }}
          >
            Keluar ({authUser.email})
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="hamburger-btn"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Buka menu"
          >
            <span />
            <span />
            <span />
          </button>

          <div>
            <div className="page-title">AI Business Assistant</div>
            <div className="page-description">Dolan Sawah Group — 3 outlet</div>
          </div>

          <div className="topbar-right">
            <div className="outlet-switch">
              {OUTLETS.map((o) => (
                <button
                  key={o.id}
                  className={`outlet-chip ${activeOutlet === o.id ? "active" : ""}`}
                  onClick={() => setActiveOutlet(o.id)}
                >
                  {o.id === "ALL" ? "Semua" : o.id}
                </button>
              ))}
            </div>
            <div className={`status ${systemOnline ? "status-ok" : "status-warn"}`}>
              <span className="status-dot" />
              {systemOnline ? "Online" : "Connecting"}
            </div>
          </div>
        </header>

        {dataQualityIssues.length > 0 && (
          <div className="data-quality-banner">
            <div
              className="data-quality-banner-header"
              onClick={() => setQualityBannerExpanded((v) => !v)}
            >
              <span className="data-quality-banner-icon">⚠️</span>
              <span className="data-quality-banner-title">
                {dataQualityIssues.length} potensi masalah data ditemukan
              </span>
              <span className="data-quality-banner-toggle">
                {qualityBannerExpanded ? "Sembunyikan ▲" : "Lihat detail ▼"}
              </span>
            </div>
            {qualityBannerExpanded && (
              <ul className="data-quality-banner-list">
                {dataQualityIssues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeMenu === "chat" ? (
          <section className="chat-page">
            <div className="chat-context-bar">
              <span>Outlet untuk entri data baru:</span>
              <div className="outlet-switch small">
                {OUTLETS.filter((o) => o.id !== "ALL").map((o) => (
                  <button
                    key={o.id}
                    className={`outlet-chip ${chatOutlet === o.id ? "active" : ""}`}
                    onClick={() => setChatOutlet(o.id)}
                  >
                    {o.id}
                  </button>
                ))}
              </div>
              <span className="chat-context-hint">Anda tetap bisa menyebut outlet lain langsung di dalam pesan.</span>
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", background: historyOpen ? "#2e7d32" : "transparent", color: historyOpen ? "#fff" : "#333", cursor: "pointer", fontSize: 13 }}
              >
                Riwayat Chat
              </button>
            </div>

            {historyOpen && (
              <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14, margin: "0 0 12px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "#666" }}>Cari chat tanggal:</span>
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(e) => setHistoryDate(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
                  />
                  <button
                    onClick={searchChatHistory}
                    disabled={!historyDate || historyLoading}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2e7d32", color: "#fff", cursor: "pointer" }}
                  >
                    {historyLoading ? "Mencari..." : "Cari"}
                  </button>
                  <button
                    onClick={closeHistory}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "transparent", cursor: "pointer" }}
                  >
                    Tutup
                  </button>
                </div>

                {historyError && <div style={{ color: "#c0392b", fontSize: 13, marginTop: 10 }}>{historyError}</div>}

                {historyMessages !== null && (
                  <div style={{ marginTop: 12, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {historyMessages.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#888" }}>Tidak ada riwayat chat di tanggal ini.</div>
                    ) : (
                      historyMessages.map((m) => <ChatMessage key={m.id} message={m} />)
                    )}
                  </div>
                )}
              </div>
            )}

            <div ref={chatRef} className="chat-messages">
              {messages.length === 1 && (
                <div className="hero">
                  <div className="hero-logo">DS</div>
                  <h2>Apa yang ingin Anda catat hari ini?</h2>
                  <p>Ketik data dalam bahasa biasa — saya yang mengatur ke database dan menghitung analisanya.</p>
                </div>
              )}

              {messages.map((m) => <ChatMessage key={m.id} message={m} />)}

              {loading && (
                <div className="chat-typing">
                  <div className="chat-avatar small">DS</div>
                  <div className="typing">Dolan Sawah AI sedang memproses...</div>
                </div>
              )}
              <div style={{ height: 12 }} />
            </div>

            {pendingSimilarity && (
              <div className="similarity-confirm-card">
                <div className="similarity-confirm-title">
                  ⚠️ {pendingSimilarity.checks.length} nama bahan mirip dengan yang sudah tercatat
                </div>
                <p className="similarity-confirm-desc">
                  Konfirmasi satu per satu: apakah bahan baru ini sama dengan yang sudah ada, atau memang bahan
                  yang berbeda? Belum ada yang tersimpan sampai semua dikonfirmasi.
                </p>
                <div className="similarity-confirm-list">
                  {pendingSimilarity.checks.map((c, i) => (
                    <div key={i} className="similarity-confirm-item">
                      <div className="similarity-confirm-names">
                        <span className="similarity-confirm-new">"{c.name}"</span>
                        <span className="similarity-confirm-vs">mirip dengan</span>
                        <span className="similarity-confirm-existing">"{c.matchedName}"</span>
                        {c.source === "ai" ? (
                          <span className="similarity-confirm-score similarity-confirm-score-ai">🤖 dinilai AI</span>
                        ) : (
                          <span className="similarity-confirm-score">({Math.round(c.score * 100)}% mirip)</span>
                        )}
                      </div>
                      {c.reason && <p className="similarity-confirm-reason">{c.reason}</p>}
                      <div className="similarity-confirm-choices">
                        <button
                          className={`chip-choice ${c.choice === "merge" ? "active" : ""}`}
                          onClick={() => choosePendingSimilarity(i, "merge")}
                        >
                          Sama, pakai "{c.matchedName}"
                        </button>
                        <button
                          className={`chip-choice ${c.choice === "separate" ? "active" : ""}`}
                          onClick={() => choosePendingSimilarity(i, "separate")}
                        >
                          Bahan berbeda, tetap "{c.name}"
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="similarity-confirm-footer">
                  <button className="secondary-button" onClick={cancelPendingSimilarity}>Batalkan Semua</button>
                  <button
                    className="primary-button"
                    onClick={confirmPendingSimilarity}
                    disabled={pendingSimilarity.checks.some((c) => !c.choice)}
                  >
                    Lanjutkan & Simpan
                  </button>
                </div>
              </div>
            )}

            <div className="quick-actions">
              <button onClick={() => quickAction(`Stok awal hari ini ${chatOutlet}\nAyam 35 kg\nBeras 50 kg`)}>Stok Awal</button>
              <button onClick={() => quickAction(`Pembelian hari ini ${chatOutlet}\nAyam 20 kg\nBeras 25 kg`)}>Pembelian</button>
              <button onClick={() => quickAction(`Barang datang hari ini ${chatOutlet}\nAyam 20 kg`)}>Barang Datang</button>
              <button onClick={() => quickAction(`Penjualan hari ini ${chatOutlet}\nAyam Bakar 45 porsi\nAyam Geprek 32 porsi`)}>Penjualan</button>
              <button onClick={() => quickAction(`Stock opname hari ini ${chatOutlet}\nAyam 28 kg`)}>Stock Opname</button>
              <button onClick={() => quickAction("Apa saja yang perlu dibeli besok?")}>Kebutuhan Besok</button>
            </div>

            <div className="input-area">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ketik data atau pertanyaan Anda..."
                rows={2}
              />
              <button className="send-button" onClick={handleSend} disabled={loading || !input.trim()}>
                <Icon name="chat" size={18} />
              </button>
            </div>
            <div className="input-hint">Enter untuk mengirim • Shift + Enter untuk baris baru</div>
          </section>
        ) : (
          <div className="content-area">{renderContent()}</div>
        )}
      </main>

      <nav className="mobile-nav">
        {MENU.filter((m) => MOBILE_NAV.includes(m.id)).map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-item ${activeMenu === item.id ? "active" : ""}`}
            onClick={() => setActiveMenu(item.id)}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}