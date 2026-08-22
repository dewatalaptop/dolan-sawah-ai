// ============================================================
// DOLAN SAWAH AI
// EXCEL / CSV IMPORT ENGINE
// ============================================================

import * as XLSX from "xlsx";

import {
  createOpeningStock,
  createPurchase,
  createReceiving,
  createSale,
  createStockOpname,
  createWaste
} from "./dataModel";

// ============================================================
// READ FILE
// ============================================================

export async function readExcelFile(file) {
  if (!file) {
    throw new Error(
      "File belum dipilih."
    );
  }

  const arrayBuffer =
    await file.arrayBuffer();

  const workbook =
    XLSX.read(
      arrayBuffer,
      {
        type: "array",
        cellDates: true
      }
    );

  const sheets =
    workbook.SheetNames;

  if (!sheets.length) {
    throw new Error(
      "File tidak memiliki sheet."
    );
  }

  const result = {};

  for (const sheetName of sheets) {
    const worksheet =
      workbook.Sheets[
        sheetName
      ];

    result[sheetName] =
      XLSX.utils.sheet_to_json(
        worksheet,
        {
          defval: ""
        }
      );
  }

  return {
    sheets,
    data: result
  };
}

// ============================================================
// NORMALIZE HEADER
// ============================================================

export function normalizeHeader(
  header
) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(
      /[_-]+/g,
      " "
    );
}

// ============================================================
// NORMALIZE ROW
// ============================================================

export function normalizeRow(row) {
  const normalized = {};

  Object.entries(row).forEach(
    ([key, value]) => {
      normalized[
        normalizeHeader(key)
      ] = value;
    }
  );

  return normalized;
}

// ============================================================
// FIND VALUE BY ALIASES
// ============================================================

function getValue(
  row,
  aliases
) {
  for (const alias of aliases) {
    const key =
      normalizeHeader(alias);

    if (
      Object.prototype.hasOwnProperty.call(
        row,
        key
      )
    ) {
      return row[key];
    }
  }

  return "";
}

// ============================================================
// PARSE NUMBER
// ============================================================

export function parseNumber(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (
    typeof value ===
    "number"
  ) {
    return Number.isFinite(value) ? value : 0;
  }

  let text =
    String(value)
      .trim()
      .replace(/\s/g, "");

  // Rp 25.000
  text =
    text.replace(
      /rp/gi,
      ""
    );

  // Format Indonesia:
  // 25.000,50
  if (
    text.includes(".") &&
    text.includes(",")
  ) {
    text =
      text
        .replace(
          /\./g,
          ""
        )
        .replace(
          ",",
          "."
        );
  } else if (
    text.includes(".")
  ) {
    // 25.000
    const parts =
      text.split(".");

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {
      text =
        parts.join("");
    }
  } else if (
    text.includes(",")
  ) {
    text =
      text.replace(
        ",",
        "."
      );
  }

  const number =
    Number(text);

  return Number.isFinite(
    number
  )
    ? number
    : 0;
}

// ============================================================
// DATE NORMALIZATION
// ============================================================

export function normalizeDate(
  value
) {
  if (!value) {
    return "";
  }

  if (
    value instanceof Date &&
    !isNaN(value)
  ) {
    return value
      .toISOString()
      .slice(0, 10);
  }

  if (
    typeof value ===
    "number"
  ) {
    const date =
      XLSX.SSF.parse_date_code(
        value
      );

    if (date) {
      const month =
        String(
          date.m
        ).padStart(2, "0");

      const day =
        String(
          date.d
        ).padStart(2, "0");

      return `${date.y}-${month}-${day}`;
    }
  }

  const text =
    String(value)
      .trim();

  // YYYY-MM-DD
  if (
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(
      text
    )
  ) {
    const parts =
      text.split("-");

    return `${parts[0]}-${String(
      parts[1]
    ).padStart(2, "0")}-${String(
      parts[2]
    ).padStart(2, "0")}`;
  }

  // DD/MM/YYYY
  const slash =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

  if (slash) {
    return `${slash[3]}-${String(
      slash[2]
    ).padStart(2, "0")}-${String(
      slash[1]
    ).padStart(2, "0")}`;
  }

  // DD-MM-YYYY
  const dash =
    text.match(
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/
    );

  if (dash) {
    return `${dash[3]}-${String(
      dash[2]
    ).padStart(2, "0")}-${String(
      dash[1]
    ).padStart(2, "0")}`;
  }

  return text;
}

// ============================================================
// DETECT DATA TYPE
// ============================================================

export function detectDataType(
  rows
) {
  if (
    !rows ||
    rows.length === 0
  ) {
    return {
      type: "UNKNOWN",
      confidence: 0
    };
  }

  const headers =
    Object.keys(
      normalizeRow(rows[0])
    );

  const headerText =
    headers.join(" ");

  // PENJUALAN
  if (
    (
      headerText.includes(
        "menu"
      ) ||
      headerText.includes(
        "produk"
      )
    ) &&
    (
      headerText.includes(
        "qty"
      ) ||
      headerText.includes(
        "jumlah"
      ) ||
      headerText.includes(
        "terjual"
      )
    )
  ) {
    return {
      type: "SALES",
      confidence: 0.95
    };
  }

  // STOCK OPNAME
  if (
    headerText.includes(
      "opname"
    ) ||
    headerText.includes(
      "stok aktual"
    ) ||
    headerText.includes(
      "stock aktual"
    )
  ) {
    return {
      type: "STOCK_OPNAME",
      confidence: 0.95
    };
  }

  // PEMBELIAN
  if (
    (
      headerText.includes(
        "supplier"
      ) ||
      headerText.includes(
        "vendor"
      )
    ) &&
    (
      headerText.includes(
        "harga"
      ) ||
      headerText.includes(
        "price"
      )
    )
  ) {
    return {
      type: "PURCHASE",
      confidence: 0.90
    };
  }

  // STOK AWAL
  if (
    headerText.includes(
      "stok awal"
    ) ||
    headerText.includes(
      "stock awal"
    )
  ) {
    return {
      type: "OPENING_STOCK",
      confidence: 0.95
    };
  }

  // RECEIVING
  if (
    (
      headerText.includes(
        "diterima"
      ) ||
      headerText.includes(
        "received"
      )
    ) &&
    (
      headerText.includes(
        "dipesan"
      ) ||
      headerText.includes(
        "ordered"
      )
    )
  ) {
    return {
      type: "RECEIVING",
      confidence: 0.95
    };
  }

  // WASTE
  if (
    headerText.includes(
      "waste"
    ) ||
    headerText.includes(
      "rusak"
    ) ||
    headerText.includes(
      "terbuang"
    )
  ) {
    return {
      type: "WASTE",
      confidence: 0.90
    };
  }

  return {
    type: "UNKNOWN",
    confidence: 0
  };
}

// ============================================================
// CONVERT SALES
// ============================================================

export function convertSales(
  rows
) {
  return rows.map(
    (original) => {
      const row =
        normalizeRow(
          original
        );

      return createSale({
        date:
          normalizeDate(
            getValue(
              row,
              [
                "tanggal",
                "date"
              ]
            )
          ),

        menuName:
          getValue(
            row,
            [
              "menu",
              "nama menu",
              "produk",
              "product"
            ]
          ),

        quantity:
          parseNumber(
            getValue(
              row,
              [
                "qty",
                "quantity",
                "jumlah",
                "terjual"
              ]
            )
          ),

        outlet:
          getValue(
            row,
            [
              "outlet",
              "cabang"
            ]
          ) ||
          "Dolan Sawah",

        source:
          "EXCEL"
      });
    }
  );
}

// ============================================================
// CONVERT PURCHASES
// ============================================================

export function convertPurchases(
  rows
) {
  return rows.map(
    (original) => {
      const row =
        normalizeRow(
          original
        );

      const quantity =
        parseNumber(
          getValue(
            row,
            [
              "qty",
              "quantity",
              "jumlah"
            ]
          )
        );

      const price =
        parseNumber(
          getValue(
            row,
            [
              "harga",
              "price",
              "harga satuan"
            ]
          )
        );

      const total =
        parseNumber(
          getValue(
            row,
            [
              "total",
              "total harga",
              "nilai"
            ]
          )
        ) ||
        quantity * price;

      return createPurchase({
        date:
          normalizeDate(
            getValue(
              row,
              [
                "tanggal",
                "date"
              ]
            )
          ),

        supplier:
          getValue(
            row,
            [
              "supplier",
              "vendor",
              "pemasok"
            ]
          ),

        itemName:
          getValue(
            row,
            [
              "barang",
              "nama barang",
              "item",
              "bahan"
            ]
          ),

        quantity,

        unit:
          getValue(
            row,
            [
              "satuan",
              "unit"
            ]
          ),

        price,

        total,

        outlet:
          getValue(
            row,
            [
              "outlet",
              "cabang"
            ]
          ) ||
          "Dolan Sawah"
      });
    }
  );
}

// ============================================================
// CONVERT RECEIVING
// ============================================================

export function convertReceiving(
  rows
) {
  return rows.map(
    (original) => {
      const row =
        normalizeRow(
          original
        );

      const ordered =
        parseNumber(
          getValue(
            row,
            [
              "dipesan",
              "ordered",
              "qty pesanan"
            ]
          )
        );

      const received =
        parseNumber(
          getValue(
            row,
            [
              "diterima",
              "received",
              "qty diterima"
            ]
          )
        );

      return createReceiving({
        date:
          normalizeDate(
            getValue(
              row,
              [
                "tanggal",
                "date"
              ]
            )
          ),

        supplier:
          getValue(
            row,
            [
              "supplier",
              "vendor"
            ]
          ),

        itemName:
          getValue(
            row,
            [
              "barang",
              "nama barang",
              "item",
              "bahan"
            ]
          ),

        orderedQuantity:
          ordered,

        receivedQuantity:
          received,

        unit:
          getValue(
            row,
            [
              "satuan",
              "unit"
            ]
          ),

        outlet:
          getValue(
            row,
            [
              "outlet",
              "cabang"
            ]
          ) ||
          "Dolan Sawah"
      });
    }
  );
}

// ============================================================
// CONVERT OPENING STOCK
// ============================================================

export function convertOpeningStock(
  rows
) {
  return rows.map(
    (original) => {
      const row =
        normalizeRow(
          original
        );

      return createOpeningStock({
        date:
          normalizeDate(
            getValue(
              row,
              [
                "tanggal",
                "date"
              ]
            )
          ),

        itemName:
          getValue(
            row,
            [
              "barang",
              "nama barang",
              "item",
              "bahan"
            ]
          ),

        quantity:
          parseNumber(
            getValue(
              row,
              [
                "stok awal",
                "stock awal",
                "qty",
                "jumlah"
              ]
            )
          ),

        unit:
          getValue(
            row,
            [
              "satuan",
              "unit"
            ]
          ),

        value:
          parseNumber(
            getValue(
              row,
              [
                "nilai",
                "value",
                "total"
              ]
            )
          ),

        outlet:
          getValue(
            row,
            [
              "outlet",
              "cabang"
            ]
          ) ||
          "Dolan Sawah"
      });
    }
  );
}

// ============================================================
// CONVERT STOCK OPNAME
// ============================================================

export function convertStockOpname(
  rows
) {
  return rows.map(
    (original) => {
      const row =
        normalizeRow(
          original
        );

      return createStockOpname({
        date:
          normalizeDate(
            getValue(
              row,
              [
                "tanggal",
                "date"
              ]
            )
          ),

        itemName:
          getValue(
            row,
            [
              "barang",
              "nama barang",
              "item",
              "bahan"
            ]
          ),

        actualQuantity:
          parseNumber(
            getValue(
              row,
              [
                "stok aktual",
                "stock aktual",
                "opname",
                "qty opname",
                "jumlah"
              ]
            )
          ),

        unit:
          getValue(
            row,
            [
              "satuan",
              "unit"
            ]
          ),

        outlet:
          getValue(
            row,
            [
              "outlet",
              "cabang"
            ]
          ) ||
          "Dolan Sawah"
      });
    }
  );
}

// ============================================================
// CONVERT WASTE
// ============================================================

export function convertWaste(
  rows
) {
  return rows.map(
    (original) => {
      const row =
        normalizeRow(
          original
        );

      return createWaste({
        date:
          normalizeDate(
            getValue(
              row,
              [
                "tanggal",
                "date"
              ]
            )
          ),

        itemName:
          getValue(
            row,
            [
              "barang",
              "nama barang",
              "item",
              "bahan"
            ]
          ),

        quantity:
          parseNumber(
            getValue(
              row,
              [
                "qty",
                "quantity",
                "jumlah",
                "waste"
              ]
            )
          ),

        unit:
          getValue(
            row,
            [
              "satuan",
              "unit"
            ]
          ),

        reason:
          getValue(
            row,
            [
              "alasan",
              "reason",
              "keterangan"
            ]
          ),

        outlet:
          getValue(
            row,
            [
              "outlet",
              "cabang"
            ]
          ) ||
          "Dolan Sawah"
      });
    }
  );
}

// ============================================================
// CONVERT DATA
// ============================================================

export function convertRows(
  rows,
  type
) {
  switch (type) {
    case "SALES":
      return convertSales(
        rows
      );

    case "PURCHASE":
      return convertPurchases(
        rows
      );

    case "RECEIVING":
      return convertReceiving(
        rows
      );

    case "OPENING_STOCK":
      return convertOpeningStock(
        rows
      );

    case "STOCK_OPNAME":
      return convertStockOpname(
        rows
      );

    case "WASTE":
      return convertWaste(
        rows
      );

    default:
      return [];
  }
}

// ============================================================
// VALIDATE IMPORT
// ============================================================

export function validateImport(
  rows,
  type
) {
  const errors = [];

  rows.forEach(
    (row, index) => {
      if (
        type === "SALES" &&
        !row.menuName
      ) {
        errors.push(
          `Baris ${
            index + 2
          }: nama menu kosong.`
        );
      }

      if (
        type === "PURCHASE" &&
        !row.itemName
      ) {
        errors.push(
          `Baris ${
            index + 2
          }: nama barang kosong.`
        );
      }

      if (
        type === "STOCK_OPNAME" &&
        !row.itemName
      ) {
        errors.push(
          `Baris ${
            index + 2
          }: nama barang kosong.`
        );
      }

      if (
        type === "OPENING_STOCK" &&
        !row.itemName
      ) {
        errors.push(
          `Baris ${
            index + 2
          }: nama barang kosong.`
        );
      }

      if (
        type === "RECEIVING" &&
        !row.itemName
      ) {
        errors.push(
          `Baris ${
            index + 2
          }: nama barang kosong.`
        );
      }
    }
  );

  return {
    valid:
      errors.length === 0,

    errors
  };
}

// ============================================================
// IMPORT PIPELINE
// ============================================================

export async function processExcelFile(
  file
) {
  const workbook =
    await readExcelFile(
      file
    );

  const result = [];

  for (
    const sheetName
    of workbook.sheets
  ) {
    const rows =
      workbook.data[
        sheetName
      ];

    if (
      !rows ||
      rows.length === 0
    ) {
      continue;
    }

    const detection =
      detectDataType(
        rows
      );

    const normalizedRows =
      convertRows(
        rows,
        detection.type
      );

    const validation =
      validateImport(
        normalizedRows,
        detection.type
      );

    result.push({
      sheetName,

      originalRows:
        rows.length,

      type:
        detection.type,

      confidence:
        detection.confidence,

      rows:
        normalizedRows,

      valid:
        validation.valid,

      errors:
        validation.errors
    });
  }

  return result;
}

// ============================================================
// IMPORT SUMMARY
// ============================================================

export function buildImportSummary(
  result
) {
  return result.map(
    (sheet) => ({
      sheet:
        sheet.sheetName,

      detectedType:
        sheet.type,

      confidence:
        sheet.confidence,

      rows:
        sheet.originalRows,

      valid:
        sheet.valid,

      errors:
        sheet.errors.length
    })
  );
}