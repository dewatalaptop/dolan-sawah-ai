// ============================================================
// DOLAN SAWAH AI -- CLOUD FUNCTIONS
// syncReservations: tiap jam, salin data reservasi dari project
// `reservasi-dolan-sawah` (collections `reservations` dan
// `reservation_requests`) ke `reservations_mirror` di project ini,
// supaya Nuvora punya konteks reservasi untuk prediksi beban dapur.
//
// Akses lintas-project TANPA credential file -- pakai identitas
// service account bawaan (serviceAccount di bawah), yang sudah
// diberi IAM role "Cloud Datastore Viewer" (baca-saja) di project
// reservasi-dolan-sawah lewat GCP Console.
// ============================================================

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

const SYNC_SERVICE_ACCOUNT = "firebase-adminsdk-fbsvc@dolan-sawah-ai-2026.iam.gserviceaccount.com";
const RESERVASI_PROJECT_ID = "reservasi-dolan-sawah";
const MIRROR_COLLECTION = "reservations_mirror";

// App default (project ini sendiri, dolan-sawah-ai-2026) -- dipakai
// untuk menulis reservations_mirror.
admin.initializeApp();
const ownDb = admin.firestore();

// App kedua ke project reservasi -- otentikasi otomatis lewat identitas
// runtime function (Application Default Credentials), diotorisasi oleh
// IAM binding yang sudah dipasang, bukan key file.
const reservasiApp = admin.initializeApp(
  {
    credential: admin.credential.applicationDefault(),
    projectId: RESERVASI_PROJECT_ID
  },
  "reservasiApp"
);
const reservasiDb = reservasiApp.firestore();

// ------------------------------------------------------------
// DETEKSI OUTLET -- heuristik dari field "tempat"/"tambahan", pola
// yang sama seperti fuzzy-matching nama bahan (cari kata kunci, kalau
// sinyalnya ambigu jangan menebak, tandai untuk ditinjau manual).
// ------------------------------------------------------------
function detectOutlet(tempat, tambahan) {
  const text = `${tempat || ""} ${tambahan || ""}`.toLowerCase();
  const hasSenja = text.includes("senja");
  const hasPagi = text.includes("pagi");

  if (hasSenja && hasPagi) return { outlet: "DS", outletReviewNeeded: true };
  if (hasSenja) return { outlet: "SS", outletReviewNeeded: false };
  if (hasPagi) return { outlet: "SP", outletReviewNeeded: false };
  return { outlet: "DS", outletReviewNeeded: false };
}

// reservation_requests memakai nama field catatan yang tidak konsisten
// di data lama -- coba beberapa nama field berurutan (dikonfirmasi oleh
// audit kode reservasids).
function pickNote(data) {
  return data.note || data.catatan || data.pesan || data.tambahan || "";
}

function toMirrorDoc(sourceCollectionName, docId, data, statusValue) {
  const { outlet, outletReviewNeeded } = detectOutlet(data.tempat, data.tambahan);
  const tambahanValue =
    sourceCollectionName === "reservation_requests" ? pickNote(data) : data.tambahan || "";

  return {
    nama: data.nama || "",
    nomorHp: data.nomorHp || "",
    jam: data.jam || "",
    jumlah: Number(data.jumlah || 0),
    dp: data.dp ?? null,
    tipeDp: data.tipeDp || "",
    tempat: data.tempat || "",
    tambahan: tambahanValue,
    menus: Array.isArray(data.menus) ? data.menus : [],
    date: data.date || "",
    createdAt: data.createdAt || null,
    thankYouSent: data.thankYouSent ?? null,
    orderTotal: data.orderTotal ?? null,
    sourceCollection: sourceCollectionName,
    sourceDocId: docId,
    status: statusValue,
    outlet,
    outletReviewNeeded,
    syncedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function commitInChunks(ownDbRef, operations) {
  const CHUNK = 400; // di bawah batas 500 operasi per batch Firestore
  let count = 0;
  for (let i = 0; i < operations.length; i += CHUNK) {
    const batch = ownDbRef.batch();
    operations.slice(i, i + CHUNK).forEach((op) => op(batch));
    await batch.commit();
    count += Math.min(CHUNK, operations.length - i);
  }
  return count;
}

// Sinkronkan satu collection sumber -> reservations_mirror. Mengembalikan
// jumlah baris diproses + Set sourceDocId yang MASIH ada di sumber saat
// ini (dipakai untuk membersihkan mirror yang sudah basi, mis. request
// yang sudah di-approve/dipindah dari reservation_requests).
async function syncCollection(sourceCollectionName, statusValue, dateFrom, dateTo) {
  const snapshot = await reservasiDb
    .collection(sourceCollectionName)
    .where("date", ">=", dateFrom)
    .where("date", "<=", dateTo)
    .get();

  const liveSourceIds = new Set();
  const operations = snapshot.docs.map((doc) => {
    liveSourceIds.add(doc.id);
    const mirrorId = `${sourceCollectionName}_${doc.id}`;
    const mirrorDoc = toMirrorDoc(sourceCollectionName, doc.id, doc.data(), statusValue);
    return (batch) => batch.set(ownDb.collection(MIRROR_COLLECTION).doc(mirrorId), mirrorDoc);
  });

  const processed = await commitInChunks(ownDb, operations);
  return { processed, liveSourceIds };
}

// Mirror dari reservation_requests jadi basi kalau request-nya sudah
// di-approve (dipindah ke `reservations`) atau dihapus di sumber --
// tanpa pembersihan ini, reservations_mirror bisa terus menumpuk entri
// "pending" yang sebenarnya sudah tidak relevan.
async function cleanupStaleMirrors(sourceCollectionName, liveSourceIds) {
  const staleSnap = await ownDb
    .collection(MIRROR_COLLECTION)
    .where("sourceCollection", "==", sourceCollectionName)
    .get();

  const operations = [];
  staleSnap.docs.forEach((doc) => {
    const sourceDocId = doc.data().sourceDocId;
    if (!liveSourceIds.has(sourceDocId)) {
      operations.push((batch) => batch.delete(doc.ref));
    }
  });

  return commitInChunks(ownDb, operations);
}

// ============================================================
// checkFollowUpNotifications: tiap pagi, cek decisions_log untuk
// follow-up yang jatuh tempo (followUpNeeded=true, followUpDate<=hari
// ini, belum dimunculkan sebagai notifikasi), buat satu dokumen di
// collection `notifications` per follow-up (dibaca UI lewat badge
// lonceng), lalu tandai followUpNotified=true supaya tidak dibuat
// ulang besok. Satu batch atomic -- tidak ada risiko "sudah ditandai
// tapi belum benar-benar muncul" seperti versi email sebelumnya,
// karena semuanya cuma tulis ke Firestore sendiri (tidak bergantung
// pada layanan pengiriman eksternal).
// ============================================================

exports.checkFollowUpNotifications = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "Asia/Jakarta",
    region: "asia-southeast2"
  },
  async () => {
    const today = new Date().toISOString().slice(0, 10);

    const snapshot = await ownDb
      .collection("decisions_log")
      .where("followUpNeeded", "==", true)
      .where("followUpNotified", "==", false)
      .where("followUpDate", "<=", today)
      .get();

    if (snapshot.empty) {
      logger.info("checkFollowUpNotifications: tidak ada follow-up jatuh tempo hari ini.");
      return;
    }

    const batch = ownDb.batch();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      batch.update(doc.ref, { followUpNotified: true });
      batch.set(ownDb.collection("notifications").doc(), {
        type: "followup",
        refId: doc.id,
        decisionId: doc.id,
        message: data.followUpNote || data.userMessage || "Follow-up perlu ditindaklanjuti",
        dueDate: data.followUpDate,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false
      });
    });
    await batch.commit();

    logger.info(`checkFollowUpNotifications selesai: ${snapshot.size} notifikasi dibuat.`);
  }
);

// ============================================================
// checkTomorrowReservations: tiap pagi (setelah syncReservations jalan
// jam-jam sebelumnya), cek reservations_mirror untuk tanggal besok,
// buat satu notifikasi per reservasi supaya muncul di badge lonceng
// UI -- pengingat proaktif tanpa perlu pengguna tanya duluan.
//
// ID dokumen notifikasi dibuat deterministik (bukan .doc() acak) dari
// id mirror + tanggal, supaya kalau function ini kebetulan jalan dua
// kali di hari yang sama (retry/redeploy), notifikasi yang sama cuma
// di-overwrite, bukan digandakan.
// ============================================================

exports.checkTomorrowReservations = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "Asia/Jakarta",
    region: "asia-southeast2"
  },
  async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);

    const snapshot = await ownDb
      .collection(MIRROR_COLLECTION)
      .where("date", "==", tomorrowDate)
      .get();

    if (snapshot.empty) {
      logger.info(`checkTomorrowReservations: tidak ada reservasi untuk ${tomorrowDate}.`);
      return;
    }

    const batch = ownDb.batch();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const jamText = data.jam ? ` jam ${data.jam}` : "";
      const outletText = data.outlet ? ` (${data.outlet})` : "";
      batch.set(
        ownDb.collection("notifications").doc(`resv-reminder-${doc.id}-${tomorrowDate}`),
        {
          type: "reservation",
          refId: doc.id,
          decisionId: "",
          message:
            `Reservasi besok: ${data.nama || "(tanpa nama)"}${jamText}, ` +
            `${data.jumlah || 0} tamu${outletText}` +
            (data.tambahan ? ` -- ${data.tambahan}` : ""),
          dueDate: tomorrowDate,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read: false
        }
      );
    });
    await batch.commit();

    logger.info(`checkTomorrowReservations selesai: ${snapshot.size} notifikasi reservasi besok dibuat.`);
  }
);

// ============================================================
// checkOverdueTodos: tiap pagi, cek todos yang belum ditandai
// selesai dan tenggatnya sudah lewat/jatuh hari ini (harian/mingguan/
// bulanan sama-sama dibandingkan lewat field dueDate), buat satu
// notifikasi per tugas supaya muncul di badge lonceng -- terus
// diulang tiap pagi selama tugasnya belum ditandai selesai (dedup
// per hari lewat ID dokumen deterministik, sama seperti reminder
// reservasi besok).
// ============================================================

exports.checkOverdueTodos = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "Asia/Jakarta",
    region: "asia-southeast2"
  },
  async () => {
    const today = new Date().toISOString().slice(0, 10);

    const snapshot = await ownDb
      .collection("todos")
      .where("done", "==", false)
      .where("dueDate", "<=", today)
      .get();

    if (snapshot.empty) {
      logger.info("checkOverdueTodos: tidak ada tugas jatuh tempo/terlambat hari ini.");
      return;
    }

    const batch = ownDb.batch();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const label = data.dueDate < today ? "terlambat" : "jatuh tempo hari ini";
      batch.set(
        ownDb.collection("notifications").doc(`todo-reminder-${doc.id}-${today}`),
        {
          type: "todo",
          refId: doc.id,
          decisionId: "",
          message: `Tugas ${label}: ${data.title || "(tanpa judul)"} (${data.period || "harian"})`,
          dueDate: data.dueDate,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read: false
        }
      );
    });
    await batch.commit();

    logger.info(`checkOverdueTodos selesai: ${snapshot.size} notifikasi tugas dibuat.`);
  }
);

// ============================================================
// chatCompletions: proxy HTTP ke endpoint OpenAI-compatible Gemini,
// supaya API key Gemini yang sesungguhnya hanya hidup sebagai secret
// server-side (GEMINI_API_KEY) -- tidak pernah ikut ter-bundle ke JS
// publik di GitHub Pages seperti waktu masih pakai z.ai client-side.
// Client (src/aiEngine.js) kirim body persis bentuk request OpenAI
// chat.completions (model/messages/tools/tool_choice), function ini
// cuma neruskan ke Gemini dengan Authorization asli, lalu kembalikan
// responsnya apa adanya -- supaya SDK `openai` di client tetap bisa
// dipakai tanpa perubahan bentuk request/response.
//
// FALLBACK ke z.ai (GLM): tier gratis Gemini cuma 20 request/hari per
// project -- kalau kena limit (429) atau Gemini lagi bermasalah (5xx),
// request yang SAMA dicoba ulang lewat z.ai secara diam-diam (client
// tidak perlu tahu, cuma dapat jawaban seperti biasa). Nama model di
// body ditukar ke model z.ai yang paling stabil dari histori pemakaian
// proyek ini (glm-4.5-flash -- glm-4.7-flash pernah dicoba tapi tier
// gratisnya jauh lebih padat) karena client selalu kirim nama model
// Gemini, yang tidak dikenali z.ai.
//
// CORS dibatasi ke origin situs publik + localhost (dev) supaya tidak
// sembarang origin bisa numpang pakai kuota lewat URL ini.
// ============================================================

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const ZAI_API_KEY = defineSecret("ZAI_API_KEY");
const ZAI_FALLBACK_MODEL = "glm-4.5-flash";

async function callGemini(body) {
  return fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GEMINI_API_KEY.value()}`
    },
    body: JSON.stringify(body)
  });
}

async function callZai(body) {
  return fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZAI_API_KEY.value()}`
    },
    body: JSON.stringify({ ...body, model: ZAI_FALLBACK_MODEL })
  });
}

exports.chatCompletions = onRequest(
  {
    region: "asia-southeast2",
    secrets: [GEMINI_API_KEY, ZAI_API_KEY],
    cors: ["https://dewatalaptop.github.io", /^http:\/\/localhost:\d+$/]
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const geminiRes = await callGemini(req.body);

      if (geminiRes.status === 429 || geminiRes.status >= 500) {
        logger.warn(`chatCompletions: Gemini gagal (${geminiRes.status}), coba fallback ke z.ai.`);
        const zaiRes = await callZai(req.body);
        const zaiData = await zaiRes.json();
        res.status(zaiRes.status).json(zaiData);
        return;
      }

      const data = await geminiRes.json();
      res.status(geminiRes.status).json(data);
    } catch (err) {
      logger.error("chatCompletions gagal:", err);
      res.status(502).json({ error: "Proxy ke AI gagal" });
    }
  }
);

// ============================================================
// checkPriceSpikes: tiap pagi, cek kenaikan harga bahan signifikan
// (>=20% dibanding catatan SEBELUMNYA -- bukan dibanding harga
// pertama kali dicatat, supaya kenaikan bertahap yang wajar tidak
// jadi "alarm palsu") dari collection price_history, buat notifikasi
// per bahan. Logika PERSIS sama dengan checkPriceSpikes di App.jsx
// (dipakai untuk banner "peringatan operasional" saat halaman chat
// dibuka) -- versi ini yang membuatnya PROAKTIF, tidak perlu pemilik
// buka halaman dulu supaya kelihatan. ID dokumen deterministik dari
// nama bahan + tanggal berlaku harga terbaru, supaya kalau function
// ini jalan ulang di hari yang sama (retry/redeploy) atau lonjakan
// yang sama masih jadi kenaikan TERBARU, notifikasinya di-overwrite,
// bukan digandakan -- begitu ada harga baru lagi yang bukan lonjakan,
// otomatis berhenti dibuat ulang.
// ============================================================

const PRICE_SPIKE_THRESHOLD_PERCENT = 20;

function normalizeItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[""]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

exports.checkPriceSpikes = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "Asia/Jakarta",
    region: "asia-southeast2"
  },
  async () => {
    const snapshot = await ownDb.collection("price_history").get();
    if (snapshot.empty) {
      logger.info("checkPriceSpikes: belum ada data harga sama sekali.");
      return;
    }

    const byItem = {};
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const key = normalizeItemName(data.itemName);
      if (!key) return;
      byItem[key] = byItem[key] || [];
      byItem[key].push(data);
    });

    const batch = ownDb.batch();
    let count = 0;

    Object.values(byItem).forEach((records) => {
      if (records.length < 2) return;
      const sorted = [...records].sort((a, b) => {
        const dateCompare = String(a.effectiveDate || "").localeCompare(String(b.effectiveDate || ""));
        if (dateCompare !== 0) return dateCompare;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      });
      const previous = sorted[sorted.length - 2];
      const latest = sorted[sorted.length - 1];
      const oldPrice = Number(previous.price || 0);
      const newPrice = Number(latest.price || 0);
      if (oldPrice <= 0) return;
      const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;
      if (changePercent < PRICE_SPIKE_THRESHOLD_PERCENT) return;

      const docId = `price-spike-${slugify(latest.itemName)}-${latest.effectiveDate || "unknown"}`;
      batch.set(ownDb.collection("notifications").doc(docId), {
        type: "price-spike",
        refId: "",
        decisionId: "",
        message:
          `Harga "${latest.itemName}" naik ${Math.round(changePercent)}% ` +
          `(Rp ${oldPrice.toLocaleString("id-ID")} -> Rp ${newPrice.toLocaleString("id-ID")}) ` +
          `sejak ${latest.effectiveDate}.`,
        dueDate: latest.effectiveDate || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false
      });
      count++;
    });

    if (count === 0) {
      logger.info("checkPriceSpikes: tidak ada kenaikan harga signifikan.");
      return;
    }
    await batch.commit();
    logger.info(`checkPriceSpikes selesai: ${count} notifikasi lonjakan harga dibuat.`);
  }
);

exports.syncReservations = onSchedule(
  {
    schedule: "0 * * * *",
    timeZone: "Asia/Jakarta",
    region: "asia-southeast2",
    serviceAccount: SYNC_SERVICE_ACCOUNT
  },
  async () => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    const to = new Date(now);
    to.setDate(to.getDate() + 60);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const dateFrom = fmt(from);
    const dateTo = fmt(to);

    const confirmed = await syncCollection("reservations", "confirmed", dateFrom, dateTo);
    const pending = await syncCollection("reservation_requests", "pending", dateFrom, dateTo);

    const staleDeleted = await cleanupStaleMirrors("reservation_requests", pending.liveSourceIds);

    logger.info(
      `syncReservations selesai: ${confirmed.processed} reservations, ` +
      `${pending.processed} reservation_requests disinkronkan, ` +
      `${staleDeleted} mirror basi (request yang sudah diproses/dihapus) dibersihkan.`
    );
  }
);
