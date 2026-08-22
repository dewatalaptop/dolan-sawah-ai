// ============================================================
// DOLAN SAWAH AI
// GEMINI ENGINE
// ============================================================

import { GoogleGenAI } from "@google/genai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL_NAME = import.meta.env.VITE_GEMINI_MODEL || "gemini-3.6-flash";

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

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
  if (!ai) {
    throw new Error("Gemini API key belum dikonfigurasi (VITE_GEMINI_API_KEY kosong).");
  }

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt
  });
  const text = response?.text;

  if (!text) {
    throw new Error("Gemini tidak mengembalikan jawaban.");
  }

  return text;
}
