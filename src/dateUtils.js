// ============================================================
// DOLAN SAWAH AI
// DATE UTILS
//
// `new Date().toISOString()` selalu memakai UTC. Untuk pengguna di WIB
// (UTC+7), tanggal kalendernya baru berganti jam 7 pagi menurut UTC,
// bukan tengah malam -- kalau dipakai untuk "hari ini" versi pengguna,
// hasilnya bisa mundur satu hari di jam-jam dini hari. Pakai
// toLocalISODate untuk apa pun yang berarti "tanggal hari ini menurut
// jam pengguna", bukan .toISOString().slice(0, 10).
// ============================================================

export function toLocalISODate(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
