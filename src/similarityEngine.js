// ============================================================
// DOLAN SAWAH AI
// SIMILARITY ENGINE -- deteksi nama bahan yang mirip (typo, variasi
// penulisan, tambahan kata) dengan bahan yang sudah tercatat, supaya
// tidak diam-diam terpecah jadi "dua bahan" berbeda di database.
// ============================================================

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

export function similarityRatio(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  const maxLen = Math.max(x.length, y.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(x, y) / maxLen;
}

// Ambang batas "mirip tapi belum tentu sama" -- dipilih supaya menangkap
// typo/variasi wajar ("Bawang Putih" vs "Bawang Puith", "Bawang Putih"
// vs "Bawang Putih Kupas") tanpa terlalu banyak false-positive pada
// nama yang memang berbeda bahannya.
export const SIMILARITY_THRESHOLD = 0.72;

// Cari nama paling mirip dari daftar `knownNames` untuk `name`. Nama
// yang PERSIS sama (setelah lowercase+trim) dianggap sudah pasti bahan
// yang sama -- bukan "mirip", jadi tidak perlu dikonfirmasi -> null.
export function findSimilarName(name, knownNames) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return null;

  let best = null;
  let bestScore = 0;

  for (const known of knownNames) {
    const knownNorm = String(known || "").trim().toLowerCase();
    if (!knownNorm || knownNorm === normalized) return null;
    const score = similarityRatio(normalized, knownNorm);
    if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
      best = known;
      bestScore = score;
    }
  }

  return best ? { match: best, score: bestScore } : null;
}

function tokenize(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

// Kandidat "kata tambahan di belakang" -- mis. "Kelapa Parut" vs "Kelapa
// Parut 30rb", atau "Jantung Pisang" vs "Jantung Pisang Seadanya". Beda
// jumlah katanya bisa terlalu jauh untuk lolos SIMILARITY_THRESHOLD di
// atas, tapi tetap layak dicurigai sebagai bahan yang sama dengan catatan
// tambahan (harga, takaran, "seadanya"/"secukupnya"). Di sisi lain, pola
// yang sama juga muncul pada bahan yang MEMANG berbeda ("Tahu" vs "Tahu
// Pong", "Kecap" vs "Kecap Manis", "Gula" vs "Gula Aren") -- karena itu
// fungsi ini cuma mengembalikan KANDIDAT, keputusan akhirnya diserahkan
// ke AI (lihat analyzeIngredientPairs di aiEngine.js) sebelum ditanyakan
// ke pengguna.
export function findPrefixCandidate(name, knownNames) {
  const words = tokenize(name);
  if (words.length === 0) return null;
  const nameNorm = words.join(" ");

  let best = null;
  let bestDiff = Infinity;

  for (const known of knownNames) {
    const knownWords = tokenize(known);
    const knownNorm = knownWords.join(" ");
    if (!knownNorm || knownNorm === nameNorm) continue;

    const [shorter, longer] = words.length <= knownWords.length ? [words, knownWords] : [knownWords, words];
    if (shorter.length === 0) continue;
    const isPrefix = shorter.every((w, i) => longer[i] === w);
    if (!isPrefix) continue;

    const diff = longer.length - shorter.length;
    if (diff > 0 && diff < bestDiff) {
      best = known;
      bestDiff = diff;
    }
  }

  return best;
}
