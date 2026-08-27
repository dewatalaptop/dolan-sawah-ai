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
