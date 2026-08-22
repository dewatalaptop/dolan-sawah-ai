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
  "yang tidak ada di data.";

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
