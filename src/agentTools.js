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
  "getReservationPatterns",
  "getVarianceTrend",
  "getKpiStatus",
  "getRecentPriceChanges",
  "getWasteBreakdown",
  "getSupplierReliability",
  "flagFollowUp",
  "logRecommendations"
];

// Semua tool tulis WAJIB approval manual pemilik -- tidak ada
// pengecualian auto-approve (keputusan eksplisit pemilik).
export const WRITE_TOOL_NAMES = ["proposeStockAdjustment", "proposePurchaseSuggestion", "proposeDataDeletion"];

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
      description:
        "Hitung biaya bahan (HPP) untuk satu resep/menu, berdasarkan harga bahan terkini. Hasilnya sudah " +
        "termasuk margin_rupiah dan margin_persen (harga_jual - estimasi_hpp) -- PAKAI LANGSUNG field ini untuk " +
        "pertanyaan soal profitabilitas/margin menu, jangan hitung ulang manual dari harga_jual dan estimasi_hpp.",
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
        "Ambil daftar reservasi (confirmed & pending, termasuk nama, jam, jumlah tamu, nomor HP, dan " +
        "paket_dipesan) untuk outlet dan rentang tanggal tertentu, dari data sinkronisasi reservasi -- pakai " +
        "ini untuk menjawab pertanyaan soal reservasi (mis. \"reservasi besok apa saja\") maupun untuk " +
        "memperkirakan beban dapur. CATATAN soal paket_dipesan: itu nama PAKET catering (mis. \"Paket D x23\"), " +
        "BUKAN nama menu/resep di sistem -- jangan mencocokkannya ke stok bahan atau resep, cukup sebutkan apa " +
        "adanya sebagai info persiapan.",
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
      name: "getKpiStatus",
      description:
        "Bandingkan kondisi bisnis SAAT INI (omzet bulan berjalan, rata-rata variance %, tingkat penyelesaian " +
        "tugas) dengan TARGET yang sudah ditetapkan pemilik di halaman Pengaturan. Kalau target belum diset " +
        "untuk suatu ukuran, statusnya \"target_belum_diset\" -- jangan berlagak ada target kalau memang belum " +
        "ada. Pakai ini untuk pertanyaan \"apakah saya sudah capai target\" atau sebagai bagian analisa MODE " +
        "BUSINESS COACH.",
      parameters: {
        type: "object",
        properties: {
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getRecentPriceChanges",
      description:
        "Ambil daftar bahan yang harganya berubah dalam beberapa hari terakhir (naik/turun), diurutkan dari " +
        "perubahan persentase terbesar. Pakai untuk pertanyaan soal kenaikan/penurunan harga bahan belakangan " +
        "ini, atau sebagai bagian ringkasan harian.",
      parameters: {
        type: "object",
        properties: {
          hariTerakhir: { type: "number", description: "Jumlah hari terakhir yang dicek. Default 14 kalau tidak disebutkan." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getWasteBreakdown",
      description:
        "Ambil rincian waste (barang terbuang/rusak) dikelompokkan per ALASAN (field yang selama ini tersimpan " +
        "tapi tidak pernah dianalisa) dan per bahan yang paling sering kena waste. Pakai untuk pertanyaan soal " +
        "kenapa banyak waste, alasan waste apa yang paling sering, atau bahan mana yang paling sering terbuang.",
      parameters: {
        type: "object",
        properties: {
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getSupplierReliability",
      description:
        "Bandingkan keandalan tiap supplier berdasarkan riwayat barang datang (receiving) -- berapa kali kirim " +
        "kurang/lebih/sesuai dari pesanan, diurutkan dari yang paling sering bermasalah. Pakai untuk pertanyaan " +
        "soal supplier mana yang sering kurang kirim atau paling bisa diandalkan.",
      parameters: {
        type: "object",
        properties: {
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getReservationPatterns",
      description:
        "Ambil pola permintaan reservasi historis per hari-dalam-minggu (rata-rata jumlah tamu & jumlah " +
        "reservasi untuk tiap Senin/Selasa/dst.), dihitung dari seluruh data reservasi confirmed yang ada. " +
        "Pakai ini untuk pertanyaan soal hari mana biasanya paling ramai/sepi, atau untuk memperkirakan beban " +
        "operasional hari tertentu berdasarkan pola masa lalu -- BUKAN untuk daftar reservasi konkret (pakai " +
        "getReservationForecast untuk itu). Kalau jumlah_hari_data sedikit, sampaikan dengan hati-hati bahwa " +
        "polanya baru indikasi awal.",
      parameters: {
        type: "object",
        properties: {
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getVarianceTrend",
      description:
        "Ambil riwayat variance (selisih stok teoritis vs aktual) dari waktu ke waktu -- setiap kali stock " +
        "opname baru disimpan, satu titik data ditambahkan. Sebutkan `bahan` untuk riwayat satu item spesifik " +
        "(mis. tren Bawang Putih tiap opname), atau kosongkan untuk ringkasan item mana yang PALING SERING " +
        "bermasalah (rata-rata selisih paling negatif) di seluruh riwayat. Pakai ini untuk pertanyaan soal pola " +
        "kebocoran/susut berulang, bukan cuma variance hari ini (itu pakai getVarianceReport).",
      parameters: {
        type: "object",
        properties: {
          bahan: { type: "string", description: "Nama bahan tertentu (opsional). Kosongkan untuk ringkasan semua bahan." },
          outlet: { type: "string", enum: OUTLET_ENUM, description: "Kode outlet, atau ALL untuk gabungan semua outlet." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "logRecommendations",
      description:
        "Catat rekomendasi/saran pengembangan yang baru saja Anda berikan sebagai tugas (to-do) yang bisa " +
        "dipantau progresnya -- BUKAN aksi ke data operasional, jadi otomatis dieksekusi tanpa approval (sama " +
        "seperti flagFollowUp). WAJIB dipanggil di akhir setiap analisa MODE BUSINESS COACH supaya rekomendasi " +
        "tidak hilang begitu saja dan bisa dicek lagi progresnya lewat getTodoList/halaman To-Do di lain waktu. " +
        "Pemilik tetap bebas menghapus/menyelesaikan tugas ini kapan saja seperti tugas biasa.",
      parameters: {
        type: "object",
        properties: {
          rekomendasi: {
            type: "array",
            description: "Daftar rekomendasi yang barusan diberikan.",
            items: {
              type: "object",
              properties: {
                judul: { type: "string", description: "Ringkasan singkat rekomendasi/aksi, mis. \"Lakukan stock opname 5 bahan utama\"." },
                target: { type: "string", description: "Ukuran keberhasilan/target, kalau ada (opsional)." },
                tenggatHari: { type: "number", description: "Berapa hari dari sekarang tenggatnya masuk akal untuk dicek. Default 7." }
              },
              required: ["judul"]
            }
          }
        },
        required: ["rekomendasi"]
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
  },
  {
    type: "function",
    function: {
      name: "proposeDataDeletion",
      description:
        "USULKAN penghapusan data historis dalam SATU jenis data + rentang tanggal tertentu (bukan langsung " +
        "menghapus -- ini SELALU perlu persetujuan manual pemilik, dan draft-nya akan menunjukkan JUMLAH BARIS " +
        "PERSIS yang akan terhapus supaya pemilik bisa mengecek sebelum menyetujui). Dipakai kalau pemilik minta " +
        "membersihkan/menghapus data lama, data salah input massal, atau data uji coba.\n\n" +
        "ATURAN KETAT (tindakan ini berisiko tinggi kalau salah cakupan):\n" +
        "1. JANGAN PERNAH memanggil tool ini tanpa dariTanggal DAN sampaiTanggal yang eksplisit dan pasti -- " +
        "kalau pemilik bilang sesuatu yang ambigu seperti \"hapus data lama\" atau \"hapus yang salah kemarin\" " +
        "tanpa tanggal jelas, TANYA BALIK dulu untuk memastikan rentang tanggal pastinya, jangan menebak.\n" +
        "2. Kalau pemilik menyebut nama bahan/menu spesifik (bukan rentang tanggal), itu BUKAN untuk tool ini -- " +
        "arahkan ke penghapusan baris manual di halaman terkait, tool ini khusus untuk hapus massal per tanggal.\n" +
        "3. Sebelum memanggil, tulis dulu di jawaban Anda: jenis data, rentang tanggal, dan outlet yang akan " +
        "dihapus, supaya pemilik sudah lihat rencananya di teks SEBELUM kartu persetujuan muncul.\n" +
        "4. Data yang terhapus tetap bisa di-undo lewat menu Riwayat Aktivitas setelah disetujui -- boleh " +
        "disebutkan ke pemilik sebagai jaring pengaman, tapi jangan jadikan alasan untuk kurang hati-hati soal " +
        "cakupan tanggal/jenis data.",
      parameters: {
        type: "object",
        properties: {
          tipeData: {
            type: "string",
            enum: ["pembelian", "barang_datang", "penjualan", "stock_opname", "waste", "stok_awal", "penyesuaian"],
            description: "Jenis data yang akan dihapus. Resep TIDAK termasuk (tidak berbasis tanggal, tidak didukung tool ini)."
          },
          dariTanggal: { type: "string", description: "Tanggal mulai (inklusif), format YYYY-MM-DD. WAJIB diisi eksplisit." },
          sampaiTanggal: { type: "string", description: "Tanggal akhir (inklusif), format YYYY-MM-DD. WAJIB diisi eksplisit." },
          outlet: { type: "string", enum: ["DS", "SS", "SP", "ALL"], description: "Outlet tertentu, atau ALL untuk semua outlet. Default ALL kalau tidak disebutkan." },
          alasan: { type: "string", description: "Alasan penghapusan, akan ditampilkan ke pemilik untuk keputusan." }
        },
        required: ["tipeData", "dariTanggal", "sampaiTanggal", "alasan"]
      }
    }
  }
];
