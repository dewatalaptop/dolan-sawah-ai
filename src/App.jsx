import { useState } from "react";

function App() {
  const [message, setMessage] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "assistant",
      text: "Halo! Saya Dolan Sawah AI. Saya siap membantu Anda menganalisis bisnis, penjualan, inventory, dan strategi Dolan Sawah.",
    },
  ]);

  const suggestions = [
    {
      icon: "◉",
      text: "Analisis penjualan hari ini",
    },
    {
      icon: "↗",
      text: "Analisis laba rugi outlet",
    },
    {
      icon: "◫",
      text: "Prediksi kebutuhan bahan",
    },
    {
      icon: "✦",
      text: "Buat strategi marketing",
    },
  ];

  const generateAIResponse = (question) => {
    const q = question.toLowerCase();

    if (q.includes("penjualan")) {
      return "Baik. Saya akan membantu menganalisis penjualan Dolan Sawah. Untuk analisis yang lebih akurat, nantinya saya akan membaca data penjualan dari Firebase berdasarkan periode, outlet, menu, dan jumlah transaksi.";
    }

    if (
      q.includes("laba") ||
      q.includes("rugi") ||
      q.includes("profit")
    ) {
      return "Saya bisa menganalisis laba dan rugi berdasarkan omzet, HPP, biaya operasional, dan margin setiap outlet. Pada tahap berikutnya data tersebut akan saya ambil langsung dari database Dolan Sawah.";
    }

    if (
      q.includes("bahan") ||
      q.includes("inventory") ||
      q.includes("stok")
    ) {
      return "Saya dapat membantu menghitung kebutuhan bahan berdasarkan penjualan dan master resep. Nantinya sistem dapat memberikan rekomendasi pembelian seperti ayam, daging, beras, sayuran, dan bahan lainnya.";
    }

    if (
      q.includes("marketing") ||
      q.includes("promosi") ||
      q.includes("promo")
    ) {
      return "Saya dapat membantu membuat strategi marketing berdasarkan kondisi bisnis, tren penjualan, hari dalam minggu, periode ramai, periode sepi, dan performa promo.";
    }

    return "Saya mengerti pertanyaan Anda. Saat ini saya masih berada dalam mode prototype. Pada tahap berikutnya kita akan menghubungkan saya dengan Gemini dan Firebase sehingga saya dapat menjawab berdasarkan data bisnis Dolan Sawah yang sebenarnya.";
  };

  const sendMessage = (text = message) => {
    const cleanText = text.trim();

    if (!cleanText || isThinking) return;

    const userMessage = {
      id: Date.now(),
      role: "user",
      text: cleanText,
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setIsThinking(true);

    setTimeout(() => {
      const response = generateAIResponse(cleanText);

      const aiMessage = {
        id: Date.now() + 1,
        role: "assistant",
        text: response,
      };

      setMessages((prev) => [...prev, aiMessage]);
      setIsThinking(false);
    }, 900);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const newChat = () => {
    setMessages([
      {
        id: Date.now(),
        role: "assistant",
        text: "Percakapan baru dimulai. Apa yang ingin Anda analisis?",
      },
    ]);

    setMessage("");
  };

  return (
    <div style={styles.app}>

      {/* ================= SIDEBAR ================= */}

      <aside style={styles.sidebar}>

        <div style={styles.logoArea}>
          <div style={styles.logo}>DS</div>

          <div>
            <div style={styles.logoTitle}>Dolan Sawah</div>
            <div style={styles.logoSubtitle}>
              AI Business Assistant
            </div>
          </div>
        </div>

        <button
          style={styles.newChat}
          onClick={newChat}
        >
          <span style={styles.plus}>+</span>
          Percakapan Baru
        </button>

        <div style={styles.menuSection}>

          <div style={styles.menuLabel}>
            MENU
          </div>

          <div style={styles.menuItemActive}>
            <span>✦</span>
            AI Assistant
          </div>

          <div style={styles.menuItem}>
            <span>▣</span>
            Dashboard
          </div>

          <div style={styles.menuItem}>
            <span>◷</span>
            Analisis Penjualan
          </div>

          <div style={styles.menuItem}>
            <span>◈</span>
            Inventory
          </div>

          <div style={styles.menuItem}>
            <span>◎</span>
            Marketing
          </div>

          <div style={styles.menuItem}>
            <span>▤</span>
            Laporan
          </div>

        </div>

        <div style={styles.sidebarBottom}>

          <div style={styles.menuItem}>
            <span>⚙</span>
            Pengaturan
          </div>

          <div style={styles.userBox}>

            <div style={styles.avatar}>
              Y
            </div>

            <div>
              <div style={styles.userName}>
                Dolan Sawah
              </div>

              <div style={styles.userRole}>
                Administrator
              </div>
            </div>

          </div>

        </div>

      </aside>


      {/* ================= MAIN ================= */}

      <main style={styles.main}>

        {/* HEADER */}

        <header style={styles.header}>

          <div>
            <div style={styles.pageTitle}>
              AI Assistant
            </div>

            <div style={styles.pageSubtitle}>
              Asisten bisnis untuk Dolan Sawah
            </div>
          </div>

          <div style={styles.status}>
            <span style={styles.statusDot}></span>
            AI Online
          </div>

        </header>


        {/* ================= CHAT ================= */}

        <section style={styles.chatContainer}>

          {/* WELCOME */}

          {messages.length === 1 && (
            <div style={styles.hero}>

              <div style={styles.aiIcon}>
                ✦
              </div>

              <h1 style={styles.heroTitle}>
                Selamat datang di{" "}
                <span style={styles.gradientText}>
                  Dolan Sawah AI
                </span>
              </h1>

              <p style={styles.heroText}>
                Asisten AI yang membantu Anda memahami
                bisnis, menganalisis data, dan mengambil
                keputusan dengan lebih cepat.
              </p>

            </div>
          )}


          {/* MESSAGES */}

          <div style={styles.messages}>

            {messages.map((item) => (

              <div
                key={item.id}
                style={{
                  ...styles.messageRow,
                  justifyContent:
                    item.role === "user"
                      ? "flex-end"
                      : "flex-start",
                }}
              >

                {item.role === "assistant" && (
                  <div style={styles.smallAI}>
                    ✦
                  </div>
                )}

                <div
                  style={
                    item.role === "user"
                      ? styles.userBubble
                      : styles.aiBubble
                  }
                >
                  {item.text}
                </div>

              </div>

            ))}

            {isThinking && (

              <div style={styles.messageRow}>

                <div style={styles.smallAI}>
                  ✦
                </div>

                <div style={styles.aiBubble}>
                  <span style={styles.thinking}>
                    AI sedang berpikir...
                  </span>
                </div>

              </div>

            )}

          </div>


          {/* QUICK ACTION */}

          {messages.length === 1 && (

            <div style={styles.quickSection}>

              <div style={styles.sectionTitle}>
                Apa yang ingin Anda lakukan?
              </div>

              <div style={styles.cards}>

                {suggestions.map((item, index) => (

                  <button
                    key={index}
                    style={styles.card}
                    onClick={() =>
                      sendMessage(item.text)
                    }
                  >

                    <div style={styles.cardIcon}>
                      {item.icon}
                    </div>

                    <div style={styles.cardText}>
                      {item.text}
                    </div>

                    <div style={styles.cardArrow}>
                      →
                    </div>

                  </button>

                ))}

              </div>

            </div>

          )}


          {/* INPUT */}

          <div style={styles.chatArea}>

            <div style={styles.inputWrapper}>

              <textarea
                value={message}
                onChange={(e) =>
                  setMessage(e.target.value)
                }
                onKeyDown={handleKeyDown}
                placeholder="Tanyakan sesuatu tentang bisnis Dolan Sawah..."
                style={styles.textarea}
                rows={1}
              />

              <button
                onClick={() => sendMessage()}
                style={{
                  ...styles.sendButton,
                  opacity:
                    message.trim() && !isThinking
                      ? 1
                      : 0.45,
                }}
              >
                ↑
              </button>

            </div>

            <div style={styles.inputHint}>
              Tekan Enter untuk mengirim · Shift + Enter
              untuk baris baru
            </div>

          </div>

        </section>


        {/* FOOTER */}

        <footer style={styles.footer}>
          <span>Dolan Sawah AI</span>
          <span>•</span>
          <span>Powered by Nuvora Systems</span>
        </footer>

      </main>

    </div>
  );
}


/* ================= STYLES ================= */

const styles = {

  app: {
    minHeight: "100vh",
    display: "flex",
    background: "#f7f9fc",
    color: "#172033",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },

  sidebar: {
    width: "250px",
    minHeight: "100vh",
    background: "#ffffff",
    borderRight: "1px solid #e7ebf2",
    display: "flex",
    flexDirection: "column",
    padding: "24px 16px",
    boxSizing: "border-box",
  },

  logoArea: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "0 8px 28px",
  },

  logo: {
    width: "42px",
    height: "42px",
    borderRadius: "13px",
    background:
      "linear-gradient(135deg, #2563eb, #7c3aed)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "800",
    fontSize: "14px",
    boxShadow:
      "0 8px 20px rgba(37,99,235,0.20)",
  },

  logoTitle: {
    fontSize: "15px",
    fontWeight: "750",
  },

  logoSubtitle: {
    fontSize: "11px",
    color: "#8a94a6",
    marginTop: "3px",
  },

  newChat: {
    width: "100%",
    border: "1px solid #dce3ef",
    background: "#ffffff",
    borderRadius: "11px",
    padding: "11px 13px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#25324a",
    cursor: "pointer",
    marginBottom: "28px",
  },

  plus: {
    fontSize: "20px",
    color: "#2563eb",
  },

  menuSection: {
    flex: 1,
  },

  menuLabel: {
    fontSize: "10px",
    fontWeight: "700",
    color: "#9aa4b5",
    letterSpacing: "1px",
    padding: "0 10px 10px",
  },

  menuItem: {
    padding: "11px 12px",
    borderRadius: "9px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    color: "#657084",
    fontSize: "13px",
    marginBottom: "4px",
    cursor: "pointer",
  },

  menuItemActive: {
    padding: "11px 12px",
    borderRadius: "9px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    color: "#2563eb",
    background: "#eff5ff",
    fontSize: "13px",
    fontWeight: "650",
    marginBottom: "4px",
  },

  sidebarBottom: {
    borderTop: "1px solid #edf0f5",
    paddingTop: "14px",
  },

  userBox: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px 8px 4px",
  },

  avatar: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "#e8eefc",
    color: "#2563eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "700",
    fontSize: "13px",
  },

  userName: {
    fontSize: "12px",
    fontWeight: "650",
  },

  userRole: {
    fontSize: "10px",
    color: "#9aa4b5",
    marginTop: "2px",
  },

  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  header: {
    height: "72px",
    background: "rgba(255,255,255,0.90)",
    borderBottom: "1px solid #e7ebf2",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 34px",
    boxSizing: "border-box",
  },

  pageTitle: {
    fontSize: "16px",
    fontWeight: "700",
  },

  pageSubtitle: {
    fontSize: "11px",
    color: "#8b95a7",
    marginTop: "3px",
  },

  status: {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    fontSize: "11px",
    color: "#657084",
    background: "#f7f9fc",
    border: "1px solid #e5e9f0",
    borderRadius: "20px",
    padding: "7px 11px",
  },

  statusDot: {
    width: "7px",
    height: "7px",
    background: "#22c55e",
    borderRadius: "50%",
    display: "inline-block",
  },

  chatContainer: {
    width: "100%",
    maxWidth: "950px",
    margin: "0 auto",
    padding: "55px 32px 30px",
    boxSizing: "border-box",
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },

  hero: {
    textAlign: "center",
    maxWidth: "680px",
    margin: "0 auto 35px",
  },

  aiIcon: {
    width: "52px",
    height: "52px",
    margin: "0 auto 20px",
    borderRadius: "16px",
    background:
      "linear-gradient(135deg, #2563eb, #7c3aed)",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "25px",
    boxShadow:
      "0 12px 30px rgba(79,70,229,0.20)",
  },

  heroTitle: {
    fontSize: "34px",
    lineHeight: "1.2",
    margin: 0,
    fontWeight: "800",
    letterSpacing: "-1px",
  },

  gradientText: {
    background:
      "linear-gradient(90deg, #2563eb, #7c3aed)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },

  heroText: {
    maxWidth: "580px",
    margin: "16px auto 0",
    color: "#778195",
    fontSize: "14px",
    lineHeight: "1.7",
  },

  messages: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    marginBottom: "25px",
  },

  messageRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "9px",
  },

  smallAI: {
    width: "30px",
    height: "30px",
    minWidth: "30px",
    borderRadius: "9px",
    background:
      "linear-gradient(135deg, #2563eb, #7c3aed)",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
  },

  aiBubble: {
    maxWidth: "75%",
    background: "#ffffff",
    border: "1px solid #e4e9f1",
    borderRadius: "4px 14px 14px 14px",
    padding: "12px 15px",
    color: "#4c586d",
    fontSize: "13px",
    lineHeight: "1.6",
    boxShadow:
      "0 3px 12px rgba(31,41,55,0.03)",
  },

  userBubble: {
    maxWidth: "75%",
    background:
      "linear-gradient(135deg, #2563eb, #4f46e5)",
    color: "#ffffff",
    borderRadius: "14px 4px 14px 14px",
    padding: "12px 15px",
    fontSize: "13px",
    lineHeight: "1.6",
    boxShadow:
      "0 5px 15px rgba(37,99,235,0.15)",
  },

  thinking: {
    color: "#8b95a7",
    fontStyle: "italic",
  },

  quickSection: {
    marginBottom: "25px",
  },

  sectionTitle: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#69758a",
    marginBottom: "12px",
  },

  cards: {
    display: "grid",
    gridTemplateColumns:
      "repeat(2, minmax(0, 1fr))",
    gap: "10px",
  },

  card: {
    border: "1px solid #e5eaf2",
    background: "#ffffff",
    borderRadius: "12px",
    padding: "15px",
    display: "flex",
    alignItems: "center",
    textAlign: "left",
    gap: "12px",
    cursor: "pointer",
    color: "#26334a",
  },

  cardIcon: {
    width: "34px",
    height: "34px",
    borderRadius: "9px",
    background: "#f1f5ff",
    color: "#356de8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "15px",
  },

  cardText: {
    flex: 1,
    fontSize: "12px",
    fontWeight: "600",
  },

  cardArrow: {
    color: "#a1aabd",
    fontSize: "16px",
  },

  chatArea: {
    marginTop: "auto",
  },

  inputWrapper: {
    display: "flex",
    alignItems: "flex-end",
    gap: "10px",
    background: "#ffffff",
    border: "1px solid #dce3ed",
    borderRadius: "15px",
    padding: "10px 10px 10px 16px",
    boxShadow:
      "0 8px 30px rgba(31,41,55,0.06)",
  },

  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: "#26334a",
    background: "transparent",
    minHeight: "24px",
    maxHeight: "100px",
  },

  sendButton: {
    width: "38px",
    height: "38px",
    border: "none",
    borderRadius: "10px",
    background:
      "linear-gradient(135deg, #2563eb, #4f46e5)",
    color: "#ffffff",
    fontSize: "20px",
    cursor: "pointer",
  },

  inputHint: {
    textAlign: "center",
    fontSize: "10px",
    color: "#a2aaba",
    marginTop: "9px",
  },

  footer: {
    padding: "15px 30px",
    borderTop: "1px solid #e9edf3",
    color: "#a0a8b6",
    fontSize: "10px",
    display: "flex",
    justifyContent: "center",
    gap: "7px",
  },
};

export default App;