// ============================================================
// Komponen UI kecil yang dipakai lintas halaman (App.jsx dan halaman
// mandiri seperti MokaSalesPage.jsx) -- dipisah dari App.jsx supaya
// halaman baru bisa memakainya tanpa import melingkar balik ke App.jsx.
// ============================================================

const ICONS = {
  chat: "M4 4h16v12H7l-3 3V4z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  cart: "M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18H18a2 2 0 0 0 2-1.6L21.5 8H6",
  truck: "M2 7h11v9H2zM13 10h5l3 3v3h-8zM6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M9 9.5c0-1 1-1.8 3-1.8s3 .8 3 1.8-1 1.5-3 1.8-3 .8-3 1.9 1 1.8 3 1.8 3-.8 3-1.8",
  box: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  leaf: "M20 4C10 4 4 10 4 18c8 0 14-6 16-14zM4 20c4-4 8-8 16-16",
  trend: "M3 17l6-6 4 4 8-8M15 6h6v6",
  tag: "M20 12l-8 8-9-9V4h7l10 8zM7 7h.01",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6M9 8h2",
  book: "M4 5c0-1 1-2 3-2h5v16H7c-2 0-3 1-3 2zM12 3h5c2 0 3 1 3 2v14c0-1-1-2-3-2h-5z",
  check: "M4 6h13v13H4zM7.5 12.5l2.5 2.5 5-5M17 6V4h3v3",
  calendar: "M5 4h14v16H5zM5 9h14M8 2v4M16 2v4M9 13h2M13 13h2M9 17h2M13 17h2",
  alert: "M12 3l10 18H2zM12 9v5M12 17h.01",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  sparkle: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z",
  bell: "M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10zM10 19a2 2 0 0 0 4 0",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
  close: "M6 6l12 12M18 6L6 18",
  expand: "M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5",
  compress: "M4 9h5V4M15 4v5h5M9 20v-5H4M20 15h-5v5"
};

export function Icon({ name, size = 17 }) {
  const path = ICONS[name] || ICONS.doc;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export function StatCard({ title, value, subtitle, icon, tone = "green" }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon tone-${tone}`}>
        <Icon name={icon} size={19} />
      </div>
      <div>
        <div className="stat-title">{title}</div>
        <div className="stat-value">{value}</div>
        {subtitle && <div className="stat-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

export function DataTable({ columns, rows, emptyText = "Belum ada data." }) {
  return (
    <div className="table-wrapper">
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="box" size={26} /></div>
          <div className="empty-title">{emptyText}</div>
          <div className="empty-description">Kirim data melalui AI Assistant atau import Excel.</div>
        </div>
      ) : (
        <table>
          <thead>
            <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
