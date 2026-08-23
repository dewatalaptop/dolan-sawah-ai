// ============================================================
// DOLAN SAWAH AI
// AI ENGINE (GLM via Z.AI -- OpenAI-compatible endpoint, free tier)
// ============================================================

import OpenAI from "openai";

const API_KEY = import.meta.env.VITE_ZAI_API_KEY;
const MODEL_NAME = import.meta.env.VITE_ZAI_MODEL || "glm-4.5-flash";
const BASE_URL = "https://api.z.ai/api/paas/v4/";

const client = API_KEY
  ? new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL, dangerouslyAllowBrowser: true })
  : null;

const SYSTEM_PROMPT =
  "Anda adalah asisten AI operasional untuk Dolan Sawah Group, yang menaungi 3 outlet " +
  "(Dolan Sawah, Sawah Senja, Soto Pagi). Anda menerima data operasional (stok, pembelian, " +
  "penjualan, omzet, variance, harga bahan) dalam format JSON dan pertanyaan dari pengguna. " +
  "Jawab dalam Bahasa Indonesia, ringkas, berbasis data yang diberikan, dan berikan " +
  "rekomendasi yang bisa langsung ditindaklanjuti bila relevan. Jangan mengarang angka " +
  "yang tidak ada di data. PENTING soal angka: kalau data JSON sudah menyediakan field " +
  "total/gabungan/rata-rata yang sesuai dengan pertanyaan, PAKAI LANGSUNG angka itu -- " +
  "jangan menjumlahkan atau menghitung ulang sendiri dari rincian per-item, karena rawan " +
  "salah hitung. Kalau menjawab pertanyaan tentang rata-rata atau total harian, selalu " +
  "sebutkan rentang tanggal/periode yang menjadi dasar angka tersebut.";

// ============================================================
// BUILD PROMPT LAPORAN
// ============================================================

export function buildReportPrompt(question, contextJson) {
  return (
    `DATA SAAT INI (JSON):\n${contextJson}\n\n` +
    `PERTANYAAN PENGGUNA:\n${question}`
  );
}

// ============================================================
// PANGGIL AI
// ============================================================

export async function askAI(prompt) {
  if (!client) {
    throw new Error("AI API key belum dikonfigurasi (VITE_ZAI_API_KEY kosong).");
  }

  const response = await client.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ]
  });
  const text = response?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("AI tidak mengembalikan jawaban.");
  }

  return text;
}

// ============================================================
// ANALISA KEMIRIPAN NAMA BAHAN (AI ikut menilai kandidat yang
// tidak bisa diputuskan cuma dari kemiripan tulisan -- mis.
// "Kelapa Parut" vs "Kelapa Parut 30rb", "Jantung Pisang" vs
// "Jantung Pisang Seadanya" -- vs yang MEMANG beda produk
// walau namanya mirip, mis. "Kecap" vs "Kecap Manis")
// ============================================================

const INGREDIENT_MATCH_SYSTEM_PROMPT =
  "Anda membantu tim operasional warung makan (Dolan Sawah Group) menilai pasangan nama " +
  "bahan/barang belanja yang ditulis staf secara manual di chat. Untuk tiap pasangan, " +
  "tentukan apakah keduanya kemungkinan besar merujuk ke BARANG FISIK YANG SAMA (beda tulisan " +
  "karena tambahan catatan harga, takaran, atau kata seperti 'seadanya'/'secukupnya'), atau " +
  "BARANG YANG BERBEDA meski namanya mirip/beririsan (mis. varian rasa, jenis, atau cara olah " +
  "yang berbeda seperti 'Kecap' vs 'Kecap Manis', 'Gula' vs 'Gula Aren', 'Kelapa Parut Santan' " +
  "vs 'Kelapa Parut Gudangan', 'Tahu' vs 'Tahu Pong'). Balas HANYA dengan JSON array valid, " +
  "tanpa teks lain di luar JSON, dengan format persis: " +
  '[{"name":"...","matchedName":"...","same":true,"reason":"..."}]. ' +
  '"reason" singkat (maksimal 12 kata) dalam Bahasa Indonesia, jelaskan alasannya.';

export async function analyzeIngredientPairs(pairs) {
  if (!client || !pairs.length) return null;

  const prompt =
    "Pasangan nama bahan berikut ditulis berdekatan dalam catatan belanja yang sama, " +
    "sehingga salah satu KEMUNGKINAN adalah catatan tambahan dari yang lain:\n\n" +
    JSON.stringify(pairs.map((p) => ({ name: p.name, matchedName: p.matchedName })));

  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: INGREDIENT_MATCH_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]
    });
    const text = response?.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
