// ============================================================
// BELI vs PAKAI -- ke mana barang yang dibeli pergi.
// Menggabungkan barang datang (Dolan Order, disinkronkan ke `receiving` oleh fungsi syncDolanOrder), penjualan per menu
// (`sales`), resep (`master_recipes`) dan waste (`waste`). Perhitungan ada di lossEngine.js (diuji); halaman ini hanya memuat
// data, menampilkan, dan menyimpan tautan bahan (settings/ingredientLinks).
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, setDoc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { Icon, StatCard, DataTable } from "./uiKit";
import { computeLoss, norm } from "./lossEngine";

const rupiah = (n) => `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n || 0))}`;
const qty = (n) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Math.round((n || 0) * 100) / 100);
const todayIso = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const monthStart = (iso) => iso.slice(0, 8) + "01";
const CAT = { pasar: "Belanja Pusat", keringan: "Keringan", ayam: "Ayam", buah: "Buah", sayur: "Sayur", bebek: "Bebek", lain: "Lain" };

const STATUS = {
  wajar: ["Wajar", "badge-ok", "Selisih dalam toleransi."],
  "selisih-lebih": ["Datang > terpakai", "badge-warning", "Barang datang lebih banyak daripada yang terpakai menurut resep. Bisa stok masih ada, waste yang belum dicatat, porsi lebih besar dari resep, atau hilang."],
  "terpakai-melebihi": ["Terpakai > datang", "badge-warning", "Pemakaian menurut resep melebihi barang datang di periode ini: stok lama terpakai, atau ada pembelian yang tidak tercatat."],
  "tanpa-resep": ["Tanpa resep", "badge", "Tidak ada resep yang memakai barang ini, jadi pemakaiannya belum bisa dijelaskan."],
  "belum-terpakai": ["Belum ada penjualan", "badge", "Ada resep, tetapi tidak ada penjualan menu terkait di periode ini (atau penjualan belum diinput)."],
  "satuan-beda": ["Satuan beda", "badge", "Satuan resep tidak sebanding dengan satuan beli (mis. resep kg, beli pcs). Tidak dihitung."],
};

function periodRange(key, today) {
  if (key === "bulan") return { from: monthStart(today), to: today };
  if (key === "lalu") { const e = addDays(monthStart(today), -1); return { from: monthStart(e), to: e }; }
  if (key === "7") return { from: addDays(today, -6), to: today };
  return { from: addDays(today, -29), to: today };
}

export default function LossPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("bulan");
  const [outlet, setOutlet] = useState("ALL");
  const [tab, setTab] = useState("barang");
  const [statusFilter, setStatusFilter] = useState("semua");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const get = async (n) => (await getDocs(collection(db, n))).docs.map((d) => ({ id: d.id, ...d.data() }));
      const [receiving, sales, recipes, waste, mirror, linksDoc, syncDoc, biz] = await Promise.all([
        get("receiving"), get("sales"), get("master_recipes"), get("waste"), get("order_items_mirror"),
        getDoc(doc(db, "settings", "ingredientLinks")), getDoc(doc(db, "settings", "doOrderSync")), getDoc(doc(db, "settings", "business")),
      ]);
      setData({ receiving, sales, recipes, waste, mirror, links: linksDoc.exists() ? linksDoc.data().links || {} : {}, sync: syncDoc.exists() ? syncDoc.data() : null, tol: biz.exists() ? Number(biz.data().targetVarianceMaxPercent) : NaN });
    } catch (e) { console.error(e); setError(e.message || "Gagal memuat data."); }
  }, []);
  useEffect(() => { load(); }, [load]);   // eslint-disable-line react-hooks/set-state-in-effect

  const today = todayIso();
  const { from, to } = periodRange(period, today);
  const outlets = useMemo(() => {
    if (!data) return [];
    const s = new Set(); data.receiving.forEach((r) => r.outlet && s.add(r.outlet)); data.sales.forEach((r) => s.add(r.outlet || "DS"));
    return [...s].sort();
  }, [data]);

  const result = useMemo(() => data && computeLoss({ ...data, from, to, outlet, tolerancePct: Number.isFinite(data.tol) && data.tol > 0 ? data.tol : 10 }), [data, from, to, outlet]);

  async function saveLinks(next) {
    setSaving(true);
    try { await setDoc(doc(db, "settings", "ingredientLinks"), { links: next, updatedAt: new Date().toISOString() }); setData((d) => ({ ...d, links: next })); }
    catch (e) { setError("Gagal menyimpan tautan: " + (e.message || e)); } finally { setSaving(false); }
  }

  if (error && !data) return <div className="empty-state"><div className="empty-icon"><Icon name="alert" size={26} /></div><div className="empty-title">Gagal memuat</div><div className="empty-description">{error}</div><button className="btn-primary" type="button" onClick={load}>Coba lagi</button></div>;
  if (!data || !result) return <div className="empty-state"><div className="ds-spinner" style={{ marginBottom: 10 }} /><div className="empty-title">Memuat data...</div></div>;

  const { kpi, coverage } = result;
  const lowCoverage = (coverage.portionsPct ?? 0) < 60 || (coverage.purchaseValuePct ?? 0) < 60;
  const todo = result.noRecipeMenus.length + result.unlinkedIngredients.length;
  const rows = result.rows.filter((r) => statusFilter === "semua" || r.status === statusFilter);
  const syncAt = data.sync?.at ? new Date(data.sync.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div>
      <div className="card">
        <div className="card-title">Beli vs Pakai — ke mana barang pergi</div>
        <div className="card-description">
          Barang datang (Dolan Order) dikurangi pemakaian menurut resep × penjualan, dikurangi waste yang tercatat. Sisanya = selisih belum terjelaskan.
          {syncAt ? ` Sinkron Dolan Order terakhir: ${syncAt} (${data.sync.rows} baris).` : " Belum ada sinkron dari Dolan Order."}
        </div>
      </div>

      <div className="month-switcher">
        <div className="month-switcher-label"><Icon name="calendar" size={14} /> Periode:</div>
        <div className="month-pills">
          {[["bulan", "Bulan ini"], ["lalu", "Bulan lalu"], ["7", "7 hari"], ["30", "30 hari"]].map(([k, l]) => (
            <button key={k} type="button" className={`month-pill${period === k ? " active" : ""}`} onClick={() => setPeriod(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="month-switcher">
        <div className="month-switcher-label">Outlet:</div>
        <div className="month-pills">
          {["ALL", ...outlets].map((o) => (
            <button key={o} type="button" className={`month-pill${outlet === o ? " active" : ""}`} onClick={() => setOutlet(o)}>{o === "ALL" ? "Semua" : o === "SEMUA" ? "Tanpa pesanan outlet" : o}</button>
          ))}
        </div>
      </div>
      <p className="card-description" style={{ margin: "4px 2px 12px" }}>{from} s/d {to}. Pembagian barang datang ke outlet = perkiraan sebanding jumlah yang dipesan tiap outlet.</p>

      {lowCoverage && (
        <div className="card" style={{ borderLeft: "4px solid var(--orange-500, #e4692a)" }}>
          <div className="card-title"><Icon name="alert" size={15} /> Angka belum mewakili semua barang</div>
          <div className="card-description">
            Baru {coverage.portionsPct === null ? "—" : Math.round(coverage.portionsPct)}% porsi terjual yang punya resep tertaut, dan {coverage.purchaseValuePct === null ? "—" : Math.round(coverage.purchaseValuePct)}% nilai pembelian berbahan yang ada di resep
            ({coverage.recipes} resep). Selisih di bawah hanya untuk barang yang sudah punya resep; sisanya tampil di tab "Perlu dilengkapi". Makin lengkap resep dan penjualan per menu, makin tajam hasilnya.
          </div>
        </div>
      )}

      <div className="stat-grid">
        <StatCard title="Nilai barang datang" value={rupiah(kpi.receivedValue)} subtitle={kpi.receivedValueUnknownItems ? `${kpi.receivedValueUnknownItems} barang tanpa harga` : "semua berharga"} icon="cart" tone="green" />
        <StatCard title="Terpakai (resep)" value={rupiah(kpi.usedValue)} subtitle={`${kpi.analyzedItems} dari ${kpi.totalItems} barang teranalisis`} icon="leaf" tone="green" />
        <StatCard title="Waste tercatat" value={rupiah(kpi.wasteValue)} subtitle={result.wasteUnmatched ? `${result.wasteUnmatched} catatan waste tak dikenali` : "dari catatan waste"} icon="trend" tone="orange" />
        <StatCard title="Datang > terpakai" value={rupiah(kpi.unexplainedValue)} subtitle={kpi.unexplainedNoPrice ? `+ ${kpi.unexplainedNoPrice} barang tanpa harga` : "belum terjelaskan"} icon="alert" tone="orange" />
        <StatCard title="Terpakai > datang" value={rupiah(kpi.overUsedValue)} subtitle="stok lama / catatan kurang" icon="arrowDown" tone="green" />
        <StatCard title="Cakupan resep" value={coverage.portionsPct === null ? "—" : `${Math.round(coverage.portionsPct)}%`} subtitle={`${qty(coverage.portionsWithRecipe)} dari ${qty(coverage.portionsAll)} porsi terjual`} icon="book" tone="green" />
      </div>

      <div className="month-switcher">
        <div className="month-pills">
          {[["barang", "Per barang"], ["outlet", "Per outlet & kategori"], ["lengkapi", `Perlu dilengkapi${todo ? ` (${todo})` : ""}`], ["tautan", "Tautan bahan"]].map(([k, l]) => (
            <button key={k} type="button" className={`month-pill${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "barang" && (
        <div className="card">
          <div className="card-title">Per barang</div>
          <div className="card-description">
            Toleransi selisih {result.tolerancePct}% (Pengaturan). Tanpa stok opname, "datang &gt; terpakai" bisa berupa stok yang masih ada — bukan pasti hilang.
          </div>
          <div style={{ margin: "8px 0" }}>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter status">
              <option value="semua">Semua status</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
            </select>
          </div>
          <DataTable
            emptyText="Belum ada barang datang pada periode ini."
            columns={["Barang", "Kategori", "Datang", "Terpakai", "Waste", "Selisih", "%", "Nilai selisih", "Status"]}
            rows={rows.map((r) => [
              r.name, CAT[r.cat] || r.cat || "-", `${qty(r.recv)} ${r.unit}`, `${qty(r.usage)} ${r.unit}`, r.waste ? `${qty(r.waste)} ${r.unit}` : "-",
              ["tanpa-resep", "satuan-beda", "belum-terpakai"].includes(r.status) ? "-" : `${r.unexplained > 0 ? "+" : ""}${qty(r.unexplained)} ${r.unit}`,
              ["tanpa-resep", "satuan-beda", "belum-terpakai"].includes(r.status) || r.pct === null ? "-" : `${Math.round(r.pct)}%`,
              ["tanpa-resep", "satuan-beda", "belum-terpakai"].includes(r.status) ? "-" : r.unexplainedValue === null ? "harga ?" : rupiah(r.unexplainedValue),
              <span key="s" className={`badge ${STATUS[r.status][1]}`} title={STATUS[r.status][2]}>{STATUS[r.status][0]}</span>,
            ])}
          />
        </div>
      )}

      {tab === "outlet" && (
        <>
          <div className="card">
            <div className="card-title">Per outlet</div>
            <div className="card-description">Selisih "datang &gt; terpakai" per outlet (perkiraan: barang datang dibagi sebanding pesanan).</div>
            <DataTable emptyText="Belum ada data." columns={["Outlet", "Nilai datang", "Selisih (datang > terpakai)", "% dari nilai datang"]}
              rows={result.byOutlet.map((o) => [o.outlet === "SEMUA" ? "Tanpa pesanan outlet" : o.outlet, rupiah(o.recvValue), rupiah(o.unexplainedValue), o.recvValue > 0 ? `${Math.round((o.unexplainedValue / o.recvValue) * 100)}%` : "-"])} />
          </div>
          <div className="card">
            <div className="card-title">Per kategori</div>
            <DataTable emptyText="Belum ada data." columns={["Kategori", "Barang", "Nilai datang", "Selisih (datang > terpakai)"]}
              rows={result.byCat.map((c) => [CAT[c.cat] || c.cat, c.items, rupiah(c.recvValue), rupiah(c.unexplainedValue)])} />
          </div>
        </>
      )}

      {tab === "lengkapi" && (
        <>
          <div className="card">
            <div className="card-title">Menu terjual tanpa resep ({result.noRecipeMenus.length})</div>
            <div className="card-description">Pemakaian bahan menu ini belum dihitung. Buat resepnya di menu Resep (nama menu harus sama).</div>
            <DataTable emptyText="Semua menu terjual sudah punya resep." columns={["Menu", "Porsi terjual"]} rows={result.noRecipeMenus.map((m) => [m.menuName, qty(m.qty)])} />
          </div>
          <div className="card">
            <div className="card-title">Bahan resep yang belum tertaut ke barang ({result.unlinkedIngredients.length})</div>
            <div className="card-description">Tautkan di tab "Tautan bahan" supaya pemakaiannya bisa dibandingkan dengan barang datang.</div>
            <DataTable emptyText="Semua bahan resep sudah tertaut." columns={["Bahan di resep", "Dipakai di menu"]} rows={result.unlinkedIngredients.map((u) => [u.name, u.menus.join(", ")])} />
          </div>
        </>
      )}

      {tab === "tautan" && <LinksTab data={data} result={result} saving={saving} onSave={saveLinks} />}
      {error && <p className="card-description" role="alert" style={{ color: "var(--red-600, #c0392b)" }}>{error}</p>}
    </div>
  );
}

function LinksTab({ data, result, saving, onSave }) {
  const [pick, setPick] = useState({});
  const [q, setQ] = useState({});
  const link = (name, id) => onSave({ ...data.links, [norm(name)]: id });
  const unlink = (k) => { const n = { ...data.links }; delete n[k]; onSave(n); };
  const nameOf = (id) => id === "none" ? "Tidak dilacak" : data.mirror.find((m) => m.id === id)?.name || id;
  return (
    <>
      <div className="card">
        <div className="card-title">Bahan resep belum tertaut ({result.unlinkedIngredients.length})</div>
        <div className="card-description">Pilih barang di katalog Dolan Order yang dimaksud bahan resep. Atau pilih "Tidak dilacak" untuk bumbu/bahan yang memang tidak dibeli lewat Dolan Order.</div>
        {result.unlinkedIngredients.length === 0 && <div className="empty-description">Semua bahan resep sudah tertaut.</div>}
        {result.unlinkedIngredients.map((u) => {
          const k = norm(u.name), term = norm(q[k] || "");
          const search = term ? data.mirror.filter((m) => term.split(" ").every((w) => norm(m.name).includes(w))).slice(0, 8) : [];
          const options = [...u.candidates, ...search.filter((s) => !u.candidates.some((c) => c.id === s.id))];
          return (
            <div key={k} style={{ borderTop: "1px solid var(--line, #e5e5e5)", padding: "10px 0" }}>
              <b>{u.name}</b> <span className="card-description">— dipakai di {u.menus.join(", ")}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                <input aria-label={`Cari barang untuk ${u.name}`} placeholder="Cari barang katalog…" value={q[k] || ""} onChange={(e) => setQ({ ...q, [k]: e.target.value })} />
                <select aria-label={`Barang untuk ${u.name}`} value={pick[k] || ""} onChange={(e) => setPick({ ...pick, [k]: e.target.value })}>
                  <option value="">{options.length ? "Pilih barang…" : "Ketik untuk mencari"}</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({CAT[o.cat] || o.cat}, {o.unit})</option>)}
                </select>
                <button type="button" className="btn-primary" disabled={!pick[k] || saving} onClick={() => link(u.name, pick[k])}>Tautkan</button>
                <button type="button" className="btn-secondary" disabled={saving} onClick={() => link(u.name, "none")}>Tidak dilacak</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <div className="card-title">Tautan tersimpan</div>
        <DataTable emptyText="Belum ada tautan manual." columns={["Bahan di resep", "Barang katalog", ""]}
          rows={Object.entries(data.links).map(([k, id]) => [k, nameOf(id), <button key={k} type="button" className="btn-secondary" disabled={saving} onClick={() => unlink(k)}>Lepas</button>])} />
      </div>
    </>
  );
}
