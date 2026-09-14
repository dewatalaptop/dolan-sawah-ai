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
    </div>
  );
}
