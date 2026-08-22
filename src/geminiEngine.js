// ============================================================
// DOLAN SAWAH AI
// GEMINI ENGINE
// ============================================================

import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL_NAME = import.meta.env.VITE_GEMINI_MODEL || "gemini-3.6-flash";

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

const SYSTEM_PROMPT =
  "Anda adalah asisten AI operasional untuk Dolan Sawah Group, yang menaungi 3 outlet " +
  "(Dolan Sawah, Sawah Senja, Soto Pagi). Anda menerima data operasional (stok, pembelian, " +
  "penjualan, variance, harga bahan) dalam format JSON dan pertanyaan dari pengguna. " +
  "Jawab dalam Bahasa Indonesia, ringkas, berbasis data yang diberikan, dan berikan " +
  "rekomendasi yang bisa langsung ditindaklanjuti bila relevan. Jangan mengarang angka " +
  "yang tidak ada di data.";

// ============================================================
// BUILD PROMPT LAPORAN
// ============================================================

export function buildReportPrompt(question, contextJson) {
  return (
    `${SYSTEM_PROMPT}\n\n` +
    `DATA SAAT INI (JSON):\n${contextJson}\n\n` +
    `PERTANYAAN PENGGUNA:\n${question}`
  );
}

// ============================================================
// PANGGIL GEMINI
// ============================================================

export async function askGemini(prompt) {
  if (!genAI) {
    throw new Error("Gemini API key belum dikonfigurasi (VITE_GEMINI_API_KEY kosong).");
  }

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent(prompt);
  const text = result?.response?.text?.();

  if (!text) {
    throw new Error("Gemini tidak mengembalikan jawaban.");
  }

  return text;
}
