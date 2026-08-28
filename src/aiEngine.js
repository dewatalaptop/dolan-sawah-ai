// ============================================================
// DOLAN SAWAH AI
// AI ENGINE (GLM via Z.AI -- OpenAI-compatible endpoint, free tier)
// ============================================================

import OpenAI from "openai";
import { toLocalISODate } from "./dateUtils";

const API_KEY = import.meta.env.VITE_ZAI_API_KEY;
// glm-4.7-flash: generasi lebih baru dari glm-4.5-flash, tetap gratis
// (dicek di docs.z.ai/guides/overview/pricing, 2026-08-28) -- upgrade
// tanpa biaya tambahan, bukan pindah ke tier berbayar.
const MODEL_NAME = import.meta.env.VITE_ZAI_MODEL || "glm-4.7-flash";
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

// ============================================================
// AGENT CORE -- agentic loop dengan function-calling
//
// Beda dari askAI() (satu kali panggil, konteks JSON manual): di sini
// GLM diberi daftar tool dan MEMILIH SENDIRI data mana yang perlu
// diambil, lewat beberapa putaran panggilan kalau perlu. Tool BACA
// dieksekusi langsung; begitu satu batch respons mengandung tool TULIS
// apa pun, loop BERHENTI TOTAL untuk batch itu (tidak ada yang
// dieksekusi, termasuk tool baca dalam batch yang sama) dan
// dikembalikan ke pemanggil sebagai status "pending_approval" --
// pemanggil (App.jsx) yang menampilkan kartu persetujuan, lalu
// melanjutkan loop lewat panggilan runAgentLoop() berikutnya dengan
// `messages` yang sudah diisi hasil tool (nyata untuk yang disetujui/
// tool baca, "ditolak" untuk yang tidak).
// ============================================================

const AGENT_SYSTEM_PROMPT =
  "Anda adalah Agent Core, asisten AI operasional sekaligus business coach untuk Dolan Sawah Group (3 outlet: " +
  "Dolan Sawah [DS], Sawah Senja [SS], Soto Pagi [SP]). Anda punya tool untuk membaca data operasional (stok, " +
  "harga, resep, penjualan, variance, reservasi, to-do) dan mengusulkan aksi tulis (penyesuaian stok, saran " +
  "belanja).\n\n" +
  "ATURAN WAJIB:\n" +
  "1. SELALU pakai tool untuk mengambil data yang dibutuhkan -- JANGAN PERNAH mengarang angka dari asumsi/ingatan.\n" +
  "2. Untuk tiap klaim angka di jawaban akhir, sebutkan sumber datanya (nama tool yang dipanggil), supaya bisa " +
  "diverifikasi.\n" +
  "3. SEMUA tool tulis (proposeStockAdjustment, proposePurchaseSuggestion) PASTI perlu persetujuan manual " +
  "pemilik sebelum benar-benar tersimpan -- itu baru USULAN, bukan aksi yang sudah terjadi. Jangan pernah " +
  "menyatakan seolah-olah sudah tersimpan sebelum ada konfirmasi persetujuan.\n" +
  "4. Sebelum memanggil tool tulis, tulis dulu rencana singkat (apa yang akan diusulkan dan kenapa) di jawaban " +
  "Anda.\n" +
  "5. Panggil HANYA SATU tool tulis dalam satu waktu (jangan gabung dengan tool lain di panggilan yang sama), " +
  "supaya alur persetujuannya jelas satu per satu.\n" +
  "6. Jawab dalam Bahasa Indonesia, ringkas, dan actionable.\n\n" +
  "MODE BUSINESS COACH: kalau pengguna minta analisa/saran pengembangan bisnis secara umum (bukan pertanyaan " +
  "spesifik satu topik), WAJIB panggil tool-tool ini sebelum menjawab, dalam urutan ini:\n" +
  "1. getTodoList (status semua) DULUAN -- cek apakah ada rekomendasi dari analisa SEBELUMNYA (tugas dengan " +
  "sumber saran_ai_sebelumnya) yang masih belum selesai. Kalau ada, itu WAJIB disebutkan di jawaban -- jangan " +
  "kasih saran baru yang isinya mengulang saran lama yang belum sempat dikerjakan; tegaskan progresnya dulu.\n" +
  "2. getSalesSummary, getVarianceReport, getReservationForecast, getKpiStatus -- kondisi operasional terkini " +
  "dan posisinya terhadap target yang pemilik tetapkan (kalau ada -- getKpiStatus akan bilang " +
  "\"target_belum_diset\" kalau belum, jangan berlagak ada target yang tidak ada).\n" +
  "3. getReservationPatterns dan getVarianceTrend -- pola historis (hari ramai/sepi, item yang berulang kali " +
  "bermasalah). Kalau datanya masih tipis (jumlah_hari_data atau jumlah_data kecil), katakan itu terus terang " +
  "sebagai keterbatasan data, jangan berlagak yakin dari sampel kecil.\n" +
  "Boleh dipanggil beberapa sekaligus dalam satu putaran atau menyebar ke beberapa putaran, yang penting semua " +
  "terpanggil sebelum jawaban akhir. Susun jawaban akhir sebagai laporan singkat terstruktur: " +
  "(a) Kondisi saat ini -- 2-3 poin fakta paling penting dari data, dengan angka konkret; " +
  "(b) Masalah/risiko -- apa yang paling mendesak diperbaiki, urutkan dari paling kritis, sebutkan kalau ada " +
  "pola berulang dari getReservationPatterns/getVarianceTrend (bukan cuma kejadian sekali); " +
  "(c) Rekomendasi aksi -- 3-5 langkah KONKRET dan spesifik (bukan saran generik seperti \"tingkatkan pemasaran\" " +
  "tanpa detail), sebutkan target/ukuran keberhasilan kalau memungkinkan; " +
  "(d) Follow-up -- kalau ada hal yang perlu dicek ulang nanti, tawarkan untuk dicatat lewat tool flagFollowUp. " +
  "SETELAH menulis (c), WAJIB panggil tool logRecommendations dengan daftar rekomendasi yang baru saja " +
  "ditulis di (c), supaya bisa dipantau progresnya di analisa berikutnya (lihat langkah 1) -- ini yang membuat " +
  "coaching-nya makin tajam tiap kali dipakai, bukan mengulang dari nol setiap saat.\n\n" +
  "MODE RINGKASAN HARIAN: kalau pengguna cuma minta ringkasan/briefing harian yang CEPAT (mis. \"ringkasan hari " +
  "ini\", bukan minta analisa/saran pengembangan), JANGAN ikuti daftar tool wajib MODE BUSINESS COACH di atas -- " +
  "itu untuk analisa mendalam dan sengaja berat/lama. Cukup panggil 2-3 tool yang relevan saja (biasanya " +
  "getReservationForecast untuk hari ini, getTodoList status belum_selesai, getRecentPriceChanges), lalu jawab " +
  "singkat dalam beberapa poin, TANPA logRecommendations dan TANPA struktur (a)-(d) di atas -- ini mode cepat, " +
  "bukan laporan lengkap.";

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// Tanpa ini, model tidak tahu "hari ini" itu tanggal berapa -- rawan
// mengarang tanggal random (pernah kejadian nyata: flagFollowUp diisi
// tanggal 2024 padahal sistemnya sudah 2026) atau salah hitung
// "besok"/"minggu depan". Dikirim sebagai pesan system terpisah di awal
// percakapan (bukan digabung ke AGENT_SYSTEM_PROMPT yang statis) supaya
// gampang di-refresh andai nanti perlu; putaran lanjutan (resumeAgentTurn
// setelah approval) memakai ulang riwayat pesan yang sama, jadi tanggal
// yang dipakai tetap tanggal saat turn ini dimulai -- cukup akurat
// karena jeda approval biasanya cuma hitungan detik/menit.
function buildDateContextMessage() {
  const now = new Date();
  const iso = toLocalISODate(now);
  const hari = HARI_ID[now.getDay()];
  return {
    role: "system",
    content: `KONTEKS WAKTU: Hari ini adalah ${hari}, ${iso} (format YYYY-MM-DD). Pakai tanggal ini sebagai acuan ` +
      `untuk semua istilah relatif ("hari ini", "besok", "minggu ini", "minggu depan", dst.) dan untuk mengisi ` +
      `parameter tanggal tool apa pun -- JANGAN pernah menebak atau memakai tanggal dari ingatan/pelatihan.`
  };
}

export function buildAgentInitialMessages(userMessage, businessContext) {
  // Konteks tanggal TIDAK disimpan di sini -- runAgentLoop() menambahkan
  // pesan tanggal segar ke tiap panggilan API (lihat komentar di sana),
  // jadi cukup ditambahkan sekali per panggilan, bukan disimpan permanen
  // dan ikut menumpuk di riwayat percakapan yang panjang.
  const messages = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];

  // Konteks bisnis (target margin, karakter tiap outlet, pola musiman,
  // dst.) diisi pemilik sendiri lewat halaman Pengaturan -- beda dari
  // konteks tanggal, ini tidak berubah dalam satu sesi jadi cukup
  // sekali di awal, tidak perlu di-refresh tiap putaran.
  if (businessContext && businessContext.trim()) {
    messages.push({
      role: "system",
      content: `KONTEKS BISNIS DARI PEMILIK (jadikan dasar analisa/saran, jangan diabaikan):\n${businessContext.trim()}`
    });
  }

  messages.push({ role: "user", content: userMessage });
  return messages;
}

// executeTool(name, args) -> Promise<any> (hasil JSON-serializable, dipakai
// sebagai isi pesan role "tool"). isWriteTool(name) -> boolean.
// maxIterations dinaikkan dari 6 -> 10: MODE BUSINESS COACH sekarang
// wajib panggil 6 tool baca + logRecommendations sebelum jawaban akhir
// (lihat AGENT_SYSTEM_PROMPT) -- kalau modelnya kebetulan memanggil
// tool satu-satu per putaran (bukan digabung), 6 masih terlalu
// sempit dan turn akan terpotong "TERLALU BANYAK LANGKAH" padahal
// sebenarnya baru separuh jalan.
export async function runAgentLoop({ messages, tools, executeTool, isWriteTool, maxIterations = 10 }) {
  if (!client) {
    throw new Error("AI API key belum dikonfigurasi (VITE_ZAI_API_KEY kosong).");
  }

  const workingMessages = [...messages];
  const toolLog = [];

  for (let i = 0; i < maxIterations; i++) {
    // Konteks tanggal dikirim ULANG sebagai pesan TERAKHIR di tiap
    // putaran (bukan cuma sekali di awal) -- supaya tidak "hilang di
    // tengah" percakapan panjang (kejadian nyata: MODE BUSINESS COACH
    // dengan 6+ tool call sempat balik mengarang tanggal 2024 di
    // flagFollowUp meski konteks tanggal sudah dikirim di pesan
    // pertama). Reminder ini TIDAK disimpan permanen ke workingMessages
    // supaya tidak menumpuk duplikat tiap putaran -- cuma ditambahkan
    // ke payload API untuk putaran ini saja.
    const apiMessages = [...workingMessages, buildDateContextMessage()];
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: apiMessages,
      tools,
      tool_choice: "auto"
    });

    const message = response?.choices?.[0]?.message;
    if (!message) {
      throw new Error("AI tidak mengembalikan respons.");
    }

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { status: "done", finalAnswer: message.content || "", toolLog, messages: [...workingMessages, message] };
    }

    workingMessages.push(message);

    const hasWriteCall = message.tool_calls.some((tc) => isWriteTool(tc.function.name));
    if (hasWriteCall) {
      return { status: "pending_approval", toolCalls: message.tool_calls, toolLog, messages: workingMessages };
    }

    for (const toolCall of message.tool_calls) {
      let args;
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = {};
      }
      const result = await executeTool(toolCall.function.name, args);
      toolLog.push({ name: toolCall.function.name, args, type: "read", result });
      workingMessages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result ?? null) });
    }
  }

  return {
    status: "max_iterations",
    finalAnswer: "Saya butuh terlalu banyak langkah untuk menjawab ini -- coba pertanyaan yang lebih spesifik.",
    toolLog,
    messages: workingMessages
  };
}
