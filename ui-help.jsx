/* ================= FocusDAW — Help Dialog (Manual) + About Dialog ================= */

function HelpDialog({ onClose, standalone = false }) {
  const scrollContainerRef = React.useRef(null);
  const matchesRef = React.useRef([]);
  const [lang, setLang] = React.useState(() => localStorage.getItem("focusdaw-manual-lang") || "ko");
  const [activeSection, setActiveSection] = React.useState("overview");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchIndex, setSearchIndex] = React.useState(-1);
  const [searchCount, setSearchCount] = React.useState(0);

  React.useEffect(() => {
    if (!standalone) return;
    const applyTheme = (nextTheme) => {
      const root = document.documentElement;
      if (!nextTheme || nextTheme === "default") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", nextTheme);
    };
    applyTheme(localStorage.getItem("focusdaw-theme") || "default");
    const channel = new BroadcastChannel("focusdaw-theme-sync");
    const onTheme = (e) => {
      if (e.data && e.data.type === "THEME_CHANGED") applyTheme(e.data.theme);
    };
    const onStorage = (e) => {
      if (e.key === "focusdaw-theme") applyTheme(e.newValue || "default");
    };
    channel.addEventListener("message", onTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      channel.removeEventListener("message", onTheme);
      channel.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [standalone]);

  const changeLang = (l) => {
    setLang(l);
    localStorage.setItem("focusdaw-manual-lang", l);
  };

  const sections = lang === "ko" ? [
    { id: "overview", label: "1. 앱 개요" },
    { id: "start", label: "2. 시작과 프로젝트" },
    { id: "import", label: "3. 오디오 가져오기" },
    { id: "record", label: "4. 오디오 녹음 · 클립 편집" },
    { id: "arrange", label: "5. 타임라인과 트랙" },
    { id: "bpm", label: "6. BPM 표시 및 설정" },
    { id: "key", label: "7. Key 표시 및 설정" },
    { id: "automation", label: "8. 볼륨 오토메이션" },
    { id: "mixer", label: "9. 믹서와 마스터" },
    { id: "advfx", label: "10. 고급 이펙트" },
    { id: "export", label: "11. 믹스다운 내보내기" },
    { id: "settings", label: "12. 설정 · 오디오 장치 · 테마" },
    { id: "shortcuts", label: "13. 단축키" },
    { id: "tips", label: "14. 문제 해결" },
  ] : [
    { id: "overview", label: "1. App Overview" },
    { id: "start", label: "2. Start & Projects" },
    { id: "import", label: "3. Importing Audio" },
    { id: "record", label: "4. Recording & Clip Editing" },
    { id: "arrange", label: "5. Timeline & Tracks" },
    { id: "bpm", label: "6. BPM Display & Settings" },
    { id: "key", label: "7. Key Display & Settings" },
    { id: "automation", label: "8. Volume Automation" },
    { id: "mixer", label: "9. Mixer & Master" },
    { id: "advfx", label: "10. Advanced Effects" },
    { id: "export", label: "11. Exporting Mixdown" },
    { id: "settings", label: "12. Settings, Audio Devices & Themes" },
    { id: "shortcuts", label: "13. Shortcuts" },
    { id: "tips", label: "14. Troubleshooting" },
  ];

  const scrollTo = (id) => {
    setActiveSection(id);
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector("#" + id);
    if (el) {
      const containerTop = container.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const relativeTop = elTop - containerTop + container.scrollTop;
      container.scrollTo({
        top: relativeTop - 10,
        behavior: "smooth"
      });
    }
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let currentSection = "overview";
    for (const sec of sections) {
      const el = container.querySelector("#" + sec.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.top - containerRect.top <= 120) {
          currentSection = sec.id;
        }
      }
    }
    setActiveSection(currentSection);
  };

  const clearSearchMarks = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.querySelectorAll(".manual-search-hit").forEach((el) => {
      el.classList.remove("manual-search-hit");
    });
  };

  const scrollToMatch = (index) => {
    const container = scrollContainerRef.current;
    const el = matchesRef.current[index];
    if (!container || !el) return;
    clearSearchMarks();
    el.classList.add("manual-search-hit");
    const containerTop = container.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    const relativeTop = elTop - containerTop + container.scrollTop;
    container.scrollTo({ top: Math.max(0, relativeTop - 18), behavior: "smooth" });
    const section = el.closest(".manual-section");
    if (section && section.id) setActiveSection(section.id);
  };

  const refreshSearch = React.useCallback((query, preferredIndex = 0) => {
    const container = scrollContainerRef.current;
    clearSearchMarks();
    matchesRef.current = [];
    const q = query.trim().toLocaleLowerCase();
    if (!container || !q) {
      setSearchCount(0);
      setSearchIndex(-1);
      return;
    }
    const targets = Array.from(container.querySelectorAll(
      ".manual-section h2, .manual-section h3, .manual-section p, .manual-section li, .manual-section td, .manual-section th, .manual-figcaption, .manual-note, .manual-warning"
    ));
    matchesRef.current = targets.filter((el) => (el.textContent || "").toLocaleLowerCase().includes(q));
    const count = matchesRef.current.length;
    setSearchCount(count);
    if (!count) {
      setSearchIndex(-1);
      return;
    }
    const nextIndex = Math.max(0, Math.min(count - 1, preferredIndex));
    setSearchIndex(nextIndex);
    requestAnimationFrame(() => scrollToMatch(nextIndex));
  }, []);

  React.useEffect(() => {
    const id = setTimeout(() => refreshSearch(searchQuery, 0), 80);
    return () => clearTimeout(id);
  }, [searchQuery, lang, refreshSearch]);

  const goMatch = (delta) => {
    const count = matchesRef.current.length;
    if (!count) return;
    const next = (searchIndex + delta + count) % count;
    setSearchIndex(next);
    scrollToMatch(next);
  };

  return (
    <div style={standalone
      ? { position: "fixed", inset: 0, background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "stretch", zIndex: 800 }
      : { position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800 }}
      onClick={e => !standalone && e.target === e.currentTarget && onClose()}>
      
      {/* Local Styles for Manual */}
      <style>{`
        .manual-container {
          font-family: var(--ui);
          color: var(--cream-2);
          line-height: 1.6;
          font-size: 13px;
        }
        .manual-section {
          margin-bottom: 24px;
          padding: 20px 24px;
          background: var(--bg2);
          border: 1px solid var(--line);
          border-radius: 8px;
        }
        .manual-section:last-child {
          margin-bottom: 0;
        }
        .manual-h2 {
          margin: 0 0 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--line-strong);
          color: var(--amber);
          font-size: 17px;
          font-weight: 600;
        }
        .manual-h3 {
          margin: 18px 0 6px;
          color: var(--cream);
          font-size: 14px;
          font-weight: 600;
        }
        .appver-since {
          font-size: 11px;
          font-weight: 600;
          color: var(--amber);
          vertical-align: middle;
        }
        .manual-p {
          margin: 6px 0 12px;
          color: var(--cream-2);
        }
        .manual-ul, .manual-ol {
          margin: 6px 0 12px;
          padding-left: 20px;
        }
        .manual-li {
          margin: 4px 0;
          color: var(--cream-2);
        }
        .manual-code {
          padding: 1px 4px;
          border-radius: 4px;
          /* Not plain var(--surface2): in themes where the accent and surface2 are close
             (Ocean — #178CA4 behind #18B7BE text ≈ 1.6:1) the text all but disappears.
             Pulling the surface toward --bg keeps the accent readable: Ocean goes to ≈6.2:1
             and every dark theme clears 4.5:1. The chip keeps the accent colour (it is an
             emphasis element); the table header below uses body text instead. */
          background: color-mix(in srgb, var(--surface2) 15%, var(--bg) 85%);
          color: var(--amber);
          font-family: var(--mono);
          font-size: 11px;
        }
        .manual-kbd {
          padding: 1px 4px;
          border-radius: 4px;
          background: var(--surface3);
          color: var(--cream);
          font-family: var(--mono);
          font-size: 11px;
          border: 1px solid var(--line-strong);
        }
        .manual-figure {
          margin: 16px 0;
          padding: 8px;
          background: #0d0b09;
          border-radius: 8px;
          border: 1px solid var(--line);
        }
        .manual-img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 4px;
          max-height: 340px;
          object-fit: contain;
          background: #17130f;
        }
        .manual-figcaption {
          margin-top: 8px;
          color: var(--dim);
          font-size: 11px;
          text-align: center;
        }
        .manual-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 12px;
        }
        .manual-card {
          padding: 12px 14px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--surface);
        }
        .manual-card h3 {
          margin-top: 0;
        }
        .manual-table {
          width: 100%;
          border-collapse: collapse;
          margin: 12px 0;
          border-radius: 6px;
          overflow: hidden;
          font-size: 12px;
        }
        .manual-th, .manual-td {
          padding: 8px 10px;
          border: 1px solid var(--line);
          text-align: left;
          vertical-align: top;
        }
        .manual-th {
          /* Left column of every manual table. surface2 + accent text failed badly in the
             Ocean theme, where surface2 (#178CA4) and the accent (#18B7BE) are both bright
             teal — about 1.6:1, far under the 4.5:1 minimum, so the row labels were unreadable
             (사용자 보고, v1.46.0). Fixed as a FORMULA, not a per-theme exception: darken (or,
             in light themes, lighten) the surface toward --bg AND use the theme's body text
             colour instead of the accent. That pairing is ≥7:1 in all ten themes, and bold
             weight still sets the label column apart from the --cream-2 description cells. */
          background: color-mix(in srgb, var(--surface2) 30%, var(--bg) 70%);
          color: var(--cream);
          font-weight: 600;
          width: 25%;
        }
        .manual-td {
          color: var(--cream-2);
        }
        .manual-note {
          margin: 12px 0;
          padding: 8px 12px;
          border-left: 3px solid var(--amber);
          background: var(--amber-soft);
          border-radius: 6px;
          color: var(--cream-2);
        }
        .manual-warning {
          margin: 12px 0;
          padding: 8px 12px;
          border-left: 3px solid var(--red);
          background: rgba(217, 106, 78, 0.08);
          border-radius: 6px;
          color: var(--cream-2);
        }
        
        .sidebar-item {
          width: 100%;
          text-align: left;
          padding: 8px 12px;
          font-size: 12.5px;
          color: var(--cream-2);
          border-radius: 6px;
          margin-bottom: 2px;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .sidebar-item:hover {
          background: var(--surface);
          color: var(--cream);
        }
        .sidebar-item.active {
          background: var(--amber-soft);
          color: var(--amber);
          font-weight: 600;
          border: 1px solid var(--line-strong);
        }
        .manual-search-hit {
          outline: 2px solid var(--amber);
          outline-offset: 3px;
          background: var(--amber-soft) !important;
          border-radius: 5px;
        }
      `}</style>

      <div style={{ background: "var(--bg2)", border: standalone ? "none" : "1px solid var(--line-strong)", borderRadius: standalone ? 0 : 14,
        width: standalone ? "100vw" : 960, maxWidth: standalone ? "100vw" : "95vw",
        height: standalone ? "100vh" : "82vh", maxHeight: standalone ? "100vh" : "720px",
        display: "flex", flexDirection: "column", boxShadow: standalone ? "none" : "var(--shadow)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 18px", borderBottom: "1px solid var(--line)",
          WebkitAppRegion: standalone ? "drag" : "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "0 0 auto" }}>
            <Logo size={24} />
            <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>
              {lang === "ko" ? "FocusDAW Studio 사용자 메뉴얼" : "FocusDAW Studio User Manual"}
            </div>
            <div className="mono" style={{ fontSize: 10, border: "1px solid var(--line)", padding: "1px 6px", borderRadius: 4, color: "var(--dim)" }}>{"v" + (window.APP_VERSION || "0.0.0")}</div>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", maxWidth: 340, minWidth: 180,
            height: 32, padding: "0 9px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--bg)",
            WebkitAppRegion: "no-drag" }}>
            <Icon name="search" size={14} style={{ color: "var(--muted)", flex: "0 0 auto" }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  goMatch(e.shiftKey ? -1 : 1);
                }
              }}
              placeholder={lang === "ko" ? "도움말 검색" : "Search manual"}
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--cream)", fontSize: 12.5 }}
            />
            <span className="mono" style={{ minWidth: 42, textAlign: "right", fontSize: 10, color: searchQuery ? "var(--cream-2)" : "var(--faint)" }}>
              {searchQuery ? `${searchCount ? searchIndex + 1 : 0}/${searchCount}` : "0/0"}
            </span>
            <button title="Previous result" onClick={() => goMatch(-1)} disabled={!searchCount}
              style={{ width: 22, height: 22, borderRadius: 5, display: "grid", placeItems: "center", color: searchCount ? "var(--cream-2)" : "var(--faint)", outline: "none" }}>‹</button>
            <button title="Next result" onClick={() => goMatch(1)} disabled={!searchCount}
              style={{ width: 22, height: 22, borderRadius: 5, display: "grid", placeItems: "center", color: searchCount ? "var(--cream-2)" : "var(--faint)", outline: "none" }}>›</button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "0 0 auto", WebkitAppRegion: "no-drag" }}>
            {/* Language Switcher */}
            <div style={{ display: "inline-flex", background: "var(--bg)", borderRadius: 8, padding: 2, border: "1px solid var(--line)" }}>
              <button onClick={() => changeLang("ko")} style={{ padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer",
                background: lang === "ko" ? "var(--surface3)" : "transparent", color: lang === "ko" ? "var(--cream)" : "var(--muted)" }}>한글</button>
              <button onClick={() => changeLang("en")} style={{ padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer",
                background: lang === "en" ? "var(--surface3)" : "transparent", color: lang === "en" ? "var(--cream)" : "var(--muted)" }}>English</button>
            </div>
            <button className="iconbtn" onClick={onClose} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Dual Panel Body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Left Sidebar */}
          <div className="theme-scroll" style={{ width: 220, borderRight: "1px solid var(--line)", overflowY: "auto", padding: "14px 10px", background: "var(--bg)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 12px 8px" }}>
              {lang === "ko" ? "목차" : "Chapters"}
            </div>
            {sections.map((sec) => (
              <button
                key={sec.id}
                className={`sidebar-item ${activeSection === sec.id ? "active" : ""}`}
                onClick={() => scrollTo(sec.id)}
              >
                {sec.label}
              </button>
            ))}
          </div>

          {/* Right Content Area */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="manual-container theme-scroll"
            style={{ flex: 1, overflowY: "auto", padding: "24px 30px", background: "var(--surface)" }}
          >
            {/* 1. 앱 개요 / App Overview */}
            <section id="overview" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">1. 앱 개요</h2>
                  <p className="manual-p">FocusDAW Studio는 <strong>여러 개의 스템(분리 음원) 파일을 한 세션에 올려 믹스하고, 그 위에 보컬을 덧녹음(오버더빙)해 한 곡으로 완성</strong>하는 데스크톱 앱입니다. 각 트랙의 볼륨·팬·솔로·뮤트·리버브·에코를 조정하고, 마이크 입력을 Audio In 트랙에 실시간으로 녹음한 뒤, 9밴드 그래픽 EQ와 출력 이펙트로 마스터를 다듬어 MP3 또는 WAV로 내보냅니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-01-main-screen.png" alt="FocusDAW Studio 기본 화면" className="manual-img" />
                    <div className="manual-figcaption">스템을 불러온 기본 작업 화면입니다. 상단 메뉴 막대와 트랜스포트, 줌·트랙 크기 도구, 트랙 헤더와 파형, 맨 아래 OUTPUT FX 트랙으로 구성됩니다.</div>
                  </div>

                  <h3 className="manual-h3">화면 구성</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-06-screen-layout.png" alt="화면 구성 — 각 기능별 번호" className="manual-img" />
                    <div className="manual-figcaption">빈 세션 화면에 각 영역의 번호를 표시한 그림입니다. 아래 표의 번호와 대응합니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">① 타임라인(Arrange)</th><td className="manual-td">트랙과 파형, 클립, 오토메이션이 놓이는 주 작업 영역입니다.</td></tr>
                      <tr><th className="manual-th">② 시작 안내 패널</th><td className="manual-td">트랙이 없을 때만 보입니다. 여기에 파일을 끌어다 놓거나 <strong>Import Folder</strong> · <strong>Import Files</strong> · <strong>Load demo session</strong>으로 시작합니다.</td></tr>
                      <tr><th className="manual-th">③ Undo / Redo</th><td className="manual-td">실행 취소와 다시 실행입니다(<kbd className="manual-kbd">Ctrl</kbd>+<kbd className="manual-kbd">Z</kbd> / <kbd className="manual-kbd">Ctrl</kbd>+<kbd className="manual-kbd">Y</kbd>).</td></tr>
                      <tr><th className="manual-th">④ TIME 줌</th><td className="manual-td">타임라인의 가로(시간축) 확대·축소입니다.</td></tr>
                      <tr><th className="manual-th">⑤ AMP 줌</th><td className="manual-td">파형의 표시 높이(보기 배율)입니다. 실제 볼륨은 바뀌지 않습니다.</td></tr>
                      <tr><th className="manual-th">⑥ TRACK SIZE</th><td className="manual-td">트랙 행 높이를 <strong>S · M · L</strong> 중에서 고릅니다. 크기에 따라 헤더에 보이는 컨트롤 수가 달라집니다.</td></tr>
                      <tr><th className="manual-th">⑦ 타임라인 미니맵</th><td className="manual-td">곡 전체에서 현재 보고 있는 구간을 보여 줍니다. 클릭·드래그로 빠르게 이동합니다.</td></tr>
                      <tr><th className="manual-th">⑧ BPM 표시기</th><td className="manual-td">앞은 프로젝트 BPM, 뒤는 재생 BPM입니다. 클릭하면 BPM 설정 패널이 열립니다(<strong>6장</strong>).</td></tr>
                      <tr><th className="manual-th">⑨ Vari BPM 스위치</th><td className="manual-td">켜야 재생 BPM으로 실제 재생 속도가 바뀝니다(기본 꺼짐).</td></tr>
                      <tr><th className="manual-th">⑩ Key 표시기</th><td className="manual-td">감지·지정된 원곡 키와 이조된 재생 키를 표시합니다. 클릭하면 Key 패널이 열립니다(<strong>7장</strong>).</td></tr>
                      <tr><th className="manual-th">⑪ Vari Key 스위치</th><td className="manual-td">켜야 지정한 반음 오프셋이 실시간 재생에 적용됩니다(기본 꺼짐).</td></tr>
                      <tr><th className="manual-th">⑫ Mixer</th><td className="manual-td">별도 창의 믹서 콘솔을 엽니다(<kbd className="manual-kbd">F3</kbd>).</td></tr>
                      <tr><th className="manual-th">⑬ Export</th><td className="manual-td">믹스다운 내보내기 창을 엽니다(<strong>11장</strong>).</td></tr>
                      <tr><th className="manual-th">⑭ 트랜스포트</th><td className="manual-td">처음으로 · 정지 · 재생/일시정지 · <strong>Repeat</strong> · <strong>메트로놈</strong> · <strong>프리롤</strong> · <strong>Punch</strong> · <strong>Record</strong> 버튼입니다(<strong>4장 · 5장</strong>).</td></tr>
                      <tr><th className="manual-th">⑮ 시간 표시</th><td className="manual-td">현재 재생 위치와 프로젝트 전체 길이입니다.</td></tr>
                      <tr><th className="manual-th">⑯ 프로젝트 이름</th><td className="manual-td">클릭하면 그 자리에서 이름을 고칠 수 있습니다. 창 아래 상태 표시줄에도 같은 이름이 나옵니다.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">상단 메뉴 한눈에 보기</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-02-project-menu.png" alt="Project 메뉴" className="manual-img" />
                    <div className="manual-figcaption"><strong>Project</strong> — 새 프로젝트, 열기(최근 목록 포함), 저장, 다른 이름으로 저장, 스템 폴더·오디오 파일 가져오기, 데모 세션, 미사용 녹음 정리, 내보내기.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-03-edit-menu.png" alt="Edit 메뉴" className="manual-img" />
                    <div className="manual-figcaption"><strong>Edit</strong> — Undo · Redo와 <strong>Delete all tracks</strong>(트랙만 비우고 마스터 이펙트는 유지).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-04-advfx-menu.png" alt="Advanced Effects 메뉴" className="manual-img" />
                    <div className="manual-figcaption"><strong>Advanced Effects</strong> — Ambience(공간감), Auto Panning(스테레오 배치), Equalizer Setup(정밀 EQ) 전용 창을 엽니다(<strong>10장</strong>).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-05-help-menu.png" alt="Help 메뉴" className="manual-img" />
                    <div className="manual-figcaption"><strong>Help</strong> — <strong>Manual</strong>(이 문서), <strong>Release Notes</strong>(버전별 변경 사항), <strong>Check for Updates</strong>(새 버전 확인·설치), <strong>About</strong>.</div>
                  </div>
                  <p className="manual-p"><strong>Settings</strong> 메뉴는 색상 테마, 믹서 창 초기화, 오디오 장치 설정을 담고 있습니다(<strong>12장</strong>).</p>

                  <h3 className="manual-h3">트랙 크기 — S · M · L</h3>
                  <p className="manual-p">상단의 <strong>TRACK SIZE</strong>로 트랙 행 높이를 바꿉니다. 높이가 커질수록 헤더에 더 많은 컨트롤이 펼쳐지므로, <strong>오토메이션 Curve나 Audio In 트랙의 녹음 컨트롤을 다룰 때는 M 또는 L</strong>을 쓰는 것이 편합니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">S (작게)</th><td className="manual-td">이름·B·S·M 정도만 보입니다. 트랙 수가 많을 때 전체를 한눈에 훑기 좋습니다.</td></tr>
                      <tr><th className="manual-th">M (기본)</th><td className="manual-td">볼륨·팬·AUTO·SOURCE까지 보입니다. 일반적인 믹스 작업에 적당합니다.</td></tr>
                      <tr><th className="manual-th">L (크게)</th><td className="manual-td">오토메이션의 <strong>Reset · Curve</strong>와 Audio In 트랙의 입력 포트·MON·LIM·입력 게인까지 모두 보입니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-07-track-size-s.png" alt="트랙 사이즈 S" className="manual-img" />
                    <div className="manual-figcaption">트랙 크기 <strong>S</strong> — 가장 조밀한 보기입니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-08-track-size-m.png" alt="트랙 사이즈 M" className="manual-img" />
                    <div className="manual-figcaption">트랙 크기 <strong>M</strong> — 기본값입니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-09-track-size-l.png" alt="트랙 사이즈 L" className="manual-img" />
                    <div className="manual-figcaption">트랙 크기 <strong>L</strong> — 오토메이션 Curve와 녹음 컨트롤까지 모두 펼쳐집니다.</div>
                  </div>

                  <h3 className="manual-h3">파일 트랙 그룹 접기</h3>
                  <p className="manual-p">불러온 스템은 <strong>FILE TRACKS</strong> 그룹으로 묶입니다. 그룹 머리글의 <strong>HIDE / SHOW</strong>를 누르면 파일 트랙 전체가 한 줄로 접히고, 그 줄에는 합쳐진 요약 파형과 <strong>“n file tracks hidden”</strong> 표시가 나타납니다. 녹음 중인 Audio In 트랙에만 집중하고 싶을 때 유용합니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-10-tracks-collapsed.png" alt="파일 트랙을 모두 접은 모습" className="manual-img" />
                    <div className="manual-figcaption">파일 트랙을 모두 접은 화면입니다. 접힌 줄에도 전체 스템의 요약 파형이 표시되어 곡의 진행을 확인할 수 있습니다.</div>
                  </div>

                  <div className="manual-grid">
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>주요 작업</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">프로젝트 새로 만들기 · 열기 · 저장 · 다른 이름으로 저장</li>
                        <li className="manual-li">오디오 파일 또는 스템 폴더 가져오기</li>
                        <li className="manual-li">마이크·인터페이스 입력을 Audio In 트랙에 실시간 녹음(오버더빙)</li>
                        <li className="manual-li">여러 테이크 녹음과 컴프(Comp) 조합, Punch 부분 재녹음</li>
                        <li className="manual-li">클립 단위 편집(이동·트림·분할·병합·복제·클립 볼륨)</li>
                        <li className="manual-li">보컬 채널 스트립(HPF · 게이트 · EQ · 컴프레서 · 디에서 · 노이즈 제거)</li>
                        <li className="manual-li">트랙별 볼륨·팬·솔로·뮤트·리버브·에코와 볼륨 오토메이션</li>
                        <li className="manual-li">마스터 EQ, 출력 이펙트, 마스터 페이드</li>
                        <li className="manual-li">MP3 또는 WAV로 믹스다운 저장</li>
                      </ul>
                    </div>
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>지원 파일</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">입력 오디오: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code>, <code className="manual-code">.aif</code>, <code className="manual-code">.aiff</code>, <code className="manual-code">.m4a</code>, <code className="manual-code">.ogg</code>, <code className="manual-code">.flac</code></li>
                        <li className="manual-li">프로젝트: <code className="manual-code">.focus</code></li>
                        <li className="manual-li">녹음·바운스 결과: <code className="manual-code">.wav</code></li>
                        <li className="manual-li">출력 오디오: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code></li>
                        <li className="manual-li">MP3 출력 시 제목, 아티스트/작곡가, 앨범, 연도, 날짜, 앨범 아트 태그를 넣을 수 있습니다.</li>
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">1. App Overview</h2>
                  <p className="manual-p">FocusDAW Studio is a desktop app for <strong>mixing a set of separated stems and overdubbing your own vocals on top of them</strong>. Balance each track's volume, pan, solo, mute, reverb, and echo; record a live mic input straight onto an Audio In track; then shape the master with a 9-band graphic EQ and output effects and export an MP3 or WAV mixdown.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-01-main-screen.png" alt="FocusDAW Studio main window" className="manual-img" />
                    <div className="manual-figcaption">The main working window with stems loaded: menu bar and transport on top, zoom and track-size tools, track headers and waveforms, and the OUTPUT FX track at the bottom.</div>
                  </div>

                  <h3 className="manual-h3">Screen layout</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-06-screen-layout.png" alt="Screen layout with numbered areas" className="manual-img" />
                    <div className="manual-figcaption">The empty session with each area numbered. The numbers match the table below.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">① Timeline (Arrange)</th><td className="manual-td">The main work area holding tracks, waveforms, clips, and automation.</td></tr>
                      <tr><th className="manual-th">② Start panel</th><td className="manual-td">Shown only while the session is empty. Drop files here, or use <strong>Import Folder</strong> · <strong>Import Files</strong> · <strong>Load demo session</strong>.</td></tr>
                      <tr><th className="manual-th">③ Undo / Redo</th><td className="manual-td">Undo and redo (<kbd className="manual-kbd">Ctrl</kbd>+<kbd className="manual-kbd">Z</kbd> / <kbd className="manual-kbd">Ctrl</kbd>+<kbd className="manual-kbd">Y</kbd>).</td></tr>
                      <tr><th className="manual-th">④ TIME zoom</th><td className="manual-td">Horizontal (time-axis) zoom of the timeline.</td></tr>
                      <tr><th className="manual-th">⑤ AMP zoom</th><td className="manual-td">Waveform display height. A visual scale only — it does not change the audio level.</td></tr>
                      <tr><th className="manual-th">⑥ TRACK SIZE</th><td className="manual-td">Track row height: <strong>S · M · L</strong>. Taller rows reveal more header controls.</td></tr>
                      <tr><th className="manual-th">⑦ Timeline minimap</th><td className="manual-td">Shows which part of the song is in view; click or drag to jump.</td></tr>
                      <tr><th className="manual-th">⑧ BPM indicator</th><td className="manual-td">Project BPM in front, playback BPM behind. Click to open the BPM panel (<strong>ch. 6</strong>).</td></tr>
                      <tr><th className="manual-th">⑨ Vari BPM switch</th><td className="manual-td">Must be on for the playback BPM to actually change the speed (off by default).</td></tr>
                      <tr><th className="manual-th">⑩ Key indicator</th><td className="manual-td">The detected/assigned original key and the transposed playback key. Click to open the Key panel (<strong>ch. 7</strong>).</td></tr>
                      <tr><th className="manual-th">⑪ Vari Key switch</th><td className="manual-td">Must be on for the semitone offset to apply during playback (off by default).</td></tr>
                      <tr><th className="manual-th">⑫ Mixer</th><td className="manual-td">Opens the mixer console in its own window (<kbd className="manual-kbd">F3</kbd>).</td></tr>
                      <tr><th className="manual-th">⑬ Export</th><td className="manual-td">Opens the mixdown export dialog (<strong>ch. 11</strong>).</td></tr>
                      <tr><th className="manual-th">⑭ Transport</th><td className="manual-td">Return to start · Stop · Play/Pause · <strong>Repeat</strong> · <strong>Metronome</strong> · <strong>Pre-roll</strong> · <strong>Punch</strong> · <strong>Record</strong> (<strong>ch. 4 &amp; 5</strong>).</td></tr>
                      <tr><th className="manual-th">⑮ Time display</th><td className="manual-td">Current playhead position and total project length.</td></tr>
                      <tr><th className="manual-th">⑯ Project name</th><td className="manual-td">Click to rename in place. The same name appears in the status bar at the bottom.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">The menus at a glance</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-02-project-menu.png" alt="Project menu" className="manual-img" />
                    <div className="manual-figcaption"><strong>Project</strong> — new, open (with a recent list), save, save as, import stem folder / audio files, demo session, clean up unused recordings, export.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-03-edit-menu.png" alt="Edit menu" className="manual-img" />
                    <div className="manual-figcaption"><strong>Edit</strong> — Undo · Redo and <strong>Delete all tracks</strong> (clears tracks but keeps the master effects).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-04-advfx-menu.png" alt="Advanced Effects menu" className="manual-img" />
                    <div className="manual-figcaption"><strong>Advanced Effects</strong> — dedicated windows for Ambience, Auto Panning, and Equalizer Setup (<strong>ch. 10</strong>).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-05-help-menu.png" alt="Help menu" className="manual-img" />
                    <div className="manual-figcaption"><strong>Help</strong> — <strong>Manual</strong> (this document), <strong>Release Notes</strong>, <strong>Check for Updates</strong> (download and install a new version), <strong>About</strong>.</div>
                  </div>
                  <p className="manual-p">The <strong>Settings</strong> menu holds color themes, the mixer-window reset, and audio device setup (<strong>ch. 12</strong>).</p>

                  <h3 className="manual-h3">Track size — S · M · L</h3>
                  <p className="manual-p"><strong>TRACK SIZE</strong> at the top changes the row height. Taller rows expose more header controls, so use <strong>M or L</strong> when working with automation curves or the Audio In recording controls.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">S (small)</th><td className="manual-td">Roughly name, B, S, and M only — best for scanning many tracks at once.</td></tr>
                      <tr><th className="manual-th">M (default)</th><td className="manual-td">Adds volume, pan, AUTO, and the SOURCE chip. Suits everyday mixing.</td></tr>
                      <tr><th className="manual-th">L (large)</th><td className="manual-td">Also shows automation <strong>Reset · Curve</strong> and, on Audio In tracks, the input port, MON, LIM, and input gain.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-07-track-size-s.png" alt="Track size S" className="manual-img" />
                    <div className="manual-figcaption">Track size <strong>S</strong> — the most compact view.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-08-track-size-m.png" alt="Track size M" className="manual-img" />
                    <div className="manual-figcaption">Track size <strong>M</strong> — the default.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-09-track-size-l.png" alt="Track size L" className="manual-img" />
                    <div className="manual-figcaption">Track size <strong>L</strong> — automation curves and recording controls fully expanded.</div>
                  </div>

                  <h3 className="manual-h3">Collapsing the file-track group</h3>
                  <p className="manual-p">Imported stems are grouped under <strong>FILE TRACKS</strong>. The <strong>HIDE / SHOW</strong> button on the group header folds every file track into a single row that still shows a combined summary waveform plus an <strong>“n file tracks hidden”</strong> chip — handy when you want to focus on the Audio In track you are recording.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-10-tracks-collapsed.png" alt="All file tracks collapsed" className="manual-img" />
                    <div className="manual-figcaption">Every file track collapsed. The folded row keeps a summary waveform so you can still follow the song.</div>
                  </div>

                  <div className="manual-grid">
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>Key Features</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">Create, open, save, and save-as projects (.focus)</li>
                        <li className="manual-li">Import individual audio files or whole stem folders</li>
                        <li className="manual-li">Record mic/interface input live onto Audio In tracks (overdubbing)</li>
                        <li className="manual-li">Multiple takes with comping, and Punch re-records</li>
                        <li className="manual-li">Clip editing — move, trim, split, merge, duplicate, per-clip volume</li>
                        <li className="manual-li">Vocal channel strip (HPF · gate · EQ · compressor · de-esser · de-noise)</li>
                        <li className="manual-li">Track volume, pan, solo, mute, reverb/echo sends, and volume automation</li>
                        <li className="manual-li">Master EQ, output effects, and master fades</li>
                        <li className="manual-li">Export the final mixdown as MP3 or WAV</li>
                      </ul>
                    </div>
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>Supported Files</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">Input audio: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code>, <code className="manual-code">.aif</code>, <code className="manual-code">.aiff</code>, <code className="manual-code">.m4a</code>, <code className="manual-code">.ogg</code>, <code className="manual-code">.flac</code></li>
                        <li className="manual-li">Project: <code className="manual-code">.focus</code></li>
                        <li className="manual-li">Recordings and bounces: <code className="manual-code">.wav</code></li>
                        <li className="manual-li">Output audio: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code></li>
                        <li className="manual-li">MP3 exports can embed Title, Artist/Composer, Album, Year, Date, and Cover Art tags.</li>
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* 2. 시작과 프로젝트 / Start & Projects */}
            <section id="start" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">2. 시작과 프로젝트</h2>
                  <h3 className="manual-h3">앱 설치와 실행</h3>
                  <p className="manual-p">받으신 설치 파일(<code className="manual-code">FocusDAW-Studio-Setup-x.y.z.exe</code>)을 실행하면 설치가 진행되고, 바탕화면과 시작 메뉴에 <strong>FocusDAW Studio</strong> 아이콘이 만들어집니다. 이후에는 이 아이콘으로 앱을 실행합니다.</p>
                  <p className="manual-p">앱을 켜면 <strong>마지막에 작업하던 세션이 자동으로 복원</strong>됩니다. 저장하지 않고 종료했더라도 이어서 작업할 수 있습니다(아래 <strong>RECENT PROJECT</strong> 참고). 완전히 새로 시작하려면 <strong>Project ▸ New Project</strong>를 사용하세요.</p>
                  <div className="manual-note">처음 실행할 때 소리가 나지 않으면 <strong>Settings ▸ 오디오 장치</strong>에서 출력 장치가 현재 쓰는 장치로 지정되어 있는지 확인하세요(<strong>12장</strong>). 녹음을 하려면 입력 장치도 함께 지정합니다.</div>

                  <h3 className="manual-h3">상단 Project 메뉴</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-02-project-menu.png" alt="Project 메뉴" className="manual-img" />
                    <div className="manual-figcaption">상단 메뉴 막대의 <strong>Project</strong>를 누르면 아래 항목이 펼쳐집니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">New Project</th><td className="manual-td">현재 세션을 <strong>완전히</strong> 비우고 새 프로젝트를 시작합니다(트랙과 마스터 이펙트가 모두 초기화됩니다).</td></tr>
                      <tr><th className="manual-th">Open Project…</th><td className="manual-td">저장된 <code className="manual-code">.focus</code> 프로젝트 파일을 엽니다. 항목 위에 마우스를 올리면 <strong>최근 목록</strong>이 옆으로 펼쳐집니다(아래 참고).</td></tr>
                      <tr><th className="manual-th">Save Project</th><td className="manual-td">현재 상태를 <code className="manual-code">.focus</code> 파일로 저장합니다. 트랙 설정, 마스터 설정, 오토메이션, 클립·테이크 정보가 함께 저장됩니다. 아직 저장한 적이 없으면 저장 위치를 묻습니다.</td></tr>
                      <tr><th className="manual-th">Save As…</th><td className="manual-td">새 위치·새 이름으로 저장합니다. 이때 <strong>프로젝트가 소유한 오디오를 함께 모아 갑니다</strong>(아래 “프로젝트 통째로 옮기기” 참고).</td></tr>
                      <tr><th className="manual-th">Import Stem Folder…</th><td className="manual-td">선택한 폴더 루트의 오디오 파일을 한 번에 트랙으로 등록합니다.</td></tr>
                      <tr><th className="manual-th">Import Audio Files…</th><td className="manual-td">개별 오디오 파일을 여러 개 골라 트랙으로 추가합니다.</td></tr>
                      <tr><th className="manual-th">Load Demo Session</th><td className="manual-td">앱에 내장된 데모 스템을 불러와 기능을 시험해 봅니다.</td></tr>
                      <tr><th className="manual-th">Clean Up Unused Recordings…</th><td className="manual-td">저장된 프로젝트의 오디오 폴더에서 <strong>어떤 트랙도, 되돌리기 기록도 참조하지 않는</strong> 녹음·바운스 파일을 찾아 휴지통으로 보냅니다(아래 참고).</td></tr>
                      <tr><th className="manual-th">Export…</th><td className="manual-td">믹스다운 내보내기 창을 엽니다(MP3 / WAV).</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">최근 프로젝트로 바로 열기</h3>
                  <p className="manual-p"><strong>Open Project…</strong> 위에 마우스를 올리면 최근 목록이 옆으로 펼쳐집니다. 목록은 두 부분으로 나뉩니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">RECENT PROJECT</th><td className="manual-td">앱을 마지막으로 닫았을 때의 <strong>자동 저장 상태</strong>입니다. 저장하지 않고 종료했더라도 작업하던 세션을 그대로 이어서 열 수 있습니다.</td></tr>
                      <tr><th className="manual-th">RECENT SAVED</th><td className="manual-td">최근에 저장한 <code className="manual-code">.focus</code> 프로젝트들입니다. 이름 아래에 실제 파일 경로가 함께 표시되어 같은 이름의 다른 프로젝트를 구분할 수 있습니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/02-01-open-recent.png" alt="프로젝트 불러오기 및 최근 프로젝트 메뉴" className="manual-img" />
                    <div className="manual-figcaption"><strong>Open Project…</strong>의 최근 목록입니다. 위쪽은 종료 시점의 자동 저장 상태, 아래쪽은 최근 저장한 프로젝트 목록입니다.</div>
                  </div>

                  <h3 className="manual-h3">프로젝트 이름 설정</h3>
                  <p className="manual-p">상단 오른쪽의 프로젝트 이름을 클릭하면 그 자리에서 이름을 고칠 수 있습니다(Enter 확정, Esc 취소). 여기서 정한 이름은 창 제목과 아래 상태 표시줄에 나타나고, 저장할 때 파일 이름의 기본값으로도 쓰입니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/02-02-project-rename.png" alt="프로젝트 이름 변경" className="manual-img" />
                    <div className="manual-figcaption">프로젝트 이름 칸을 클릭해 원하는 이름으로 바꿉니다.</div>
                  </div>
                  <div className="manual-note">이름을 바꿔도 <strong>이미 저장된 폴더 위치는 그대로</strong>입니다. 표시 이름만 바뀌므로, 프로젝트가 모아 둔 녹음·바운스 파일과의 연결이 끊어지지 않습니다. 파일 자체를 다른 곳에 새로 만들고 싶다면 <strong>Save As…</strong>를 사용하세요.</div>

                  <h3 className="manual-h3">프로젝트 통째로 옮기기 — Save As</h3>
                  <p className="manual-p"><strong>Save As…</strong>로 저장하면 이 프로젝트가 만들어 낸 오디오(녹음 테이크, 바운스, 병합 파일)를 <code className="manual-code">.focus</code> 파일 옆의 <strong>“&lt;프로젝트 이름&gt; Audio” 폴더로 모아</strong> 두고, 프로젝트 안에는 <strong>상대 경로</strong>로 기록합니다. 덕분에 <code className="manual-code">.focus</code>와 그 Audio 폴더를 함께 복사하면 다른 폴더나 다른 PC에서도 그대로 열립니다.</p>
                  <div className="manual-note">단, <strong>처음 불러온 스템 원본</strong>은 원래 자리에 그대로 두고 참조합니다. 스템까지 함께 옮기려면 스템 폴더도 같이 복사한 뒤, 열었을 때 <strong>NO SRC</strong>가 뜨면 같은 파일을 다시 가져와 재연결하세요(<strong>3장</strong>).</div>

                  <h3 className="manual-h3">미사용 녹음 정리 — Clean Up Unused Recordings</h3>
                  <p className="manual-p">여러 번 다시 녹음하다 보면 어느 트랙도 쓰지 않는 <code className="manual-code">.wav</code> 파일이 프로젝트 폴더에 쌓입니다. <strong>Project ▸ Clean Up Unused Recordings…</strong>는 저장된 프로젝트의 Audio 폴더를 훑어 <strong>지금 트랙에서도 쓰이지 않고 되돌리기(Undo) 기록에도 남아 있지 않은</strong> 파일만 골라내고, 파일 이름·종류·크기 목록과 총 용량을 보여 준 뒤 <strong>휴지통으로 이동</strong>합니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/02-03-cleanup-unused.png" alt="Clean Up Unused Recordings 대화창" className="manual-img" />
                    <div className="manual-figcaption">정리 대상 목록입니다. 맨 위에 <strong>파일 개수와 총 용량</strong>이 요약되고, 아래에 파일 이름·분류(Recordings 등)·크기가 나열됩니다. <strong>Move to Recycle Bin</strong>으로 한 번에 정리합니다.</div>
                  </div>
                  <div className="manual-note">되돌리기 기록에 남아 있는 파일은 <strong>정리 대상에서 제외</strong>되므로, 방금 지운 테이크를 Undo로 되살릴 수 있습니다. 또한 삭제가 아니라 <strong>휴지통 이동</strong>이므로 실수해도 복원할 수 있습니다. 이 기능은 <strong>프로젝트를 한 번 저장한 뒤에만</strong> 쓸 수 있습니다.</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">2. Start & Projects</h2>
                  <h3 className="manual-h3">Installing and launching</h3>
                  <p className="manual-p">Run the installer you received (<code className="manual-code">FocusDAW-Studio-Setup-x.y.z.exe</code>). It adds a <strong>FocusDAW Studio</strong> shortcut to the desktop and the Start menu — launch the app from there.</p>
                  <p className="manual-p">On start-up the app <strong>restores the session you last worked on</strong>, even if you closed it without saving (see <strong>RECENT PROJECT</strong> below). Use <strong>Project ▸ New Project</strong> when you want a clean slate instead.</p>
                  <div className="manual-note">If you hear nothing on first launch, check that the output device under <strong>Settings ▸ Audio device</strong> is the one you are actually using (<strong>ch. 12</strong>). Recording additionally needs an input device selected there.</div>

                  <h3 className="manual-h3">Top "Project" Menu</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-02-project-menu.png" alt="Project menu" className="manual-img" />
                    <div className="manual-figcaption">Clicking <strong>Project</strong> in the menu bar reveals the commands below.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">New Project</th><td className="manual-td">Clears the session <strong>completely</strong> and starts fresh (both tracks and master effects are reset).</td></tr>
                      <tr><th className="manual-th">Open Project…</th><td className="manual-td">Opens an existing <code className="manual-code">.focus</code> file. Hovering the item slides out a <strong>recent list</strong> (see below).</td></tr>
                      <tr><th className="manual-th">Save Project</th><td className="manual-td">Saves the current state to a <code className="manual-code">.focus</code> file — track parameters, master effects, automation, and clip/take information. If the project has never been saved, you are asked where to put it.</td></tr>
                      <tr><th className="manual-th">Save As…</th><td className="manual-td">Saves to a new name/location and <strong>gathers the audio this project owns</strong> alongside it (see "Moving a whole project" below).</td></tr>
                      <tr><th className="manual-th">Import Stem Folder…</th><td className="manual-td">Creates a track for every audio file in the root of the chosen folder.</td></tr>
                      <tr><th className="manual-th">Import Audio Files…</th><td className="manual-td">Adds multiple individual audio files as tracks.</td></tr>
                      <tr><th className="manual-th">Load Demo Session</th><td className="manual-td">Loads the demo stems bundled with the app so you can try the features.</td></tr>
                      <tr><th className="manual-th">Clean Up Unused Recordings…</th><td className="manual-td">Scans the saved project's audio folder for recordings and bounces that <strong>no track and no undo step</strong> references, and moves them to the Recycle Bin (see below).</td></tr>
                      <tr><th className="manual-th">Export…</th><td className="manual-td">Opens the mixdown export dialog (MP3 / WAV).</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Reopening a recent project</h3>
                  <p className="manual-p">Hovering <strong>Open Project…</strong> slides out a recent list in two parts.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">RECENT PROJECT</th><td className="manual-td">The <strong>autosaved state</strong> from when you last closed the app — you can pick the session back up even if you never saved it.</td></tr>
                      <tr><th className="manual-th">RECENT SAVED</th><td className="manual-td">Recently saved <code className="manual-code">.focus</code> projects. Each entry shows its full path beneath the name so identically-named projects stay distinguishable.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/02-01-open-recent.png" alt="Open Project and the recent list" className="manual-img" />
                    <div className="manual-figcaption">The recent list under <strong>Open Project…</strong> — the autosaved exit state on top, recently saved projects below.</div>
                  </div>

                  <h3 className="manual-h3">Setting the Project Name</h3>
                  <p className="manual-p">Click the project name at the top right to rename it in place (Enter confirms, Esc cancels). The name shows in the window title and the status bar, and becomes the default filename when saving.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/02-02-project-rename.png" alt="Renaming the project" className="manual-img" />
                    <div className="manual-figcaption">Click the project name field and type a new name.</div>
                  </div>
                  <div className="manual-note">Renaming <strong>does not move the saved folder</strong> — only the display name changes, so the project's collected recordings and bounces stay linked. Use <strong>Save As…</strong> when you actually want a new file somewhere else.</div>

                  <h3 className="manual-h3">Moving a whole project — Save As</h3>
                  <p className="manual-p"><strong>Save As…</strong> collects the audio this project produced (recorded takes, bounces, consolidated files) into a <strong>“&lt;Project&gt; Audio” folder next to the <code className="manual-code">.focus</code></strong> and stores <strong>relative paths</strong> to them. Copy the <code className="manual-code">.focus</code> together with that Audio folder and the project opens correctly on another folder or another PC.</p>
                  <div className="manual-note">The <strong>originally imported stems</strong> are still referenced where they live. To move those too, copy the stem folder as well; if a track shows <strong>NO SRC</strong> after opening, re-import the same files to reconnect them (<strong>ch. 3</strong>).</div>

                  <h3 className="manual-h3">Clean Up Unused Recordings</h3>
                  <p className="manual-p">Re-recording repeatedly leaves <code className="manual-code">.wav</code> files in the project folder that no track uses any more. <strong>Project ▸ Clean Up Unused Recordings…</strong> scans the saved project's Audio folder for files that are <strong>neither used by a track nor held by the undo history</strong>, lists them with name, category, and size plus the total, and moves them to the <strong>Recycle Bin</strong>.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/02-03-cleanup-unused.png" alt="Clean Up Unused Recordings dialog" className="manual-img" />
                    <div className="manual-figcaption">The cleanup list. The <strong>file count and total size</strong> are summarised at the top, with each file's name, category (Recordings, etc.), and size below. <strong>Move to Recycle Bin</strong> clears them in one go.</div>
                  </div>
                  <div className="manual-note">Files still referenced by the undo history are <strong>excluded</strong>, so a take you just deleted can still be brought back with Undo. And because files are moved to the Recycle Bin rather than erased, a mistake is recoverable. The command is available only <strong>after the project has been saved once</strong>.</div>
                </>
              )}
            </section>

            {/* 3. 오디오 가져오기 / Importing Audio */}
            <section id="import" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">3. 오디오 가져오기</h2>
                  <p className="manual-p">오디오를 가져오는 방법은 세 가지입니다.</p>
                  <ol className="manual-ol">
                    <li className="manual-li"><strong>Track 버튼</strong>을 눌러 파일 선택 창에서 오디오 파일을 고릅니다.</li>
                    <li className="manual-li"><strong>Project &gt; Import Audio Files...</strong>로 여러 파일을 선택합니다.</li>
                    <li className="manual-li"><strong>Project &gt; Import Stem Folder...</strong>로 스템 폴더를 선택합니다.</li>
                  </ol>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/03-01-audio-loaded.png" alt="실제 오디오 파일들을 불러온 화면" className="manual-img" />
                    <div className="manual-figcaption">실제 오디오 스템을 불러온 화면입니다. 파일 이름에서 딴 트랙 이름이 왼쪽 헤더에 표시되고, 각 트랙의 파형이 타임라인에 배치됩니다.</div>
                  </div>

                  <p className="manual-p">여러 스템을 가져오면 보컬, 드럼, 베이스, 기타, 스트링, 신스처럼 파일별로 독립 트랙이 생성됩니다. 각 트랙은 같은 시작점에 놓이지만, 실제 오디오가 없는 구간은 빈 파형으로 보이므로 편곡의 구간별 밀도를 한눈에 확인할 수 있습니다.</p>

                  <h3 className="manual-h3">폴더 이름으로 프로젝트 이름 자동 설정 <span className="appver-since">(v1.9.4)</span></h3>
                  <p className="manual-p">아직 트랙이 없는 <strong>초기(빈) 화면</strong>에서 <strong>Import Folder</strong>로 스템 폴더를 불러오면, 그 <strong>폴더 이름이 프로젝트 이름으로 자동 설정</strong>됩니다. 스템을 폴더 단위로 정리해 둔 경우 이름을 따로 입력하지 않아도 곡 제목이 곧바로 잡혀 편리합니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/03-02-stem-folder-drop.png" alt="스템 폴더를 끌어다 놓으면 프로젝트 이름이 자동 설정됨" className="manual-img" />
                    <div className="manual-figcaption">빈 화면에 스템 폴더를 끌어다 놓거나 <strong>Import Folder</strong>로 불러오면, 상단의 프로젝트 이름이 <strong>그 폴더 이름으로 자동 설정</strong>됩니다(예: <code className="manual-code">Higher Than Ever Stems</code>).</div>
                  </div>
                  <div className="manual-note">이 자동 설정은 <strong>초기(빈) 화면에서 폴더를 불러올 때만</strong> 적용됩니다. 이미 트랙이 있거나 이름을 직접 바꿨거나 저장한 프로젝트에 폴더를 추가로 불러올 때는 기존 이름이 유지됩니다. 개별 파일(Import Files)은 자동 이름 설정 대상이 아닙니다.</div>

                  <h3 className="manual-h3">드래그 앤 드롭</h3>
                  <p className="manual-p">메인 타임라인 영역으로 오디오 파일을 끌어다 놓아도 트랙을 추가할 수 있습니다. 지원하지 않는 확장자는 자동으로 무시됩니다.</p>

                  <h3 className="manual-h3">프로젝트를 다시 열 때</h3>
                  <p className="manual-p"><code className="manual-code">.focus</code> 프로젝트는 오디오 설정과 파일 경로를 저장합니다. 원본 오디오 파일이 옮겨지거나 지워지면 트랙 헤더에 붉은 <strong>NO SRC</strong> 표시가 나타납니다. 이때는 <strong>같은 파일을 그 트랙 위로 끌어다 놓거나</strong> 같은 이름의 오디오를 다시 가져오면 누락된 트랙이 재연결됩니다.</p>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">3. Importing Audio</h2>
                  <p className="manual-p">There are three ways to import audio files into your session:</p>
                  <ol className="manual-ol">
                    <li className="manual-li">Click the <strong>+ Track</strong> button to choose files via the file selector.</li>
                    <li className="manual-li">Select <strong>Project &gt; Import Audio Files...</strong> from the menu bar to import multiple files.</li>
                    <li className="manual-li">Select <strong>Project &gt; Import Stem Folder...</strong> to batch import all stems inside a folder.</li>
                  </ol>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/03-01-audio-loaded.png" alt="Audio tracks loaded" className="manual-img" />
                    <div className="manual-figcaption">A multi-track stem session loaded. Track names are parsed from the filenames and waveforms are laid out on the timeline.</div>
                  </div>

                  <p className="manual-p">Importing multiple stems creates separate, independent tracks for Vocals, Drums, Bass, Guitar, and so on. Tracks are aligned to the same starting point. Sections where a track is silent are shown as flat line waveforms, providing a clear layout of the arrangement density.</p>

                  <h3 className="manual-h3">Auto-Naming the Project from the Folder <span className="appver-since">(v1.9.4)</span></h3>
                  <p className="manual-p">When you use <strong>Import Folder</strong> on the <strong>initial (empty) screen</strong> — before any track exists — the <strong>folder's name automatically becomes the project name</strong>. If you keep your stems in per-song folders, the title is set instantly without typing.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/03-02-stem-folder-drop.png" alt="Project name set automatically from the dropped stem folder" className="manual-img" />
                    <div className="manual-figcaption">Dropping a stem folder onto the empty screen (or using <strong>Import Folder</strong>) sets the project name at the top to <strong>that folder's name</strong> — e.g. <code className="manual-code">Higher Than Ever Stems</code>.</div>
                  </div>
                  <div className="manual-note">This auto-naming applies <strong>only when importing a folder onto the empty start screen</strong>. If the project already has tracks, was renamed, or was saved, importing another folder keeps the existing name. Individual files (Import Files) are not auto-named.</div>

                  <h3 className="manual-h3">Drag and Drop</h3>
                  <p className="manual-p">You can drag and drop audio files directly from your system file explorer onto the main timeline area to add new tracks. Unsupported formats are ignored automatically.</p>

                  <h3 className="manual-h3">Reconnecting Missing Audio</h3>
                  <p className="manual-p">The <code className="manual-code">.focus</code> file references audio file paths. If the original audio is moved or deleted, the track header shows a red <strong>NO SRC</strong> chip. <strong>Drop the same file onto that track</strong>, or re-import audio with matching names, to reconnect it.</p>
                </>
              )}
            </section>

            {/* 4. 오디오 녹음 / Recording (Audio In) */}
            <section id="record" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">4. 오디오 녹음 · 클립 편집</h2>
                  <p className="manual-p">FocusDAW Studio는 마이크·오디오 인터페이스로 들어오는 입력 신호를 <strong>Audio In 트랙</strong>에 실시간으로 녹음할 수 있습니다. 녹음 결과는 프로젝트 폴더에 <code className="manual-code">.wav</code> 파일(테이크)로 저장되고, 다른 스템 트랙과 똑같이 볼륨·팬·솔로·뮤트·오토메이션·마스터 이펙트를 적용할 수 있습니다. 기존 스템 위에 보컬이나 애드리브를 덧입히는 <strong>오버더빙</strong>이 이 앱의 핵심 작업입니다.</p>
                  <p className="manual-p">이 장은 <strong>녹음 → 여러 테이크 중 고르기 → 클립 다듬기 → 보컬 이펙트 걸기</strong>까지의 흐름을 순서대로 다룹니다.</p>

                  <div className="manual-note">녹음을 시작하기 전에 먼저 <strong>Settings ▸ Audio Devices</strong>에서 입력 장치(모드·입력/출력 장치·샘플레이트·버퍼)를 지정해야 합니다. 장치 설정 방법은 <strong>12. 설정 · 오디오 장치 · 테마</strong>를 참고하세요.</div>

                  <h3 className="manual-h3">① Audio In 트랙 만들기</h3>
                  <p className="manual-p">타임라인 왼쪽 위 <strong>TRACK</strong> 영역에 추가 버튼이 두 개 있습니다. <strong>+</strong>(플러스)는 오디오 파일을 불러오는 일반 파일 트랙을, <strong>+ Audio In</strong> 버튼은 <strong>입력 녹음용 트랙</strong>을 만듭니다. Audio In 트랙은 파일 트랙과 구분되도록 헤더에 파란 틴트가 적용되며, 파일 트랙 그룹(FILE TRACKS) <strong>바깥</strong>에 놓입니다.</p>

                  <h3 className="manual-h3">② Audio In 트랙 헤더 컨트롤</h3>
                  <p className="manual-p">Audio In 트랙 헤더에는 일반 트랙의 볼륨·팬·솔로·뮤트에 더해, 녹음을 위한 전용 컨트롤이 있습니다. (트랙 크기가 <strong>S</strong>일 때는 공간이 좁아 ARM만 제목 행에 인라인으로 표시되고, <strong>M/L</strong>에서 모든 컨트롤이 펼쳐집니다.)</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">ARM</th><td className="manual-td">이 트랙을 <strong>녹음 대기(무장)</strong> 상태로 만듭니다. 녹음은 ARM된 트랙에만 기록되며, 한 번에 <strong>하나의 Audio In 트랙만</strong> ARM됩니다(다른 트랙을 ARM하면 이전 트랙은 자동 해제). ARM된 트랙이 있어야 상단의 Record 버튼이 활성화됩니다.</td></tr>
                      <tr><th className="manual-th">입력 포트 선택</th><td className="manual-td">이 트랙이 받을 입력 채널을 고릅니다. 현재 열린 인터페이스의 실제 채널 수에 맞춰 <strong>모노 포트(Input 1, Input 2 …)</strong>와 <strong>연속 스테레오 쌍(Input 1-2 …)</strong>이 동적으로 나열됩니다. (ASIO는 인터페이스가 제공하는 실제 채널 이름을 그대로 표시합니다.)</td></tr>
                      <tr><th className="manual-th">MON</th><td className="manual-td"><strong>입력 모니터링</strong>. 켜면 입력 신호를 출력으로 흘려보내 지금 들어오는 소리를 실시간으로 들을 수 있습니다. 모노 입력은 양쪽 채널로 센터링되어 재생됩니다.</td></tr>
                      <tr><th className="manual-th">LIM</th><td className="manual-td"><strong>입력 리미터</strong>(천장 −1.0 dBFS). 켜져 있으면 과입력으로 인한 클리핑을 방지합니다. 기본값은 켜짐입니다. 리미터가 실제로 신호를 누른 양은 입력 게인 슬라이더의 <strong>게인 리덕션(GR) 미터</strong>(레벨 미터 아래의 붉은 막대, 오른쪽에서 채워짐)로 확인합니다. GR이 크게 자주 움직이면 입력 게인이 너무 큰 것이므로 낮춰 주세요.</td></tr>
                      <tr><th className="manual-th">입력 게인</th><td className="manual-td">녹음될 입력 신호의 게인을 조절합니다. 헤더에 현재 게인이 dB로 표시됩니다. 너무 크면 왜곡, 너무 작으면 잡음이 커지므로 미터가 상단에 닿지 않는 선에서 맞춥니다.</td></tr>
                      <tr><th className="manual-th">볼륨 · 팬</th><td className="manual-td">파일 트랙과 동일하게 재생 레벨과 스테레오 위치를 조절합니다(볼륨은 −∞ ~ +6 dB).</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-01-audioin-header-m.png" alt="Audio In 트랙 헤더 (트랙 크기 M)" className="manual-img" />
                    <div className="manual-figcaption">트랙 크기 <strong>M</strong>의 Audio In 트랙 헤더입니다. 제목 행에 <strong>ARM · S · M</strong>, 그 아래 볼륨과 팬이 보입니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-02-audioin-header-l.png" alt="Audio In 트랙 헤더 (트랙 크기 L)" className="manual-img" />
                    <div className="manual-figcaption">트랙 크기 <strong>L</strong>에서 모두 펼쳐진 모습입니다. 아래 줄에 <strong>입력 포트(Input 1)</strong> · <strong>MON</strong> · <strong>LIM</strong> · <strong>입력 게인(IN)</strong>과 레벨 미터가, 맨 아래에 오토메이션 <strong>Reset · Curve</strong>가 나타납니다.</div>
                  </div>
                  <p className="manual-p">헤더 아래쪽 줄에는 오토메이션 <strong>AUTO</strong> 버튼 옆에 파형 모양의 <strong>FX 버튼</strong>이 있습니다. 이 버튼이 <strong>보컬 채널 스트립</strong> 창을 여는 입구입니다(⑨ 참고). 오른쪽 <strong>SOURCE</strong> 칩은 이 트랙의 원본 오디오가 정상적으로 연결돼 있음을 뜻하며, 파일을 찾지 못하면 붉은 <strong>NO SRC</strong>로 바뀝니다.</p>

                  <h3 className="manual-h3">③ 녹음 준비 — ARM</h3>
                  <p className="manual-p">녹음할 트랙의 <strong>ARM</strong> 버튼을 눌러 <strong>녹음 대기(무장)</strong> 상태로 만듭니다. ARM된 트랙이 있어야 트랜스포트의 <strong>Record</strong> 버튼이 활성화되고, 녹음은 오직 그 트랙에만 기록됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-03-arm.png" alt="녹음 준비 버튼(ARM)" className="manual-img" />
                    <div className="manual-figcaption">ARM 버튼이 <strong>빨간색</strong>으로 켜진 무장 상태입니다. 이 상태에서만 상단 트랜스포트의 Record 버튼이 활성화됩니다.</div>
                  </div>

                  <h3 className="manual-h3">④ 녹음 시작 — 트랜스포트 규칙</h3>
                  <p className="manual-p">ARM한 뒤 트랜스포트의 <strong>Record(빨간 점)</strong> 버튼을 누르면 녹음이 시작됩니다. 실수를 막기 위해 녹음 트랜스포트는 다음 규칙을 따릅니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">정지 상태에서 Record — <strong>프리롤</strong>(기본)</th><td className="manual-td">프리롤이 켜져 있고 <strong>앞에 들을 음악이 있으면</strong>, 재생 위치보다 <strong>설정한 초만큼 앞에서 기존 음악이 먼저 재생</strong>되고 원래 위치에 도달하면 <strong>녹음이 시작</strong>됩니다. 화면 상단에 <strong>PRE-ROLL</strong> 표시와 남은 시간이 뜨며, 타임라인은 가려지지 않습니다.</td></tr>
                      <tr><th className="manual-th">정지 상태에서 Record — <strong>카운트인</strong></th><td className="manual-td">프리롤이 꺼져 있거나, <strong>들을 음악이 없을 때</strong>(빈 프로젝트 / 맨 앞에서 녹음)는 화면 중앙에 <strong>카운트인</strong> 오버레이가 뜬 뒤 <strong>재생과 녹음이 동시에</strong> 시작됩니다. 메트로놈이 켜져 있으면 <strong>4 → 3 → 2 → 1</strong>(프로젝트 BPM 기준 한 마디), 꺼져 있으면 <strong>3 → 2 → 1</strong>(1초 간격 무음)입니다.</td></tr>
                      <tr><th className="manual-th">재생 중 Record</th><td className="manual-td">카운트인 없이 <strong>즉시</strong> 녹음이 시작됩니다.</td></tr>
                      <tr><th className="manual-th">프리롤 길이</th><td className="manual-td">트랜스포트의 <strong>프리롤 버튼</strong>을 누를 때마다 <strong>2초 → 4초 → 8초 → 끔</strong> 으로 바뀝니다(버튼에 현재 초가 표시됨, 기본 4초). 느린 곡은 길게, 빠른 곡은 짧게 두면 편합니다.</td></tr>
                      <tr><th className="manual-th">왜 프리롤인가</th><td className="manual-td">이 앱은 <strong>불러온 스템 위에 덧녹음</strong>하는 도구입니다. 그런 음악은 중간에 <strong>템포가 미묘하게 흔들리고</strong>, BPM이 맞아도 클릭이 곡의 <strong>박자 위상</strong>까지 알 수는 없어서 합성 클릭은 음악과 어긋나기 쉽습니다. 프리롤의 리드인은 <strong>곡 자체</strong>이므로 정의상 박자가 맞습니다. 길이를 마디가 아니라 <strong>초</strong>로 정하는 것도 같은 이유입니다.</td></tr>
                      <tr><th className="manual-th">메트로놈(카운트인 클릭)</th><td className="manual-td">트랜스포트의 <strong>메트로놈 버튼</strong>으로 켜고 끕니다. <strong>카운트인으로 시작할 때만</strong> 쓰입니다(프리롤에는 클릭이 없습니다 — 위 "왜 프리롤인가" 참고). 켜면 <strong>프로젝트 BPM에 맞춘 4박 클릭</strong>이 울립니다(첫 박은 높은 음으로 강조). 클릭은 <strong>모니터 출력 전용</strong>이라 <strong>녹음 파일과 Export에는 들어가지 않으며</strong>, 녹음이 시작되면 멈춥니다. 프로젝트 <strong>BPM이 없으면 버튼이 비활성</strong>됩니다.</td></tr>
                      <tr><th className="manual-th">Repeat 자동 해제</th><td className="manual-td">Record를 누르면 반복(Loop)이 <strong>자동으로 꺼집니다</strong>. 녹음이 끝나면 이전 반복 상태로 <strong>복원</strong>됩니다.</td></tr>
                      <tr><th className="manual-th">자동 종료</th><td className="manual-td">재생이 <strong>기존 트랙 중 가장 긴 트랙의 끝</strong>에 도달하면 녹음과 재생이 자동으로 멈춥니다. 기존 트랙이 없으면 직접 Stop을 누를 때까지 계속 녹음합니다.</td></tr>
                      <tr><th className="manual-th">녹음 중 Record / Stop</th><td className="manual-td">녹음과 재생을 모두 정지합니다. 트랜스포트는 0초로 복귀합니다.</td></tr>
                      <tr><th className="manual-th">녹음 중 Play/Pause · 처음으로 이동</th><td className="manual-td">녹음 중에는 <strong>무시</strong>됩니다. 녹음을 멈추려면 Record 또는 Stop을 사용하세요.</td></tr>
                      <tr><th className="manual-th">프리롤 · 카운트인 도중 조작</th><td className="manual-td">진행 중에 Record / Stop / Play를 누르면 <strong>취소</strong>됩니다(메트로놈 클릭도 즉시 멈춤). 프리롤을 취소하면 재생이 멈추고 <strong>플레이헤드가 Record를 누른 위치로 되돌아갑니다.</strong></td></tr>
                      <tr><th className="manual-th">프리롤이 안 되는 경우</th><td className="manual-td">① <strong>Repeat 구간이 켜져 있으면</strong> 프리롤 대신 카운트인이 쓰입니다(구간 반복은 플레이헤드를 구간 안에 가두므로 앞으로 되감을 수 없습니다). ② 재생 위치가 <strong>곡 맨 앞</strong>이거나 <strong>다른 트랙에 음악이 없으면</strong> 들려줄 리드인이 없으므로 카운트인으로 넘어갑니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-04-record-countin.png" alt="정지 상태에서의 녹음 시작 — 카운트인" className="manual-img" />
                    <div className="manual-figcaption">정지 상태에서 Record를 누르면 화면 중앙에 <strong>카운트인</strong> 숫자가 크게 뜬 뒤 재생과 녹음이 함께 시작됩니다(메트로놈 On = 프로젝트 BPM 기준 <strong>4 → 3 → 2 → 1</strong> + 클릭, Off = <strong>3 → 2 → 1</strong> 무음).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-05-preroll.png" alt="프리롤을 이용한 녹음 시작" className="manual-img" />
                    <div className="manual-figcaption">프리롤로 시작한 모습입니다. 트랙 위에 <strong>PRE-ROLL 7.1s</strong> 배지가 떠서 남은 시간을 알려 주고, 기존 음악이 먼저 재생되다가 원래 위치에 닿는 순간 녹음이 시작됩니다. 트랜스포트의 프리롤 버튼에는 현재 설정된 초(예: <strong>8</strong>)가 표시됩니다.</div>
                  </div>

                  <div className="manual-warning">녹음·카운트인 중에는 <strong>키보드 이동키(←/→/,/./0)와 타임라인·눈금자 마우스 클릭 이동(seek)이 모두 차단</strong>됩니다. 녹음 중 실수로 플레이헤드가 튀는 것을 막기 위한 것으로, 위치를 바꾸려면 먼저 녹음을 멈추세요.</div>

                  <h3 className="manual-h3">⑤ 구간 반복 녹음 — 테이크 쌓기</h3>
                  <p className="manual-p">같은 구절을 여러 번 불러 그중 제일 좋은 것을 고르고 싶을 때 씁니다. 타임라인 아래 <strong>OUTPUT FX 눈금 레인을 드래그해 Repeat 구간</strong>을 만들고 <strong>Repeat</strong>를 켠 뒤 Record를 누르면, 구간을 한 바퀴 돌 때마다 <strong>테이크가 하나씩 쌓입니다</strong>. 녹음 중에는 <strong>REC Take A · B · C …</strong> 배지가 현재 몇 번째 테이크인지 알려 줍니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-06-loop-take.png" alt="구간 반복 녹음(Take별 녹음)" className="manual-img" />
                    <div className="manual-figcaption">Repeat 구간을 켜고 녹음 중인 모습입니다. 구간이 파랗게 표시되고, 오른쪽 위 <strong>REC Take J</strong> 배지가 현재 녹음 중인 테이크를 나타냅니다.</div>
                  </div>

                  <h3 className="manual-h3">⑥ 테이크 고르기와 컴프(Comp)</h3>
                  <p className="manual-p">테이크가 둘 이상 쌓이면 클립 왼쪽 위에 <strong>“▾ n takes”</strong> 배지가 생깁니다. 이 배지를 누르면 아래로 <strong>테이크 레인</strong>이 펼쳐져 Take A, B, C … 를 나란히 볼 수 있습니다.</p>
                  <p className="manual-p"><strong>테이크는 클립(녹음한 구간)별로 따로 관리됩니다.</strong> 한 트랙에서 서로 다른 구간을 여러 번 녹음했다면, 레인 목록도 <strong>CLIP 1 · CLIP 2 · CLIP 3 …</strong> 머리글로 나뉘어 표시되고 <strong>각 클립의 테이크는 그 클립 안에서 Take A부터</strong> 번호가 매겨집니다. 배지도 <strong>“3 clips · 8 takes”</strong>처럼 알려 줍니다. 클립마다 테이크 개수가 달라도 서로 영향을 주지 않으며, <strong>선택한 테이크가 맨 위 메인 타임라인에 표시되고 재생·내보내기에 쓰입니다</strong>.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">테이크 고르기</th><td className="manual-td">레인을 <strong>클릭</strong>하면 <strong>그 클립</strong>이 해당 테이크로 재생됩니다. <strong>다른 클립의 선택은 그대로 유지</strong>됩니다(예: 1번 클립은 Take A, 2번 클립은 Take C, 3번 클립은 Take B).</td></tr>
                      <tr><th className="manual-th">컴프 만들기 (swipe)</th><td className="manual-td">레인 위를 <strong>가로로 쓸면(swipe)</strong> 한 클립 안에서도 구간마다 다른 테이크를 골라 이어 붙일 수 있습니다. “앞부분은 Take B, 뒷부분은 Take D”처럼 좋은 부분만 조합하는 방식입니다. 쓸기는 <strong>그 테이크가 속한 클립 구간 안으로만</strong> 적용됩니다.</td></tr>
                      <tr><th className="manual-th">Clear</th><td className="manual-td">쓸어서 나눈 구간을 지우고 <strong>각 클립이 다시 테이크 하나를 통째로</strong> 재생하게 되돌립니다. 클립별 테이크 선택은 그대로 남습니다.</td></tr>
                      <tr><th className="manual-th">테이크 삭제</th><td className="manual-td">각 레인 오른쪽의 <strong>×</strong> 버튼으로 그 테이크를 지웁니다.</td></tr>
                      <tr><th className="manual-th">Flatten Comp</th><td className="manual-td">조합한 결과를 <strong>하나의 오디오 파일로 확정</strong>합니다. <strong>클립마다 선택한 테이크가 각각 확정</strong>되고 나머지 테이크는 정리됩니다. 모든 테이크의 파형이 완전히 로드된 뒤에 실행하세요.</td></tr>
                      <tr><th className="manual-th">레인 접기</th><td className="manual-td">배지를 다시 누르거나 아래쪽 <strong>∨</strong> 버튼으로 레인을 접습니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-07-take-lanes.png" alt="다중 Take 녹음본을 펼친 모습" className="manual-img" />
                    <div className="manual-figcaption">테이크 레인을 펼친 모습입니다. Take A~E가 각각의 줄에 표시되고, 지금은 <strong>Take E</strong>가 active입니다. 맨 아래 <strong>Flatten Comp</strong>로 조합 결과를 확정합니다.</div>
                  </div>
                  <div className="manual-note">테이크 배지를 눌러도 <strong>재생 위치는 움직이지 않습니다</strong>. 배지는 레인을 펼치고 접는 역할만 합니다.</div>

                  <h3 className="manual-h3">⑦ Punch 녹음 — 일부 구간만 다시 부르기</h3>
                  <p className="manual-p">한 소절만 틀렸을 때 전체를 다시 부르지 않고 <strong>그 구간만 덮어쓰는</strong> 방식입니다. 먼저 <strong>Repeat 구간</strong>을 만든 다음 트랜스포트의 <strong>Punch</strong> 버튼을 켜고 Record를 누르면, 프리롤로 들어가 구간 시작점에서 <strong>자동으로 녹음이 시작(punch-in)</strong>되고 끝점에서 <strong>자동으로 멈춥니다(punch-out)</strong>. 구간 바깥의 소리는 건드리지 않습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-08-punch.png" alt="Punch 녹음 기능" className="manual-img" />
                    <div className="manual-figcaption"><strong>PUNCH</strong>로 지정된 구간(점선)입니다. 이 구간만 새로 녹음되고, 앞뒤 클립은 그대로 유지됩니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Punch 켜기 조건</th><td className="manual-td"><strong>Repeat 구간이 있어야</strong> 버튼이 활성화됩니다. 구간을 지우면 Punch도 자동으로 꺼집니다(구간 없는 상태에서 전체가 덮어써지는 사고를 막기 위함).</td></tr>
                      <tr><th className="manual-th">Punch 켜짐 + Repeat 꺼짐</th><td className="manual-td"><strong>단일 펀치</strong> — 구간을 한 번만 다시 녹음해 현재 테이크의 그 부분을 교체합니다.</td></tr>
                      <tr><th className="manual-th">Punch 켜짐 + Repeat 켜짐</th><td className="manual-td"><strong>Loop-Punch Comp</strong> — 구간을 반복하며 <strong>매 회차를 구간 전용 테이크로</strong> 쌓습니다. 그중 좋은 것을 테이크 레인에서 고르면 됩니다.</td></tr>
                      <tr><th className="manual-th">원본 보존</th><td className="manual-td">펀치 전의 소리는 버려지지 않고 <strong>테이크로 남습니다</strong>. 마음에 들지 않으면 이전 테이크로 되돌릴 수 있습니다.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">⑧ 클립 편집</h3>
                  <p className="manual-p">녹음된 오디오는 <strong>클립</strong> 단위로 다룰 수 있습니다(Audio In 트랙과 병합으로 만든 Bounce 트랙에서 사용 가능). 클립을 <strong>클릭</strong>하면 테두리가 밝아지며 선택되고, 시작·끝 시각이 표시됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-09-clip-selected.png" alt="녹음 트랙의 오디오 클립 선택" className="manual-img" />
                    <div className="manual-figcaption">클립을 선택한 모습입니다. 선택된 클립만 테두리가 강조됩니다.</div>
                  </div>
                  <p className="manual-p">클립 위에서 <strong>마우스 오른쪽 버튼</strong>을 누르면 편집 메뉴가 열립니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-10-clip-menu.png" alt="클립 메뉴 구성" className="manual-img" />
                    <div className="manual-figcaption">클립 오른쪽 클릭 메뉴입니다. 메뉴 아래쪽에는 드래그 이동·가장자리 트림·다중 선택 같은 조작 요령이 함께 안내됩니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Deselect <kbd className="manual-kbd">Esc</kbd></th><td className="manual-td">선택을 해제합니다.</td></tr>
                      <tr><th className="manual-th">Copy <kbd className="manual-kbd">Ctrl+C</kbd></th><td className="manual-td">선택한 클립을 복사합니다.</td></tr>
                      <tr><th className="manual-th">Paste at playhead <kbd className="manual-kbd">Ctrl+V</kbd></th><td className="manual-td">복사한 클립을 <strong>현재 재생 위치</strong>에 붙여 넣습니다.</td></tr>
                      <tr><th className="manual-th">Duplicate <kbd className="manual-kbd">Ctrl+D</kbd></th><td className="manual-td">클립을 바로 뒤에 복제합니다.</td></tr>
                      <tr><th className="manual-th">Split <kbd className="manual-kbd">C</kbd></th><td className="manual-td">재생 위치를 기준으로 클립을 <strong>둘로 나눕니다</strong>.</td></tr>
                      <tr><th className="manual-th">Merge Clips <kbd className="manual-kbd">J</kbd></th><td className="manual-td">이어진 클립들을 <strong>하나로 합칩니다</strong>.</td></tr>
                      <tr><th className="manual-th">Delete <kbd className="manual-kbd">Del</kbd></th><td className="manual-td">클립을 지웁니다.</td></tr>
                    </tbody>
                  </table>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">이동</th><td className="manual-td">클립 가운데를 <strong>드래그</strong>해 시간축으로 옮깁니다.</td></tr>
                      <tr><th className="manual-th">트림(길이 조절)</th><td className="manual-td">클립의 <strong>좌우 가장자리를 드래그</strong>해 앞뒤를 잘라 냅니다.</td></tr>
                      <tr><th className="manual-th">여러 개 선택</th><td className="manual-td"><kbd className="manual-kbd">Ctrl</kbd>+클릭으로 여러 클립을 함께 선택합니다.</td></tr>
                      <tr><th className="manual-th">미세 이동(nudge)</th><td className="manual-td">클립을 선택한 채 <kbd className="manual-kbd">←</kbd>/<kbd className="manual-kbd">→</kbd>로 밀어 줍니다. 기본 <strong>1 ms</strong>, <kbd className="manual-kbd">Ctrl</kbd>과 함께 <strong>10 ms</strong>, <kbd className="manual-kbd">Shift</kbd>와 함께 <strong>100 ms</strong>씩 이동합니다.</td></tr>
                      <tr><th className="manual-th">선택 해제</th><td className="manual-td"><kbd className="manual-kbd">Esc</kbd>를 누르거나 빈 곳을 클릭합니다.</td></tr>
                    </tbody>
                  </table>

                  <p className="manual-p"><strong>Split — 클립 나누기</strong></p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-11-split-before.png" alt="Split 전" className="manual-img" />
                    <div className="manual-figcaption">Split 전 — 하나로 이어진 클립입니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-12-split-after.png" alt="Split 후" className="manual-img" />
                    <div className="manual-figcaption">Split 후 — 재생 위치를 경계로 클립이 나뉘어 각각 따로 옮기거나 지울 수 있습니다.</div>
                  </div>

                  <p className="manual-p"><strong>Merge Clips — 클립 합치기</strong></p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-13-merge-before.png" alt="클립 Merge 전" className="manual-img" />
                    <div className="manual-figcaption">Merge 전 — 두 개의 클립으로 나뉘어 있습니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-14-merge-after.png" alt="클립 Merge 후" className="manual-img" />
                    <div className="manual-figcaption">Merge 후 — 하나의 클립이 되어 시작·끝 시각이 한 쌍으로 표시됩니다.</div>
                  </div>

                  <p className="manual-p"><strong>클립별 볼륨</strong> — 클립을 선택하면 위쪽에 가로선이 나타납니다. 이 선을 <strong>아래로 끌면 그 클립만 소리가 작아집니다</strong>. 맨 위가 0 dB이고 <strong>줄이는 방향으로만</strong> 동작하며, 드래그하는 동안 dB 값이 표시되고 파형 높이도 함께 줄어듭니다. 한 구절만 너무 크게 불렀을 때 트랙 전체 볼륨을 건드리지 않고 그 부분만 낮출 수 있습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-15-clip-volume.png" alt="클립별 볼륨 조정 기능" className="manual-img" />
                    <div className="manual-figcaption">클립 위쪽의 볼륨 선입니다. 안내 문구처럼 <strong>아래로 끌어</strong> 해당 클립의 볼륨만 낮춥니다.</div>
                  </div>
                  <div className="manual-note">클립 편집·클립 볼륨은 모두 <strong>되돌리기(Undo)</strong>가 되고, 프로젝트에 저장되며, Export 결과에도 그대로 반영됩니다.</div>

                  <h3 className="manual-h3">⑨ 보컬 채널 스트립 (FX)</h3>
                  <p className="manual-p">Audio In 트랙과 Bounce 트랙 헤더의 <strong>FX 버튼</strong>(파형 모양)을 누르면 <strong>보컬 채널 스트립</strong> 창이 열립니다. 녹음한 목소리를 다듬는 여섯 개의 모듈이 <strong>신호가 지나가는 순서대로</strong> 세로로 놓여 있고, 이 처리는 <strong>트랙 페이더 앞(pre-fader)</strong>에서 이루어져 재생·Export·프로젝트 저장에 모두 반영됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-16a-vocal-strip.png" alt="보컬 채널 스트립 — 상단부" className="manual-img" />
                    <div className="manual-figcaption">스트립 상단입니다. 트랙 이름과 <strong>STRIP ACTIVE</strong>(A/B) 스위치, <strong>PRESET</strong> 줄, <strong>Spectrum</strong>, 그리고 <strong>01 High-Pass Filter</strong>와 <strong>02 Noise Gate</strong>가 보입니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-16b-vocal-strip.png" alt="보컬 채널 스트립 — 하단부" className="manual-img" />
                    <div className="manual-figcaption">스트립 하단입니다. <strong>04 Compressor</strong>, <strong>05 De-Esser</strong>, <strong>06 Broadband De-noise</strong>가 이어집니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-16c-strip-eq.png" alt="보컬 스트립 03 Equalizer" className="manual-img" />
                    <div className="manual-figcaption">Noise Gate와 Compressor 사이에 있는 <strong>03 Equalizer</strong>입니다. 60Hz부터 15kHz까지 9개의 세로 페이더를 끌어 대역별로 조절하며, 각 페이더 위에 현재 값(dB)이 표시됩니다(올린 대역은 초록, 내린 대역은 붉은색). <strong>더블클릭하면 0 dB</strong>로 돌아갑니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">STRIP ACTIVE (A/B)</th><td className="manual-td">스트립 <strong>전체</strong>를 켜고 끕니다. 껐다 켜며 <strong>처리 전/후를 즉석에서 비교</strong>할 때 씁니다.</td></tr>
                      <tr><th className="manual-th">PRESET</th><td className="manual-td"><strong>Clean Lead · Warm Pop · Bright Air · Podcast</strong> 네 가지 보컬 프리셋입니다. HPF · EQ · 컴프레서 · 디에서를 한 번에 잡아 줍니다.</td></tr>
                      <tr><th className="manual-th">Reset</th><td className="manual-td">모든 모듈을 기본값으로 되돌리고 끕니다. <strong>A/B(Bypass) 상태는 건드리지 않습니다</strong> — 듣고 있는 방식을 초기화가 말없이 바꾸지 않도록 하기 위함입니다.</td></tr>
                      <tr><th className="manual-th">Spectrum</th><td className="manual-td">처리 <strong>전(PRE)</strong>과 <strong>후(POST)</strong>의 주파수 곡선을 겹쳐 보여 줍니다. EQ를 움직이면 POST 곡선이 실시간으로 따라 바뀌어, 목소리가 어떻게 달라지는지 눈으로 확인할 수 있습니다.</td></tr>
                      <tr><th className="manual-th">01 High-Pass Filter</th><td className="manual-td">저역 <strong>럼블·팝 노이즈</strong>를 잘라 냅니다(12 dB/oct). FREQ로 자를 지점을 정합니다.</td></tr>
                      <tr><th className="manual-th">02 Noise Gate</th><td className="manual-td">설정한 <strong>임계값(THRESH) 아래 소리를 줄여</strong> 숨소리와 방 소음을 정리합니다. RATIO · ATTACK · RELEASE로 반응을 다듬고, <strong>ATTENUATION</strong> 미터로 지금 얼마나 줄이고 있는지 확인합니다.</td></tr>
                      <tr><th className="manual-th">03 Equalizer</th><td className="manual-td">9밴드 그래픽 EQ입니다. 세로 페이더를 끌어 대역별로 올리고 내립니다(<strong>더블클릭 = 0 dB</strong>).</td></tr>
                      <tr><th className="manual-th">04 Compressor</th><td className="manual-td">큰 소리와 작은 소리의 <strong>차이를 좁혀</strong> 목소리를 고르게 만듭니다. THRESH · RATIO · ATTACK · RELEASE · MAKEUP을 노브로 조절하며, 노브는 <strong>휠로 미세 조정</strong>·<strong>더블클릭으로 초기화</strong>됩니다. <strong>GAIN REDUCTION</strong> 미터로 압축량을 봅니다.</td></tr>
                      <tr><th className="manual-th">05 De-Esser</th><td className="manual-td">“ㅅ/ㅊ” 같은 <strong>치찰음</strong>이 셀 때 그 대역만 눌러 줍니다(컴프레서 뒤에 적용). FREQ · THRESH · AMOUNT로 설정하고 <strong>DE-ESS GR</strong> 미터로 동작량을 확인합니다.</td></tr>
                      <tr><th className="manual-th">06 Broadband De-noise</th><td className="manual-td">일정하게 깔린 <strong>방 소음·히스</strong>를 제거합니다(⑩ 참고). 실시간이 아니라 <strong>파일로 찍어 내는 오프라인 처리</strong>입니다.</td></tr>
                    </tbody>
                  </table>
                  <p className="manual-p">각 모듈 오른쪽의 <strong>ON / OFF</strong> 버튼으로 개별로 켜고 끌 수 있습니다. 꺼져 있어도 <strong>노브를 만지면 자동으로 켜집니다.</strong></p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-17-strip-preset-spectrum.png" alt="FX 프리셋 적용과 스펙트럼 비교" className="manual-img" />
                    <div className="manual-figcaption"><strong>Podcast</strong> 프리셋을 적용한 모습입니다. Spectrum에 <strong>PRE(원음)</strong>와 <strong>POST(처리 후)</strong> 두 곡선이 겹쳐 표시되어 차이를 바로 확인할 수 있습니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-18-noise-gate.png" alt="Noise 게이트 작동 모습" className="manual-img" />
                    <div className="manual-figcaption">Noise Gate가 동작하는 모습입니다. <strong>ATTENUATION</strong> 막대가 차오르며 지금 얼마나 줄이고 있는지(예: 21.7 dB) 보여 줍니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-19-comp-deesser.png" alt="Compressor와 De-Esser 작동 모습" className="manual-img" />
                    <div className="manual-figcaption">Compressor와 De-Esser가 동작하는 모습입니다. 각각의 <strong>GAIN REDUCTION</strong> · <strong>DE-ESS GR</strong> 미터가 움직여, 효과가 미묘할 때도 실제로 걸리고 있는지 눈으로 확인할 수 있습니다.</div>
                  </div>
                  <div className="manual-note">프리셋은 <strong>Noise Gate를 일부러 건드리지 않습니다.</strong> 적정 임계값은 녹음마다 노이즈 바닥이 달라 고정값이 의미가 없기 때문입니다 — 너무 낮으면 아무 일도 일어나지 않고, 너무 높으면 말끝이 잘립니다. 게이트는 자신의 녹음을 들으며 직접 맞추세요.</div>

                  <h3 className="manual-h3">⑩ 노이즈 제거 — Broadband De-noise</h3>
                  <p className="manual-p">에어컨 소리나 히스처럼 <strong>계속 깔려 있는 잡음</strong>을 없애는 기능입니다. 먼저 잡음만 있는 구간을 들려주어 <strong>“이것이 잡음”이라고 학습</strong>시킨 뒤, 그 특성을 곡 전체에서 빼내는 방식입니다.</p>
                  <ol className="manual-ol">
                    <li className="manual-li">해당 트랙에서 <strong>소리 없이 잡음만 있는 구간</strong>(숨소리·방 소음만 있는 곳)을 <strong>Repeat 구간</strong>으로 지정합니다.</li>
                    <li className="manual-li">스트립의 <strong>Learn Noise</strong>를 누릅니다. 학습에 성공하면 버튼이 <strong>✓ Noise learned</strong>로 바뀌고 아래에 학습한 길이가 표시됩니다.</li>
                    <li className="manual-li"><strong>AMOUNT</strong>로 제거 강도를 정한 뒤 <strong>Apply De-noise</strong>를 누릅니다.</li>
                  </ol>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-20-denoise.png" alt="Noise 제거 기능" className="manual-img" />
                    <div className="manual-figcaption">잡음 학습을 마친 상태입니다. <strong>Noise profile learned — 0.35 s</strong>처럼 학습 결과가 표시되고 <strong>Apply De-noise</strong>를 누를 수 있게 됩니다.</div>
                  </div>
                  <div className="manual-note">De-noise는 <strong>비파괴</strong>입니다. 처리 결과는 <strong>새 파일로 저장</strong>되고 원본 녹음 WAV는 그대로 남으며, <strong>되돌리기(Undo)</strong>도 됩니다. AMOUNT를 지나치게 올리면 목소리까지 깎여 답답해질 수 있으니, 조금씩 올리며 들어 보고 정하세요.</div>

                  <h3 className="manual-h3">⑪ 테이크 관리 · 이름 변경</h3>
                  <ul className="manual-ul">
                    <li className="manual-li">녹음이 끝나면 입력 신호가 트랙 위에 파형으로 붙고, 실제 오디오는 <code className="manual-code">.wav</code> 파일로 저장됩니다. 녹음을 시작한 위치가 곡의 중간이면 그 시점에 클립이 놓입니다.</li>
                    <li className="manual-li">같은 트랙에서 <strong>다시 Record</strong>하면 새 테이크가 만들어집니다. Repeat나 Punch를 쓰지 않았다면 마지막 테이크가 재생 대상이 됩니다.</li>
                    <li className="manual-li">트랙 제목을 <strong>더블클릭</strong>하면 이름을 바로 편집할 수 있습니다(Enter 확정, Esc 취소). <strong>트랙 이름과 녹음 파일 이름은 따로 관리</strong>되므로, 트랙 이름을 바꿔도 이미 녹음된 파일 이름은 바뀌지 않습니다.</li>
                  </ul>
                  <div className="manual-note">녹음 파일은 다른 오디오와 마찬가지로 마스터 EQ·리버브·에코 등 출력 이펙트와 트랙 볼륨 오토메이션의 영향을 받습니다. 완성된 테이크는 <strong>11. 믹스다운 내보내기</strong>에서 전체 믹스에 함께 렌더링됩니다.</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">4. Recording &amp; Clip Editing</h2>
                  <p className="manual-p">FocusDAW Studio can record a live input signal from a microphone or audio interface straight onto an <strong>Audio In track</strong>. Each recording is saved into the project folder as a <code className="manual-code">.wav</code> take and behaves exactly like any other stem — volume, pan, solo, mute, automation, and the master effects all apply. <strong>Overdubbing</strong> vocals or ad-libs on top of imported stems is what this app is built around.</p>
                  <p className="manual-p">This chapter follows the whole flow in order: <strong>record → choose among takes → tidy the clips → shape the voice</strong>.</p>

                  <div className="manual-note">Before recording, set up your input under <strong>Settings ▸ Audio Devices</strong> (mode, input/output device, sample rate, buffer). See <strong>12. Settings, Audio Devices &amp; Themes</strong> for the full device setup.</div>

                  <h3 className="manual-h3">1. Create an Audio In track</h3>
                  <p className="manual-p">The <strong>TRACK</strong> area at the top left of the timeline has two add buttons. The <strong>+</strong> (plus) creates a normal file track for importing audio; the <strong>+ Audio In</strong> button creates an <strong>input-recording track</strong>. Audio In tracks are tinted blue in the header and sit <strong>outside</strong> the FILE TRACKS group.</p>

                  <h3 className="manual-h3">2. Audio In track header controls</h3>
                  <p className="manual-p">In addition to the usual volume, pan, solo, and mute, an Audio In track header adds dedicated recording controls. (At track size <strong>S</strong> only ARM is shown inline on the title row for space; <strong>M/L</strong> reveal every control.)</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">ARM</th><td className="manual-td">Arms this track for recording. Audio is only captured to the armed track, and <strong>only one Audio In track can be armed at a time</strong> (arming another disarms the previous one). The transport Record button is only active while a track is armed.</td></tr>
                      <tr><th className="manual-th">Input port</th><td className="manual-td">Chooses which input channel this track receives. Ports are built dynamically from the real channel count of the currently open interface: <strong>mono ports (Input 1, Input 2 …)</strong> and <strong>consecutive stereo pairs (Input 1-2 …)</strong>. (ASIO shows the interface's actual channel names.)</td></tr>
                      <tr><th className="manual-th">MON</th><td className="manual-td"><strong>Input monitoring.</strong> When on, the incoming signal is passed to the output so you can hear it live. A mono input is centered to both output channels.</td></tr>
                      <tr><th className="manual-th">LIM</th><td className="manual-td"><strong>Input limiter</strong> (ceiling −1.0 dBFS). When on, it prevents clipping from a hot input. On by default. How much the limiter is actually clamping is shown by the <strong>gain-reduction (GR) meter</strong> on the input gain slider (the red bar beneath the level meter, filling from the right). If GR moves a lot and often, the input gain is too high — turn it down.</td></tr>
                      <tr><th className="manual-th">Input gain</th><td className="manual-td">Sets the gain of the signal being recorded; the header shows the current gain in dB. Aim for a level where the meter does not hit the top — too hot distorts, too low raises the noise floor.</td></tr>
                      <tr><th className="manual-th">Volume · Pan</th><td className="manual-td">Playback level and stereo position, same as a file track (volume ranges −∞ to +6 dB).</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-01-audioin-header-m.png" alt="Audio In track header at size M" className="manual-img" />
                    <div className="manual-figcaption">An Audio In track header at track size <strong>M</strong>: <strong>ARM · S · M</strong> on the title row, with volume and pan below.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-02-audioin-header-l.png" alt="Audio In track header at size L" className="manual-img" />
                    <div className="manual-figcaption">Fully expanded at track size <strong>L</strong>: the <strong>input port (Input 1)</strong> · <strong>MON</strong> · <strong>LIM</strong> · <strong>input gain (IN)</strong> row with its meters, and automation <strong>Reset · Curve</strong> at the bottom.</div>
                  </div>
                  <p className="manual-p">On the lower row, next to the automation <strong>AUTO</strong> button, sits a waveform-shaped <strong>FX button</strong> — this is the entry point to the <strong>Vocal Channel Strip</strong> (see step 9). The <strong>SOURCE</strong> chip on the right confirms the track's audio is linked; it turns into a red <strong>NO SRC</strong> chip if the file cannot be found.</p>

                  <h3 className="manual-h3">3. Arming the track</h3>
                  <p className="manual-p">Press <strong>ARM</strong> on the track you want to record. The transport <strong>Record</strong> button only becomes active while a track is armed, and audio is captured to that track alone.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-03-arm.png" alt="Armed Audio In track" className="manual-img" />
                    <div className="manual-figcaption">The <strong>red ARM</strong> button indicates the track is armed. Only while a track is armed is the transport Record button active.</div>
                  </div>

                  <h3 className="manual-h3">4. Starting a take — transport rules</h3>
                  <p className="manual-p">Once armed, press the transport <strong>Record (red dot)</strong> button to start recording. To prevent mistakes, the recording transport follows these rules:</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Record from stopped — <strong>pre-roll</strong> (default)</th><td className="manual-td">With pre-roll on and <strong>music to roll into</strong>, playback starts the set number of seconds <strong>before</strong> the playhead and <strong>recording begins when it reaches the original position</strong>. A <strong>PRE-ROLL</strong> chip and the remaining time appear at the top; the timeline stays visible.</td></tr>
                      <tr><th className="manual-th">Record from stopped — <strong>count-in</strong></th><td className="manual-td">With pre-roll off, or when there is <strong>nothing to roll into</strong> (empty project / recording at the very start), a <strong>count-in</strong> overlay appears and <strong>playback and recording start together</strong>. With the metronome on it counts <strong>4 → 3 → 2 → 1</strong> (one bar at the project BPM); with it off, <strong>3 → 2 → 1</strong> silently, a second apart.</td></tr>
                      <tr><th className="manual-th">Record while playing</th><td className="manual-td">Recording begins <strong>immediately</strong>, with no count-in.</td></tr>
                      <tr><th className="manual-th">Pre-roll length</th><td className="manual-td">Each press of the <strong>pre-roll button</strong> cycles <strong>2s → 4s → 8s → off</strong> (the button shows the current length; default 4s). Longer suits slow songs, shorter suits fast ones.</td></tr>
                      <tr><th className="manual-th">Why pre-roll</th><td className="manual-td">This app records <strong>over imported stems</strong>. That material tends to <strong>drift in tempo</strong>, and even at a matching BPM a click cannot know the song's <strong>beat phase</strong> — so a synthesized click easily disagrees with the music. A pre-roll's lead-in <strong>is the song</strong>, so it is in time by definition. That is also why the length is set in <strong>seconds</strong> rather than bars.</td></tr>
                      <tr><th className="manual-th">Metronome (count-in click)</th><td className="manual-td">Toggled with the <strong>metronome button</strong> in the transport. Used <strong>only when starting with a count-in</strong> (pre-roll has no click — see "Why pre-roll"). When on, it plays <strong>four clicks on the project's BPM</strong> (the downbeat is accented). The click is <strong>monitor-only</strong> — it is <strong>never in the recorded file or an Export</strong> — and it stops once recording starts. Without a project BPM the button is <strong>disabled</strong>.</td></tr>
                      <tr><th className="manual-th">Repeat auto-off</th><td className="manual-td">Pressing Record <strong>turns Loop off automatically</strong>, and <strong>restores</strong> the previous loop state when recording ends.</td></tr>
                      <tr><th className="manual-th">Auto-stop</th><td className="manual-td">When playback reaches the <strong>end of the longest existing track</strong>, recording and playback stop automatically. With no existing tracks, recording continues until you press Stop.</td></tr>
                      <tr><th className="manual-th">Record / Stop while recording</th><td className="manual-td">Stops both recording and playback; the transport returns to 0.</td></tr>
                      <tr><th className="manual-th">Play/Pause · Return-to-start while recording</th><td className="manual-td"><strong>Ignored</strong> during recording. Use Record or Stop to end the take.</td></tr>
                      <tr><th className="manual-th">During pre-roll / the count-in</th><td className="manual-td">Pressing Record / Stop / Play <strong>cancels</strong> it (and silences the click immediately). Cancelling a pre-roll stops playback and <strong>returns the playhead to where you pressed Record</strong>.</td></tr>
                      <tr><th className="manual-th">When pre-roll does not apply</th><td className="manual-td">① With a <strong>Repeat region active</strong>, the count-in is used instead — a repeat region keeps the playhead inside itself, so there is nowhere to roll back to. ② At the <strong>very start of the song</strong>, or with <strong>no music on other tracks</strong>, there is no lead-in to play, so it falls back to the count-in.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-04-record-countin.png" alt="Count-in overlay" className="manual-img" />
                    <div className="manual-figcaption">Recording from a stopped state shows a large <strong>count-in</strong> number, then starts playback and recording together (metronome on = <strong>4 → 3 → 2 → 1</strong> with clicks at the project BPM; off = a silent <strong>3 → 2 → 1</strong>).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-05-preroll.png" alt="Recording started with a pre-roll" className="manual-img" />
                    <div className="manual-figcaption">Starting with a pre-roll. A <strong>PRE-ROLL 7.1s</strong> badge counts down on the track while the existing music plays; recording begins the moment the playhead reaches your original position. The transport pre-roll button shows the current length (here <strong>8</strong>).</div>
                  </div>

                  <div className="manual-warning">During recording and the count-in, the <strong>keyboard seek keys (←/→/,/./0) and mouse-click seeking on the timeline/ruler are all blocked</strong> to keep the playhead from jumping mid-take. Stop recording first if you need to move the position.</div>

                  <h3 className="manual-h3">5. Loop recording — stacking takes</h3>
                  <p className="manual-p">Use this when you want to sing a phrase several times and keep the best one. Drag a <strong>Repeat region</strong> on the OUTPUT FX ruler lane, turn <strong>Repeat</strong> on, and press Record: <strong>each pass around the region records a new take</strong>. While recording, a <strong>REC Take A · B · C …</strong> badge shows which take is being captured.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-06-loop-take.png" alt="Loop recording, one take per pass" className="manual-img" />
                    <div className="manual-figcaption">Recording with a Repeat region active. The region is highlighted and the <strong>REC Take J</strong> badge names the take currently being recorded.</div>
                  </div>

                  <h3 className="manual-h3">6. Choosing takes and comping</h3>
                  <p className="manual-p">Once more than one take exists, a <strong>“▾ n takes”</strong> badge appears at the top left of the clip. Click it to expand the <strong>take lanes</strong> and see Take A, B, C … side by side.</p>
                  <p className="manual-p"><strong>Takes belong to the clip they were recorded into.</strong> If you recorded several different spots on one track, the lane list is split by <strong>CLIP 1 · CLIP 2 · CLIP 3 …</strong> headers and <strong>each clip numbers its own takes from Take A</strong> (the badge reads e.g. <strong>“3 clips · 8 takes”</strong>). Clips can hold different numbers of takes without affecting each other, and <strong>the take you select is what the main lane shows and what plays and exports</strong>.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Pick a take</th><td className="manual-td"><strong>Click</strong> a lane to play that take <strong>for that clip</strong>. The other clips keep their own selections — clip 1 on Take A, clip 2 on Take C, clip 3 on Take B is perfectly fine.</td></tr>
                      <tr><th className="manual-th">Build a comp (swipe)</th><td className="manual-td"><strong>Swipe horizontally</strong> across a lane to assemble one clip from different passes — "Take B for the first half, Take D for the rest". A swipe only applies <strong>inside its own clip's span</strong>.</td></tr>
                      <tr><th className="manual-th">Clear</th><td className="manual-td">Drops the swiped regions so <strong>each clip plays one whole take</strong> again. The per-clip take selections stay.</td></tr>
                      <tr><th className="manual-th">Delete a take</th><td className="manual-td">The <strong>×</strong> button at the right of each lane removes that take.</td></tr>
                      <tr><th className="manual-th">Flatten Comp</th><td className="manual-td"><strong>Commits the comp to audio.</strong> <strong>Every clip's selected take is committed</strong> and the remaining takes are cleared away. Run it once every take shows a fully loaded waveform.</td></tr>
                      <tr><th className="manual-th">Collapse lanes</th><td className="manual-td">Click the badge again, or the <strong>∨</strong> button below the lanes.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-07-take-lanes.png" alt="Take lanes expanded" className="manual-img" />
                    <div className="manual-figcaption">Take lanes expanded. Takes A–E each occupy a row, with <strong>Take E</strong> active. <strong>Flatten Comp</strong> at the bottom commits the result.</div>
                  </div>
                  <div className="manual-note">Clicking the take badge <strong>does not move the playhead</strong> — it only opens and closes the lanes.</div>

                  <h3 className="manual-h3">7. Punch recording — redoing part of a take</h3>
                  <p className="manual-p">When only one phrase is wrong, punch lets you <strong>overwrite just that span</strong> instead of re-singing everything. Set a <strong>Repeat region</strong>, turn on the transport's <strong>Punch</strong> button, and press Record: playback pre-rolls in, recording <strong>punches in automatically</strong> at the region start and <strong>punches out</strong> at its end. Everything outside the region is untouched.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-08-punch.png" alt="Punch recording" className="manual-img" />
                    <div className="manual-figcaption">The span marked <strong>PUNCH</strong> (dashed). Only this region is re-recorded; the clips before and after stay as they were.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Requires a region</th><td className="manual-td">The button is enabled only while a <strong>Repeat region exists</strong>. Removing the region turns Punch off automatically — this prevents a region-less punch from destructively re-recording the whole track.</td></tr>
                      <tr><th className="manual-th">Punch on + Repeat off</th><td className="manual-td"><strong>Single punch</strong> — records the region once and replaces that part of the active take.</td></tr>
                      <tr><th className="manual-th">Punch on + Repeat on</th><td className="manual-td"><strong>Loop-Punch Comp</strong> — loops the region and stores <strong>every pass as a region-scoped take</strong>, so you can pick the best one from the take lanes.</td></tr>
                      <tr><th className="manual-th">The original is kept</th><td className="manual-td">What was there before the punch is <strong>kept as a take</strong>, so you can always go back to it.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">8. Clip editing</h3>
                  <p className="manual-p">Recorded audio can be edited as <strong>clips</strong> (available on Audio In tracks and on Bounce tracks created by merging). <strong>Click</strong> a clip to select it — its border brightens and its start/end times are shown.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-09-clip-selected.png" alt="A selected clip on a recording track" className="manual-img" />
                    <div className="manual-figcaption">A selected clip. Only the selected clip gets the highlighted border.</div>
                  </div>
                  <p className="manual-p"><strong>Right-click</strong> a clip to open the edit menu.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-10-clip-menu.png" alt="Clip context menu" className="manual-img" />
                    <div className="manual-figcaption">The clip context menu. Its footer also reminds you of drag-to-move, edge-trim, and multi-select gestures.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Deselect <kbd className="manual-kbd">Esc</kbd></th><td className="manual-td">Clears the selection.</td></tr>
                      <tr><th className="manual-th">Copy <kbd className="manual-kbd">Ctrl+C</kbd></th><td className="manual-td">Copies the selected clip.</td></tr>
                      <tr><th className="manual-th">Paste at playhead <kbd className="manual-kbd">Ctrl+V</kbd></th><td className="manual-td">Pastes the copied clip at the <strong>current playhead position</strong>.</td></tr>
                      <tr><th className="manual-th">Duplicate <kbd className="manual-kbd">Ctrl+D</kbd></th><td className="manual-td">Duplicates the clip right after itself.</td></tr>
                      <tr><th className="manual-th">Split <kbd className="manual-kbd">C</kbd></th><td className="manual-td"><strong>Cuts the clip in two</strong> at the playhead.</td></tr>
                      <tr><th className="manual-th">Merge Clips <kbd className="manual-kbd">J</kbd></th><td className="manual-td"><strong>Joins</strong> adjacent clips into one.</td></tr>
                      <tr><th className="manual-th">Delete <kbd className="manual-kbd">Del</kbd></th><td className="manual-td">Removes the clip.</td></tr>
                    </tbody>
                  </table>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Move</th><td className="manual-td"><strong>Drag</strong> the middle of a clip along the timeline.</td></tr>
                      <tr><th className="manual-th">Trim</th><td className="manual-td"><strong>Drag a clip's left or right edge</strong> to shorten it from that side.</td></tr>
                      <tr><th className="manual-th">Multi-select</th><td className="manual-td"><kbd className="manual-kbd">Ctrl</kbd>+click to select several clips at once.</td></tr>
                      <tr><th className="manual-th">Nudge</th><td className="manual-td">With a clip selected, <kbd className="manual-kbd">←</kbd>/<kbd className="manual-kbd">→</kbd> nudges it — <strong>1 ms</strong> by default, <strong>10 ms</strong> with <kbd className="manual-kbd">Ctrl</kbd>, <strong>100 ms</strong> with <kbd className="manual-kbd">Shift</kbd>.</td></tr>
                      <tr><th className="manual-th">Deselect</th><td className="manual-td">Press <kbd className="manual-kbd">Esc</kbd> or click empty space.</td></tr>
                    </tbody>
                  </table>

                  <p className="manual-p"><strong>Split — cutting a clip</strong></p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-11-split-before.png" alt="Before Split" className="manual-img" />
                    <div className="manual-figcaption">Before Split — a single continuous clip.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-12-split-after.png" alt="After Split" className="manual-img" />
                    <div className="manual-figcaption">After Split — the clip is divided at the playhead, and each part can be moved or deleted on its own.</div>
                  </div>

                  <p className="manual-p"><strong>Merge Clips — joining clips</strong></p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-13-merge-before.png" alt="Before Merge" className="manual-img" />
                    <div className="manual-figcaption">Before Merge — two separate clips.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-14-merge-after.png" alt="After Merge" className="manual-img" />
                    <div className="manual-figcaption">After Merge — one clip with a single start/end pair.</div>
                  </div>

                  <p className="manual-p"><strong>Per-clip volume</strong> — selecting a clip reveals a horizontal line across its top. <strong>Drag that line down to lower just that clip's volume.</strong> The top is 0 dB and the control is <strong>cut-only</strong>; a live dB label follows the drag and the waveform shrinks to match. Use it when one phrase came out too loud, without touching the track fader.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-15-clip-volume.png" alt="Per-clip volume line" className="manual-img" />
                    <div className="manual-figcaption">The clip's volume line. As the tooltip says, <strong>drag down</strong> to attenuate only this clip.</div>
                  </div>
                  <div className="manual-note">Clip edits and clip volume are all <strong>undoable</strong>, saved with the project, and reflected in the Export.</div>

                  <h3 className="manual-h3">9. The Vocal Channel Strip (FX)</h3>
                  <p className="manual-p">The <strong>FX button</strong> (waveform icon) on an Audio In or Bounce track header opens the <strong>Vocal Channel Strip</strong> window. Six modules for shaping a recorded voice are stacked <strong>in the order the signal passes through them</strong>. The strip is an insert applied <strong>before the track fader (pre-fader)</strong> and is reflected in playback, Export, and the saved project.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-16a-vocal-strip.png" alt="Vocal channel strip — upper half" className="manual-img" />
                    <div className="manual-figcaption">The top of the strip: track name and the <strong>STRIP ACTIVE</strong> (A/B) switch, the <strong>PRESET</strong> row, <strong>Spectrum</strong>, then <strong>01 High-Pass Filter</strong> and <strong>02 Noise Gate</strong>.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-16b-vocal-strip.png" alt="Vocal channel strip — lower half" className="manual-img" />
                    <div className="manual-figcaption">The bottom of the strip: <strong>04 Compressor</strong>, <strong>05 De-Esser</strong>, and <strong>06 Broadband De-noise</strong>.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-16c-strip-eq.png" alt="Vocal strip 03 Equalizer" className="manual-img" />
                    <div className="manual-figcaption"><strong>03 Equalizer</strong>, between the Noise Gate and the Compressor. Drag the nine vertical faders (60 Hz–15 kHz) to shape each band; the current value in dB sits above each fader (green for boosts, red for cuts). <strong>Double-click returns a band to 0 dB.</strong></div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">STRIP ACTIVE (A/B)</th><td className="manual-td">Bypasses or engages the <strong>whole strip</strong> — flip it to <strong>compare processed against unprocessed</strong> on the spot.</td></tr>
                      <tr><th className="manual-th">PRESET</th><td className="manual-td">Four vocal starting points — <strong>Clean Lead · Warm Pop · Bright Air · Podcast</strong> — which set the HPF, EQ, compressor, and de-esser together.</td></tr>
                      <tr><th className="manual-th">Reset</th><td className="manual-td">Returns every module to its defaults and switches it off. It deliberately <strong>leaves the A/B (bypass) state alone</strong>, so resetting never silently changes what you are hearing.</td></tr>
                      <tr><th className="manual-th">Spectrum</th><td className="manual-td">Overlays the frequency curve <strong>before (PRE)</strong> and <strong>after (POST)</strong> the chain. Move the EQ and the POST curve follows in real time, so you can see how the voice is being reshaped.</td></tr>
                      <tr><th className="manual-th">01 High-Pass Filter</th><td className="manual-td">Cuts low-end <strong>rumble and plosives</strong> (12 dB/oct). FREQ sets the cutoff.</td></tr>
                      <tr><th className="manual-th">02 Noise Gate</th><td className="manual-td"><strong>Attenuates anything below the threshold</strong> to clean up breaths and room tone. RATIO · ATTACK · RELEASE shape the response, and the <strong>ATTENUATION</strong> meter shows how much is being removed right now.</td></tr>
                      <tr><th className="manual-th">03 Equalizer</th><td className="manual-td">A 9-band graphic EQ — drag the vertical faders to boost or cut each band (<strong>double-click = 0 dB</strong>).</td></tr>
                      <tr><th className="manual-th">04 Compressor</th><td className="manual-td"><strong>Narrows the gap between loud and quiet</strong> for an even vocal. THRESH · RATIO · ATTACK · RELEASE · MAKEUP knobs respond to <strong>the wheel for fine-tuning</strong> and <strong>double-click to recentre</strong>. The <strong>GAIN REDUCTION</strong> meter shows how hard it is working.</td></tr>
                      <tr><th className="manual-th">05 De-Esser</th><td className="manual-td">Tames harsh <strong>sibilance</strong> ("s"/"sh") by attenuating just that band when it gets loud — applied after the compressor. Set FREQ · THRESH · AMOUNT and watch the <strong>DE-ESS GR</strong> meter.</td></tr>
                      <tr><th className="manual-th">06 Broadband De-noise</th><td className="manual-td">Removes steady <strong>room tone or hiss</strong> (see step 10). This one is an <strong>offline print</strong>, not a realtime effect.</td></tr>
                    </tbody>
                  </table>
                  <p className="manual-p">Each module has its own <strong>ON / OFF</strong> button. Even while off, <strong>touching a knob switches that module on automatically.</strong></p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-17-strip-preset-spectrum.png" alt="Preset applied with PRE/POST spectrum" className="manual-img" />
                    <div className="manual-figcaption">The <strong>Podcast</strong> preset applied. The Spectrum draws <strong>PRE</strong> (source) and <strong>POST</strong> (processed) on top of each other so the difference is immediately visible.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-18-noise-gate.png" alt="Noise gate working" className="manual-img" />
                    <div className="manual-figcaption">The Noise Gate in action — the <strong>ATTENUATION</strong> bar fills to show how much is being removed (21.7 dB here).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-19-comp-deesser.png" alt="Compressor and de-esser working" className="manual-img" />
                    <div className="manual-figcaption">Compressor and De-Esser working. Their <strong>GAIN REDUCTION</strong> and <strong>DE-ESS GR</strong> meters move, so you can confirm the effect even when it is subtle.</div>
                  </div>
                  <div className="manual-note">The presets deliberately <strong>leave the Noise Gate alone.</strong> A usable threshold depends on your own recording's noise floor, so a fixed value is meaningless — too low and nothing happens, too high and word endings get chopped. Set the gate by ear on your own take.</div>

                  <h3 className="manual-h3">10. Broadband De-noise</h3>
                  <p className="manual-p">This removes <strong>constant background noise</strong> such as air conditioning or hiss. You first let it <strong>learn what the noise sounds like</strong> from a silent stretch, then subtract that profile from the whole clip.</p>
                  <ol className="manual-ol">
                    <li className="manual-li">Mark a stretch of this track that contains <strong>only noise</strong> (breaths / room tone, no singing) as the <strong>Repeat region</strong>.</li>
                    <li className="manual-li">Press <strong>Learn Noise</strong> in the strip. On success the button becomes <strong>✓ Noise learned</strong> and the learned length is reported below.</li>
                    <li className="manual-li">Set <strong>AMOUNT</strong>, then press <strong>Apply De-noise</strong>.</li>
                  </ol>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/04-20-denoise.png" alt="De-noise after learning a profile" className="manual-img" />
                    <div className="manual-figcaption">After learning. A status line such as <strong>Noise profile learned — 0.35 s</strong> appears and <strong>Apply De-noise</strong> becomes available.</div>
                  </div>
                  <div className="manual-note">De-noise is <strong>non-destructive</strong>: the cleaned audio is printed to a <strong>new file</strong>, the original recording WAV is kept, and the whole operation is <strong>undoable</strong>. Pushing AMOUNT too high starts eating the voice itself and sounds dull — raise it gradually and listen.</div>

                  <h3 className="manual-h3">11. Managing takes &amp; renaming</h3>
                  <ul className="manual-ul">
                    <li className="manual-li">When recording ends, the captured signal appears as a waveform and the audio is saved as a <code className="manual-code">.wav</code> file. If you started partway through the song, the clip is placed at that position.</li>
                    <li className="manual-li"><strong>Recording again</strong> on the same track creates a new take. Without Repeat or Punch, the latest take is the one that plays.</li>
                    <li className="manual-li"><strong>Double-click</strong> a track title to rename it inline (Enter to confirm, Esc to cancel). <strong>Track names and recording file names are handled separately</strong>, so renaming a track does not rename its already-recorded files.</li>
                  </ul>
                  <div className="manual-note">Like any other audio, recordings are shaped by the master EQ, reverb, echo, and other output effects, plus track volume automation. Finished takes are rendered into the full mix in <strong>11. Exporting Mixdown</strong>.</div>
                </>
              )}
            </section>

            {/* 5. 타임라인과 트랙 / Timeline & Tracks */}
            <section id="arrange" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">5. 타임라인과 트랙</h2>
                  <h3 className="manual-h3">트랜스포트 컨트롤</h3>
                  <p className="manual-p">상단 가운데의 버튼들로 재생과 녹음을 조작합니다. 오른쪽의 시간 표시는 <strong>현재 재생 위치 / 전체 길이</strong>입니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">처음으로</th><td className="manual-td">재생 위치를 0초로 되돌립니다(<kbd className="manual-kbd">0</kbd>).</td></tr>
                      <tr><th className="manual-th">정지</th><td className="manual-td">재생(및 녹음)을 멈춥니다.</td></tr>
                      <tr><th className="manual-th">재생 / 일시정지</th><td className="manual-td">재생과 일시정지를 전환합니다(<kbd className="manual-kbd">Space</kbd>).</td></tr>
                      <tr><th className="manual-th">Repeat</th><td className="manual-td">구간 반복을 켭니다. 구간은 아래 <strong>OUTPUT FX 눈금 레인을 드래그</strong>해 만듭니다. 녹음과 함께 쓰면 테이크가 쌓입니다(<strong>4장</strong>).</td></tr>
                      <tr><th className="manual-th">메트로놈</th><td className="manual-td">카운트인 클릭을 켜고 끕니다. <strong>프로젝트 BPM이 있어야</strong> 활성화됩니다.</td></tr>
                      <tr><th className="manual-th">프리롤</th><td className="manual-td">누를 때마다 <strong>2초 → 4초 → 8초 → 끔</strong>으로 바뀌며, 버튼에 현재 초가 표시됩니다(기본 4초).</td></tr>
                      <tr><th className="manual-th">Punch</th><td className="manual-td">Repeat 구간만 다시 녹음하는 모드입니다. <strong>구간이 있어야</strong> 활성화됩니다(<strong>4장</strong>).</td></tr>
                      <tr><th className="manual-th">Record</th><td className="manual-td">녹음을 시작합니다. <strong>ARM된 Audio In 트랙이 있어야</strong> 활성화됩니다.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">줌과 트랙 크기</h3>
                  <ul className="manual-ul">
                    <li className="manual-li"><strong>TIME</strong>: 타임라인의 가로(시간축) 확대·축소입니다.</li>
                    <li className="manual-li"><strong>AMP</strong>: 파형 표시 높이입니다. 실제 오디오 볼륨이 아니라 <strong>보기 배율</strong>입니다.</li>
                    <li className="manual-li"><strong>TRACK SIZE</strong>: 트랙 행 높이를 S · M · L 중에서 고릅니다(<strong>1장</strong> 참고).</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-01-time-zoom.png" alt="Time 줌 기능" className="manual-img" />
                    <div className="manual-figcaption">TIME 줌을 올리면 시간축이 넓어져 짧은 구간의 파형과 클립 경계, 오토메이션 포인트를 더 세밀하게 다룰 수 있습니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-02-amp-zoom.png" alt="AMP 줌 기능" className="manual-img" />
                    <div className="manual-figcaption">AMP를 올린 화면입니다. 오디오 레벨은 그대로 두고 파형만 크게 그려 작은 신호를 확인하기 좋습니다.</div>
                  </div>

                  <h3 className="manual-h3">상단 미니맵 이동</h3>
                  <p className="manual-p">타임라인 위쪽의 긴 막대는 곡 전체에서 현재 보고 있는 위치를 보여 주는 미니맵입니다. 안쪽 선택 영역을 드래그하면 긴 프로젝트에서도 원하는 시간대로 단번에 이동할 수 있습니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-03-minimap.png" alt="상단 미니맵 이동" className="manual-img" />
                    <div className="manual-figcaption">미니맵으로 원하는 구간으로 이동한 화면입니다. 가로 스크롤보다 훨씬 빠르게 위치를 잡을 수 있습니다.</div>
                  </div>

                  <h3 className="manual-h3">트랙 헤더 컨트롤</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">볼륨 슬라이더</th><td className="manual-td">트랙의 재생 레벨을 조절합니다. 0dB 지점은 슬라이더 중앙 눈금으로 표시됩니다.</td></tr>
                      <tr><th className="manual-th">Pan 노브</th><td className="manual-td">좌우 스테레오 위치를 조정합니다.</td></tr>
                      <tr><th className="manual-th">B 버튼</th><td className="manual-td">BPM 측정 대상으로 사용할 트랙을 선택합니다. 한 번에 하나의 트랙만 선택됩니다.</td></tr>
                      <tr><th className="manual-th">S 버튼</th><td className="manual-td">해당 트랙만 듣는 Solo 기능입니다. Solo가 켜진 트랙이 있으면 다른 트랙은 자동으로 들리지 않습니다.</td></tr>
                      <tr><th className="manual-th">M 버튼</th><td className="manual-td">해당 트랙을 음소거합니다.</td></tr>
                      <tr><th className="manual-th">AUTO</th><td className="manual-td">볼륨 오토메이션 레인을 켜고 끕니다(<strong>8장</strong>).</td></tr>
                      <tr><th className="manual-th">FX 버튼</th><td className="manual-td">Audio In · Bounce 트랙에만 있습니다. <strong>보컬 채널 스트립</strong> 창을 엽니다(<strong>4장</strong>).</td></tr>
                      <tr><th className="manual-th">SOURCE 칩</th><td className="manual-td">트랙의 원본 오디오가 정상 연결됐음을 뜻합니다. 파일을 찾지 못하면 붉은 <strong>NO SRC</strong>로 바뀝니다.</td></tr>
                      <tr><th className="manual-th">레벨 미터</th><td className="manual-td">트랙의 현재 출력 레벨을 표시합니다.</td></tr>
                      <tr><th className="manual-th">− 버튼</th><td className="manual-td">트랙을 제거합니다. 확인 창에서 삭제를 확정해야 합니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-warning">트랙 삭제와 오토메이션 초기화는 확인 후 즉시 적용됩니다. 필요하면 삭제 전에 프로젝트를 저장해 두세요.</div>

                  <h3 className="manual-h3">트랙 이름 바꾸기</h3>
                  <p className="manual-p">트랙 헤더의 제목을 <strong>더블클릭</strong>하면 그 자리에서 이름을 고칠 수 있습니다(Enter 확정, Esc 취소). <strong>트랙 이름과 녹음 파일 이름은 따로 관리</strong>되므로, 트랙 이름을 바꿔도 디스크의 녹음 파일 이름은 그대로 유지됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-04-track-rename.png" alt="트랙 헤더 이름 편집" className="manual-img" />
                    <div className="manual-figcaption">트랙 제목을 더블클릭해 이름을 편집하는 모습입니다.</div>
                  </div>

                  <h3 className="manual-h3">파일 트랙 그룹 — 접기 · 일괄 뮤트 · 병합</h3>
                  <p className="manual-p">불러온 스템은 모두 <strong>FILE TRACKS</strong> 그룹으로 묶입니다. 그룹 머리글에는 <strong>“n trk · n active”</strong>처럼 전체 트랙 수와 소리가 나고 있는 트랙 수가 표시되고, 오른쪽 <strong>HIDE / SHOW</strong>로 그룹 전체를 접거나 펼칩니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">일괄 뮤트</th><td className="manual-td">파일 트랙의 <strong>M</strong> 버튼을 <strong>Shift+클릭</strong>하면 <strong>모든 파일 트랙</strong>의 뮤트가 한 번에 켜지고 꺼집니다. 이때 그룹 머리글에 <strong>M4</strong>처럼 몇 개가 뮤트됐는지 배지가 표시됩니다. 믹서 창의 M 버튼에서도 똑같이 동작합니다.</td></tr>
                      <tr><th className="manual-th">적용 대상</th><td className="manual-td">일괄 뮤트는 <strong>파일 트랙에만</strong> 적용됩니다. <strong>Audio In 트랙과 Bounce 트랙은 제외</strong>되므로, 스템을 통째로 음소거하고 자신의 녹음만 확인할 수 있습니다.</td></tr>
                      <tr><th className="manual-th">MUTE Clr</th><td className="manual-td">OUTPUT FX 헤더의 <strong>MUTE Clr</strong> 버튼을 누르면 모든 트랙의 뮤트·솔로가 한 번에 해제됩니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-05-batch-mute.png" alt="파일 트랙의 일괄 뮤트" className="manual-img" />
                    <div className="manual-figcaption">파일 트랙을 일괄 뮤트한 모습입니다. 그룹 머리글이 <strong>4 trk · 0 active</strong>로 바뀌고 <strong>M4</strong> 배지가 표시되며, 아래 <strong>Audio In</strong> 트랙은 영향을 받지 않습니다.</div>
                  </div>

                  <h3 className="manual-h3">트랙 병합 — Merge Tracks (Bounce)</h3>
                  <p className="manual-p">여러 스템을 <strong>하나의 오디오 트랙으로 합치는</strong> 기능입니다. 스템이 많아 화면이 복잡하거나, 반주 전체를 한 덩어리로 묶어 두고 보컬 작업에만 집중하고 싶을 때 씁니다.</p>
                  <p className="manual-p">합칠 파일 트랙들을 고른 뒤 FILE TRACKS 머리글 오른쪽의 <strong>MERGE TRACKS…</strong> 버튼을 누르면 설정 창이 열립니다. 이 버튼은 <strong>트랙을 2개 이상 선택해야</strong> 활성화되며, 버튼 왼쪽에 선택한 트랙 수가 표시됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-06a-merge-button.png" alt="트랙 2개 선택 시 MERGE TRACKS 버튼 활성화" className="manual-img" />
                    <div className="manual-figcaption">파일 트랙을 두 개 선택하자 FILE TRACKS 머리글의 <strong>MERGE TRACKS…</strong> 버튼이 활성화된 모습입니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-06b-merge-dialog.png" alt="Merge Tracks 대화창" className="manual-img" />
                    <div className="manual-figcaption">Merge Tracks 창입니다. 맨 위에 합쳐질 트랙 목록이 표시되고, 아래에서 이름·채널·원본 처리 방식을 정한 뒤 <strong>Create Bounce</strong>로 렌더링합니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Track Name</th><td className="manual-td">만들어질 <strong>Bounce 트랙</strong>의 이름입니다.</td></tr>
                      <tr><th className="manual-th">Channels</th><td className="manual-td"><strong>Stereo</strong> 또는 <strong>Mono</strong>로 렌더링합니다.</td></tr>
                      <tr><th className="manual-th">Originals</th><td className="manual-td">원본 트랙 처리 방식입니다. <strong>Keep + Mute</strong>(남기고 음소거·기본값) · <strong>Keep</strong>(그대로 남김) · <strong>Delete</strong>(삭제) 중에서 고릅니다.</td></tr>
                      <tr><th className="manual-th">Create Bounce</th><td className="manual-td">렌더링을 시작합니다. 완료되면 새 <strong>Bounce 트랙</strong>이 만들어집니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-note">만들어진 <strong>Bounce 트랙</strong>은 Audio In 트랙과 마찬가지로 <strong>클립 편집</strong>과 <strong>보컬 채널 스트립(FX)</strong>을 쓸 수 있습니다. 원본을 <strong>Keep + Mute</strong>로 두면 나중에 다시 펼쳐 볼 수 있으므로 가장 안전합니다.</div>
                  <div className="manual-note"><strong>바운스는 언제나 원본 BPM · Key로 렌더링됩니다.</strong> Vari BPM이나 Vari Key를 켜 둔 채 병합해도 결과물의 길이와 음정이 달라지지 않아, 타임라인에서 원본 트랙과 정확히 겹칩니다. 템포·조성 변경은 <strong>실시간 재생과 Export</strong>에만 적용된다고 기억하세요(<strong>6장 · 7장 · 11장</strong>).</div>

                  <h3 className="manual-h3">Edit 메뉴 — 모든 트랙 삭제 (Delete all tracks) <span className="appver-since">(v1.9.0)</span></h3>
                  <p className="manual-p">상단 <strong>Edit</strong> 메뉴의 Undo / Redo 아래에 <strong>Delete all tracks</strong> 항목이 있습니다. 현재 불러온 <strong>오디오 트랙만 모두 비우고</strong>, 마스터(프로젝트 전체)에 걸어 둔 <strong>이펙트 설정은 그대로 유지</strong>합니다. 같은 이펙트 체인(마스터 EQ·리버브·에코·Ambience·페이드 등)을 유지한 채 다른 스템 세트로 교체할 때 유용합니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-03-edit-menu.png" alt="Edit 메뉴의 Delete all tracks 항목" className="manual-img" />
                    <div className="manual-figcaption">Edit 메뉴의 <strong>Delete all tracks</strong> 항목입니다. 실수를 막기 위해 확인 창을 거칩니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">유지되는 것</th><td className="manual-td">마스터 출력 이펙트(EQ, Reverb, Delay, Saturation, Widener, Exciter), Ambience, 마스터 페이드 등 <strong>프로젝트 전체 설정</strong>.</td></tr>
                      <tr><th className="manual-th">사라지는 것</th><td className="manual-td">모든 오디오 트랙과 트랙별 설정(PAN, 트랙 볼륨/게인, 볼륨 오토메이션). BPM/Key도 빈 프로젝트처럼 <strong>---</strong>로 초기화됩니다.</td></tr>
                      <tr><th className="manual-th">되돌리기</th><td className="manual-td">삭제된 트랙의 오디오는 보관하지 않으므로 <strong>되돌릴 수 없습니다</strong>. 실행 시 Undo/Redo 기록도 비워집니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-warning">Delete all tracks는 되돌릴 수 없습니다. 트랙을 보존해야 한다면 실행 전에 <code className="manual-code">Project &gt; Save Project</code>로 저장해 두세요. (참고: <code className="manual-code">New Project</code>는 트랙과 함께 마스터 이펙트까지 모두 초기화합니다.)</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">5. Timeline & Tracks</h2>
                  <h3 className="manual-h3">Transport Controls</h3>
                  <p className="manual-p">The buttons at the top center drive playback and recording. The time readout on their right is <strong>current position / total length</strong>.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Return to start</th><td className="manual-td">Moves the playhead back to 0 (<kbd className="manual-kbd">0</kbd>).</td></tr>
                      <tr><th className="manual-th">Stop</th><td className="manual-td">Stops playback (and recording).</td></tr>
                      <tr><th className="manual-th">Play / Pause</th><td className="manual-td">Toggles playback (<kbd className="manual-kbd">Space</kbd>).</td></tr>
                      <tr><th className="manual-th">Repeat</th><td className="manual-td">Loops a region, which you drag on the <strong>OUTPUT FX ruler lane</strong>. Combined with Record it stacks takes (<strong>ch. 4</strong>).</td></tr>
                      <tr><th className="manual-th">Metronome</th><td className="manual-td">Toggles the count-in click. Requires a <strong>project BPM</strong> to be enabled.</td></tr>
                      <tr><th className="manual-th">Pre-roll</th><td className="manual-td">Each press cycles <strong>2s → 4s → 8s → off</strong>; the button shows the current length (default 4s).</td></tr>
                      <tr><th className="manual-th">Punch</th><td className="manual-td">Re-records only the Repeat region. Requires <strong>a region</strong> to be enabled (<strong>ch. 4</strong>).</td></tr>
                      <tr><th className="manual-th">Record</th><td className="manual-td">Starts recording. Requires <strong>an armed Audio In track</strong>.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Zoom and Track Size</h3>
                  <ul className="manual-ul">
                    <li className="manual-li"><strong>TIME</strong>: horizontal (time-axis) zoom of the timeline.</li>
                    <li className="manual-li"><strong>AMP</strong>: waveform display height — a <strong>visual scale only</strong>, not the audio level.</li>
                    <li className="manual-li"><strong>TRACK SIZE</strong>: track row height, S · M · L (see <strong>ch. 1</strong>).</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-01-time-zoom.png" alt="Timeline zoomed in" className="manual-img" />
                    <div className="manual-figcaption">With TIME zoom increased, waveforms, clip boundaries, and automation points can be handled with much more precision.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-02-amp-zoom.png" alt="Waveform amplitude zoom" className="manual-img" />
                    <div className="manual-figcaption">With AMP raised, quiet signals and transients are easy to inspect — the audio level itself is unchanged.</div>
                  </div>

                  <h3 className="manual-h3">Minimap Navigation</h3>
                  <p className="manual-p">The bar above the timeline represents the whole song. Dragging the highlighted area moves the view instantly, even across long sessions.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-03-minimap.png" alt="Minimap navigation" className="manual-img" />
                    <div className="manual-figcaption">Using the minimap to jump to a section — far faster than scrolling horizontally.</div>
                  </div>

                  <h3 className="manual-h3">Track Header Controls</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Volume Slider</th><td className="manual-td">Controls track volume. The center position marks nominal gain (0dB).</td></tr>
                      <tr><th className="manual-th">Pan Knob</th><td className="manual-td">Positions the track in the stereo field (Left/Right balance).</td></tr>
                      <tr><th className="manual-th">B Button</th><td className="manual-td">Selects the track used for BPM detection. Only one track can be selected at a time.</td></tr>
                      <tr><th className="manual-th">S Button</th><td className="manual-td">Solos the track (mutes all other non-soloed tracks).</td></tr>
                      <tr><th className="manual-th">M Button</th><td className="manual-td">Mutes the track.</td></tr>
                      <tr><th className="manual-th">AUTO</th><td className="manual-td">Toggles the volume automation lane (<strong>ch. 8</strong>).</td></tr>
                      <tr><th className="manual-th">FX Button</th><td className="manual-td">Present on Audio In and Bounce tracks only — opens the <strong>Vocal Channel Strip</strong> (<strong>ch. 4</strong>).</td></tr>
                      <tr><th className="manual-th">SOURCE chip</th><td className="manual-td">Confirms the track's source audio is linked. It turns into a red <strong>NO SRC</strong> chip when the file cannot be found.</td></tr>
                      <tr><th className="manual-th">Level Meter</th><td className="manual-td">Displays real-time playback output levels.</td></tr>
                      <tr><th className="manual-th">− Button</th><td className="manual-td">Deletes the track from the project (requires confirmation).</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-warning">Track deletion and automation resets take effect immediately after confirmation. Save your project first if you are unsure.</div>

                  <h3 className="manual-h3">Renaming tracks</h3>
                  <p className="manual-p"><strong>Double-click</strong> a track title in the header to edit it in place (Enter to confirm, Esc to cancel). <strong>Track names and recording file names are handled separately</strong>, so renaming a track leaves the recorded files on disk untouched.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-04-track-rename.png" alt="Editing a track name in the header" className="manual-img" />
                    <div className="manual-figcaption">Double-clicking a track title to rename it inline.</div>
                  </div>

                  <h3 className="manual-h3">The file-track group — collapse, batch mute, merge</h3>
                  <p className="manual-p">Imported stems are gathered under <strong>FILE TRACKS</strong>. The group header shows <strong>“n trk · n active”</strong> — total tracks and how many are actually sounding — and <strong>HIDE / SHOW</strong> folds or expands the whole group.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Batch mute</th><td className="manual-td"><strong>Shift+click</strong> the <strong>M</strong> button on a file track to toggle mute on <strong>every file track</strong> at once. The group header then shows a badge such as <strong>M4</strong> with the muted count. The M button in the Mixer window behaves the same way.</td></tr>
                      <tr><th className="manual-th">Scope</th><td className="manual-td">Batch mute affects <strong>file tracks only</strong>. <strong>Audio In and Bounce tracks are excluded</strong>, so you can silence the backing stems and check your own recording alone.</td></tr>
                      <tr><th className="manual-th">MUTE Clr</th><td className="manual-td">The <strong>MUTE Clr</strong> button on the OUTPUT FX header clears every mute and solo at once.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-05-batch-mute.png" alt="Batch-muting the file tracks" className="manual-img" />
                    <div className="manual-figcaption">File tracks batch-muted. The group header reads <strong>4 trk · 0 active</strong> with an <strong>M4</strong> badge, while the <strong>Audio In</strong> track below is unaffected.</div>
                  </div>

                  <h3 className="manual-h3">Merge Tracks (Bounce)</h3>
                  <p className="manual-p">Merging renders several stems down to <strong>a single audio track</strong> — useful when there are too many stems on screen, or when you want the whole backing as one block so you can focus on the vocal.</p>
                  <p className="manual-p">Select the file tracks to combine, then press <strong>MERGE TRACKS…</strong> at the right of the FILE TRACKS header. The button only becomes active once <strong>two or more tracks are selected</strong>, and shows the selected count beside it.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-06a-merge-button.png" alt="MERGE TRACKS enabled with two tracks selected" className="manual-img" />
                    <div className="manual-figcaption">With two file tracks selected, the <strong>MERGE TRACKS…</strong> button in the FILE TRACKS header becomes active.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/05-06b-merge-dialog.png" alt="Merge Tracks dialog" className="manual-img" />
                    <div className="manual-figcaption">The Merge Tracks dialog. The tracks being combined are listed at the top; set the name, channels, and originals handling, then press <strong>Create Bounce</strong>.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Track Name</th><td className="manual-td">The name of the <strong>Bounce track</strong> that will be created.</td></tr>
                      <tr><th className="manual-th">Channels</th><td className="manual-td">Render as <strong>Stereo</strong> or <strong>Mono</strong>.</td></tr>
                      <tr><th className="manual-th">Originals</th><td className="manual-td">What happens to the source tracks: <strong>Keep + Mute</strong> (default), <strong>Keep</strong>, or <strong>Delete</strong>.</td></tr>
                      <tr><th className="manual-th">Create Bounce</th><td className="manual-td">Starts rendering; a new <strong>Bounce track</strong> appears when it finishes.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-note">A <strong>Bounce track</strong> supports <strong>clip editing</strong> and the <strong>Vocal Channel Strip (FX)</strong>, just like an Audio In track. Leaving the originals on <strong>Keep + Mute</strong> is the safest choice — you can always unfold them again later.</div>
                  <div className="manual-note"><strong>Bounces always render at the original BPM and key.</strong> Merging with Vari BPM or Vari Key switched on does not change the result's length or pitch, so it lines up exactly with the tracks it came from. Tempo and key changes apply to <strong>realtime playback and Export only</strong> (<strong>ch. 6 · 7 · 11</strong>).</div>

                  <h3 className="manual-h3">Edit Menu — Delete all tracks <span className="appver-since">(v1.9.0)</span></h3>
                  <p className="manual-p">The top <strong>Edit</strong> menu offers <strong>Delete all tracks</strong> below Undo / Redo. It clears <strong>all loaded audio tracks at once while keeping the master (project-wide) effect settings intact</strong> — handy when you want to swap in a different set of stems but keep the same effect chain (master EQ, reverb, echo, Ambience, fades, etc.).</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/01-03-edit-menu.png" alt="Delete all tracks item in the Edit menu" className="manual-img" />
                    <div className="manual-figcaption">The <strong>Delete all tracks</strong> item in the Edit menu. A confirmation dialog prevents accidental loss.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Kept</th><td className="manual-td">Master output effects (EQ, Reverb, Delay, Saturation, Widener, Exciter), Ambience, master fades — all <strong>project-wide settings</strong>.</td></tr>
                      <tr><th className="manual-th">Removed</th><td className="manual-td">Every audio track and its per-track settings (PAN, track volume/gain, volume automation). BPM/Key also reset to <strong>---</strong>.</td></tr>
                      <tr><th className="manual-th">Undo</th><td className="manual-td">Deleted track audio is not retained, so this <strong>cannot be undone</strong>. Running it also clears the Undo/Redo history.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-warning">Delete all tracks cannot be undone. Save with <code className="manual-code">Project &gt; Save Project</code> first if you need to keep the tracks. (<code className="manual-code">New Project</code> differs in that it also resets the master effects.)</div>
                </>
              )}
            </section>

            {/* 5. BPM 표시 및 설정 / BPM Display & Settings */}
            <section id="bpm" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">6. BPM 표시 및 설정</h2>
                  <p className="manual-p">FocusDAW Studio는 트랙 오디오에서 곡의 BPM(분당 박자 수)을 자동으로 측정하고, 그 값을 기준으로 <strong>전체 음악</strong>의 재생 템포를 조정할 수 있습니다. 새 프로젝트의 BPM은 처음에 <strong>---</strong>로 표시되며, 모든 트랙을 지우거나 새 프로젝트를 시작하면 다시 <strong>---</strong>로 초기화됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-01-bpm-indicator.png" alt="BPM 표시기" className="manual-img" />
                    <div className="manual-figcaption">상단 도구 막대의 BPM 표시기입니다. <strong>100 BPM | 100</strong>처럼 두 숫자가 보이며, <strong>앞</strong>은 프로젝트 BPM(곡의 기준 템포), <strong>뒤</strong>는 재생 BPM(실제 재생 속도)입니다.</div>
                  </div>

                  <p className="manual-p">BPM 표시기 오른쪽에는 <strong>Vari BPM</strong> 스위치가 있습니다. 이 스위치를 <strong>켜야</strong> 재생 BPM으로 곡 속도를 조정하며, <strong>끄면</strong> 재생 BPM을 바꿔도 속도가 변하지 않습니다(기본값 OFF). 스위치를 켠 상태에서 BPM 표시기 위에 마우스 휠을 돌리거나 ▲▼ 버튼을 누르면 <strong>뒤쪽 재생 BPM</strong>이 1씩 바뀌고, 곡 전체가 그 비율(<code>재생 BPM ÷ 프로젝트 BPM</code>)만큼 빨라지거나 느려집니다.</p>
                  <div className="manual-note"><strong>Vari BPM은 프로젝트 BPM이 정해진 뒤에만 켤 수 있습니다.</strong> 기준이 될 BPM이 없으면 속도 비율을 계산할 수 없기 때문입니다. BPM 표시기가 <code className="manual-code">---</code>인 상태에서 스위치를 누르면 스위치가 흐리게 표시된 채 <strong>BPM 측정이 필요하다는 안내창</strong>이 뜹니다. 아래 ①~④ 절차로 BPM을 먼저 정하세요.</div>

                  <h3 className="manual-h3">① BPM 측정 대상 트랙 선택 (B 버튼)</h3>
                  <p className="manual-p">먼저 어떤 트랙의 오디오로 BPM을 측정할지 정합니다. 트랙 헤더의 <strong>B</strong> 버튼을 누르면 그 트랙이 BPM 측정 소스로 선택되어 배경이 채워지며, B는 한 번에 한 트랙에만 켜집니다. 드럼처럼 박자가 뚜렷한 트랙을 고르면 측정이 더 정확합니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-02-bpm-source.png" alt="특정 트랙을 BPM 측정 트랙으로 설정" className="manual-img" />
                    <div className="manual-figcaption"><strong>B</strong> 버튼이 채워진 트랙이 BPM 측정 소스입니다.</div>
                  </div>

                  <h3 className="manual-h3">② BPM 설정 패널 열기</h3>
                  <p className="manual-p">BPM 표시기를 클릭하면 아래로 설정 패널이 펼쳐집니다. 다시 누르거나, 마우스가 패널 밖으로 나간 채 5초가 지나면 접힙니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-03-bpm-panel.png" alt="BPM 설정 패널" className="manual-img" />
                    <div className="manual-figcaption">BPM 설정 패널입니다. 위쪽 <strong>BPM SOURCE</strong>에 선택된 트랙 이름과 <strong>Track</strong> 번호가 두 열로 표시되고, 그 아래 Detect · 직접 입력칸 · APPLY · TAP 버튼이 있습니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Detect</th><td className="manual-td">B로 선택한 트랙의 오디오를 분석해 BPM을 자동 추정합니다. 추정값이 아래 입력칸에 채워집니다.</td></tr>
                      <tr><th className="manual-th">직접 입력</th><td className="manual-td">입력칸에 BPM 숫자를 직접 적을 수 있습니다.</td></tr>
                      <tr><th className="manual-th">TAP</th><td className="manual-td">음악을 들으며 박자에 맞춰 버튼을 반복해 누르면 BPM을 수동 측정합니다. 누를수록 값이 정확해지고, 버튼에는 실시간 BPM과 탭 횟수(<code>TAP · n</code>)가 표시됩니다.</td></tr>
                      <tr><th className="manual-th">APPLY</th><td className="manual-td">측정/입력한 값을 프로젝트 BPM과 재생 BPM에 <strong>모두</strong> 적용합니다.</td></tr>
                    </tbody>
                  </table>

                  <p className="manual-p">자동 감지가 잘 맞지 않을 때는 <strong>TAP</strong>이 가장 확실합니다. 음악을 재생해 두고 박자에 맞춰 TAP 버튼을 반복해 누르면, 누른 간격의 평균으로 BPM이 계산됩니다. 버튼에는 지금까지의 추정값과 누른 횟수가 <code className="manual-code">TAP · n</code> 형태로 표시되며, 여러 번 누를수록 값이 안정됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-06-bpm-tap.png" alt="TAP을 이용한 BPM 입력" className="manual-img" />
                    <div className="manual-figcaption">TAP으로 BPM을 직접 재는 모습입니다. 원하는 값이 나오면 <strong>APPLY</strong>로 확정합니다.</div>
                  </div>

                  <h3 className="manual-h3">③ Detect 분석 중 표시</h3>
                  <p className="manual-p"><strong>Detect</strong>를 누르면 분석이 진행되는 동안 버튼이 회전 아이콘과 <strong>Analyzing…</strong> 표시로 바뀝니다. 분석이 끝나면 추정된 BPM이 입력칸에 강조 효과와 함께 표시됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-04-bpm-analyzing.png" alt="BPM 분석 중 화면" className="manual-img" />
                    <div className="manual-figcaption">Detect 실행 중에는 버튼이 <strong>Analyzing…</strong> 상태로 바뀌어 분석이 진행 중임을 알려줍니다.</div>
                  </div>

                  <h3 className="manual-h3">④ 전체 음악 템포 바꿔 재생하기</h3>
                  <p className="manual-p"><strong>Vari BPM</strong> 스위치를 켠 뒤 재생 BPM(뒤 숫자)을 바꾸면 모든 트랙이 같은 비율로 빨라지거나 느려진 상태로 재생됩니다. 예를 들어 프로젝트 BPM이 100일 때 재생 BPM을 120으로 올리면 곡 전체가 1.2배 빠르게 재생됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-05-vari-bpm.png" alt="BPM 속도를 변경한 뒤 재생 중인 화면" className="manual-img" />
                    <div className="manual-figcaption">재생 BPM을 <strong>100 → 120</strong>으로 올린 뒤 재생 중인 화면입니다. 표시기가 <strong>100 BPM | 120</strong>으로 바뀌고 곡 전체가 그 비율만큼 빠르게 재생됩니다.</div>
                  </div>

                  <div className="manual-warning">실시간 재생의 템포 변경은 Vari BPM이 켜져 있을 때 캐시형 Time Stretch 프리뷰를 준비해 <strong>피치 보존을 우선 적용합니다.</strong> Export 창의 Keep pitch 옵션은 Electron 데스크톱 Export에서 검증된 단기 안정 Time Stretch 경로를 사용해 파일 출력에 피치 보존을 적용합니다.</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">6. BPM Display & Settings</h2>
                  <p className="manual-p">FocusDAW Studio detects a song's BPM (beats per minute) from a track's audio and lets you adjust the playback tempo of the <strong>whole song</strong> based on it. A new project starts with BPM shown as <strong>---</strong>, and it returns to <strong>---</strong> whenever you clear all tracks or start a new project.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-01-bpm-indicator.png" alt="BPM indicator" className="manual-img" />
                    <div className="manual-figcaption">The indicator shows two numbers such as <strong>100 BPM | 100</strong>: the front is the project BPM (reference tempo), the back is the playback BPM (actual speed).</div>
                  </div>

                  <p className="manual-p">The <strong>Vari BPM</strong> switch to the right of the indicator must be <strong>on</strong> for the playback BPM to change the song speed (off = no speed change; default off). With it on, hover the BPM indicator and scroll the mouse wheel, or use the ▲▼ buttons, to change the <strong>playback BPM</strong> by 1 — the whole song speeds up or slows down by that ratio (playback BPM ÷ project BPM).</p>
                  <div className="manual-note"><strong>Vari BPM can only be switched on once a project BPM exists</strong> — without a reference tempo there is no ratio to apply. While the indicator reads <code className="manual-code">---</code> the switch is dimmed, and clicking it opens a notice explaining that the BPM has to be measured first. Use steps 1–4 below to set one.</div>

                  <h3 className="manual-h3">1. Choose the detection source track (B button)</h3>
                  <p className="manual-p">Press the <strong>B</strong> button on a track header to mark it as the BPM detection source (its background fills in). Only one track can be the B source at a time. Picking a track with a clear beat (e.g. drums) gives more accurate detection.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-02-bpm-source.png" alt="Track set as BPM detection source" className="manual-img" />
                    <div className="manual-figcaption">The track whose <strong>B</strong> button is filled is the BPM detection source.</div>
                  </div>

                  <h3 className="manual-h3">2. Open the BPM settings panel</h3>
                  <p className="manual-p">Click the BPM indicator to expand the settings panel. Click it again, or leave it inactive outside the mouse area for 5 seconds, to collapse it.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-03-bpm-panel.png" alt="BPM settings panel" className="manual-img" />
                    <div className="manual-figcaption">The top row shows <strong>BPM SOURCE</strong> (selected track name) and its <strong>Track</strong> number in two columns, with Detect, an input field, APPLY, and TAP below.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Detect</th><td className="manual-td">Analyzes the B-selected track's audio and estimates its BPM, filling the input field.</td></tr>
                      <tr><th className="manual-th">Manual input</th><td className="manual-td">Type a BPM value directly into the field.</td></tr>
                      <tr><th className="manual-th">TAP</th><td className="manual-td">Tap along with the beat repeatedly to measure BPM. Accuracy improves the more you tap, and the button shows a live BPM and tap count (TAP · n).</td></tr>
                      <tr><th className="manual-th">APPLY</th><td className="manual-td">Applies the measured/entered value to <strong>both</strong> the project BPM and the playback BPM.</td></tr>
                    </tbody>
                  </table>

                  <p className="manual-p">When automatic detection struggles, <strong>TAP</strong> is the most reliable route. Play the song and tap the button along with the beat — the BPM is averaged from your tap intervals. The button shows the running estimate and tap count as <code className="manual-code">TAP · n</code>, and the value settles the more you tap.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-06-bpm-tap.png" alt="Entering BPM by tapping" className="manual-img" />
                    <div className="manual-figcaption">Measuring BPM by tapping. Once the value looks right, confirm it with <strong>APPLY</strong>.</div>
                  </div>

                  <h3 className="manual-h3">3. Detection-in-progress feedback</h3>
                  <p className="manual-p">While <strong>Detect</strong> runs, the button changes to a spinner with <strong>Analyzing…</strong>. When it finishes, the estimated BPM appears in the input field with a brief highlight.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-04-bpm-analyzing.png" alt="BPM analysis in progress" className="manual-img" />
                    <div className="manual-figcaption">During detection the button shows the <strong>Analyzing…</strong> state.</div>
                  </div>

                  <h3 className="manual-h3">4. Play back at a changed tempo</h3>
                  <p className="manual-p">With the <strong>Vari BPM</strong> switch on, changing the playback BPM (the back number) plays every track faster or slower by the same ratio. For example, with a project BPM of 100, raising the playback BPM to 120 plays the whole song 1.2× faster.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/06-05-vari-bpm.png" alt="Playing after a tempo change" className="manual-img" />
                    <div className="manual-figcaption">Playing after raising the playback BPM <strong>100 → 120</strong>; the indicator reads <strong>100 BPM | 120</strong> and the whole song plays faster by that ratio.</div>
                  </div>

                  <div className="manual-warning">Realtime tempo changes prepare a cached Time Stretch preview when Vari BPM is enabled, prioritizing <strong>pitch preservation</strong> during playback. The Export dialog's Keep pitch option applies pitch preservation through the validated short-term stable Time Stretch path for Electron desktop exports.</div>
                </>
              )}
            </section>

            {/* 6. Key 표시 및 설정 / Key Display & Settings */}
            <section id="key" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">7. Key 표시 및 설정</h2>
                  <p className="manual-p">FocusDAW Studio는 프로젝트에 로드된 트랙 오디오의 화성 성분을 종합적으로 분석하여 곡의 원곡 키(Key)를 자동으로 감지하고, 반음(Semitones) 단위로 곡의 조성을 올리거나 내려서 실시간으로 이조 재생할 수 있습니다. 처음 세션을 열었을 때 키 표시창은 <strong>---</strong>로 표시됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-01-key-indicator.png" alt="Key 표시창 초기 상태" className="manual-img" />
                    <div className="manual-figcaption">상단 도구 막대의 Key 표시창 초기 상태입니다. 아직 키 설정이 적용되지 않아 <code>---</code>로 표시됩니다.</div>
                  </div>

                  <h3 className="manual-h3">① Key 설정 패널 열기</h3>
                  <p className="manual-p">Key 표시창 부분을 클릭하면 아래로 Key 설정 패널이 펼쳐집니다. 이 패널은 클릭하여 켜고 끌 수 있으며, 마우스 포인터가 패널에서 벗어난 지 5초가 지나면 자동으로 닫힙니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-02-key-panel.png" alt="Key 설정 패널 열린 상태" className="manual-img" />
                    <div className="manual-figcaption">Key 표시창을 클릭하여 설정 패널을 열어둔 상태입니다.</div>
                  </div>

                  <h3 className="manual-h3">② Key Detection (조성 감지)</h3>
                  <p className="manual-p">패널 내의 <strong>Detect</strong> 버튼을 누르면 프로젝트의 활성화된 모든 오디오 트랙을 정밀 분석(STFT 기반 크로마 연산)하여 원곡의 키를 추정합니다. 결과는 <strong>하나의 원곡 Key</strong>이며, 패널 가운데의 원Key 표시창에 나타나고 하단 조성 목록에서도 강조 표시됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-03a-key-detect.png" alt="Key Detection 완료 화면" className="manual-img" />
                    <div className="manual-figcaption">Detect 버튼을 누르면 <code>Analyzing...</code> 상태를 거쳐 분석된 오디오의 감지된 키가 하단에 나타납니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-03b-key-list.png" alt="하단 Key 후보 리스트" className="manual-img" />
                    <div className="manual-figcaption">하단 Key 리스트는 <strong>참고용 전체 조성 목록</strong>입니다(장조 12개 · 단조 12개). 감지된 원곡 Key가 강조 표시되어 어떤 조성으로 판정됐는지 한눈에 확인할 수 있습니다. <strong>이 목록에서 Key를 고를 수는 없으며</strong>, 조성 변경은 <strong>+</strong> / <strong>−</strong> 오프셋을 정한 뒤 <strong>APPLY</strong>로만 적용됩니다.</div>
                  </div>

                  <h3 className="manual-h3">③ Key 설정 적용</h3>
                  <p className="manual-p">원하는 키 후보를 선택하거나, 패널 내의 <strong>+</strong> / <strong>-</strong> 버튼을 클릭해 원하는 반음(Semitones, 최대 ±6) 오프셋을 설정한 뒤 <strong>APPLY</strong> 버튼을 누르면 프로젝트의 기준 키가 세션에 등록됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-04a-key-apply.png" alt="APPLY 적용 후의 Key 표시" className="manual-img" />
                    <div className="manual-figcaption">APPLY 적용 후 Key 표시창의 <strong>앞부분</strong>에 분석/지정된 원곡 키(예: <code>Ab</code>)가 표시됩니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-04b-key-apply.png" alt="오프셋 변경 후 APPLY된 화면" className="manual-img" />
                    <div className="manual-figcaption">설정 패널에서 <code>+1</code> 반음과 같이 키 오프셋을 변경하고 APPLY 버튼을 눌러 적용을 완료한 화면입니다.</div>
                  </div>

                  <h3 className="manual-h3">④ 실시간 이조 재생 (Vari Key)</h3>
                  <p className="manual-p">Key 표시기 오른쪽의 <strong>Vari Key</strong> 스위치를 <strong>켜면</strong>, 사용자가 변경한 조(Key)의 피치가 재생 엔진에 즉각 반영되어 음높이가 실시간으로 변조(Pitch Shift)되어 플레이됩니다. 스위치를 끄면 원래 녹음된 피치 그대로 재생됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-05-vari-key.png" alt="Vari Key 기능을 켠 화면" className="manual-img" />
                    <div className="manual-figcaption">Vari Key 스위치를 켜면 재생 Key(뒤쪽 표시값)에 변경된 조가 적용되고, 재생 중인 음악의 키가 실시간으로 변합니다.</div>
                  </div>

                  <div className="manual-warning">
                    <strong>Vari BPM과 Vari Key 동시 적용 시 주의</strong><br />
                    Vari BPM과 Vari Key를 모두 켜서 템포와 음높이를 동시에 크게 조절하는 경우, 실시간 타임 스트레칭 및 피치 변조 처리가 겹치게 됩니다. 이로 인해 연산 부하가 증가하거나 재생 오디오에 과도한 소리 왜곡(Artifact)이 생길 수 있으므로, 적절한 범위 안에서 조절하는 것을 권장합니다.
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-06-vari-both.png" alt="BPM 및 Key 동시 변경 경고 화면" className="manual-img" />
                    <div className="manual-figcaption">Vari BPM과 Vari Key 스위치가 동시에 활성화된 상태입니다. 과도한 이조와 템포 변경은 음질 왜곡을 유발할 수 있습니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">7. Key Display & Settings</h2>
                  <p className="manual-p">FocusDAW Studio analyzes the harmonic content of all loaded audio tracks to estimate the song's original key and lets you shift the pitch up or down in semitones (up to ±6 semitones) for real-time key-shifted playback. When a new session is opened, the Key indicator reads <strong>---</strong>.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-01-key-indicator.png" alt="Key indicator initial state" className="manual-img" />
                    <div className="manual-figcaption">The initial state of the Key indicator in the top toolbar. It displays <code>---</code> when no key is set.</div>
                  </div>

                  <h3 className="manual-h3">1. Open Key Settings Panel</h3>
                  <p className="manual-p">Click the Key indicator in the toolbar to expand the Key settings panel. You can toggle the panel open and closed by clicking it, and it will close automatically 5 seconds after the mouse pointer leaves the panel area.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-02-key-panel.png" alt="Key settings panel opened" className="manual-img" />
                    <div className="manual-figcaption">The Key settings panel opened by clicking the Key indicator.</div>
                  </div>

                  <h3 className="manual-h3">2. Key Detection</h3>
                  <p className="manual-p">Click the <strong>Detect</strong> button in the panel to run a comprehensive harmonic analysis (STFT-based chromagram) across all active audio tracks. It produces <strong>one original key</strong>, shown in the original-key box in the middle of the panel and highlighted in the key list below it.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-03a-key-detect.png" alt="Key detection complete" className="manual-img" />
                    <div className="manual-figcaption">Clicking Detect switches the button to an <code>Analyzing...</code> state, then reveals the detected key details.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-03b-key-list.png" alt="Key candidate list" className="manual-img" />
                    <div className="manual-figcaption">The list at the bottom is a <strong>reference list of every key</strong> (12 major · 12 minor), with the detected original key highlighted so you can see what the analysis settled on. <strong>You cannot pick a key from this list</strong> — transposition is set with the <strong>+</strong> / <strong>−</strong> offset and committed with <strong>APPLY</strong>.</div>
                  </div>

                  <h3 className="manual-h3">3. Applying Key Settings</h3>
                  <p className="manual-p">Select your preferred candidate key, or use the <strong>+</strong> / <strong>-</strong> buttons to adjust the semitones offset (up to ±6 semitones), then click <strong>APPLY</strong> to write the reference key to the project.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-04a-key-apply.png" alt="Key indicator showing applied key" className="manual-img" />
                    <div className="manual-figcaption">After clicking APPLY, the estimated/selected key is displayed in the <strong>left</strong> portion of the Key indicator (e.g. <code>Ab</code>).</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-04b-key-apply.png" alt="Offset changed and applied" className="manual-img" />
                    <div className="manual-figcaption">Changing the key offset (e.g. to <code>+1</code> semitone) and applying the changes.</div>
                  </div>

                  <h3 className="manual-h3">4. Real-time Pitch Shifting (Vari Key)</h3>
                  <p className="manual-p">Enable the <strong>Vari Key</strong> switch next to the Key indicator to apply your pitch shifts directly to the playback engine in real-time. Turning the switch off reverts the playback pitch back to the original recorded audio state.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-05-vari-key.png" alt="Vari Key switch turned on" className="manual-img" />
                    <div className="manual-figcaption">Enabling Vari Key updates the playback key (the right value) and shifts the pitch of the playing music in real-time.</div>
                  </div>

                  <div className="manual-warning">
                    <strong>Caution when combining Vari BPM and Vari Key</strong><br />
                    If both Vari BPM and Vari Key are enabled to make significant changes to both tempo and pitch at the same time, the combined real-time time-stretching and pitch-shifting processing will run concurrently. This can increase CPU overhead or cause audibly noticeable sound artifacts, so we recommend keeping adjustments within moderate ranges.
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/07-06-vari-both.png" alt="Vari BPM and Vari Key active warning" className="manual-img" />
                    <div className="manual-figcaption">Both Vari BPM and Vari Key enabled at the same time. Excessive stretching and shifting may degrade audio quality.</div>
                  </div>
                </>
              )}
            </section>

            {/* 7. 볼륨 오토메이션 / Volume Automation */}
            <section id="automation" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">8. 볼륨 오토메이션</h2>
                  <p className="manual-p">트랙 헤더의 <strong>VOL AUTO</strong>를 켜면 트랙 위에 볼륨 오토메이션 곡선이 표시됩니다. 곡선의 점은 시간에 따른 볼륨 변화를 의미합니다.</p>

                  <ul className="manual-ul">
                    <li className="manual-li">오토메이션 선을 클릭하면 새 포인트가 추가됩니다.</li>
                    <li className="manual-li">포인트를 드래그하면 시간과 볼륨 값을 바꿀 수 있습니다.</li>
                    <li className="manual-li">중간 포인트를 우클릭하면 삭제됩니다. 시작점과 끝점은 유지됩니다.</li>
                    <li className="manual-li">트랙 크기를 L로 키우면 <strong>Reset</strong>과 <strong>Curve</strong> 버튼을 함께 볼 수 있습니다.</li>
                    <li className="manual-li"><strong>Curve</strong>를 켜면 직선 연결 대신 부드러운 곡선으로 볼륨 변화를 적용합니다.</li>
                  </ul>

                  <h3 className="manual-h3">오토메이션 편집 방법</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">마우스 왼쪽 버튼 클릭</th><td className="manual-td">오토메이션 선 위를 클릭하면 새 편집점이 추가됩니다.</td></tr>
                      <tr><th className="manual-th">편집점 드래그</th><td className="manual-td">편집점 위에 마우스를 올리면 손 모양 커서로 바뀝니다. 그 상태에서 마우스 왼쪽 버튼을 누른 채 움직이면 편집점의 시간 위치와 볼륨 값을 이동할 수 있습니다.</td></tr>
                      <tr><th className="manual-th">마우스 오른쪽 버튼 클릭</th><td className="manual-td">편집점 위에 마우스를 올려 손 모양 커서가 보이는 상태에서 오른쪽 마우스 버튼을 누르면 해당 편집점이 삭제됩니다. 시작점과 끝점은 삭제되지 않습니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/08-01-auto-on-off.png" alt="VOL AUTO를 켠 화면" className="manual-img" />
                    <div className="manual-figcaption">VOL AUTO를 켜면 해당 트랙 위에 노란 볼륨 오토메이션 레인이 표시됩니다. 트랙 크기가 L일 때 Reset과 Curve 버튼도 함께 보입니다.</div>
                  </div>

                  <h3 className="manual-h3">포인트 조정</h3>
                  <p className="manual-p">오토메이션 선 위를 클릭해 포인트를 추가하고, 포인트를 드래그해 볼륨 변화 시점과 크기를 조절합니다. 아래로 내린 구간은 소리가 작아지고, 위로 올린 구간은 원래 볼륨에 가깝게 재생됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/08-02-point-edit.png" alt="볼륨 오토메이션을 조정한 화면" className="manual-img" />
                    <div className="manual-figcaption">여러 포인트를 배치해 구간별 볼륨을 조정한 화면입니다. 점과 선의 형태가 그대로 재생 및 내보내기에 적용됩니다.</div>
                  </div>

                  <h3 className="manual-h3">Curve 적용</h3>
                  <p className="manual-p"><strong>Curve</strong>를 켜면 포인트 사이가 직선이 아니라 부드러운 곡선으로 이어집니다. 급격한 볼륨 변화보다 자연스러운 페이드나 강조를 만들 때 유용합니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/08-03-curve.png" alt="볼륨 오토메이션 Curve 기능을 켠 화면" className="manual-img" />
                    <div className="manual-figcaption">Curve 기능을 켠 화면입니다. 점선은 기준 직선이고, 실제 적용 곡선은 부드럽게 보정되어 표시됩니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">8. Volume Automation</h2>
                  <p className="manual-p">Toggling <strong>VOL AUTO</strong> in the track header displays a yellow automation lane over the track lane. Points on this line represent volume changes over time.</p>

                  <ul className="manual-ul">
                    <li className="manual-li">Left-click the line to add a new automation point.</li>
                    <li className="manual-li">Click and drag points horizontally (time) and vertically (volume).</li>
                    <li className="manual-li">Right-click a point to delete it. The start and end anchors cannot be deleted.</li>
                    <li className="manual-li">When track size is set to L, <strong>Reset</strong> and <strong>Curve</strong> buttons appear.</li>
                    <li className="manual-li">Toggling <strong>Curve</strong> connects points with smooth bezier curves instead of linear lines.</li>
                  </ul>

                  <h3 className="manual-h3">How to Edit Automation Points</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Left-click line</th><td className="manual-td">Creates a new automation point at the cursor position.</td></tr>
                      <tr><th className="manual-th">Drag point</th><td className="manual-td">Hover over a point to see a hand cursor, then drag to change time and volume values.</td></tr>
                      <tr><th className="manual-th">Right-click point</th><td className="manual-td">Right-click a point while the hand cursor is visible to delete it (anchors excluded).</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/08-01-auto-on-off.png" alt="Automation Lane Enabled" className="manual-img" />
                    <div className="manual-figcaption">Volume automation lane enabled on a track. Reset and Curve options are visible when track size is L.</div>
                  </div>

                  <h3 className="manual-h3">Adjusting Levels</h3>
                  <p className="manual-p">Add points and adjust them to shape volume over time. Pulling the line down attenuates volume, while dragging it up approaches original volume.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/08-02-point-edit.png" alt="Edited Automation Curve" className="manual-img" />
                    <div className="manual-figcaption">A customized automation curve. Point values and curves are applied to playback and exported mixdowns.</div>
                  </div>

                  <h3 className="manual-h3">Applying Smooth Curves</h3>
                  <p className="manual-p">Enabling **Curve** shapes the paths between points with smooth bezier curves. This is useful for creating organic fade-ins, fade-outs, or natural volume rises.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/08-03-curve.png" alt="Bezier Curve Automation" className="manual-img" />
                    <div className="manual-figcaption">Automation curves enabled. Dotted lines show linear references, while the solid line represents the active curve.</div>
                  </div>
                </>
              )}
            </section>

            {/* 8. 믹서와 마스터 / Mixer & Master */}
            <section id="mixer" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">9. 믹서와 마스터</h2>
                  <p className="manual-p">상단 오른쪽의 <strong>Mixer</strong> 버튼을 누르면 떠 있는 믹서 창이 열립니다. 믹서 창은 제목 표시줄을 드래그해 위치를 옮길 수 있습니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-01-mixer-overview.png" alt="메인 앱과 믹서 창" className="manual-img" />
                    <div className="manual-figcaption">메인 창 위에 믹서를 띄운 모습입니다. 왼쪽에 트랙별 채널 스트립, 오른쪽에 MASTER 패널이 놓입니다. 타임라인 파형을 보면서 동시에 믹스를 조정할 수 있습니다.</div>
                  </div>
                  <p className="manual-p">믹서 창 제목 표시줄에는 <strong>정지 · 재생</strong> 버튼이 있어, 메인 창으로 돌아가지 않고도 믹서에서 바로 재생을 조작할 수 있습니다.</p>

                  <h3 className="manual-h3">채널 스트립</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">VRB</th><td className="manual-td">트랙 리버브 전송량입니다.</td></tr>
                      <tr><th className="manual-th">ECHO</th><td className="manual-td">트랙 에코/딜레이 전송량입니다.</td></tr>
                      <tr><th className="manual-th">S / M</th><td className="manual-td">Solo와 Mute입니다. <strong>M</strong>을 <strong>Shift+클릭</strong>하면 파일 트랙 일괄 뮤트가 동작합니다(<strong>5장</strong>).</td></tr>
                      <tr><th className="manual-th">PAN</th><td className="manual-td">좌우 스테레오 위치입니다. 아래에 현재 값(C / L · R)이 표시됩니다.</td></tr>
                      <tr><th className="manual-th">Fader</th><td className="manual-td">트랙 볼륨을 세로 페이더로 조절하고, 맨 아래 dB 값으로 확인합니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-02a-strip-normal.png" alt="채널 스트립 — 일반 트랙" className="manual-img" />
                    <div className="manual-figcaption">일반(파일) 트랙의 채널 스트립입니다. 위에서부터 VRB · ECHO, S · M, PAN, 볼륨 페이더와 dB 값 순서입니다.</div>
                  </div>

                  <p className="manual-p"><strong>Audio In 트랙의 채널 스트립</strong>에는 아래쪽에 녹음 전용 구역이 더 붙습니다. <strong>ARM · MON · LIM</strong> 버튼과 <strong>입력 포트</strong> 선택, 큰 <strong>GAIN</strong> 노브, 그리고 그 오른쪽의 <strong>IN</strong>(입력 레벨) · <strong>GR</strong>(리미터 게인 리덕션) 미터입니다. 덕분에 믹서 창만 보면서도 입력 게인을 잡을 수 있습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-02b-strip-audioin.png" alt="채널 스트립 — Audio Input 트랙" className="manual-img" />
                    <div className="manual-figcaption">Audio In 트랙의 채널 스트립입니다. 일반 트랙 구성 아래에 ARM · MON · LIM, 입력 포트, GAIN 노브와 IN · GR 미터가 추가됩니다.</div>
                  </div>

                  <h3 className="manual-h3">MASTER 패널</h3>
                  <p className="manual-p">MASTER 패널은 최종 출력에 적용되는 설정입니다. 9밴드 Graphic EQ, 마스터 볼륨(VOL), EQ 프리셋, 그리고 다섯 가지 <strong>OUTPUT EFFECTS</strong>(Reverb · Delay · Saturation · Widener · Exciter / Enhancer)를 제공합니다. 패널 오른쪽 위에는 현재 <strong>피크 레벨(dB)</strong>이 표시됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-03a-master.png" alt="MASTER 패널" className="manual-img" />
                    <div className="manual-figcaption">MASTER 패널입니다. 60Hz부터 15kHz까지 EQ 포인트를 위아래로 끌어 저역·중역·고역을 조절하고, 아래 EQ PRESET과 OUTPUT EFFECTS로 마스터를 다듬습니다.</div>
                  </div>
                  <p className="manual-p">EQ 그래프 위쪽의 <strong>GRAPHIC EQ · FFT</strong>와 <strong>LEVEL METER</strong> 버튼으로 배경 표시를 바꿀 수 있습니다. <strong>FFT</strong>는 실시간 주파수 스펙트럼을, <strong>LEVEL METER</strong>는 대역별 LED 레벨 미터를 보여 줍니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-03b-master-led.png" alt="MASTER 패널 — LED 오디오 레벨 미터" className="manual-img" />
                    <div className="manual-figcaption"><strong>LEVEL METER</strong> 보기로 전환한 모습입니다. 주파수 대역별 LED 미터 위에서 EQ 포인트를 그대로 조작할 수 있습니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Graphic EQ · FFT</th><td className="manual-td">스펙트럼 배경 위에 EQ 곡선을 표시합니다. 각 밴드 포인트를 드래그해 -12dB부터 +12dB까지 조절합니다.</td></tr>
                      <tr><th className="manual-th">Level meter</th><td className="manual-td">주파수 대역별 레벨 미터를 표시합니다. EQ 포인트 오버레이도 함께 조작할 수 있습니다.</td></tr>
                      <tr><th className="manual-th">EQ PRESET</th><td className="manual-td">Reset(Flat), Pop, Classic, Hip Hop 프리셋을 바로 적용합니다. 정밀 편집은 오른쪽 <strong>ADVANCED</strong> 버튼으로 큰 Equalizer 창을 엽니다(7장 참조).</td></tr>
                      <tr><th className="manual-th">OUTPUT EFFECTS</th><td className="manual-td">최종 출력(마스터 버스)에 적용하는 다섯 가지 효과입니다. 각 슬라이더로 0~100% 전송량을 조절하며, 켜진 효과는 아이콘에 색이 들어오고 오른쪽에 퍼센트가 표시됩니다.</td></tr>
                    </tbody>
                  </table>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Reverb</th><td className="manual-td">잔향(공간감)을 더합니다. 값이 클수록 더 넓고 멀리 울리는 공간처럼 들립니다.</td></tr>
                      <tr><th className="manual-th">Delay</th><td className="manual-td">반복되는 메아리(에코)를 추가해 리듬감 있는 반사로 공간을 넓힙니다.</td></tr>
                      <tr><th className="manual-th">Saturation</th><td className="manual-td">아날로그 테이프/진공관식 배음을 더해 소리를 따뜻하고 두툼하게 만듭니다.</td></tr>
                      <tr><th className="manual-th">Widener</th><td className="manual-td">스테레오 폭을 넓혀 믹스를 크고 시원하게 들리게 합니다.</td></tr>
                      <tr><th className="manual-th">Exciter / Enhancer</th><td className="manual-td">고역대 배음을 보강해 선명함과 반짝임(공기감)을 살립니다.</td></tr>
                    </tbody>
                  </table>

                  <p className="manual-p">EQ 프리셋 줄에서는 <strong>Reset · POP · Classic · HIP HOP</strong>을 바로 적용할 수 있고, OUTPUT EFFECTS 오른쪽의 <strong>ADVANCED</strong> 버튼은 정밀 편집용 Equalizer 창을 엽니다(<strong>10장</strong>).</p>

                  <h3 className="manual-h3">OUTPUT FX 트랙</h3>
                  <p className="manual-p">타임라인 맨 아래의 OUTPUT FX 트랙은 Master 트랙 역할을 하며, 전체 믹스에 적용되는 페이드와 EQ·효과 상태를 보여 줍니다. 이 트랙의 눈금 레인이 <strong>Repeat · Punch 구간을 드래그해 만드는 자리</strong>이기도 합니다(<strong>4장</strong>).</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-05-outputfx-header.png" alt="Output FX 트랙 헤더" className="manual-img" />
                    <div className="manual-figcaption">OUTPUT FX 트랙 헤더입니다. 왼쪽의 작은 EQ 그래프를 클릭하면 믹서가 열리고, <strong>MUTE Clr</strong>은 모든 뮤트·솔로를 해제합니다. <strong>EFFECT</strong>는 출력 효과 전체를 한 번에 켜고 끄며, 아래의 <strong>R · D · S · W · E</strong> 배지는 각각 Reverb · Delay · Saturation · Widener · Exciter를 개별로 켜고 끕니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-04-outputfx-fade.png" alt="Output FX 트랙 Fade in/out 핸들" className="manual-img" />
                    <div className="manual-figcaption">OUTPUT FX 트랙의 Fade in/out 핸들입니다. ①번 초록 점은 Fade in, ②번 빨간 점은 Fade out을 조정합니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">왼쪽 점 드래그</th><td className="manual-td">OUTPUT FX 트랙 왼쪽의 초록 점을 좌우로 드래그하면 곡 시작 부분에 Fade in 효과를 줄 수 있습니다. 점을 오른쪽으로 옮길수록 서서히 커지는 시간이 길어집니다.</td></tr>
                      <tr><th className="manual-th">오른쪽 끝 점 드래그</th><td className="manual-td">OUTPUT FX 트랙 오른쪽 끝의 빨간 점을 좌우로 드래그하면 곡 끝부분에 Fade out 효과를 줄 수 있습니다. 점을 왼쪽으로 옮길수록 서서히 작아지는 시간이 길어집니다.</td></tr>
                      <tr><th className="manual-th">적용 범위</th><td className="manual-td">Fade in/out은 개별 트랙이 아니라 최종 Master 출력에 적용되며, 재생과 믹스다운 내보내기에 모두 반영됩니다.</td></tr>
                    </tbody>
                  </table>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">9. Mixer & Master</h2>
                  <p className="manual-p">Click the <strong>Mixer</strong> button on the top right to open the floating mixer console. Drag its title bar to position it anywhere on the screen.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-01-mixer-overview.png" alt="Main window with the mixer open" className="manual-img" />
                    <div className="manual-figcaption">The mixer floating over the main window: track channel strips on the left, the MASTER panel on the right. You can mix while watching the timeline waveforms.</div>
                  </div>
                  <p className="manual-p">The mixer's own title bar carries <strong>Stop</strong> and <strong>Play</strong> buttons, so you can drive playback without switching back to the main window.</p>

                  <h3 className="manual-h3">Channel Strips</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">VRB</th><td className="manual-td">Track reverb send level.</td></tr>
                      <tr><th className="manual-th">ECHO</th><td className="manual-td">Track echo/delay send level.</td></tr>
                      <tr><th className="manual-th">S / M</th><td className="manual-td">Solo and Mute. <strong>Shift+click</strong> <strong>M</strong> to batch-mute the file tracks (<strong>ch. 5</strong>).</td></tr>
                      <tr><th className="manual-th">PAN</th><td className="manual-td">Stereo position, with the current value (C / L · R) shown beneath.</td></tr>
                      <tr><th className="manual-th">Fader</th><td className="manual-td">Vertical volume fader with the exact dB value at the bottom.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-02a-strip-normal.png" alt="Channel strip — normal track" className="manual-img" />
                    <div className="manual-figcaption">A normal (file) track strip: VRB · ECHO, S · M, PAN, then the volume fader and its dB readout.</div>
                  </div>

                  <p className="manual-p">An <strong>Audio In track's strip</strong> adds a recording section below. It carries <strong>ARM · MON · LIM</strong>, the <strong>input port</strong> selector, a large <strong>GAIN</strong> knob, and <strong>IN</strong> (input level) and <strong>GR</strong> (limiter gain reduction) meters beside it — so input gain can be set entirely from the mixer.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-02b-strip-audioin.png" alt="Channel strip — Audio In track" className="manual-img" />
                    <div className="manual-figcaption">An Audio In track strip. Below the normal controls sit ARM · MON · LIM, the input port, the GAIN knob, and the IN · GR meters.</div>
                  </div>

                  <h3 className="manual-h3">MASTER Panel</h3>
                  <p className="manual-p">The MASTER panel shapes the final stereo mixdown: a 9-band Graphic EQ, master volume (VOL), EQ presets, and five <strong>OUTPUT EFFECTS</strong> (Reverb, Delay, Saturation, Widener, Exciter / Enhancer). The current <strong>peak level (dB)</strong> is shown at the panel's top right.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-03a-master.png" alt="MASTER panel" className="manual-img" />
                    <div className="manual-figcaption">The MASTER panel. Drag the band points (60 Hz–15 kHz) to shape lows, mids, and highs, then refine with the EQ PRESET row and OUTPUT EFFECTS below.</div>
                  </div>
                  <p className="manual-p">The <strong>GRAPHIC EQ · FFT</strong> and <strong>LEVEL METER</strong> buttons above the graph switch its background: <strong>FFT</strong> draws a live frequency spectrum, <strong>LEVEL METER</strong> shows per-band LED meters.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-03b-master-led.png" alt="MASTER panel with LED level meters" className="manual-img" />
                    <div className="manual-figcaption">Switched to the <strong>LEVEL METER</strong> view. The EQ points remain fully draggable on top of the per-band LED meters.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Graphic EQ / FFT</th><td className="manual-td">Displays the EQ curve over a real-time FFT spectrum background. Drag points to adjust gain from -12dB to +12dB.</td></tr>
                      <tr><th className="manual-th">Level meters</th><td className="manual-td">Displays real-time level bars for each frequency range alongside EQ controls.</td></tr>
                      <tr><th className="manual-th">EQ PRESETS</th><td className="manual-td">Instantly applies preset curves: Reset (Flat), Pop, Classic, and Hip Hop. The <strong>ADVANCED</strong> button opens the large Equalizer window (see ch.7).</td></tr>
                      <tr><th className="manual-th">OUTPUT EFFECTS</th><td className="manual-td">Five effects applied to the final master bus. Each slider sets the 0–100% send amount; active effects light up and show their percentage on the right.</td></tr>
                    </tbody>
                  </table>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Reverb</th><td className="manual-td">Adds reverberation; higher amounts feel like a larger, more distant room.</td></tr>
                      <tr><th className="manual-th">Delay</th><td className="manual-td">Adds repeating echoes — rhythmic reflections that widen the sound and add depth.</td></tr>
                      <tr><th className="manual-th">Saturation</th><td className="manual-td">Adds gentle analog tape/tube harmonics for a warmer, thicker tone.</td></tr>
                      <tr><th className="manual-th">Widener</th><td className="manual-td">Expands stereo width so the mix sounds bigger and more open.</td></tr>
                      <tr><th className="manual-th">Exciter / Enhancer</th><td className="manual-td">Reinforces high-frequency harmonics for clarity and "air."</td></tr>
                    </tbody>
                  </table>

                  <p className="manual-p">The EQ preset row applies <strong>Reset · POP · Classic · HIP HOP</strong> instantly, and the <strong>ADVANCED</strong> button beside OUTPUT EFFECTS opens the large Equalizer window for precise editing (<strong>ch. 10</strong>).</p>

                  <h3 className="manual-h3">Master OUTPUT FX Track</h3>
                  <p className="manual-p">At the bottom of the timeline, the OUTPUT FX track represents the Master channel and shows the master fades plus the EQ/effect state. Its ruler lane is also <strong>where you drag out Repeat and Punch regions</strong> (<strong>ch. 4</strong>).</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-05-outputfx-header.png" alt="OUTPUT FX track header" className="manual-img" />
                    <div className="manual-figcaption">The OUTPUT FX track header. Clicking the small EQ graph opens the mixer; <strong>MUTE Clr</strong> clears every mute and solo. <strong>EFFECT</strong> bypasses or engages all output effects at once, and the <strong>R · D · S · W · E</strong> badges below toggle Reverb, Delay, Saturation, Widener, and Exciter individually.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/09-04-outputfx-fade.png" alt="Master Fade Handles" className="manual-img" />
                    <div className="manual-figcaption">OUTPUT FX track handles. The green handle on the left shapes Fade-in, and the red handle on the right shapes Fade-out.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Green Handle (Left)</th><td className="manual-td">Drag horizontally to define a Fade-In duration at the start of the mix.</td></tr>
                      <tr><th className="manual-th">Red Handle (Right)</th><td className="manual-td">Drag horizontally to define a Fade-Out duration at the end of the mix.</td></tr>
                      <tr><th className="manual-th">Scope</th><td className="manual-td">Master fades apply directly to the final mix, affecting both real-time playback and rendered files.</td></tr>
                    </tbody>
                  </table>
                </>
              )}
            </section>

            {/* 9. 고급 이펙트 / Advanced Effects */}
            <section id="advfx" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">10. 고급 이펙트(Advanced Effects)</h2>
                  <p className="manual-p">상단 메뉴의 <strong>Advanced Effects</strong>에는 세 가지 전용 편집 창이 있습니다. 각 창은 마스터(프로젝트 전체) 출력에 적용되는 고급 효과를 넓은 화면에서 정밀하게 다루도록 만들어졌습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/10-01-advanced-effects.png" alt="Advanced Effects 메뉴" className="manual-img" />
                    <div className="manual-figcaption">상단 <strong>Advanced Effects</strong> 메뉴입니다. <strong>Ambience</strong>(공간감), <strong>Auto Panning</strong>(스테레오 배치), <strong>Equalizer Setup</strong>(EQ) 세 항목이 있습니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Ambience</th><td className="manual-td">곡 전체의 공간감(잔향·울림)을 디자인하는 <em>Sound Environment</em> 창을 엽니다.</td></tr>
                      <tr><th className="manual-th">Auto Panning</th><td className="manual-td">각 악기를 좌우·원근으로 배치하는 <em>Spatial Field</em>(스테레오 무대) 창을 엽니다.</td></tr>
                      <tr><th className="manual-th">Equalizer Setup</th><td className="manual-td">9밴드 그래픽 EQ를 큰 화면에서 편집하고 사용자 프리셋을 저장하는 <em>Equalizer</em> 창을 엽니다.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">세 창 사이 이동</h3>
                  <p className="manual-p">세 고급 창은 모두 왼쪽 위에 <strong>창 전환 드롭다운</strong>을 공유합니다. 창을 닫지 않고도 <strong>Spatial Field → Ambience → Equalizer</strong> 사이를 바로 오갈 수 있습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/35-advfx-nav-dropdown.png" alt="고급 창 전환 드롭다운" className="manual-img" />
                    <div className="manual-figcaption">왼쪽 위 드롭다운으로 <strong>Spatial Field · Ambience · Equalizer</strong>를 바로 전환합니다.</div>
                  </div>

                  <h3 className="manual-h3">9.1 Ambience — 음향 공간(Sound Environment)</h3>
                  <p className="manual-p">Ambience는 곡 전체가 어떤 <strong>공간에서 울리는지</strong>를 정하는 창입니다. 위쪽 <strong>SOUND ENVIRONMENT</strong>에서 공간 프리셋을 고른 뒤, 왼쪽 노브와 오른쪽 슬라이더로 잔향의 길이·거리감·밝기를 다듬습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/32-ambience-main.png" alt="Ambience 기본 화면" className="manual-img" />
                    <div className="manual-figcaption">Ambience 메인 화면입니다. 가운데 곡선은 잔향이 사라지는 모양(Decay)을 보여 주고, 왼쪽 MIX·ECHO·WIDTH 노브와 오른쪽 DECAY·PRE-DELAY·ROOM SIZE·DAMPING 슬라이더로 조정합니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/live-screens/34-ambience-presets.png" alt="Ambience 프리셋 선택" className="manual-img" />
                    <div className="manual-figcaption">SOUND ENVIRONMENT 프리셋 선택 줄입니다. 각 프리셋은 실제 공간을 흉내 낸 음악적 효과를 줍니다.</div>
                  </div>
                  <p className="manual-p"><strong>각 공간 프리셋의 음악적 효과</strong> — 이름이 곧 어떤 음악적 결과를 내는지를 뜻합니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Reset (Dry)</th><td className="manual-td">잔향을 모두 끈 <strong>건조한</strong> 상태. 울림 없이 소리가 가깝고 또렷합니다. 원음 확인·기준점 복귀용.</td></tr>
                      <tr><th className="manual-th">Concert Hall</th><td className="manual-td">큰 공연장처럼 <strong>길고 풍성한 잔향</strong>. 오케스트라·발라드·합창에 웅장하고 깊은 공간감.</td></tr>
                      <tr><th className="manual-th">Home</th><td className="manual-td">작은 방의 <strong>짧고 자연스러운 울림</strong>. 보컬·어쿠스틱 기타에 어울리는 은은한 실내 공기감.</td></tr>
                      <tr><th className="manual-th">Far Field</th><td className="manual-td">소리가 <strong>멀리서 들리는 듯한 거리감</strong> + 한 번 튕기는 슬랩 에코. 빈티지·로파이·몽환적 분위기.</td></tr>
                      <tr><th className="manual-th">Studio</th><td className="manual-td">녹음 스튜디오 같은 <strong>짧고 단단한 잔향</strong>. 모던 팝/록에서 선명함 유지하며 살짝만 공간 부여.</td></tr>
                      <tr><th className="manual-th">Tunnel</th><td className="manual-td">터널·복도처럼 <strong>금속성 반사가 강한 긴 잔향</strong>. 특수효과·앰비언트·드라마틱한 연출.</td></tr>
                      <tr><th className="manual-th">Custom</th><td className="manual-td">아래 노브·슬라이더로 직접 조정한 <strong>나만의 공간 설정</strong>을 보관.</td></tr>
                    </tbody>
                  </table>
                  <p className="manual-p"><strong>세부 조절(FINE-TUNE 노브 · 오른쪽 슬라이더)</strong></p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">MIX</th><td className="manual-td">원음과 잔향의 <strong>비율</strong>. 높일수록 울림이 많아지고, 낮추면 원음이 또렷해집니다.</td></tr>
                      <tr><th className="manual-th">ECHO</th><td className="manual-td">잔향에 섞이는 <strong>반복 반사(에코)</strong>의 양. 리듬감 있는 공간 반사를 더합니다.</td></tr>
                      <tr><th className="manual-th">WIDTH</th><td className="manual-td">잔향의 <strong>스테레오 폭</strong>. 높이면 공간감이 좌우로 넓게 펼쳐집니다.</td></tr>
                      <tr><th className="manual-th">DECAY</th><td className="manual-td">잔향 꼬리가 사라지는 <strong>길이</strong>(Short↔Long). 길수록 큰 공간처럼 오래 울립니다.</td></tr>
                      <tr><th className="manual-th">PRE-DELAY</th><td className="manual-td">원음 뒤 잔향이 <strong>시작되기까지의 시간</strong>(Near↔Late). 길수록 더 큰 공간감, 원음이 묻히지 않음.</td></tr>
                      <tr><th className="manual-th">ROOM SIZE</th><td className="manual-td">가상 공간의 <strong>크기</strong>(Small↔Large). 잔향의 밀도·두께를 좌우합니다.</td></tr>
                      <tr><th className="manual-th">DAMPING</th><td className="manual-td">잔향의 <strong>고역 흡수(밝기)</strong>(Dark↔Bright). 어두우면 따뜻하게, 밝으면 화사하게 울립니다.</td></tr>
                    </tbody>
                  </table>
                  <p className="manual-p">Ambience 창 아래쪽에는 믹서 MASTER와 동일한 <strong>OUTPUT EFFECTS</strong>(Reverb · Delay · Saturation · Widener · Exciter / Enhancer)가 함께 있어, 공간감을 잡으면서 마스터 출력 효과까지 한 화면에서 조정할 수 있습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/33-ambience-output-effects.png" alt="Ambience 창 하단 OUTPUT EFFECTS" className="manual-img" />
                    <div className="manual-figcaption">Ambience 창 하단의 OUTPUT EFFECTS입니다. 믹서 MASTER 패널과 같은 다섯 효과를 제공합니다.</div>
                  </div>

                  <h3 className="manual-h3">9.2 Auto Panning — 스테레오 배치(Spatial Field)</h3>
                  <p className="manual-p">Auto Panning은 각 악기(트랙)를 반원형 <strong>스테레오 무대</strong> 위에 배치하는 창입니다. 위쪽 무대에서 악기 노드를 드래그해 <strong>좌우(팬)와 앞뒤(거리)</strong> 위치를 정하고, 아래쪽 트랙별 노브로 값을 미세 조정합니다. 악기를 서로 다른 자리에 펼쳐 두면 겹침이 줄어 믹스가 더 또렷하고 입체적으로 들립니다. 리뉴얼된 Spatial Field 창의 우측에는 전체 믹스 볼륨을 조절할 수 있는 <strong>볼륨 슬라이더</strong>가 추가되었습니다. 게인을 과도하게 올려 사운드가 클리핑 임계값에 도달하면 슬라이더 배경이 붉은색으로 변하며 사운드 포화(Saturation) 경고가 표시됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/36-advanced-pan.png" alt="Advanced Pan(Spatial Field) 악기 배치 화면" className="manual-img" />
                    <div className="manual-figcaption">리뉴얼된 Spatial Field 화면입니다. 무대 위 각 악기 노드를 드래그해 좌우·원근 위치를 잡고, 하단 노브로 트랙별 팬을 조정하며 우측 볼륨 슬라이더로 마스터 출력을 제어합니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/live-screens/36-advanced-pan-saturation.png" alt="Spatial Field 게인 과도 시 Saturation 표시 화면" className="manual-img" />
                    <div className="manual-figcaption">우측 볼륨 슬라이더의 게인을 과도하게 올렸을 때 레벨 미터가 붉은색으로 바뀌며 사운드 Saturation 경고가 표시되는 모습입니다.</div>
                  </div>

                  <h3 className="manual-h3">9.3 Equalizer — 정밀 EQ 편집</h3>
                  <p className="manual-p">믹서 MASTER의 EQ를 큰 화면에서 다루는 전용 창입니다. 실시간 FFT 스펙트럼 위에 9개 밴드 포인트가 놓여 있고, 각 포인트를 위아래로 드래그하면 저역~고역의 양을 ±로 조절하며 그 값(dB)이 포인트 아래에 표시됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/37-advanced-eq-presets.png" alt="Equalizer 창과 프리셋" className="manual-img" />
                    <div className="manual-figcaption">Equalizer 창입니다. 하단 <strong>PRESET</strong> 줄에서 Reset · Pop · Classic · Hip Hop을 바로 적용합니다(그림은 Pop).</div>
                  </div>
                  <p className="manual-p"><strong>사용자 EQ 프리셋 저장 · 불러오기 · 이름 변경</strong> — PRESET 아래 <strong>USER</strong> 줄에는 사용자 슬롯(내 EQ 1~5)이 있습니다. 슬롯을 누르면 작은 메뉴가 열립니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Save here</th><td className="manual-td">현재 EQ 곡선을 그 슬롯에 <strong>저장</strong>합니다.</td></tr>
                      <tr><th className="manual-th">Recall</th><td className="manual-td">슬롯에 저장된 EQ 설정을 <strong>불러와 적용</strong>합니다.</td></tr>
                      <tr><th className="manual-th">Rename…</th><td className="manual-td">슬롯의 <strong>이름을 변경</strong>합니다. 자주 쓰는 설정을 알아보기 쉽게 이름 붙일 수 있습니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/live-screens/38-advanced-eq-user.png" alt="사용자 EQ 저장/불러오기/이름변경 메뉴" className="manual-img" />
                    <div className="manual-figcaption">USER 슬롯의 <strong>Save here · Recall · Rename…</strong> 메뉴입니다. 즐겨 쓰는 EQ를 슬롯에 저장해 곡마다 빠르게 불러올 수 있습니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">10. Advanced Effects</h2>
                  <p className="manual-p">The top <strong>Advanced Effects</strong> menu opens three dedicated editing windows, each giving you a larger workspace to fine-tune advanced effects applied to the master (project-wide) output.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/10-01-advanced-effects.png" alt="Advanced Effects menu" className="manual-img" />
                    <div className="manual-figcaption">The <strong>Advanced Effects</strong> menu: <strong>Ambience</strong> (space), <strong>Auto Panning</strong> (stereo placement), and <strong>Equalizer Setup</strong> (EQ).</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Ambience</th><td className="manual-td">Opens the <em>Sound Environment</em> window for designing the overall space (reverb/ambience).</td></tr>
                      <tr><th className="manual-th">Auto Panning</th><td className="manual-td">Opens the <em>Spatial Field</em> stereo-stage window for placing each instrument left/right and near/far.</td></tr>
                      <tr><th className="manual-th">Equalizer Setup</th><td className="manual-td">Opens the large <em>Equalizer</em> window to edit the 9-band graphic EQ and store user presets.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Switching Between the Windows</h3>
                  <p className="manual-p">All three advanced windows share a <strong>window switcher dropdown</strong> at the top left. Jump between <strong>Spatial Field → Ambience → Equalizer</strong> without closing the window.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/35-advfx-nav-dropdown.png" alt="Advanced window switcher dropdown" className="manual-img" />
                    <div className="manual-figcaption">Use the top-left dropdown to switch instantly between <strong>Spatial Field · Ambience · Equalizer</strong>.</div>
                  </div>

                  <h3 className="manual-h3">9.1 Ambience — Sound Environment</h3>
                  <p className="manual-p">Ambience defines <strong>what space the whole song echoes in</strong>. Pick a space preset under <strong>SOUND ENVIRONMENT</strong>, then refine the length, distance, and brightness of the reverb with the knobs on the left and sliders on the right.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/32-ambience-main.png" alt="Ambience main window" className="manual-img" />
                    <div className="manual-figcaption">The Ambience main window. The center curve shows how the reverb fades over time (Decay); adjust with the MIX/ECHO/WIDTH knobs (left) and DECAY/PRE-DELAY/ROOM SIZE/DAMPING sliders (right).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/live-screens/34-ambience-presets.png" alt="Ambience SOUND ENVIRONMENT presets" className="manual-img" />
                    <div className="manual-figcaption">The SOUND ENVIRONMENT preset row. Each preset emulates a real space with a distinct musical effect.</div>
                  </div>
                  <p className="manual-p"><strong>The musical effect of each space preset</strong> — the name tells you the musical result.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Reset (Dry)</th><td className="manual-td">All reverb off — a <strong>dry</strong>, close, crisp sound. Use it to hear the raw source or return to a baseline.</td></tr>
                      <tr><th className="manual-th">Concert Hall</th><td className="manual-td">A <strong>long, lush reverb</strong> like a large hall. Grand, deep space for orchestras, ballads, and choirs.</td></tr>
                      <tr><th className="manual-th">Home</th><td className="manual-td">A small room's <strong>short, natural ambience</strong>. Subtle indoor air for vocals and acoustic guitar.</td></tr>
                      <tr><th className="manual-th">Far Field</th><td className="manual-td">Sound heard <strong>from a distance</strong> plus a single slap-back echo. Great for vintage, lo-fi, dreamy moods.</td></tr>
                      <tr><th className="manual-th">Studio</th><td className="manual-td">A <strong>short, tight reverb</strong> like a recording studio. Keeps modern pop/rock clear with a touch of space.</td></tr>
                      <tr><th className="manual-th">Tunnel</th><td className="manual-td">A <strong>long, metallic reverb</strong> with strong reflections. Suited to special effects, ambient, and drama.</td></tr>
                      <tr><th className="manual-th">Custom</th><td className="manual-td">Stores <strong>your own space</strong> shaped with the knobs and sliders below.</td></tr>
                    </tbody>
                  </table>
                  <p className="manual-p"><strong>Fine-tuning (FINE-TUNE knobs · right-side sliders)</strong></p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">MIX</th><td className="manual-td">The <strong>balance</strong> between dry and reverberant sound. Higher = more space; lower = crisper original.</td></tr>
                      <tr><th className="manual-th">ECHO</th><td className="manual-td">The amount of <strong>repeating reflections (echo)</strong> blended into the reverb.</td></tr>
                      <tr><th className="manual-th">WIDTH</th><td className="manual-td">The <strong>stereo width</strong> of the reverb. Raise it to spread the space wider.</td></tr>
                      <tr><th className="manual-th">DECAY</th><td className="manual-td">How <strong>long</strong> the reverb tail lasts (Short↔Long).</td></tr>
                      <tr><th className="manual-th">PRE-DELAY</th><td className="manual-td">The <strong>time before the reverb begins</strong> after the dry sound (Near↔Late); longer feels like a bigger space.</td></tr>
                      <tr><th className="manual-th">ROOM SIZE</th><td className="manual-td">The <strong>size</strong> of the virtual space (Small↔Large).</td></tr>
                      <tr><th className="manual-th">DAMPING</th><td className="manual-td">The reverb's <strong>high-frequency absorption (brightness)</strong> (Dark↔Bright).</td></tr>
                    </tbody>
                  </table>
                  <p className="manual-p">The bottom of the Ambience window also includes the same <strong>OUTPUT EFFECTS</strong> as the mixer MASTER (Reverb, Delay, Saturation, Widener, Exciter / Enhancer), so you can shape the space and master output effects on one screen.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/33-ambience-output-effects.png" alt="OUTPUT EFFECTS at the bottom of the Ambience window" className="manual-img" />
                    <div className="manual-figcaption">The OUTPUT EFFECTS at the bottom of the Ambience window — the same five effects as the mixer MASTER panel.</div>
                  </div>

                  <h3 className="manual-h3">9.2 Auto Panning — Spatial Field</h3>
                  <p className="manual-p">Auto Panning places each instrument (track) on a fan-shaped <strong>stereo stage</strong>. Drag the instrument nodes to set their <strong>left/right (pan) and front/back (distance)</strong>, and fine-tune with the per-track knobs below. Spreading instruments apart reduces overlap, making the mix clearer and more three-dimensional. In the renewed Spatial Field window, a <strong>master volume slider</strong> has been added to the right side. If you increase the gain excessively so that the signal level reaches clipping threshold, the level indicator turns red to warn about sound saturation.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/36-advanced-pan.png" alt="Advanced Pan (Spatial Field) instrument placement" className="manual-img" />
                    <div className="manual-figcaption">The renewed Spatial Field window. Drag each instrument node on the stage to set left/right and near/far, adjust per-track pan, and control overall master volume via the slider on the right.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/live-screens/36-advanced-pan-saturation.png" alt="Spatial Field Saturation Warning Screen" className="manual-img" />
                    <div className="manual-figcaption">When gain is raised excessively, the right volume slider level meter changes to red, displaying a sound saturation warning.</div>
                  </div>

                  <h3 className="manual-h3">9.3 Equalizer — Precise EQ Editing</h3>
                  <p className="manual-p">A dedicated window for editing the mixer MASTER EQ on a large canvas. Nine band points sit over a real-time FFT spectrum; drag a point up or down to boost/cut from lows to highs, with its value (dB) shown beneath it.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/37-advanced-eq-presets.png" alt="Equalizer window and presets" className="manual-img" />
                    <div className="manual-figcaption">The Equalizer window. The bottom <strong>PRESET</strong> row applies Reset · Pop · Classic · Hip Hop instantly (Pop is active here).</div>
                  </div>
                  <p className="manual-p"><strong>Save, recall, and rename user EQ presets</strong> — below PRESET, the <strong>USER</strong> row holds user slots (My EQ 1–5). Clicking a slot opens a small menu.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Save here</th><td className="manual-td"><strong>Saves</strong> the current EQ curve into that slot.</td></tr>
                      <tr><th className="manual-th">Recall</th><td className="manual-td"><strong>Loads and applies</strong> the EQ stored in the slot.</td></tr>
                      <tr><th className="manual-th">Rename…</th><td className="manual-td"><strong>Renames</strong> the slot so favorite settings are easy to recognize.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-figure">
                    <img src="manual/live-screens/38-advanced-eq-user.png" alt="User EQ save/recall/rename menu" className="manual-img" />
                    <div className="manual-figcaption">The <strong>Save here · Recall · Rename…</strong> menu on a USER slot. Store favorite EQ settings and recall them quickly per song.</div>
                  </div>
                </>
              )}
            </section>

            {/* 10. 믹스다운 내보내기 / Exporting Mixdown */}
            <section id="export" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">11. 믹스다운 내보내기</h2>
                  <p className="manual-p"><strong>Export</strong> 버튼 또는 <strong>Project &gt; Export...</strong> 메뉴를 누르면 Export mixdown 창이 열립니다. 실제 내보내기 창에서는 MP3와 WAV 중 하나를 고를 수 있습니다.</p>

                  <h3 className="manual-h3">Export 설정</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/11-01-export-dialog.png" alt="Export mixdown 창" className="manual-img" />
                    <div className="manual-figcaption">Export mixdown 창입니다. 왼쪽 <strong>EXPORT</strong>에서 출력 형식과 품질을, 오른쪽 <strong>AUDIO INFO (TAGS)</strong>에서 곡 정보를 설정합니다. 아래 회색 상자에는 무엇이 렌더링되는지와 <strong>전체 길이</strong>가 요약됩니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">File name</th><td className="manual-td">저장될 파일 이름입니다. 프로젝트 이름이 기본값으로 들어갑니다.</td></tr>
                      <tr><th className="manual-th">Format</th><td className="manual-td"><code>MP3</code> 또는 <code>WAV</code>를 선택합니다.</td></tr>
                      <tr><th className="manual-th">Bitrate</th><td className="manual-td">MP3 출력 시 192, 256, 320kbps 중에서 선택합니다.</td></tr>
                      <tr><th className="manual-th">Sample rate</th><td className="manual-td">44.1kHz 또는 48kHz로 렌더링합니다.</td></tr>
                      <tr><th className="manual-th">Normalize</th><td className="manual-td">스위치를 켜면 목표 음량(LUFS)에 맞춰 라우드니스 정규화를 적용합니다. -9(loud master), -12(loud), -14(streaming), -16(podcast), -23(broadcast) LUFS 중에서 목표를 고를 수 있습니다.</td></tr>
                      <tr><th className="manual-th">Keep pitch</th><td className="manual-td">Vari BPM으로 출력 템포를 바꿀 때 Export 파일에 피치 보존 Time Stretch를 적용합니다. Electron 데스크톱에서는 현재 <code className="manual-code">ffmpeg atempo</code> 기준선을 사용하며, 실시간 재생은 캐시형 Time Stretch 프리뷰를 사용합니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-note"><strong>Normalize</strong> 스위치를 켜면 그 아래에 목표 LUFS를 고르는 드롭다운이 나타납니다. 스트리밍 발매용으로는 <strong>-14 LUFS</strong>가 일반적인 기준값입니다.</div>

                  <h3 className="manual-h3">Audio info 태그</h3>
                  <p className="manual-p">오른쪽 <strong>AUDIO INFO (TAGS)</strong>에서 <strong>Title · Artist / Composer · Album · Year · Date</strong>를 입력합니다. MP3 형식에서는 <strong>Album art</strong>까지 넣을 수 있으며, 프리셋 커버를 고르거나 이미지 파일을 직접 지정할 수 있습니다.</p>

                  <h3 className="manual-h3">저장 절차</h3>
                  <ol className="manual-ol">
                    <li className="manual-li">내보내기 설정과 태그 정보를 입력합니다.</li>
                    <li className="manual-li"><strong>Render</strong>를 누릅니다.</li>
                    <li className="manual-li">렌더링이 끝나면 <strong>Save file</strong>을 눌러 저장 위치를 선택합니다.</li>
                  </ol>

                  <div className="manual-note">내보내기에는 음소거되지 않은 트랙, Solo 상태, 트랙 FX, 볼륨 오토메이션, 마스터 EQ, 마스터 페이드, 출력 리버브/에코가 모두 반영됩니다.</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">11. Exporting Mixdown</h2>
                  <p className="manual-p">Click the <strong>Export</strong> button or go to <strong>Project &gt; Export...</strong> to open the Export dialog. The dialog supports exporting in either MP3 or WAV format.</p>

                  <h3 className="manual-h3">Export Settings</h3>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/11-01-export-dialog.png" alt="Export mixdown dialog" className="manual-img" />
                    <div className="manual-figcaption">The Export mixdown window. <strong>EXPORT</strong> on the left sets format and quality; <strong>AUDIO INFO (TAGS)</strong> on the right holds the song metadata. The grey box below summarises what will be rendered and the <strong>total length</strong>.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">File name</th><td className="manual-td">The output filename, pre-filled from the project name.</td></tr>
                      <tr><th className="manual-th">Format</th><td className="manual-td">Choose <code>MP3</code> or <code>WAV</code> format.</td></tr>
                      <tr><th className="manual-th">Bitrate</th><td className="manual-td">Choose 192, 256, or 320kbps for MP3 compression quality.</td></tr>
                      <tr><th className="manual-th">Sample rate</th><td className="manual-td">Select 44.1kHz or 48kHz for output rendering.</td></tr>
                      <tr><th className="manual-th">Normalize</th><td className="manual-td">When enabled, applies loudness normalization to a target LUFS. Choose from -9 (loud master), -12 (loud), -14 (streaming), -16 (podcast), or -23 (broadcast) LUFS.</td></tr>
                      <tr><th className="manual-th">Keep pitch</th><td className="manual-td">Applies pitch-preserving Time Stretch to exported files when Vari BPM changes the output tempo. Electron desktop currently uses the <code className="manual-code">ffmpeg atempo</code> baseline; realtime playback uses a cached Time Stretch preview.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-note">Turning the <strong>Normalize</strong> switch on reveals a LUFS target dropdown beneath it. <strong>-14 LUFS</strong> is the usual reference for streaming releases.</div>

                  <h3 className="manual-h3">Audio Info Tags</h3>
                  <p className="manual-p">Fill in <strong>Title · Artist / Composer · Album · Year · Date</strong> under <strong>AUDIO INFO (TAGS)</strong> on the right. MP3 exports can also embed <strong>Album art</strong> — pick a preset cover or choose your own image file.</p>

                  <h3 className="manual-h3">Exporting Steps</h3>
                  <ol className="manual-ol">
                    <li className="manual-li">Configure your format, quality, and metadata tags.</li>
                    <li className="manual-li">Click <strong>Render</strong> to print the session audio.</li>
                    <li className="manual-li">Once rendering completes, click <strong>Save file</strong> to select the output destination on your computer.</li>
                  </ol>

                  <div className="manual-note">The rendered mixdown captures all unmuted tracks, solo states, track sends, volume automation curves, master EQ adjustments, master fades, and master effects.</div>
                </>
              )}
            </section>

            {/* 11. 설정과 테마 / Settings & Themes */}
            <section id="settings" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">12. 설정 · 오디오 장치 · 테마</h2>
                  <p className="manual-p">상단 메뉴의 <strong>Settings</strong>를 누르면 설정 창이 열립니다. 왼쪽 <strong>CONTENTS</strong> 목록으로 <strong>Color Theme · Mixer Console Window · Audio Devices</strong> 세 영역을 오갈 수 있습니다.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/12-01-settings.png" alt="설정 · 오디오 장치 · 테마" className="manual-img" />
                    <div className="manual-figcaption">Settings 창입니다. 색상 테마 10종, 오디오 입력 텍스처, 믹서 창 초기화, 오디오 장치 설정이 한 창에 모여 있습니다.</div>
                  </div>

                  <h3 className="manual-h3">Color Theme — 색상 테마</h3>
                  <p className="manual-p">10가지 테마 중 하나를 고르면 <strong>메인 창과 믹서·보컬 스트립·고급 이펙트 창까지 전부</strong> 즉시 같은 색으로 바뀝니다. 각 카드에는 미리보기와 성격을 설명하는 한 줄이 함께 표시됩니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">어두운 테마</th><td className="manual-td">Warm Analog(기본) · Modern Blue · Milky Purple · Clownfish · Neon Lime · Minimal Slate · Antique Olive · Ocean</td></tr>
                      <tr><th className="manual-th">밝은 테마</th><td className="manual-td">Classical Ivory · Sage Mist</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Audio Input Texture — 입력 트랙 질감</h3>
                  <p className="manual-p">Audio In 트랙 영역의 배경 질감을 고릅니다. <strong>None</strong>(기본) · <strong>Diagonal</strong> · <strong>Dots</strong> · <strong>Brushed</strong> · <strong>Edge Lines</strong> 중에서 선택하며, 녹음 트랙을 파일 트랙과 시각적으로 더 뚜렷이 구분하고 싶을 때 씁니다. 소리에는 아무 영향이 없습니다.</p>

                  <h3 className="manual-h3">Mixer Console Window — 믹서 창 초기화</h3>
                  <p className="manual-p">믹서 창을 화면 구석으로 치워 두었거나 크기를 크게 바꿔 놓았다면 <strong>Reset Position</strong>을 누르세요. 기억해 둔 좌표와 크기가 지워져 다음에 열 때 화면 중앙에 기본 크기로 나타납니다.</p>

                  <h3 className="manual-h3">Audio Devices — 녹음/재생 장치 설정</h3>
                  <p className="manual-p"><strong>Audio Devices</strong> 섹션에서 녹음과 재생에 쓸 오디오 장치를 지정합니다(<strong>4장</strong>의 사전 준비). 설정 순서는 <strong>모드 → 입력/출력 장치 → Sample Rate / Buffer</strong>입니다.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/12-02-audio-devices.png" alt="오디오 디바이스 선택 및 설정" className="manual-img" />
                    <div className="manual-figcaption">Audio Devices 섹션입니다. 드라이버 모드, 입력·출력 장치, 샘플레이트와 버퍼, 현재 상태와 지연 시간 추정치, <strong>Recording offset</strong>, 그리고 모드 비교 표가 함께 표시됩니다.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">모드(드라이버 타입)</th><td className="manual-td"><strong>Shared</strong>(공유·기본) · <strong>Exclusive</strong>(단독 점유) · <strong>Low Latency</strong>(낮은 지연) 중에서 고릅니다. 선택한 모드에 해당하는 장치만 아래 목록에 나타납니다.</td></tr>
                      <tr><th className="manual-th">입력 / 출력 장치</th><td className="manual-td">녹음에 쓸 입력 장치와 재생에 쓸 출력 장치를 고릅니다. 트랙별 <strong>입력 포트</strong>(모노/스테레오 채널) 목록은 여기서 고른 입력 장치의 채널을 따릅니다.</td></tr>
                      <tr><th className="manual-th">Exclusive 자동 페어링</th><td className="manual-td">Exclusive 모드에서는 <strong>입력·출력을 모두 가진 인터페이스만</strong> 보이고, 입력을 고르면 같은 인터페이스의 출력이 자동으로 짝지어집니다.</td></tr>
                      <tr><th className="manual-th">Sample Rate / Buffer</th><td className="manual-td">샘플레이트와 버퍼 크기입니다. 버퍼가 작을수록 지연은 줄지만 CPU 부하와 끊김 위험이 커집니다.</td></tr>
                      <tr><th className="manual-th">현재 상태 · 지연 표시</th><td className="manual-td">드롭다운 아래에 지금 열려 있는 입력·출력 장치와 샘플레이트·버퍼가 요약되고, 그 아래 줄에 <strong>입력 · 출력 · 왕복(round-trip) 지연 추정치</strong>가 표시됩니다.</td></tr>
                      <tr><th className="manual-th">Rescan</th><td className="manual-td">연결한 장치가 목록에 없으면 다시 검색합니다.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Recording offset — 녹음 위치 보정</h3>
                  <p className="manual-p">오디오 장치는 입력을 붙잡아 앱에 넘기기까지 아주 짧은 시간이 걸립니다. 보정하지 않으면 녹음된 소리가 반주보다 <strong>조금씩 늦게</strong> 놓이는데, <strong>Recording offset</strong>이 이를 자동으로 맞춰 줍니다.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Auto (기본)</th><td className="manual-td">체크해 두면 드라이버가 보고한 지연값을 그대로 사용합니다. 대부분 이대로 두면 됩니다.</td></tr>
                      <tr><th className="manual-th">수동 입력</th><td className="manual-td">Auto를 끄고 밀리초(ms)를 직접 넣습니다. <strong>양수</strong>는 녹음을 <strong>앞으로 당기고</strong>(입력 지연 보정), <strong>음수</strong>는 <strong>뒤로 미룹니다</strong>.</td></tr>
                      <tr><th className="manual-th">Offset Cal.</th><td className="manual-td">녹음 클립을 귀로 맞춰 옮겼다면, 그 클립을 오른쪽 클릭해 <strong>Recording Offset Cal.</strong>을 실행하세요. 손으로 맞춘 간격이 <strong>전역 Recording offset에 반영</strong>되어 이후 녹음은 처음부터 제자리에 놓입니다.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">어떤 모드를 골라야 할까</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Exclusive</th><td className="manual-td">지연이 <strong>가장 낮지만</strong>, 하나의 장치를 앱이 독차지하므로 <strong>다른 프로그램 소리가 나지 않습니다</strong>. 샘플레이트도 앱이 정합니다.</td></tr>
                      <tr><th className="manual-th">Low Latency</th><td className="manual-td">지연이 <strong>낮고</strong> 다른 프로그램 소리도 들립니다. 실제 지연은 드라이버에 따라 다릅니다.</td></tr>
                      <tr><th className="manual-th">Shared (기본)</th><td className="manual-td">지연은 보통이지만 <strong>가장 안정적</strong>이며 다른 프로그램과 함께 쓸 수 있습니다. 평소에는 이 모드를 권장합니다.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-note">지연을 낮출수록 안정성은 떨어집니다. <strong>소리가 끊기거나 지직거리면 Shared로 되돌리세요.</strong></div>
                  <div className="manual-warning">Exclusive 모드는 장치가 그 샘플레이트/버퍼 조합을 지원하지 않으면 열리지 않을 수 있습니다. 이 경우 <strong>이전 정상 장치가 유지</strong>되고 Audio Devices 섹션에 붉은 배너로 실패 사유가 표시됩니다. 배너를 참고해 Sample Rate/Buffer를 조정하거나 Shared / Low Latency로 바꿔 보세요.</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">12. Settings, Audio Devices &amp; Themes</h2>
                  <p className="manual-p">Click <strong>Settings</strong> in the menu bar to open the settings window. The <strong>CONTENTS</strong> list on the left moves between <strong>Color Theme · Mixer Console Window · Audio Devices</strong>.</p>

                  <div className="manual-figure">
                    <img src="manual/screens-v2/12-01-settings.png" alt="Settings — themes, texture, devices" className="manual-img" />
                    <div className="manual-figcaption">The Settings window gathers the 10 color themes, the audio input texture, the mixer-window reset, and audio device setup in one place.</div>
                  </div>

                  <h3 className="manual-h3">Color Theme</h3>
                  <p className="manual-p">Choosing one of the ten themes instantly recolors <strong>everything — the main window, the mixer, the vocal strip, and the advanced effect windows</strong>. Each card shows a preview and a one-line description of its character.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Dark themes</th><td className="manual-td">Warm Analog (default) · Modern Blue · Milky Purple · Clownfish · Neon Lime · Minimal Slate · Antique Olive · Ocean</td></tr>
                      <tr><th className="manual-th">Light themes</th><td className="manual-td">Classical Ivory · Sage Mist</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Audio Input Texture</h3>
                  <p className="manual-p">Sets the background texture of Audio In track lanes — <strong>None</strong> (default), <strong>Diagonal</strong>, <strong>Dots</strong>, <strong>Brushed</strong>, or <strong>Edge Lines</strong>. Use it to make recording tracks stand out more clearly from file tracks. It has no effect on the audio.</p>

                  <h3 className="manual-h3">Mixer Console Window</h3>
                  <p className="manual-p">If you have parked the mixer in a screen corner or resized it heavily, press <strong>Reset Position</strong>. The remembered bounds are cleared and the window reopens centred at its default size.</p>

                  <h3 className="manual-h3">Audio Devices — recording &amp; playback setup</h3>
                  <p className="manual-p">The <strong>Audio Devices</strong> section is where you choose the devices used for recording and playback (the prerequisite for <strong>ch. 4</strong>). The order is <strong>mode → input/output device → Sample Rate / Buffer</strong>.</p>
                  <div className="manual-figure">
                    <img src="manual/screens-v2/12-02-audio-devices.png" alt="Audio device selection and setup" className="manual-img" />
                    <div className="manual-figcaption">The Audio Devices section: driver mode, input/output device, sample rate and buffer, the active-state and latency estimate lines, <strong>Recording offset</strong>, and a mode comparison table.</div>
                  </div>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Mode (driver type)</th><td className="manual-td">Choose <strong>Shared</strong> (default), <strong>Exclusive</strong> (sole ownership), or <strong>Low Latency</strong>. Only devices for the selected mode are listed below.</td></tr>
                      <tr><th className="manual-th">Input / Output device</th><td className="manual-td">Pick the input device for recording and the output device for playback. Each track's <strong>input port</strong> (mono/stereo channel) list follows the channels of the input device chosen here.</td></tr>
                      <tr><th className="manual-th">Exclusive auto-pairing</th><td className="manual-td">In Exclusive mode only interfaces with <strong>both input and output</strong> appear, and choosing an input auto-selects the matching output of the same interface.</td></tr>
                      <tr><th className="manual-th">Sample Rate / Buffer</th><td className="manual-td">A smaller buffer lowers latency but raises CPU load and the risk of dropouts.</td></tr>
                      <tr><th className="manual-th">Active state &amp; latency</th><td className="manual-td">Below the dropdowns, a line summarises the currently open input/output, sample rate, and buffer; the next line estimates <strong>input, output, and round-trip latency</strong>.</td></tr>
                      <tr><th className="manual-th">Rescan</th><td className="manual-td">Searches again if a connected device is missing from the list.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Recording offset</h3>
                  <p className="manual-p">An audio device takes a small amount of time to capture your input and hand it to the app. Without compensation, recordings land <strong>slightly late</strong> against the backing track — <strong>Recording offset</strong> corrects that automatically.</p>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Auto (default)</th><td className="manual-td">Uses the latency the driver reports. Leave it on unless you have a reason not to.</td></tr>
                      <tr><th className="manual-th">Manual</th><td className="manual-td">Turn Auto off and type a value in milliseconds. <strong>Positive</strong> pulls recordings <strong>earlier</strong> (compensating capture delay); <strong>negative</strong> pushes them <strong>later</strong>.</td></tr>
                      <tr><th className="manual-th">Offset Cal.</th><td className="manual-td">If you nudged a recorded clip into place by ear, right-click it and run <strong>Recording Offset Cal.</strong> — that manual alignment is <strong>folded into the global Recording offset</strong> so future takes land pre-aligned.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Which mode should I use?</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Exclusive</th><td className="manual-td"><strong>Lowest latency</strong>, but the app takes over one device for input+output, so <strong>other apps are muted</strong> and the app sets the sample rate.</td></tr>
                      <tr><th className="manual-th">Low Latency</th><td className="manual-td"><strong>Low latency</strong> while other apps stay audible. The real figure depends on the driver.</td></tr>
                      <tr><th className="manual-th">Shared (default)</th><td className="manual-td">Normal latency but <strong>the most stable</strong>, and it shares the device with other apps. Recommended for everyday use.</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-note">Lower latency trades away stability — <strong>if you hear dropouts or crackles, switch back to Shared.</strong></div>
                  <div className="manual-warning">Exclusive mode may fail to open if the device does not support the chosen sample-rate/buffer combination. If that happens, the <strong>previous working device is kept</strong> and a red banner in the Audio Devices section shows the reason. Use it to adjust the Sample Rate/Buffer, or switch to Shared / Low Latency.</div>
                </>
              )}
            </section>

            {/* 13. 단축키 / Shortcuts */}
            <section id="shortcuts" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">13. 단축키</h2>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Space</kbd></th><td className="manual-td">재생 / 일시정지</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">F3</kbd></th><td className="manual-td">믹서 콘솔(Mixer) 열기 / 닫기</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">0</kbd></th><td className="manual-td">Play bar를 0초로 이동</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">,</kbd> 또는 <kbd className="manual-kbd">&lt;</kbd></th><td className="manual-td">Play bar를 1초 뒤로 이동</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">.</kbd> 또는 <kbd className="manual-kbd">&gt;</kbd></th><td className="manual-td">Play bar를 1초 앞으로 이동</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">←</kbd></th><td className="manual-td">Play bar를 1초 뒤로 이동</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">→</kbd></th><td className="manual-td">Play bar를 1초 앞으로 이동</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">S</kbd></th><td className="manual-td">프로젝트 저장</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">O</kbd></th><td className="manual-td">프로젝트 열기</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">실행 취소</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Y</kbd></th><td className="manual-td">다시 실행</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Shift</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">다시 실행</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">도구 선택</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">S</kbd></th><td className="manual-td">선택 도구</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">C</kbd></th><td className="manual-td">자르기(가위) 도구 — 클립 Split</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">J</kbd></th><td className="manual-td">합치기 도구 — 클립 Merge</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">클립 편집 (클립을 선택한 상태)</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Esc</kbd></th><td className="manual-td">클립 선택 해제(도구도 함께 해제)</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Del</kbd> 또는 <kbd className="manual-kbd">Backspace</kbd></th><td className="manual-td">선택한 클립 삭제</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">C</kbd></th><td className="manual-td">클립 복사</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">V</kbd></th><td className="manual-td">재생 위치에 붙여넣기</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">D</kbd></th><td className="manual-td">클립 복제</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">←</kbd> / <kbd className="manual-kbd">→</kbd></th><td className="manual-td">클립 미세 이동 — <strong>1 ms</strong></td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">←</kbd> / <kbd className="manual-kbd">→</kbd></th><td className="manual-td">클립 미세 이동 — <strong>10 ms</strong></td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Shift</kbd> + <kbd className="manual-kbd">←</kbd> / <kbd className="manual-kbd">→</kbd></th><td className="manual-td">클립 미세 이동 — <strong>100 ms</strong></td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + 클릭</th><td className="manual-td">여러 클립을 함께 선택</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-note">클립이 선택돼 있으면 <kbd className="manual-kbd">←</kbd>/<kbd className="manual-kbd">→</kbd>가 <strong>클립 미세 이동</strong>으로 쓰이고, 선택된 클립이 없을 때만 <strong>재생 위치 이동</strong>으로 동작합니다.</div>
                  <div className="manual-note">녹음 또는 카운트인이 진행되는 동안에는 <strong>이동키(←/→/,/./0)와 마우스 클릭 이동(seek)이 차단</strong>되고, <kbd className="manual-kbd">Space</kbd>(재생/일시정지)도 무시됩니다. 녹음을 멈추려면 트랜스포트의 Record 또는 Stop을 사용하세요(<strong>4장</strong> 참고).</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">13. Shortcuts</h2>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Space</kbd></th><td className="manual-td">Play / Pause</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">F3</kbd></th><td className="manual-td">Open / Close Mixer Console</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">0</kbd></th><td className="manual-td">Move the play bar to 0 seconds</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">,</kbd> or <kbd className="manual-kbd">&lt;</kbd></th><td className="manual-td">Move the play bar backward by 1 second</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">.</kbd> or <kbd className="manual-kbd">&gt;</kbd></th><td className="manual-td">Move the play bar forward by 1 second</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">←</kbd></th><td className="manual-td">Move the play bar backward by 1 second</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">→</kbd></th><td className="manual-td">Move the play bar forward by 1 second</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">S</kbd></th><td className="manual-td">Save Project</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">O</kbd></th><td className="manual-td">Open Project</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">Undo</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Y</kbd></th><td className="manual-td">Redo</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Shift</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">Redo</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Tools</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">S</kbd></th><td className="manual-td">Select tool</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">C</kbd></th><td className="manual-td">Scissors tool — split clips</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">J</kbd></th><td className="manual-td">Join tool — merge clips</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Clip editing (with a clip selected)</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Esc</kbd></th><td className="manual-td">Deselect the clip (and release the active tool)</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Del</kbd> or <kbd className="manual-kbd">Backspace</kbd></th><td className="manual-td">Delete the selected clip</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">C</kbd></th><td className="manual-td">Copy the clip</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">V</kbd></th><td className="manual-td">Paste at the playhead</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">D</kbd></th><td className="manual-td">Duplicate the clip</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">←</kbd> / <kbd className="manual-kbd">→</kbd></th><td className="manual-td">Nudge the clip — <strong>1 ms</strong></td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">←</kbd> / <kbd className="manual-kbd">→</kbd></th><td className="manual-td">Nudge the clip — <strong>10 ms</strong></td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Shift</kbd> + <kbd className="manual-kbd">←</kbd> / <kbd className="manual-kbd">→</kbd></th><td className="manual-td">Nudge the clip — <strong>100 ms</strong></td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + click</th><td className="manual-td">Select several clips at once</td></tr>
                    </tbody>
                  </table>
                  <div className="manual-note">With a clip selected, <kbd className="manual-kbd">←</kbd>/<kbd className="manual-kbd">→</kbd> <strong>nudge the clip</strong>; they only <strong>move the playhead</strong> when no clip is selected.</div>
                  <div className="manual-note">While recording or during the count-in, the <strong>seek keys (←/→/,/./0) and mouse-click seeking are blocked</strong>, and <kbd className="manual-kbd">Space</kbd> (play/pause) is ignored. Use the transport Record or Stop to end a take (see <strong>ch. 4</strong>).</div>
                </>
              )}
            </section>

            {/* 13. 문제 해결 / Troubleshooting */}
            <section id="tips" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">14. 문제 해결</h2>
                  <h3 className="manual-h3">오디오가 들리지 않을 때</h3>
                  <ul className="manual-ul">
                    <li className="manual-li">트랙의 <strong>M</strong> 버튼이 켜져 있지 않은지 확인합니다.</li>
                    <li className="manual-li">다른 트랙의 <strong>S</strong> 버튼이 켜져 있으면 Solo가 켜진 트랙만 들립니다.</li>
                    <li className="manual-li">트랙 볼륨과 마스터 볼륨이 너무 낮지 않은지 확인합니다.</li>
                    <li className="manual-li">운영체제의 출력 장치와 볼륨을 확인합니다.</li>
                  </ul>

                  <h3 className="manual-h3">모든 트랙이 안 들리는데 레벨 미터는 움직일 때</h3>
                  <p className="manual-p">저장된 <strong>출력 장치가 연결 해제</strong>된 경우입니다. <strong>Settings ▸ Audio Devices</strong>에서 지금 연결된 출력 장치를 다시 고르세요. 시작할 때 저장된 장치를 열지 못하면 앱이 시스템 기본 장치로 되돌리고 경고를 표시합니다.</p>

                  <h3 className="manual-h3">프로젝트를 열었는데 NO SRC가 보일 때</h3>
                  <p className="manual-p">원본 오디오 파일의 위치가 바뀌었을 가능성이 큽니다. <strong>같은 파일을 그 트랙 위로 끌어다 놓거나</strong> 다시 가져오면 앱이 파일 이름·경로 기준으로 재연결합니다. 프로젝트를 통째로 옮길 때는 <strong>Save As…</strong>로 저장하면 녹음·바운스가 함께 모아져 안전합니다(<strong>2장</strong>).</p>

                  <h3 className="manual-h3">녹음한 소리가 반주보다 늦게(또는 빠르게) 들릴 때</h3>
                  <p className="manual-p"><strong>Settings ▸ Audio Devices ▸ Recording offset</strong>을 확인하세요. 기본값인 <strong>Auto</strong>가 대부분 맞지만, 어긋난다면 Auto를 끄고 ms 값을 직접 조정하거나, 귀로 맞춘 클립에서 오른쪽 클릭 ▸ <strong>Recording Offset Cal.</strong>로 그 값을 전역 설정에 반영하세요(<strong>12장</strong>).</p>

                  <h3 className="manual-h3">녹음 중 소리가 끊기거나 지직거릴 때</h3>
                  <p className="manual-p">버퍼가 너무 작거나 드라이버 모드가 불안정한 경우입니다. <strong>Buffer를 키우고</strong>, 모드를 <strong>Shared</strong>로 되돌려 보세요. 지연을 낮출수록 안정성은 떨어집니다(<strong>12장</strong>).</p>

                  <h3 className="manual-h3">Record 버튼이 눌리지 않을 때</h3>
                  <p className="manual-p"><strong>ARM된 Audio In 트랙이 없기 때문</strong>입니다. 녹음할 트랙의 <strong>ARM</strong> 버튼을 먼저 켜세요. <strong>Punch</strong> 버튼이 눌리지 않는다면 <strong>Repeat 구간이 없기 때문</strong>이고, <strong>메트로놈</strong>이 눌리지 않는다면 <strong>프로젝트 BPM이 아직 없기 때문</strong>입니다(<strong>4장 · 6장</strong>).</p>

                  <h3 className="manual-h3">프로젝트 폴더 용량이 계속 커질 때</h3>
                  <p className="manual-p">여러 번 다시 녹음하면 쓰이지 않는 테이크 파일이 쌓입니다. <strong>Project ▸ Clean Up Unused Recordings…</strong>로 정리하세요. 되돌리기 기록에 남아 있는 파일은 제외되고, 삭제가 아니라 휴지통으로 이동합니다(<strong>2장</strong>).</p>

                  <h3 className="manual-h3">MP3 저장이 실패할 때</h3>
                  <p className="manual-p">MP3 인코딩은 앱에 함께 설치되는 변환기(ffmpeg)가 처리합니다. MP3 저장이 실패하면 ① 저장 위치에 <strong>쓰기 권한</strong>이 있는지(다른 폴더로 저장해 보기), ② 같은 이름의 파일이 <strong>다른 프로그램에서 열려 있지</strong> 않은지, ③ 디스크 여유 공간이 충분한지 확인하세요. 그래도 실패하면 <strong>WAV로 먼저 저장</strong>해 작업물을 안전하게 확보한 뒤, 앱을 <strong>다시 설치</strong>해 주세요.</p>

                  <h3 className="manual-h3">화면이 너무 좁을 때</h3>
                  <p className="manual-p">FocusDAW Studio의 최소 창 크기는 1258x600입니다. 믹서나 Export 창이 좁게 보이면 창을 넓히거나 타임라인을 스크롤해 필요한 영역을 확인하세요.</p>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">14. Troubleshooting</h2>
                  <h3 className="manual-h3">No Sound During Playback</h3>
                  <ul className="manual-ul">
                    <li className="manual-li">Check if the track **M** (Mute) button is turned on.</li>
                    <li className="manual-li">Check if another track has its **S** (Solo) button active (which mutes all other tracks).</li>
                    <li className="manual-li">Check track faders and master volume fader levels.</li>
                    <li className="manual-li">Verify system audio output device settings and volume levels.</li>
                  </ul>

                  <h3 className="manual-h3">Nothing is audible but the meters still move</h3>
                  <p className="manual-p">The saved <strong>output device has been disconnected</strong>. Pick a currently connected output under <strong>Settings ▸ Audio Devices</strong>. If the saved device cannot be opened at launch, the app falls back to the system default and shows a warning.</p>

                  <h3 className="manual-h3">NO SRC appears after loading a project</h3>
                  <p className="manual-p">The source audio has been moved or deleted. <strong>Drop the same file onto that track</strong>, or re-import it, and the app reconnects by name/path. When moving a project as a whole, save it with <strong>Save As…</strong> so its recordings and bounces travel with it (<strong>ch. 2</strong>).</p>

                  <h3 className="manual-h3">Recordings land late (or early) against the backing</h3>
                  <p className="manual-p">Check <strong>Settings ▸ Audio Devices ▸ Recording offset</strong>. The default <strong>Auto</strong> is right in most cases; otherwise turn Auto off and adjust the millisecond value, or align one clip by ear and use right-click ▸ <strong>Recording Offset Cal.</strong> to fold that into the global setting (<strong>ch. 12</strong>).</p>

                  <h3 className="manual-h3">Dropouts or crackles while recording</h3>
                  <p className="manual-p">The buffer is too small, or the driver mode is unstable on your system. <strong>Raise the Buffer</strong> and switch the mode back to <strong>Shared</strong> — lower latency always trades away stability (<strong>ch. 12</strong>).</p>

                  <h3 className="manual-h3">The Record button will not press</h3>
                  <p className="manual-p">There is <strong>no armed Audio In track</strong> — press <strong>ARM</strong> on the track you want to record. Likewise, <strong>Punch</strong> is disabled without a <strong>Repeat region</strong>, and the <strong>metronome</strong> is disabled until the project has a <strong>BPM</strong> (<strong>ch. 4 &amp; 6</strong>).</p>

                  <h3 className="manual-h3">The project folder keeps growing</h3>
                  <p className="manual-p">Repeated re-recording leaves unused take files behind. Run <strong>Project ▸ Clean Up Unused Recordings…</strong>. Files still held by the undo history are excluded, and everything goes to the Recycle Bin rather than being erased (<strong>ch. 2</strong>).</p>

                  <h3 className="manual-h3">MP3 Render Fails</h3>
                  <p className="manual-p">MP3 encoding is handled by the converter (ffmpeg) that ships with the app. If an MP3 export fails, check that ① you can <strong>write to the destination folder</strong> (try another one), ② no other program has a file of the same name <strong>open</strong>, and ③ there is enough free disk space. If it still fails, <strong>export a WAV first</strong> to secure your work, then reinstall the app.</p>

                  <h3 className="manual-h3">Elements cut off or window too small</h3>
                  <p className="manual-p">The minimum window resolution is 1258x600. Resize your window or scroll horizontally on the timeline to locate hidden elements.</p>
                </>
              )}
            </section>

            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 20 }}>
              {lang === "ko"
                ? "FocusDAW Studio 사용자 메뉴얼 · 작성 기준 버전 v" + (window.APP_VERSION || "0.0.0")
                : "FocusDAW Studio User Manual · Written for version v" + (window.APP_VERSION || "0.0.0")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const RELEASE_NOTES = {
  range: "v1.40.0 - v1.46.2",
  date: "2026-08-18",
  features: [
    "Takes are now organised per clip: when one Audio In track holds several recorded spots, the take lanes are grouped under CLIP 1 / CLIP 2 / CLIP 3 headers, each clip numbers its takes from Take A, and choosing a take for one clip leaves the other clips playing their own. Flatten Comp commits every clip's choice at once.",
    "Vari BPM can no longer be switched on before the project BPM is known. While the indicator reads \"---\" the switch is dimmed and clicking it explains how to measure the tempo — previously it could silently apply the previous project's tempo ratio and play the song too fast or too slow.",
    "Merge Tracks always renders its bounce at the original BPM and key, so a bounce lines up with the tracks it came from even when Vari BPM / Vari Key are on. Tempo and key changes now apply to realtime playback and Export only.",
    "Manual: readable table headings in the Ocean theme, end-user (installed app) instructions instead of developer commands in \"Start & Projects\", and a corrected description of the key list in the Key chapter.",
    "User manual rewritten for v1.45.0: the in-app manual and manual/사용자 메뉴얼.html now cover recording takes and comping, punch, clip editing, the vocal channel strip, de-noise, Merge Tracks, the file-track group, Save As portability, Clean Up Unused Recordings, and the new audio-device settings — with refreshed screenshots throughout.",
    "Vocal channel strip: Audio In and Bounce tracks now have an FX button that opens a dedicated Vocal Channel Strip window with a 9-band graphic EQ and a compressor, plus vocal presets (Clean Lead / Warm Pop / Bright Air / Podcast) and an A/B bypass. The strip is applied before the track fader and is reflected in playback, Export, and saved projects.",
    "Vocal strip layout: the Bypass / Strip Active switch moved up next to the track name, and the preset row gained a Reset button that returns every module to its defaults (your bypass state is left alone, and it is undoable).",
    "Vocal presets now set the high-pass filter and de-esser as well as the EQ and compressor. The Noise Gate is deliberately left alone, because a usable gate threshold depends on how noisy your own recording is.",
    "Vocal strip spectrum: the strip's Spectrum panel now shows the vocal's measured frequency curve (PRE) with the EQ's effect drawn on top (POST) in real time as you move the EQ, so you can see how the EQ reshapes the voice.",
    "Vocal strip High-Pass Filter and Noise Gate: the strip's HPF (rumble/plosive cut, 12 dB/oct) and Noise Gate (attenuates below a threshold to clean up breaths and room tone) are now active, applied before the EQ in playback and Export.",
    "Vocal strip De-esser: tames harsh sibilance (\"s\"/\"sh\" sounds) by attenuating just the sibilance band when it gets loud — set the frequency, threshold, and amount. Applied after the compressor in playback and Export.",
    "Vocal strip gain-reduction meters: the Noise Gate, Compressor, and De-esser now show a live meter of how much they are working during playback, so you can see the effect even when it is subtle.",
    "Broadband de-noise: remove steady room tone or hiss from a vocal clip. Mark a silent stretch as the Repeat region, click Learn Noise, then apply — the cleaned audio is printed to a new file next to your project, leaving the original recording untouched and the whole thing undoable.",
    "Clip volume lines: on Audio In and Bounce tracks, select a clip and drag the amber line on top to lower that clip's volume (cut-only, with a live dB label). The waveform shrinks to match, and it is saved, undoable, and reflected in Export.",
    "Clean Up Unused Recordings: a Project menu command that scans your saved project's audio folder for recordings, bounces, and consolidated files that nothing references — including your undo history — and moves them to the Recycle Bin (restorable).",
    "Portable projects: Save As now gathers the project's own recordings, bounces, and consolidated audio into a \"<Project> Audio\" folder next to the .focus and stores relative paths, so a saved project is self-contained and can be moved or copied.",
    "Comp lane building: swipe across the take lanes to assemble a composite take from your best passes.",
    "In-app updates: check for updates from the Help menu and download and install new versions directly, delivered through GitHub Releases.",
    "Color themes: additional accent color themes to personalise the look.",
  ],
  improvements: [
    "Punch recording now keeps the original as a take instead of discarding it, and the Punch button is enabled only when a Repeat region exists — preventing accidental destructive re-records.",
    "Color themes now apply everywhere: the remaining accent highlights that stayed amber on a blue, purple, or green theme — track headers, the mixer's EQ and knobs, slider glows, dialogs, and the vocal strip — now follow the theme you picked.",
    "Missing-audio alerts, the Flatten confirmation, and other prompts now use the app's themed modal instead of the plain browser dialog.",
    "Track names and recording file names are handled separately, so renaming a track no longer changes its recorded file names.",
    "Recording and session scratch files now live under Documents\\FocusDAW\\Temp and are cleaned up automatically; temp originals are removed once collected into a saved project.",
    "Output device safety: if the saved output device is unavailable at launch, the app falls back to the system default and shows a themed warning instead of playing silently.",
    "Recording offset: recorded takes are shifted to line up with the backing track. Auto follows the driver's latency estimate, and aligning one clip by ear can be folded into the global offset with Recording Offset Cal.",
    "Audio device settings now show the active device summary, an input/output/round-trip latency estimate, and a mode comparison table so the latency-vs-stability trade-off is explicit.",
    "Audio input texture: an optional background texture (Diagonal, Dots, Brushed, Edge Lines) that makes Audio In lanes easier to tell apart from file tracks.",
    "Demo session now loads real mp3 stems bundled with the app instead of synthesized tones.",
  ],
  fixes: [
    "Fixed renaming a project breaking its audio on the next launch (recordings/bounces showed as missing). Renaming now changes only the display name and keeps the saved folder, so collected audio still resolves.",
    "Fixed the Export loudness chain — harmonic distortion and added noise at loud targets — and improved the limiter's lookahead/release along with export speed.",
    "Fixed re-recording, loop-take, and single-punch takes overlapping or replacing more of the track than intended.",
    "Fixed reopen/restart issues where tracks were duplicated, came back as \"NO AUDIO,\" or a saved project's audio could not be found.",
    "Fixed moving a normal clip also dragging inactive takes along with it.",
    "Fixed the menu Save Project opening a Save As dialog on an already-saved project (menu actions could call a stale handler); the menu now behaves the same as the Ctrl+S shortcut.",
    "Fixed clicking the take-count badge on an Audio In track jumping the play bar to the click point; the badge now only toggles the take lanes.",
    "Fixed the arrow-key play bar movement on the native engine — the right arrow now steps forward smoothly instead of jumping around, and the left arrow steps backward reliably (held keys chain off the last step so backward no longer stalls).",
  ],
};

function ReleaseNotesDialog({ onClose }) {
  const sectionStyle = { marginTop: 18 };
  const headingStyle = {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: ".10em",
    textTransform: "uppercase",
    color: "var(--amber)",
    margin: "0 0 10px",
  };
  const listStyle = {
    margin: 0,
    paddingLeft: 19,
    color: "var(--cream-2)",
    fontSize: 13.5,
    lineHeight: 1.55,
  };
  const renderList = (items) => (
    <ul style={listStyle}>
      {items.map((item, i) => <li key={i} style={{ marginBottom: 8 }}>{item}</li>)}
    </ul>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 860, userSelect: "none", WebkitUserSelect: "none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--bg2)", border: "1px solid color-mix(in srgb, var(--cream) 30%, transparent)", borderRadius: 14, width: 560, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid color-mix(in srgb, var(--cream) 30%, transparent)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".06em", color: "var(--cream-2)", textTransform: "uppercase" }}>RELEASE NOTES</span>
          <button className="iconbtn" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: 0, minWidth: 0, width: "auto", height: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>×</button>
        </div>

        <div className="theme-scroll release-notes-scroll" style={{ padding: "24px 28px 18px", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "color-mix(in srgb, var(--surface) 60%, transparent)", border: "1px solid color-mix(in srgb, var(--cream) 16%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow)", flex: "0 0 auto" }}>
              <Logo size={38} style={{ borderRadius: 9 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: '"Cinzel", serif', fontSize: 22, fontWeight: 400, color: "var(--cream)", lineHeight: 1.15 }}>What's New</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--dim)" }}>
                <span className="mono" style={{ color: "var(--cream-2)", fontWeight: 700 }}>{RELEASE_NOTES.range}</span>
                <span>·</span>
                <span>{RELEASE_NOTES.date}</span>
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <h3 style={headingStyle}>New Features</h3>
            {renderList(RELEASE_NOTES.features)}
          </div>
          <div style={sectionStyle}>
            <h3 style={headingStyle}>Improvements</h3>
            {renderList(RELEASE_NOTES.improvements)}
          </div>
          <div style={sectionStyle}>
            <h3 style={headingStyle}>Fixes</h3>
            {renderList(RELEASE_NOTES.fixes)}
          </div>
        </div>

        <div style={{ padding: "12px 16px 18px", display: "flex", justifyContent: "center", borderTop: "1px solid color-mix(in srgb, var(--cream) 14%, transparent)" }}>
          <button className="btn" onClick={onClose} style={{ minWidth: 90, height: 32, justifyContent: "center" }}>OK</button>
        </div>
      </div>
    </div>
  );
}

function AboutDialog({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 850, userSelect: "none", WebkitUserSelect: "none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--bg2)", border: "1px solid color-mix(in srgb, var(--cream) 30%, transparent)", borderRadius: 14, width: 400, maxWidth: "95vw", display: "flex", flexDirection: "column", boxShadow: "var(--shadow)", overflow: "hidden" }}>
        
        {/* Header Bar */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid color-mix(in srgb, var(--cream) 30%, transparent)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".06em", color: "var(--cream-2)", textTransform: "uppercase" }}>ABOUT</span>
          <button className="iconbtn" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: 0, minWidth: 0, width: "auto", height: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>×</button>
        </div>

        {/* Content Area */}
        <div style={{ padding: "32px 24px", textAlign: "center" }}>
          {/* Logo Card */}
          <div style={{ width: 90, height: 90, borderRadius: 18, background: "color-mix(in srgb, var(--surface) 50%, transparent)", border: "1px solid color-mix(in srgb, var(--cream) 10%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", boxShadow: "var(--shadow)" }}>
            <Logo size={56} style={{ borderRadius: 12 }} />
          </div>

          {/* Title */}
          <div style={{ fontFamily: '"Cinzel", serif', fontSize: 22, fontWeight: 400, color: "var(--cream)", marginBottom: 8 }}>
            F<span style={{ fontSize: 20 }}>ocus</span>DAW - S<span style={{ fontSize: 20 }}>tudio</span>
          </div>

          {/* Version Badge */}
          <div style={{ display: "inline-flex", alignItems: "center", background: "var(--surface)", border: "1px solid color-mix(in srgb, var(--cream) 30%, transparent)", borderRadius: 14, padding: "4px 16px", fontSize: 12, fontWeight: 600, color: "var(--cream-2)", marginBottom: 20 }}>
            Studio Edition v{window.APP_VERSION || "0.14.2"}
          </div>

          {/* Description */}
          <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.5, maxWidth: 320, margin: "0 auto 20px" }}>
            FocusDAW Studio is a desktop stem-mixing DAW. It lets you import separated audio stems, balance each track, draw volume automation, shape the master with EQ and output effects, and export a final MP3 or WAV mixdown.
          </div>

          {/* Email */}
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--accent)", marginBottom: 24 }}>
            focustone.el@gmail.com
          </div>

          {/* OK Button */}
          <button className="btn" onClick={onClose} style={{ minWidth: 90, height: 32, justifyContent: "center", margin: "0 auto" }}>
            OK
          </button>
        </div>

      </div>
    </div>
  );
}
