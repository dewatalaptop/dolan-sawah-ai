// ============================================================
// DOLAN SAWAH AI
// REPORT ENGINE -- export laporan lengkap ke Excel
// ============================================================

import * as XLSX from "xlsx";

import { calculateTheoreticalStock } from "./inventoryEngine";

// ============================================================
// FILTER DATA BY DATE RANGE
// ============================================================

export function filterDataByDateRange(data, startDate, endDate) {
  const inRange = (date) => {
    const d = String(date || "");
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };
  const byDate = (row) => inRange(row.date);

  return {
    ...data,
    openingStock: data.openingStock.filter(byDate),
    purchases: data.purchases.filter(byDate),
    receiving: data.receiving.filter(byDate),
    sales: data.sales.filter(byDate),
    stockOpname: data.stockOpname.filter(byDate),
    waste: data.waste.filter(byDate),
    adjustments: data.adjustments.filter(byDate)
  };
}

// ============================================================
// HELPERS
// ============================================================

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function autoWidth(rows) {
  if (!rows.length) return undefined;
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.map((r) => String(r[key] ?? "").length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 42) };
  });
}

function sheetFromRows(rows) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const width = autoWidth(rows);
  if (width) sheet["!cols"] = width;
  return sheet;
}

function varianceStatus(item) {
  if (item.actual === null || item.actual === undefined) return "BELUM DI-OPNAME";
  const v = Number(item.variance || 0);
  if (v < -0.0001) return "KRITIS - STOK KURANG";
  if (v > 0.0001) return "PERLU DICEK - STOK LEBIH";
  return "SESUAI";
}

// ============================================================
// BUILD REPORT WORKBOOK
// ============================================================

export function buildReportWorkbook({
  rawData,
  startDate,
  endDate,
  outlet,
  dataQualityIssues,
  purchaseSuggestions,
  generatedAt
}) {
  const periodData = filterDataByDateRange(rawData, startDate, endDate);
  const theoreticalStock = calculateTheoreticalStock(periodData);

  const workbook = XLSX.utils.book_new();

  // ----------------------------------------------------------
  // SHEET 1: RINGKASAN
  // ----------------------------------------------------------

  const totalSalesQty = periodData.sales.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const totalPurchaseValue = periodData.purchases.reduce((s, r) => s + Number(r.total || 0), 0);
  const criticalItems = theoreticalStock
    .filter((i) => i.actual !== null && Number(i.variance || 0) < -0.0001)
    .sort((a, b) => a.variance - b.variance);

  const summaryRows = [
    ["LAPORAN BISNIS -- DOLAN SAWAH AI"],
    [],
    ["Outlet", outlet === "ALL" ? "Semua outlet" : outlet],
    ["Periode", `${startDate || "(awal)"} s/d ${endDate || "(sekarang)"}`],
    ["Dibuat pada", generatedAt],
    [],
    ["RINGKASAN PERIODE"],
    ["Total penjualan (porsi)", round2(totalSalesQty)],
    ["Total nilai pembelian (Rp)", round2(totalPurchaseValue)],
    ["Jumlah transaksi penjualan", periodData.sales.length],
    ["Jumlah transaksi pembelian", periodData.purchases.length],
    ["Jumlah laporan barang datang", periodData.receiving.length],
    ["Jumlah stock opname", periodData.stockOpname.length],
    ["Item dengan variance kritis (stok kurang)", criticalItems.length],
    ["Total indikator masalah data", dataQualityIssues.length],
    []
  ];

  if (criticalItems.length) {
    summaryRows.push(["TOP VARIANCE KRITIS (STOK KURANG TERBESAR)"]);
    summaryRows.push(["Bahan", "Unit", "Saldo Teoritis", "Stok Aktual", "Selisih"]);
    criticalItems.slice(0, 15).forEach((item) => {
      summaryRows.push([
        item.itemName,
        item.unit,
        round2(item.theoretical),
        round2(item.actual),
        round2(item.variance)
      ]);
    });
    summaryRows.push([]);
  }

  if (dataQualityIssues.length) {
    summaryRows.push(["INDIKATOR HAL PENTING YANG PERLU DIPERBAIKI"]);
    dataQualityIssues.forEach((issue) => summaryRows.push([issue.message]));
  }

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 46 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Ringkasan");

  // ----------------------------------------------------------
  // SHEET 2: VARIANCE & WASTE
  // ----------------------------------------------------------

  const varianceRows = theoreticalStock
    .slice()
    .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))
    .map((item) => ({
      Bahan: item.itemName,
      Unit: item.unit,
      "Stok Awal/Baseline": round2(item.opening),
      "Pembelian/Barang Datang": round2(item.receiving),
      Pemakaian: round2(item.usage),
      Waste: round2(item.waste),
      Penyesuaian: round2(item.adjustment),
      "Saldo Teoritis": round2(item.theoretical),
      "Stok Aktual (Opname)": item.actual === null ? "" : round2(item.actual),
      Selisih: item.variance === null ? "" : round2(item.variance),
      Status: varianceStatus(item)
    }));
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(varianceRows), "Variance & Waste");

  // ----------------------------------------------------------
  // SHEET 3: INDIKATOR MASALAH DATA
  // ----------------------------------------------------------

  const issueRows = dataQualityIssues.map((issue) => ({
    Kategori: issue.type,
    "Indikator / Masalah": issue.message
  }));
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(issueRows.length ? issueRows : [{ Kategori: "-", "Indikator / Masalah": "Tidak ada masalah data ditemukan." }]),
    "Indikator Masalah"
  );

  // ----------------------------------------------------------
  // SHEET 4: SARAN PEMBELIAN
  // ----------------------------------------------------------

  const suggestionRows = (purchaseSuggestions || []).map((x) => ({
    Bahan: x.itemName,
    Unit: x.base,
    "Kebutuhan/Hari": round2(x.dailyNeed),
    "Stok Tersedia": round2(x.currentStock),
    "Sumber Stok": x.sourceIsOpname ? "Stock Opname" : "Saldo Teoritis",
    "Saran Beli": round2(x.suggestedPurchase)
  }));
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(
      suggestionRows.length
        ? suggestionRows
        : [{ Bahan: "-", Unit: "", "Kebutuhan/Hari": "", "Stok Tersedia": "", "Sumber Stok": "", "Saran Beli": "" }]
    ),
    "Saran Pembelian"
  );

  // ----------------------------------------------------------
  // SHEET 5: PENJUALAN
  // ----------------------------------------------------------

  const salesRows = periodData.sales
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      Tanggal: r.date,
      Outlet: r.outlet,
      Menu: r.menuName,
      Qty: round2(r.quantity)
    }));
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(salesRows.length ? salesRows : [{ Tanggal: "-", Outlet: "", Menu: "Tidak ada data di periode ini", Qty: "" }]), "Penjualan");

  // ----------------------------------------------------------
  // SHEET 6: PEMBELIAN
  // ----------------------------------------------------------

  const purchaseRows = periodData.purchases
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      Tanggal: r.date,
      Outlet: r.outlet,
      Supplier: r.supplier,
      Bahan: r.itemName,
      Qty: round2(r.quantity),
      Unit: r.unit,
      Harga: round2(r.price),
      Total: round2(r.total)
    }));
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(purchaseRows.length ? purchaseRows : [{ Tanggal: "-", Outlet: "", Supplier: "", Bahan: "Tidak ada data di periode ini", Qty: "", Unit: "", Harga: "", Total: "" }]), "Pembelian");

  // ----------------------------------------------------------
  // SHEET 7: BARANG DATANG
  // ----------------------------------------------------------

  const receivingRows = periodData.receiving
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      Tanggal: r.date,
      Outlet: r.outlet,
      Supplier: r.supplier,
      Bahan: r.itemName,
      Dipesan: round2(r.orderedQuantity),
      Diterima: round2(r.receivedQuantity),
      Unit: r.unit,
      Selisih: round2(r.difference)
    }));
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(receivingRows.length ? receivingRows : [{ Tanggal: "-", Outlet: "", Supplier: "", Bahan: "Tidak ada data di periode ini", Dipesan: "", Diterima: "", Unit: "", Selisih: "" }]), "Barang Datang");

  // ----------------------------------------------------------
  // SHEET 8: STOCK OPNAME
  // ----------------------------------------------------------

  const opnameRows = periodData.stockOpname
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      Tanggal: r.date,
      Outlet: r.outlet,
      Bahan: r.itemName,
      "Stok Aktual": round2(r.actualQuantity),
      Unit: r.unit
    }));
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(opnameRows.length ? opnameRows : [{ Tanggal: "-", Outlet: "", Bahan: "Tidak ada data di periode ini", "Stok Aktual": "", Unit: "" }]), "Stock Opname");

  // ----------------------------------------------------------
  // SHEET 9: WASTE
  // ----------------------------------------------------------

  const wasteRows = periodData.waste
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      Tanggal: r.date,
      Outlet: r.outlet,
      Bahan: r.itemName,
      Qty: round2(r.quantity),
      Unit: r.unit,
      Alasan: r.reason
    }));
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(wasteRows.length ? wasteRows : [{ Tanggal: "-", Outlet: "", Bahan: "Tidak ada data di periode ini", Qty: "", Unit: "", Alasan: "" }]), "Waste");

  return workbook;
}

// ============================================================
// DOWNLOAD
// ============================================================

export function downloadReportWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename);
}
