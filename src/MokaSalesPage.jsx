// ============================================================
// PENJUALAN MOKA -- baca laporan kasir harian (Google Sheets
// "LAPORAN KASIR_DS.xlsx", satu sheet per hari x shift) lewat Cloud
// Function `getMokaSalesReport`, lalu tampilkan rekap "P. Moka" per
// hari/shift. Live fetch setiap halaman dibuka / tombol Refresh
// ditekan -- tidak ada cache lokal, jadi selalu data terbaru dari
// spreadsheet begitu kasir update.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { auth } from "./firebase";
import { Icon, StatCard, DataTable } from "./uiKit";

const REPORT_URL =
  import.meta.env.VITE_MOKA_REPORT_URL ||
  "https://asia-southeast2-dolan-sawah-ai-2026.cloudfunctions.net/getMokaSalesReport";
const REGISTER_URL =
  import.meta.env.VITE_MOKA_REGISTER_URL ||
  "https://asia-southeast2-dolan-sawah-ai-2026.cloudfunctions.net/registerMokaSpreadsheet";
const REMOVE_URL =
  import.meta.env.VITE_MOKA_REMOVE_URL ||
  "https://asia-southeast2-dolan-sawah-ai-2026.cloudfunctions.net/removeMokaSpreadsheet";

// DS Pagi/Siang berbagi keluarga warna oranye (outlet yang sama, shift
// beda) supaya langsung kebaca sekilas mata, SP hijau & SS biru
// mengikuti gaya warna yang sudah dipakai di halaman lain.
const SHIFT_COLORS = { SP: "#2c9660", "DS Pagi": "#e4692a", "DS Siang": "#f0803d", SS: "#2f6fd1" };
const SHIFT_ORDER_FALLBACK = ["SP", "DS Pagi", "SS", "DS Siang"];

function formatRupiah(n) {
  return `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n || 0))}`;
}

export default function MokaSalesPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const [removingId, setRemovingId] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Belum login.");
      const res = await fetch(REPORT_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Gagal memuat laporan (status ${res.status}).`);
      }
      setReport(await res.json());
    } catch (err) {
      console.error("Gagal memuat laporan Moka:", err);
      setError(err.message || "Gagal memuat laporan Moka.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount dari Cloud Function eksternal (bukan turunan state
    // lokal) -- kasus yang valid untuk efek, lihat "You Might Not Need
    // an Effect" di react.dev soal fetching data saat mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReport();
  }, [loadReport]);

  // Setiap awal bulan, kasir/owner membuat spreadsheet laporan BARU (lewat
  // "Buat salinan" di Google Sheets, bukan tab baru di file lama) -- daftarkan
  // di sini sekali, tanpa perlu sesi coding, supaya "Penjualan Moka" langsung
  // membaca bulan baru itu juga. Lihat MOKA_SPREADSHEET_SEED di functions/index.js.
  const handleRegister = useCallback(
    async (e) => {
      e.preventDefault();
      setRegistering(true);
      setRegisterError("");
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Belum login.");
        const res = await fetch(REGISTER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ url: newUrl, label: newLabel })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Gagal mendaftarkan spreadsheet (status ${res.status}).`);
        setNewUrl("");
        setNewLabel("");
        await loadReport();
      } catch (err) {
        console.error("Gagal mendaftarkan spreadsheet Moka:", err);
        setRegisterError(err.message || "Gagal mendaftarkan spreadsheet.");
      } finally {
        setRegistering(false);
      }
    },
    [newUrl, newLabel, loadReport]
  );

  const handleRemove = useCallback(
    async (spreadsheetId) => {
      setRemovingId(spreadsheetId);
      setRegisterError("");
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Belum login.");
        const res = await fetch(REMOVE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ spreadsheetId })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Gagal menghapus (status ${res.status}).`);
        await loadReport();
      } catch (err) {
        console.error("Gagal menghapus spreadsheet Moka:", err);
        setRegisterError(err.message || "Gagal menghapus spreadsheet.");
      } finally {
        setRemovingId("");
      }
    },
    [loadReport]
  );

  const days = report?.days || [];
  const shiftOrder = report?.shiftOrder || SHIFT_ORDER_FALLBACK;
  const shiftLabels = report?.shiftLabels || {};
  const grandTotal = report?.grandTotal || 0;
  const avgPerDay = days.length ? grandTotal / days.length : 0;
  const bestDay = days.reduce((best, d) => (!best || d.total > best.total ? d : best), null);
  const maxTotal = Math.max(1, ...days.map((d) => d.total));

  return (
    <div className="page">
      <div className="section-header">
        <div>
          <h1>Penjualan Moka</h1>
          <p>Rekap harian "P. Moka" dari laporan kasir (Google Sheets) — dibaca langsung dari sumbernya.</p>
        </div>
        <button className="secondary-button" onClick={loadReport} disabled={loading}>
          <Icon name="trend" size={15} /> {loading ? "Memuat..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="logic-card">
          <div className="logic-icon"><Icon name="alert" size={20} /></div>
          <div>{error}</div>
        </div>
      )}

      {loading && !report && (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="coin" size={26} /></div>
          <div className="empty-title">Memuat laporan...</div>
        </div>
      )}

      {!loading && !error && days.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="coin" size={26} /></div>
          <div className="empty-title">Belum ada data P. Moka</div>
          <div className="empty-description">Belum ada sheet harian berisi angka "P. Moka" di spreadsheet.</div>
        </div>
      )}

      {days.length > 0 && (
        <>
          <div className="stat-grid">
            <StatCard title="Total Periode" value={formatRupiah(grandTotal)} subtitle={`${days.length} hari tercatat`} icon="coin" tone="orange" />
            <StatCard title="Rata-rata / Hari" value={formatRupiah(avgPerDay)} subtitle="dari hari yang tercatat" icon="trend" tone="green" />
            {bestDay && (
              <StatCard title="Hari Tertinggi" value={bestDay.dateLabel} subtitle={formatRupiah(bestDay.total)} icon="sparkle" tone="orange" />
            )}
          </div>

          <div className="card">
            <div className="card-title">Total P. Moka per hari, per shift</div>
            <div className="card-description">
              Batang bertumpuk — satu warna satu shift.
              {report?.updatedAt && ` Diperbarui: ${new Date(report.updatedAt).toLocaleString("id-ID")}.`}
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "12px 0 18px", fontSize: 12, color: "var(--ink-soft)" }}>
              {shiftOrder.map((k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: SHIFT_COLORS[k] || "#999", flexShrink: 0 }} />
                  {shiftLabels[k] || k}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 210, overflowX: "auto", paddingBottom: 4 }}>
              {days.map((d) => (
                <div
                  key={`${d.month}-${d.day}`}
                  title={`${d.dateLabel}: ${formatRupiah(d.total)}`}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 46, flexShrink: 0 }}
                >
                  <div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{(d.total / 1000000).toFixed(1)}jt</div>
                  <div style={{ width: 34, height: 150, display: "flex", flexDirection: "column-reverse", borderRadius: "6px 6px 0 0", overflow: "hidden", background: "var(--border-soft)" }}>
                    {shiftOrder.map((k) => {
                      const v = d.shifts[k] || 0;
                      if (!v) return null;
                      const heightPct = Math.max((v / maxTotal) * 100, 1.5);
                      return <div key={k} style={{ width: "100%", height: `${heightPct}%`, background: SHIFT_COLORS[k] || "#999" }} />;
                    })}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink)" }}>{d.dateLabel}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Tabel rincian</div>
            <div className="card-description">Nilai Kredit "P. Moka" per shift (Rupiah).</div>
            <DataTable
              columns={["Tanggal", ...shiftOrder.map((k) => shiftLabels[k] || k), "Total"]}
              rows={days.map((d) => [
                d.dateLabel,
                ...shiftOrder.map((k) => (d.shifts[k] ? formatRupiah(d.shifts[k]) : "-")),
                formatRupiah(d.total)
              ])}
            />
          </div>
        </>
      )}

      <div className="card">
        <div className="card-title">Sumber data spreadsheet</div>
        <div className="card-description">
          Setiap awal bulan, kasir/owner membuat spreadsheet laporan BARU (bukan tab baru di file
          lama). Daftarkan link-nya di sini sekali setiap ada file baru — datanya langsung ikut
          muncul di rekap di atas, tanpa perlu ubah kode.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "14px 0" }}>
          {(report?.spreadsheets || []).map((sp) => (
            <div
              key={sp.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                fontSize: 13
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ fontWeight: 650, color: "var(--ink)" }}>{sp.label}</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 650,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: sp.source === "seed" ? "var(--border-soft)" : "var(--green-050)",
                    color: sp.source === "seed" ? "var(--ink-faint)" : "var(--green-700, #1f7a4c)"
                  }}
                >
                  {sp.source === "seed" ? "bawaan" : "terdaftar"}
                </span>
              </div>
              {sp.source !== "seed" && (
                <button
                  className="secondary-button"
                  onClick={() => handleRemove(sp.id)}
                  disabled={removingId === sp.id}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {removingId === sp.id ? "Menghapus..." : "Hapus"}
                </button>
              )}
            </div>
          ))}
          {!report?.spreadsheets?.length && (
            <div style={{ fontSize: 13, color: "var(--ink-faint)" }}>Belum ada info spreadsheet (muat ulang laporan dulu).</div>
          )}
        </div>

        <form onSubmit={handleRegister} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="Link atau ID spreadsheet baru"
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", minWidth: 260, flex: 1 }}
            required
          />
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder='Label (mis. "November 2026")'
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", minWidth: 180 }}
            required
          />
          <button className="primary-button" type="submit" disabled={registering}>
            {registering ? "Mendaftarkan..." : "+ Tambah"}
          </button>
        </form>
        {registerError && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--red-600, #c0392b)" }}>{registerError}</div>
        )}
      </div>
    </div>
  );
}
