// ============================================================
// DOLAN SAWAH AI
// WHATSAPP IMPORT ENGINE
//
// Mengurai ekspor chat WhatsApp mentah (rekap belanja harian yang
// dikirim staf ke beberapa outlet) menjadi baris pembelian per
// tanggal + per outlet. Ekspor semacam ini mencampur banyak tanggal
// dan outlet dalam satu blok teks -- berbeda dari input chat AI
// biasa yang mengasumsikan satu tanggal + satu outlet per pesan.
//
// Prinsip desain: JANGAN pernah diam-diam membuang baris barang.
// Baris yang jelas (nama + jumlah + satuan cocok) masuk ke `groups`
// dan siap disimpan langsung. Baris yang meragukan (satuan tak
// dikenal, tanpa angka jelas, atau tanggal/outlet belum diketahui)
// tetap dibuatkan tebakan terbaik dan masuk ke `reviewItems` supaya
// pengguna bisa meninjau/mengedit di pop-up sebelum simpan -- kalau
// tidak diedit, tebakan itu yang tersimpan. Hanya baris yang memang
// bukan barang (bagian rencana/PR, pesan biasa) yang dikecualikan,
// dan itu pun tetap dilaporkan di `excludedPr` supaya tidak hilang
// tanpa jejak.
// ============================================================

const UNIT_WORDS =
  "kg|kilogram|gram|gr|g|liter|ltr|l|ml|porsi|pcs|buah|butir|ekor|pack|bungkus|bgks|kemasan|ikat|" +
  "dus|krat|bal|sak|kotak|kranjang|keranjang|botol|karton";

export function unitNormalize(unit) {
  const u = String(unit || "").trim().toLowerCase();
  if (u.includes("mililiter") || u.includes("milliliter") || u === "ml") return "ml";
  if (u.includes("liter") || u === "l" || u === "ltr") return "liter";
  if (u.includes("gram") || u === "gr" || u === "g") return "gram";
  if (u.includes("kg") || u.includes("kilo")) return "kg";
  return "unit";
}

// Menghapus penanda UI WhatsApp yang kadang ikut ter-copy ("<Pesan ini
// diedit>", "<This message was edited>") supaya tidak mengganggu regex
// jumlah/satuan di akhir baris.
function stripWhatsAppUiNoise(text) {
  return text.replace(/<[^>]*(pesan\s+ini\s+diedit|this\s+message\s+was\s+edited)[^>]*>/gi, "").trim();
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toNumber(value) {
  const text = String(value || "").trim().replace(",", ".");
  return Number(text) || 0;
}

// "01/08/26" -> "2026-08-01". Asumsi format WhatsApp Indonesia: DD/MM/YY.
function toISODate(dd, mm, yy) {
  const year = yy.length === 2 ? `20${yy}` : yy;
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

const DATE_HEADER_RE = /^=+\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*=+$/;
const MSG_HEADER_RE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*[\d.:]+\]\s*.*:?\s*$/;
const OUTLET_LINE_RE = /^(DS|SS|SP)$/i;
const BULLET_RE = /^[*\-•]\s*(.+)$/;
const PR_MARKER_RE = /^\*?\s*PR\s*\*?$/i;

function parseQuantityToken(raw) {
  const text = raw.trim();
  if (text.includes("/")) {
    const [num, den] = text.split("/").map((x) => Number(x.replace(",", ".")));
    if (den) return num / den;
  }
  return toNumber(text);
}

// Coba urai "nama barang + jumlah [+ satuan]" dari akhir baris. null kalau
// tidak ada angka yang jelas terbaca sama sekali.
function parseItemLine(rawText) {
  let text = stripWhatsAppUiNoise(rawText);
  // Anotasi harga seperti "2*30rb" -- angka pertama adalah jumlah,
  // sisanya harga satuan yang tidak relevan untuk qty.
  text = text.replace(/(\d+)\s*\*\s*\d+\s*(rb|ribu|k)\b/i, "$1").trim();

  const match = text.match(
    new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?(?:\\/\\d+)?)\\s*(${UNIT_WORDS})?\\s*$`, "i")
  );
  if (!match) return null;

  const itemName = titleCase(match[1]);
  const quantity = parseQuantityToken(match[2]);
  if (!itemName || !quantity) return null;

  return {
    itemName,
    quantity,
    unit: match[3] ? unitNormalize(match[3]) : "unit"
  };
}

// Tebakan terbaik untuk baris yang gagal diurai parseItemLine -- seluruh
// teks jadi nama barang, jumlah default 1 unit. Ini nilai yang benar-benar
// tersimpan kalau pengguna tidak mengedit lewat pop-up review.
function bestEffortGuess(rawText) {
  const clean = stripWhatsAppUiNoise(rawText);
  return {
    itemName: titleCase(clean) || "(tidak diketahui)",
    quantity: 1,
    unit: "unit"
  };
}

export function parseWhatsAppExport(text) {
  // Karakter kendali tak tampak (LRM/RLM) yang sering muncul di ekspor
  // WhatsApp -- dibersihkan supaya regex header/bullet tidak meleset.
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/[‎‏]/g, ""));

  let currentDate = null;
  let currentOutlet = null;
  let inPRBlock = false;
  const groupMap = new Map();
  const reviewItems = [];
  const excludedPr = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let m = line.match(DATE_HEADER_RE);
    if (m) {
      currentDate = toISODate(m[1], m[2], m[3]);
      currentOutlet = null;
      inPRBlock = false;
      continue;
    }

    m = line.match(MSG_HEADER_RE);
    if (m) {
      if (!currentDate) currentDate = toISODate(m[1], m[2], m[3]);
      currentOutlet = null;
      inPRBlock = false;
      continue;
    }

    if (OUTLET_LINE_RE.test(line)) {
      currentOutlet = line.toUpperCase();
      inPRBlock = false;
      continue;
    }

    if (PR_MARKER_RE.test(line)) {
      inPRBlock = true;
      continue;
    }

    m = line.match(BULLET_RE);
    if (m) {
      if (inPRBlock) {
        excludedPr.push({ line, reason: "Bagian rencana (PR), bukan realisasi belanja -- tidak disimpan" });
        continue;
      }

      const parsed = parseItemLine(m[1]);
      const guess = parsed || bestEffortGuess(m[1]);
      const needsReview = !parsed || !currentDate || !currentOutlet;

      if (!needsReview) {
        const key = `${currentDate}|${currentOutlet}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, { date: currentDate, outlet: currentOutlet, items: [] });
        }
        groupMap.get(key).items.push(guess);
        continue;
      }

      reviewItems.push({
        date: currentDate || "",
        outlet: currentOutlet || "",
        itemName: guess.itemName,
        quantity: guess.quantity,
        unit: guess.unit,
        rawLine: line,
        reason: !currentDate || !currentOutlet ? "Tanggal atau outlet belum jelas di titik ini" : "Jumlah/satuan tidak terbaca otomatis"
      });
      continue;
    }

    // Baris lain (pesan biasa, "gambar tidak disertakan", dst) -- bukan
    // baris barang, aman diabaikan sepenuhnya.
  }

  const groups = [...groupMap.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.outlet < b.outlet ? -1 : 1));
  const totalConfident = groups.reduce((sum, g) => sum + g.items.length, 0);

  return { groups, reviewItems, excludedPr, totalConfident };
}
