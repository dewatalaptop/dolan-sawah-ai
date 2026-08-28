// ============================================================
// DOLAN SAWAH AI -- AGENT CORE
// Skema tool (format function-calling OpenAI-compatible) untuk
// agentic loop GLM. Tiap tool BACA membungkus fungsi engine yang
// sudah ada (tidak menulis ulang logikanya) -- eksekusi nyatanya
// ada di App.jsx (executor), file ini cuma daftar skema + metadata
// mana yang tergolong tool TULIS (selalu perlu approval manual).
// ============================================================

export const READ_TOOL_NAMES = [
  "getVarianceReport",
  "getCurrentStock",
  "getPriceHistory",
  "getRecipeCost",
  "getSalesSummary",
  "getReservationForecast",
  "getTodoList",
  "flagFollowUp"
];

// Semua tool tulis WAJIB approval manual pemilik -- tidak ada
// pengecualian auto-approve (keputusan eksplisit pemilik).
export const WRITE_TOOL_NAMES = ["proposeStockAdjustment", "proposePurchaseSuggestion"];

export function isWriteTool(name) {
  return WRITE_TOOL_NAMES.includes(name);
}

const OUTLET_ENUM = ["DS", "SS", "SP", "ALL"];

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "getVarianceReport",
      description:
        "Ambil laporan variance (selisih stok teoritis vs aktual hasil stock opname) untuk outlet tertentu. " +
        "Pakai ini untuk pertanyaan soal selisih stok, kemungkinan waste tak tercatat, atau surplus.",
      parameters: {
        type: "object",
        properties: {
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." }
        },
        required: ["outlet"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getCurrentStock",
      description:
        "Ambil saldo stok teoritis & aktual (kalau ada hasil opname) untuk satu bahan tertentu, di satu outlet " +
        "atau gabungan semua outlet.",
      parameters: {
        type: "object",
        properties: {
          bahan: { type: "string", description: "Nama bahan, mis. \"Ayam\", \"Bawang Putih\"." },
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." }
        },
        required: ["bahan", "outlet"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getPriceHistory",
      description: "Ambil harga terkini dan riwayat harga untuk satu bahan tertentu.",
      parameters: {
        type: "object",
        properties: {
          bahan: { type: "string", description: "Nama bahan." }
        },
        required: ["bahan"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getRecipeCost",
      description: "Hitung biaya bahan (HPP) untuk satu resep/menu, berdasarkan harga bahan terkini.",
      parameters: {
        type: "object",
        properties: {
          menu: { type: "string", description: "Nama menu, mis. \"Ayam Bakar\"." }
        },
        required: ["menu"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getSalesSummary",
      description:
        "Ambil ringkasan penjualan (total porsi, rata-rata harian, per menu) untuk outlet dan rentang tanggal " +
        "tertentu.",
      parameters: {
        type: "object",
        properties: {
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." },
          hariTerakhir: { type: "number", description: "Jumlah hari terakhir yang dihitung, mis. 7 atau 30. Default 7 kalau tidak disebutkan." }
        },
        required: ["outlet"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getReservationForecast",
      description:
        "Ambil daftar reservasi (confirmed & pending, termasuk nama, jam, jumlah tamu, dan nomor HP) untuk " +
        "outlet dan rentang tanggal tertentu, dari data sinkronisasi reservasi -- pakai ini untuk menjawab " +
        "pertanyaan soal reservasi (mis. \"reservasi besok apa saja\") maupun untuk memperkirakan beban dapur.",
      parameters: {
        type: "object",
        properties: {
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." },
          dariTanggal: { type: "string", description: "Tanggal mulai, format YYYY-MM-DD. Default hari ini." },
          sampaiTanggal: { type: "string", description: "Tanggal akhir, format YYYY-MM-DD. Default 14 hari dari sekarang." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getTodoList",
      description:
        "Ambil daftar tugas (to-do) pemilik -- harian/mingguan/bulanan, sekali selesai per periode (bukan " +
        "berulang otomatis). Pakai ini untuk pertanyaan soal tugas apa yang sudah/belum dikerjakan, mis. " +
        "\"tugas minggu ini apa aja yang belum selesai?\".",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["belum_selesai", "selesai", "semua"],
            description: "Filter status tugas. Default belum_selesai kalau tidak disebutkan."
          },
          period: {
            type: "string",
            enum: ["harian", "mingguan", "bulanan", "semua"],
            description: "Filter periode tugas. Default semua kalau tidak disebutkan."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "flagFollowUp",
      description:
        "Tandai bahwa percakapan ini perlu ditindaklanjuti lagi di kemudian hari (bukan aksi tulis ke data " +
        "operasional -- cuma catatan pengingat, otomatis dieksekusi tanpa approval). Pakai kalau ada sesuatu " +
        "yang perlu dicek ulang nanti, mis. \"cek lagi variance bahan X minggu depan\".",
      parameters: {
        type: "object",
        properties: {
          catatan: { type: "string", description: "Catatan singkat soal apa yang perlu ditindaklanjuti." },
          tanggal: { type: "string", description: "Tanggal follow-up, format YYYY-MM-DD." }
        },
        required: ["catatan", "tanggal"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "proposeStockAdjustment",
      description:
        "USULKAN penyesuaian stok manual untuk satu bahan (bukan langsung menyimpan -- ini SELALU perlu " +
        "persetujuan manual pemilik sebelum benar-benar tersimpan). Pakai kalau ada indikasi kuat stok tercatat " +
        "perlu dikoreksi (mis. dari hasil analisa variance) dan Anda ingin mengusulkan perbaikannya.",
      parameters: {
        type: "object",
        properties: {
          bahan: { type: "string", description: "Nama bahan yang diusulkan disesuaikan." },
          outlet: { type: "string", enum: ["DS", "SS", "SP"], description: "Kode outlet (bukan ALL -- penyesuaian selalu per outlet spesifik)." },
          jumlah: { type: "number", description: "Jumlah penyesuaian (boleh negatif untuk pengurangan, positif untuk penambahan)." },
          satuan: { type: "string", description: "Satuan jumlah, mis. \"kg\", \"liter\", \"unit\"." },
          alasan: { type: "string", description: "Alasan/justifikasi penyesuaian ini, akan ditampilkan ke pemilik untuk keputusan." }
        },
        required: ["bahan", "outlet", "jumlah", "satuan", "alasan"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "proposePurchaseSuggestion",
      description:
        "USULKAN daftar rekomendasi belanja (draft saja -- ini SELALU perlu persetujuan manual pemilik, TIDAK " +
        "langsung tersimpan sebagai pembelian). Pakai untuk menjawab pertanyaan \"apa yang perlu dibeli\" dengan " +
        "rekomendasi yang lebih spesifik dari perhitungan standar aplikasi.",
      parameters: {
        type: "object",
        properties: {
          daftarBahan: {
            type: "array",
            description: "Daftar bahan yang diusulkan untuk dibeli.",
            items: {
              type: "object",
              properties: {
                bahan: { type: "string" },
                jumlah: { type: "number" },
                satuan: { type: "string" },
                alasan: { type: "string" }
              },
              required: ["bahan", "jumlah", "satuan"]
            }
          }
        },
        required: ["daftarBahan"]
      }
    }
  }
];
