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
    { id: "arrange", label: "4. 타임라인과 트랙" },
    { id: "bpm", label: "5. BPM 표시 및 설정" },
    { id: "key", label: "6. Key 표시 및 설정" },
    { id: "automation", label: "7. 볼륨 오토메이션" },
    { id: "mixer", label: "8. 믹서와 마스터" },
    { id: "advfx", label: "9. 고급 이펙트" },
    { id: "export", label: "10. 믹스다운 내보내기" },
    { id: "settings", label: "11. 설정과 테마" },
    { id: "shortcuts", label: "12. 단축키" },
    { id: "tips", label: "13. 문제 해결" },
  ] : [
    { id: "overview", label: "1. App Overview" },
    { id: "start", label: "2. Start & Projects" },
    { id: "import", label: "3. Importing Audio" },
    { id: "arrange", label: "4. Timeline & Tracks" },
    { id: "bpm", label: "5. BPM Display & Settings" },
    { id: "key", label: "6. Key Display & Settings" },
    { id: "automation", label: "7. Volume Automation" },
    { id: "mixer", label: "8. Mixer & Master" },
    { id: "advfx", label: "9. Advanced Effects" },
    { id: "export", label: "10. Exporting Mixdown" },
    { id: "settings", label: "11. Settings & Themes" },
    { id: "shortcuts", label: "12. Shortcuts" },
    { id: "tips", label: "13. Troubleshooting" },
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
          background: var(--surface2);
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
          background: var(--surface2);
          color: var(--amber);
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
                  <p className="manual-p">FocusDAW Studio는 여러 개의 스템 파일을 한 세션에 등록한 뒤, 각 트랙의 볼륨, 팬, 솔로, 뮤트, 리버브, 에코를 조정하고 최종 마스터를 출력하는 앱입니다. 전체 믹스에는 9밴드 그래픽 EQ, 마스터 볼륨, 출력 리버브/에코, 페이드 인/아웃을 적용할 수 있습니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/02-arrange-demo.png" alt="FocusDAW Studio arrange 화면" className="manual-img" />
                    <div className="manual-figcaption">실제 앱을 실행해 캡처한 메인 Arrange 화면입니다. 상단 메뉴와 전송 컨트롤, 줌/트랙 크기 도구, 트랙 파형, OUTPUT FX 트랙이 함께 표시됩니다.</div>
                  </div>

                  <div className="manual-grid">
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>주요 작업</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">프로젝트 새로 만들기, 열기, 저장</li>
                        <li className="manual-li">오디오 파일 또는 스템 폴더 가져오기</li>
                        <li className="manual-li">트랙별 볼륨, 팬, 솔로, 뮤트 조정</li>
                        <li className="manual-li">트랙별 리버브, 에코, 볼륨 오토메이션 적용</li>
                        <li className="manual-li">마스터 EQ, 페이드, 출력 효과 적용</li>
                        <li className="manual-li">MP3 또는 WAV로 믹스다운 저장</li>
                      </ul>
                    </div>
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>지원 파일</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">입력 오디오: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code>, <code className="manual-code">.aif</code>, <code className="manual-code">.aiff</code>, <code className="manual-code">.m4a</code>, <code className="manual-code">.ogg</code>, <code className="manual-code">.flac</code></li>
                        <li className="manual-li">프로젝트: <code className="manual-code">.focus</code></li>
                        <li className="manual-li">출력 오디오: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code></li>
                        <li className="manual-li">MP3 출력 시 제목, 아티스트/작곡가, 앨범, 연도, 날짜, 앨범 아트 태그를 입력할 수 있습니다.</li>
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">1. App Overview</h2>
                  <p className="manual-p">FocusDAW Studio is an application designed to import multiple stem files into a single session, adjust volume, pan, solo, mute, reverb, and echo for each track, and export a final master mixdown. The overall mix can be shaped using a 9-band graphic EQ, master volume fader, master output reverb/echo effects, and master fade-in/out automation.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/02-arrange-demo.png" alt="FocusDAW Studio Arrange Window" className="manual-img" />
                    <div className="manual-figcaption">Main Arrange window. Displays the top menu, transport controls, time/amplitude zoom sliders, track waveforms, and the Master OUTPUT FX track.</div>
                  </div>

                  <div className="manual-grid">
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>Key Features</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">Create, open, and save projects (.focus)</li>
                        <li className="manual-li">Import individual audio files or stem folders</li>
                        <li className="manual-li">Control track volume, panning, solo, and mute</li>
                        <li className="manual-li">Apply track reverb/echo sends and volume automation</li>
                        <li className="manual-li">Master EQ shaping, master fades, and output effects</li>
                        <li className="manual-li">Export final mixdown as MP3 or WAV</li>
                      </ul>
                    </div>
                    <div className="manual-card">
                      <h3 className="manual-h3" style={{ color: "var(--amber)" }}>Supported Files</h3>
                      <ul className="manual-ul">
                        <li className="manual-li">Input Audio: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code>, <code className="manual-code">.aif</code>, <code className="manual-code">.aiff</code>, <code className="manual-code">.m4a</code>, <code className="manual-code">.ogg</code>, <code className="manual-code">.flac</code></li>
                        <li className="manual-li">Project: <code className="manual-code">.focus</code></li>
                        <li className="manual-li">Output Audio: <code className="manual-code">.mp3</code>, <code className="manual-code">.wav</code></li>
                        <li className="manual-li">For MP3 exports, metadata tags (Title, Artist, Album, Year, Date, and Cover Art) can be embedded.</li>
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
                  <h3 className="manual-h3">앱 실행</h3>
                  <p className="manual-p">개발 환경에서 실행할 때는 프로젝트 루트에서 다음 명령을 사용합니다.</p>
                  <p className="manual-p"><code className="manual-code">npm start</code></p>
                  <p className="manual-p">패키징된 앱에서는 FocusDAW Studio 실행 파일을 열면 됩니다.</p>

                  <h3 className="manual-h3">상단 Project 메뉴</h3>
                  <div className="manual-figure">
                    <img src="manual/live-screens/01-empty-start.png" alt="FocusDAW Studio 시작 화면" className="manual-img" />
                    <div className="manual-figcaption">새 세션 시작 화면입니다. 파일을 끌어다 놓거나 Import Folder, Import Files, Load demo session을 선택해 작업을 시작합니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/24-project-menu.png" alt="Project 메뉴" className="manual-img" />
                    <div className="manual-figcaption">상단 메뉴 막대의 <strong>Project</strong>를 누르면 New / Open / Save, Import, Load Demo, Export 항목이 펼쳐집니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">New Project</th><td className="manual-td">현재 세션을 비우고 새 프로젝트를 시작합니다.</td></tr>
                      <tr><th className="manual-th">Open Project...</th><td className="manual-td">저장된 <code className="manual-code">.focus</code> 프로젝트 파일을 엽니다.</td></tr>
                      <tr><th className="manual-th">Save Project</th><td className="manual-td">현재 프로젝트 상태를 <code className="manual-code">.focus</code> 파일로 저장합니다. 트랙 설정, 마스터 설정, 오토메이션, 클립 정보가 저장됩니다.</td></tr>
                      <tr><th className="manual-th">Import Stem Folder...</th><td className="manual-td">선택한 폴더의 루트에 있는 오디오 파일을 한 번에 등록합니다.</td></tr>
                      <tr><th className="manual-th">Import Audio Files...</th><td className="manual-td">개별 오디오 파일을 여러 개 선택해 트랙으로 추가합니다.</td></tr>
                      <tr><th className="manual-th">Load Demo Session</th><td className="manual-td">Drums, Bass, Keys, Lead 데모 트랙을 불러와 앱 기능을 시험합니다.</td></tr>
                      <tr><th className="manual-th">Export...</th><td className="manual-td">믹스다운 내보내기 창을 엽니다. 실제 창에서는 MP3와 WAV를 선택할 수 있습니다.</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">프로젝트 이름 설정</h3>
                  <p className="manual-p">상단 오른쪽의 프로젝트 이름 칸을 클릭하면 이름을 바로 입력·수정할 수 있습니다. 여기서 정한 이름은 제목 표시줄에 나타나고, 프로젝트를 저장할 때 파일 이름의 기본값으로도 사용됩니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/18-project-name.png" alt="프로젝트 이름 설정 화면" className="manual-img" />
                    <div className="manual-figcaption">상단 오른쪽의 프로젝트 이름 칸(예: <code className="manual-code">untitled</code>)을 클릭해 원하는 이름으로 바꿉니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">2. Start & Projects</h2>
                  <h3 className="manual-h3">Launching the App</h3>
                  <p className="manual-p">In the development environment, execute the following command at the project root:</p>
                  <p className="manual-p"><code className="manual-code">npm start</code></p>
                  <p className="manual-p">In the packaged release, simply open the FocusDAW Studio executable.</p>

                  <h3 className="manual-h3">Top "Project" Menu</h3>
                  <div className="manual-figure">
                    <img src="manual/live-screens/01-empty-start.png" alt="FocusDAW Studio Start Screen" className="manual-img" />
                    <div className="manual-figcaption">Empty startup session. Drop audio files directly or choose an import option to begin working.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/24-project-menu.png" alt="Project menu" className="manual-img" />
                    <div className="manual-figcaption">Clicking <strong>Project</strong> in the menu bar reveals New / Open / Save, Import, Load Demo, and Export commands.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">New Project</th><td className="manual-td">Clears the current session and creates a fresh project.</td></tr>
                      <tr><th className="manual-th">Open Project...</th><td className="manual-td">Opens an existing <code className="manual-code">.focus</code> project file.</td></tr>
                      <tr><th className="manual-th">Save Project</th><td className="manual-td">Saves the current session state to a <code className="manual-code">.focus</code> file, including track parameters, master effects, automation curves, and clip locations.</td></tr>
                      <tr><th className="manual-th">Import Stem Folder...</th><td className="manual-td">Imports and creates tracks for all audio files located in the root of the chosen folder.</td></tr>
                      <tr><th className="manual-th">Import Audio Files...</th><td className="manual-td">Opens a file selector to add multiple individual audio files as tracks.</td></tr>
                      <tr><th className="manual-th">Load Demo Session</th><td className="manual-td">Loads a pre-configured multi-track demo session (Drums, Bass, Keys, Lead) to test the app features.</td></tr>
                      <tr><th className="manual-th">Export...</th><td className="manual-td">Opens the mixdown export dialog (supports MP3 and WAV export formats).</td></tr>
                    </tbody>
                  </table>

                  <h3 className="manual-h3">Setting the Project Name</h3>
                  <p className="manual-p">Click the project name field on the top right to rename it instantly. The name appears in the title bar and is also used as the default filename when saving the project.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/18-project-name.png" alt="Project name field" className="manual-img" />
                    <div className="manual-figcaption">Click the project name field on the top right (e.g. <code className="manual-code">untitled</code>) to rename it.</div>
                  </div>
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
                    <img src="manual/live-screens/07-real-audio-tracks.png" alt="실제 오디오 트랙을 불러온 화면" className="manual-img" />
                    <div className="manual-figcaption">실제 오디오 스템을 불러온 화면입니다. 파일명에서 가져온 트랙 이름이 왼쪽 헤더에 표시되고, 각 트랙의 파형이 타임라인에 배치됩니다.</div>
                  </div>

                  <p className="manual-p">여러 스템을 가져오면 보컬, 드럼, 베이스, 기타, 스트링, 신스처럼 파일별로 독립 트랙이 생성됩니다. 각 트랙은 같은 시작점에 놓이지만, 실제 오디오가 없는 구간은 빈 파형으로 보이므로 편곡의 구간별 밀도를 한눈에 확인할 수 있습니다.</p>

                  <h3 className="manual-h3">폴더 이름으로 프로젝트 이름 자동 설정 <span className="appver-since">(v1.9.4)</span></h3>
                  <p className="manual-p">아직 트랙이 없는 <strong>초기(빈) 화면</strong>에서 <strong>Import Folder</strong>로 스템 폴더를 불러오면, 그 <strong>폴더 이름이 프로젝트 이름으로 자동 설정</strong>됩니다. 스템을 폴더 단위로 정리해 둔 경우 이름을 따로 입력하지 않아도 곡 제목이 곧바로 잡혀 편리합니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/27-import-folder-button.png" alt="초기 화면의 Import Folder 버튼" className="manual-img" />
                    <div className="manual-figcaption">초기 화면 가운데의 <strong>Import Folder</strong> 버튼입니다. 이 버튼(또는 <code className="manual-code">Project &gt; Import Stem Folder…</code>)으로 폴더를 선택합니다.</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/live-screens/28-folder-project-name.png" alt="폴더를 불러와 프로젝트 이름이 설정된 화면" className="manual-img" />
                    <div className="manual-figcaption">예를 들어 <code className="manual-code">불꽃의 리듬 (Rhythm of Fire) Stems</code> 폴더를 불러오면, 상단의 프로젝트 이름이 그 폴더 이름으로 자동 설정됩니다.</div>
                  </div>
                  <div className="manual-note">이 자동 설정은 <strong>초기(빈) 화면에서 폴더를 불러올 때만</strong> 적용됩니다. 이미 트랙이 있거나 이름을 직접 바꿨거나 저장한 프로젝트에 폴더를 추가로 불러올 때는 기존 이름이 유지됩니다. 개별 파일(Import Files)이나 드래그 앤 드롭은 자동 이름 설정 대상이 아닙니다.</div>

                  <h3 className="manual-h3">드래그 앤 드롭</h3>
                  <p className="manual-p">메인 타임라인 영역으로 오디오 파일을 끌어다 놓아도 트랙을 추가할 수 있습니다. 지원하지 않는 확장자는 자동으로 무시됩니다.</p>

                  <h3 className="manual-h3">프로젝트를 다시 열 때</h3>
                  <p className="manual-p"><code className="manual-code">.focus</code> 프로젝트는 오디오 설정과 파일 경로를 저장합니다. 원본 오디오 파일이 이동되면 트랙에 <strong>NO AUDIO</strong>가 표시될 수 있습니다. 이 경우 같은 이름의 오디오 파일을 다시 가져오면 누락된 트랙이 재연결됩니다.</p>
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
                    <img src="manual/live-screens/07-real-audio-tracks.png" alt="Audio Tracks Loaded" className="manual-img" />
                    <div className="manual-figcaption">Multi-track stem session loaded. Track names are parsed from the filenames, and waveforms are placed on the timeline.</div>
                  </div>

                  <p className="manual-p">Importing multiple stems creates separate, independent tracks for Vocals, Drums, Bass, Guitar, and so on. Tracks are aligned to the same starting point. Sections where a track is silent are shown as flat line waveforms, providing a clear layout of the arrangement density.</p>

                  <h3 className="manual-h3">Auto-Naming the Project from the Folder <span className="appver-since">(v1.9.4)</span></h3>
                  <p className="manual-p">When you use <strong>Import Folder</strong> on the <strong>initial (empty) screen</strong> — before any track exists — the <strong>folder's name automatically becomes the project name</strong>. If you keep your stems in per-song folders, the title is set instantly without typing.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/27-import-folder-button.png" alt="Import Folder button on the empty start screen" className="manual-img" />
                    <div className="manual-figcaption">The <strong>Import Folder</strong> button at the center of the empty start screen (equivalent to <code className="manual-code">Project &gt; Import Stem Folder…</code>).</div>
                  </div>
                  <div className="manual-figure">
                    <img src="manual/live-screens/28-folder-project-name.png" alt="Project name set from the imported folder" className="manual-img" />
                    <div className="manual-figcaption">For example, importing a folder named <code className="manual-code">불꽃의 리듬 (Rhythm of Fire) Stems</code> sets the project name at the top to that folder name.</div>
                  </div>
                  <div className="manual-note">This auto-naming applies <strong>only when importing a folder onto the empty start screen</strong>. If the project already has tracks, was renamed, or was saved, importing another folder keeps the existing name. Individual files (Import Files) and drag-and-drop are not auto-named.</div>

                  <h3 className="manual-h3">Drag and Drop</h3>
                  <p className="manual-p">You can drag and drop audio files directly from your system file explorer onto the main timeline area to add new tracks. Unsupported formats are ignored automatically.</p>

                  <h3 className="manual-h3">Reconnecting Missing Audio</h3>
                  <p className="manual-p">The <code className="manual-code">.focus</code> file references audio file paths. If the original audio files are moved, the track will display a <strong>NO AUDIO</strong> warning. Re-importing files with matching names will automatically reconnect them.</p>
                </>
              )}
            </section>

            {/* 4. 타임라인과 트랙 / Timeline & Tracks */}
            <section id="arrange" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">4. 타임라인과 트랙</h2>
                  <h3 className="manual-h3">전송 컨트롤</h3>
                  <p className="manual-p">상단 중앙의 컨트롤로 처음으로 이동, 정지, 재생/일시정지, 루프를 조작합니다. 현재 재생 위치는 분:초 형식으로 표시됩니다.</p>

                  <h3 className="manual-h3">줌과 트랙 크기</h3>
                  <ul className="manual-ul">
                    <li className="manual-li"><strong>TIME</strong>: 타임라인의 가로 확대/축소를 조절합니다.</li>
                    <li className="manual-li"><strong>AMP</strong>: 파형 표시 높이를 조절합니다. 실제 오디오 볼륨이 아니라 파형 보기 배율입니다.</li>
                    <li className="manual-li"><strong>TRACK SIZE</strong>: 트랙 행 높이를 S, M, L 중에서 선택합니다.</li>
                    <li className="manual-li">상단 미니맵을 클릭하거나 드래그하면 긴 프로젝트에서 원하는 구간으로 빠르게 이동합니다.</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/live-screens/08-time-zoom-in.png" alt="TIME ZOOM in 한 화면" className="manual-img" />
                    <div className="manual-figcaption">TIME 줌을 올리면 시간축이 넓어져 짧은 구간의 파형과 오토메이션 포인트를 더 세밀하게 볼 수 있습니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/09-amp-waveform-large.png" alt="AMP 기능으로 파형을 크게 보기" className="manual-img" />
                    <div className="manual-figcaption">AMP를 올린 화면입니다. 오디오 레벨을 바꾸지 않고 파형 표시만 크게 만들어 작은 신호를 확인하기 좋습니다.</div>
                  </div>

                  <h3 className="manual-h3">상단 미니맵 이동</h3>
                  <p className="manual-p">타임라인 위쪽의 긴 막대는 전체 곡에서 현재 보고 있는 위치를 보여주는 미니맵입니다. 미니맵 안의 선택 영역을 드래그하면 긴 프로젝트에서도 원하는 시간대로 빠르게 이동할 수 있습니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/10-minimap-drag.png" alt="상단 미니맵을 통해 드래그 이동" className="manual-img" />
                    <div className="manual-figcaption">상단 미니맵으로 1분대 구간으로 이동한 화면입니다. 긴 오디오 프로젝트에서 스크롤보다 빠르게 위치를 잡을 수 있습니다.</div>
                  </div>

                  <h3 className="manual-h3">트랙 헤더 컨트롤</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">볼륨 슬라이더</th><td className="manual-td">트랙의 재생 레벨을 조절합니다. 0dB 지점은 슬라이더 중앙 눈금으로 표시됩니다.</td></tr>
                      <tr><th className="manual-th">Pan 노브</th><td className="manual-td">좌우 스테레오 위치를 조정합니다.</td></tr>
                      <tr><th className="manual-th">B 버튼</th><td className="manual-td">BPM 측정 대상으로 사용할 트랙을 선택합니다. 한 번에 하나의 트랙만 선택됩니다.</td></tr>
                      <tr><th className="manual-th">S 버튼</th><td className="manual-td">해당 트랙만 듣는 Solo 기능입니다. Solo가 켜진 트랙이 있으면 다른 트랙은 자동으로 들리지 않습니다.</td></tr>
                      <tr><th className="manual-th">M 버튼</th><td className="manual-td">해당 트랙을 음소거합니다.</td></tr>
                      <tr><th className="manual-th">레벨 미터</th><td className="manual-td">트랙의 현재 출력 레벨을 표시합니다.</td></tr>
                      <tr><th className="manual-th">삭제 버튼</th><td className="manual-td">트랙을 제거합니다. 확인 창에서 삭제를 확정해야 합니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-warning">트랙 삭제와 오토메이션 초기화는 확인 후 즉시 적용됩니다. 필요하면 삭제 전에 프로젝트를 저장해 두세요.</div>

                  <h3 className="manual-h3">Edit 메뉴 — 모든 트랙 삭제 (Delete all tracks) <span className="appver-since">(v1.9.0)</span></h3>
                  <p className="manual-p">상단 <strong>Edit</strong> 메뉴의 Undo / Redo 아래에 <strong>Delete all tracks</strong> 항목이 있습니다. 현재 불러온 <strong>오디오 트랙만 모두 비우고</strong>, 마스터(프로젝트 전체)에 걸어 둔 <strong>이펙트 설정은 그대로 유지</strong>합니다. 같은 이펙트 체인(마스터 EQ·리버브·에코·Ambience·페이드 등)을 유지한 채 다른 스템 세트로 교체할 때 유용합니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/29-edit-delete-all-tracks.png" alt="Edit 메뉴의 Delete all tracks 항목" className="manual-img" />
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
                  <h2 className="manual-h2">4. Timeline & Tracks</h2>
                  <h3 className="manual-h3">Transport Controls</h3>
                  <p className="manual-p">Located at the top center, these control Go to Start, Stop, Play/Pause, and Loop. The current play position is shown in min:sec format.</p>

                  <h3 className="manual-h3">Zoom and Track Size</h3>
                  <ul className="manual-ul">
                    <li className="manual-li"><strong>TIME</strong>: Adjusts horizontal zoom (time scale) of the timeline.</li>
                    <li className="manual-li"><strong>AMP</strong>: Adjusts the display height of waveforms. This is a visual zoom scale only and does not change the actual audio level.</li>
                    <li className="manual-li"><strong>TRACK SIZE</strong>: Changes the height of track headers and lanes (S, M, L options).</li>
                    <li className="manual-li">Drag or click the top minimap to jump quickly to any section of the song.</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/live-screens/08-time-zoom-in.png" alt="Timeline Zoomed In" className="manual-img" />
                    <div className="manual-figcaption">With horizontal TIME zoom increased, short clips and automation points can be edited with high precision.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/09-amp-waveform-large.png" alt="Waveforms Visual Zoom" className="manual-img" />
                    <div className="manual-figcaption">With visual AMP zoom increased, quiet signals and detailed waveform transients can be clearly inspected.</div>
                  </div>

                  <h3 className="manual-h3">Minimap Navigation</h3>
                  <p className="manual-p">The bar above the timeline represents the entire length of the project. Dragging the highlighted area moves the timeline view viewport instantly across long sessions.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/10-minimap-drag.png" alt="Minimap Drag Navigation" className="manual-img" />
                    <div className="manual-figcaption">Using the minimap to navigate to the 1-minute mark. Much faster than manual horizontal scrolling.</div>
                  </div>

                  <h3 className="manual-h3">Track Header Controls</h3>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Volume Slider</th><td className="manual-td">Controls track volume. The center position marks nominal gain (0dB).</td></tr>
                      <tr><th className="manual-th">Pan Knob</th><td className="manual-td">Positions the track in the stereo field (Left/Right balance).</td></tr>
                      <tr><th className="manual-th">B Button</th><td className="manual-td">Selects the track used for BPM detection. Only one track can be selected at a time.</td></tr>
                      <tr><th className="manual-th">S Button</th><td className="manual-td">Solos the track (mutes all other non-soloed tracks).</td></tr>
                      <tr><th className="manual-th">M Button</th><td className="manual-td">Mutes the track.</td></tr>
                      <tr><th className="manual-th">Level Meter</th><td className="manual-td">Displays real-time playback output levels.</td></tr>
                      <tr><th className="manual-th">Delete Button</th><td className="manual-td">Deletes the track from the project (requires confirmation).</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-warning">Track deletion and automation resets take effect immediately after confirmation. Save your project first if you are unsure.</div>

                  <h3 className="manual-h3">Edit Menu — Delete all tracks <span className="appver-since">(v1.9.0)</span></h3>
                  <p className="manual-p">The top <strong>Edit</strong> menu offers <strong>Delete all tracks</strong> below Undo / Redo. It clears <strong>all loaded audio tracks at once while keeping the master (project-wide) effect settings intact</strong> — handy when you want to swap in a different set of stems but keep the same effect chain (master EQ, reverb, echo, Ambience, fades, etc.).</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/29-edit-delete-all-tracks.png" alt="Delete all tracks item in the Edit menu" className="manual-img" />
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
                  <h2 className="manual-h2">5. BPM 표시 및 설정</h2>
                  <p className="manual-p">FocusDAW Studio는 트랙 오디오에서 곡의 BPM(분당 박자 수)을 자동으로 측정하고, 그 값을 기준으로 <strong>전체 음악</strong>의 재생 템포를 조정할 수 있습니다. 새 프로젝트의 BPM은 처음에 <strong>---</strong>로 표시되며, 모든 트랙을 지우거나 새 프로젝트를 시작하면 다시 <strong>---</strong>로 초기화됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/19-bpm-indicator.png" alt="BPM 표시기" className="manual-img" />
                    <div className="manual-figcaption">상단 도구 막대의 BPM 표시기입니다. <strong>100 BPM | 100</strong>처럼 두 숫자가 보이며, <strong>앞</strong>은 프로젝트 BPM(곡의 기준 템포), <strong>뒤</strong>는 재생 BPM(실제 재생 속도)입니다.</div>
                  </div>

                  <p className="manual-p">BPM 표시기 오른쪽에는 <strong>Vari BPM</strong> 스위치가 있습니다. 이 스위치를 <strong>켜야</strong> 재생 BPM으로 곡 속도를 조정하며, <strong>끄면</strong> 재생 BPM을 바꿔도 속도가 변하지 않습니다(기본값 OFF). 스위치를 켠 상태에서 BPM 표시기 위에 마우스 휠을 돌리거나 ▲▼ 버튼을 누르면 <strong>뒤쪽 재생 BPM</strong>이 1씩 바뀌고, 곡 전체가 그 비율(<code>재생 BPM ÷ 프로젝트 BPM</code>)만큼 빨라지거나 느려집니다.</p>

                  <h3 className="manual-h3">① BPM 측정 대상 트랙 선택 (B 버튼)</h3>
                  <p className="manual-p">먼저 어떤 트랙의 오디오로 BPM을 측정할지 정합니다. 트랙 헤더의 <strong>B</strong> 버튼을 누르면 그 트랙이 BPM 측정 소스로 선택되어 배경이 채워지며, B는 한 번에 한 트랙에만 켜집니다. 드럼처럼 박자가 뚜렷한 트랙을 고르면 측정이 더 정확합니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/20-bpm-source-track.png" alt="특정 트랙을 BPM 측정 트랙으로 설정" className="manual-img" />
                    <div className="manual-figcaption"><strong>B</strong> 버튼이 채워진 트랙이 BPM 측정 소스입니다.</div>
                  </div>

                  <h3 className="manual-h3">② BPM 설정 패널 열기</h3>
                  <p className="manual-p">BPM 표시기를 클릭하면 아래로 설정 패널이 펼쳐집니다. 다시 누르거나, 마우스가 패널 밖으로 나간 채 5초가 지나면 접힙니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/21-bpm-settings-panel.png" alt="BPM 설정 패널" className="manual-img" />
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

                  <h3 className="manual-h3">③ Detect 분석 중 표시</h3>
                  <p className="manual-p"><strong>Detect</strong>를 누르면 분석이 진행되는 동안 버튼이 회전 아이콘과 <strong>Analyzing…</strong> 표시로 바뀝니다. 분석이 끝나면 추정된 BPM이 입력칸에 강조 효과와 함께 표시됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/22-bpm-analyzing.png" alt="BPM 분석 중 화면" className="manual-img" />
                    <div className="manual-figcaption">Detect 실행 중에는 버튼이 <strong>Analyzing…</strong> 상태로 바뀌어 분석이 진행 중임을 알려줍니다.</div>
                  </div>

                  <h3 className="manual-h3">④ 전체 음악 템포 바꿔 재생하기</h3>
                  <p className="manual-p"><strong>Vari BPM</strong> 스위치를 켠 뒤 재생 BPM(뒤 숫자)을 바꾸면 모든 트랙이 같은 비율로 빨라지거나 느려진 상태로 재생됩니다. 예를 들어 프로젝트 BPM이 100일 때 재생 BPM을 120으로 올리면 곡 전체가 1.2배 빠르게 재생됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/23-bpm-tempo-changed.png" alt="BPM 속도를 변경한 뒤 재생 중인 화면" className="manual-img" />
                    <div className="manual-figcaption">재생 BPM을 <strong>100 → 120</strong>으로 올린 뒤 재생 중인 화면입니다. 표시기가 <strong>100 BPM | 120</strong>으로 바뀌고 곡 전체가 그 비율만큼 빠르게 재생됩니다.</div>
                  </div>

                  <div className="manual-warning">실시간 재생의 템포 변경은 Vari BPM이 켜져 있을 때 캐시형 Time Stretch 프리뷰를 준비해 <strong>피치 보존을 우선 적용합니다.</strong> Export 창의 Keep pitch 옵션은 Electron 데스크톱 Export에서 검증된 단기 안정 Time Stretch 경로를 사용해 파일 출력에 피치 보존을 적용합니다.</div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">5. BPM Display & Settings</h2>
                  <p className="manual-p">FocusDAW Studio detects a song's BPM (beats per minute) from a track's audio and lets you adjust the playback tempo of the <strong>whole song</strong> based on it. A new project starts with BPM shown as <strong>---</strong>, and it returns to <strong>---</strong> whenever you clear all tracks or start a new project.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/19-bpm-indicator.png" alt="BPM indicator" className="manual-img" />
                    <div className="manual-figcaption">The indicator shows two numbers such as <strong>100 BPM | 100</strong>: the front is the project BPM (reference tempo), the back is the playback BPM (actual speed).</div>
                  </div>

                  <p className="manual-p">The <strong>Vari BPM</strong> switch to the right of the indicator must be <strong>on</strong> for the playback BPM to change the song speed (off = no speed change; default off). With it on, hover the BPM indicator and scroll the mouse wheel, or use the ▲▼ buttons, to change the <strong>playback BPM</strong> by 1 — the whole song speeds up or slows down by that ratio (playback BPM ÷ project BPM).</p>

                  <h3 className="manual-h3">1. Choose the detection source track (B button)</h3>
                  <p className="manual-p">Press the <strong>B</strong> button on a track header to mark it as the BPM detection source (its background fills in). Only one track can be the B source at a time. Picking a track with a clear beat (e.g. drums) gives more accurate detection.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/20-bpm-source-track.png" alt="Track set as BPM detection source" className="manual-img" />
                    <div className="manual-figcaption">The track whose <strong>B</strong> button is filled is the BPM detection source.</div>
                  </div>

                  <h3 className="manual-h3">2. Open the BPM settings panel</h3>
                  <p className="manual-p">Click the BPM indicator to expand the settings panel. Click it again, or leave it inactive outside the mouse area for 5 seconds, to collapse it.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/21-bpm-settings-panel.png" alt="BPM settings panel" className="manual-img" />
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

                  <h3 className="manual-h3">3. Detection-in-progress feedback</h3>
                  <p className="manual-p">While <strong>Detect</strong> runs, the button changes to a spinner with <strong>Analyzing…</strong>. When it finishes, the estimated BPM appears in the input field with a brief highlight.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/22-bpm-analyzing.png" alt="BPM analysis in progress" className="manual-img" />
                    <div className="manual-figcaption">During detection the button shows the <strong>Analyzing…</strong> state.</div>
                  </div>

                  <h3 className="manual-h3">4. Play back at a changed tempo</h3>
                  <p className="manual-p">With the <strong>Vari BPM</strong> switch on, changing the playback BPM (the back number) plays every track faster or slower by the same ratio. For example, with a project BPM of 100, raising the playback BPM to 120 plays the whole song 1.2× faster.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/23-bpm-tempo-changed.png" alt="Playing after a tempo change" className="manual-img" />
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
                  <h2 className="manual-h2">6. Key 표시 및 설정</h2>
                  <p className="manual-p">FocusDAW Studio는 프로젝트에 로드된 트랙 오디오의 화성 성분을 종합적으로 분석하여 곡의 원곡 키(Key)를 자동으로 감지하고, 반음(Semitones) 단위로 곡의 조성을 올리거나 내려서 실시간으로 이조 재생할 수 있습니다. 처음 세션을 열었을 때 키 표시창은 <strong>---</strong>로 표시됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/39-key-indicator-initial.png" alt="Key 표시창 초기 상태" className="manual-img" />
                    <div className="manual-figcaption">상단 도구 막대의 Key 표시창 초기 상태입니다. 아직 키 설정이 적용되지 않아 <code>---</code>로 표시됩니다.</div>
                  </div>

                  <h3 className="manual-h3">① Key 설정 패널 열기</h3>
                  <p className="manual-p">Key 표시창 부분을 클릭하면 아래로 Key 설정 패널이 펼쳐집니다. 이 패널은 클릭하여 켜고 끌 수 있으며, 마우스 포인터가 패널에서 벗어난 지 5초가 지나면 자동으로 닫힙니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/40-key-panel-opened.png" alt="Key 설정 패널 열린 상태" className="manual-img" />
                    <div className="manual-figcaption">Key 표시창을 클릭하여 설정 패널을 열어둔 상태입니다.</div>
                  </div>

                  <h3 className="manual-h3">② Key Detection (조성 감지)</h3>
                  <p className="manual-p">패널 내의 <strong>Detect</strong> 버튼을 누르면 프로젝트의 활성화된 모든 오디오 트랙을 정밀 분석(STFT 기반 크로마 연산)하여 원곡의 키를 추정합니다. 분석이 끝나면 감지된 대표 키값이 패널 하단 목록에 표시됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/41-key-detected.png" alt="Key Detection 완료 화면" className="manual-img" />
                    <div className="manual-figcaption">Detect 버튼을 누르면 <code>Analyzing...</code> 상태를 거쳐 분석된 오디오의 감지된 키가 하단에 나타납니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/42-key-list-window.png" alt="하단 Key 후보 리스트" className="manual-img" />
                    <div className="manual-figcaption">하단 Key 리스트 창에서는 신뢰도가 높은 으뜸음 및 조성 후보들을 목록으로 제안합니다.</div>
                  </div>

                  <h3 className="manual-h3">③ Key 설정 적용</h3>
                  <p className="manual-p">원하는 키 후보를 선택하거나, 패널 내의 <strong>+</strong> / <strong>-</strong> 버튼을 클릭해 원하는 반음(Semitones, 최대 ±6) 오프셋을 설정한 뒤 <strong>APPLY</strong> 버튼을 누르면 프로젝트의 기준 키가 세션에 등록됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/43-key-applied.png" alt="APPLY 적용 후의 Key 표시" className="manual-img" />
                    <div className="manual-figcaption">APPLY 적용 후 Key 표시창의 <strong>앞부분</strong>에 분석/지정된 원곡 키(예: <code>Ab</code>)가 표시됩니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/44-key-settings-change.png" alt="오프셋 변경 후 APPLY된 화면" className="manual-img" />
                    <div className="manual-figcaption">설정 패널에서 <code>+1</code> 반음과 같이 키 오프셋을 변경하고 APPLY 버튼을 눌러 적용을 완료한 화면입니다.</div>
                  </div>

                  <h3 className="manual-h3">④ 실시간 이조 재생 (Vari Key)</h3>
                  <p className="manual-p">Key 표시기 오른쪽의 <strong>Vari Key</strong> 스위치를 <strong>켜면</strong>, 사용자가 변경한 조(Key)의 피치가 재생 엔진에 즉각 반영되어 음높이가 실시간으로 변조(Pitch Shift)되어 플레이됩니다. 스위치를 끄면 원래 녹음된 피치 그대로 재생됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/45-vari-key-on.png" alt="Vari Key 기능을 켠 화면" className="manual-img" />
                    <div className="manual-figcaption">Vari Key 스위치를 켜면 재생 Key(뒤쪽 표시값)에 변경된 조가 적용되고, 재생 중인 음악의 키가 실시간으로 변합니다.</div>
                  </div>

                  <div className="manual-warning">
                    <strong>Vari BPM과 Vari Key 동시 적용 시 주의</strong><br />
                    Vari BPM과 Vari Key를 모두 켜서 템포와 음높이를 동시에 크게 조절하는 경우, 실시간 타임 스트레칭 및 피치 변조 처리가 겹치게 됩니다. 이로 인해 연산 부하가 증가하거나 재생 오디오에 과도한 소리 왜곡(Artifact)이 생길 수 있으므로, 적절한 범위 안에서 조절하는 것을 권장합니다.
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/46-vari-bpm-key-warning.png" alt="BPM 및 Key 동시 변경 경고 화면" className="manual-img" />
                    <div className="manual-figcaption">Vari BPM과 Vari Key 스위치가 동시에 활성화된 상태입니다. 과도한 이조와 템포 변경은 음질 왜곡을 유발할 수 있습니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">6. Key Display & Settings</h2>
                  <p className="manual-p">FocusDAW Studio analyzes the harmonic content of all loaded audio tracks to estimate the song's original key and lets you shift the pitch up or down in semitones (up to ±6 semitones) for real-time key-shifted playback. When a new session is opened, the Key indicator reads <strong>---</strong>.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/39-key-indicator-initial.png" alt="Key indicator initial state" className="manual-img" />
                    <div className="manual-figcaption">The initial state of the Key indicator in the top toolbar. It displays <code>---</code> when no key is set.</div>
                  </div>

                  <h3 className="manual-h3">1. Open Key Settings Panel</h3>
                  <p className="manual-p">Click the Key indicator in the toolbar to expand the Key settings panel. You can toggle the panel open and closed by clicking it, and it will close automatically 5 seconds after the mouse pointer leaves the panel area.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/40-key-panel-opened.png" alt="Key settings panel opened" className="manual-img" />
                    <div className="manual-figcaption">The Key settings panel opened by clicking the Key indicator.</div>
                  </div>

                  <h3 className="manual-h3">2. Key Detection</h3>
                  <p className="manual-p">Click the <strong>Detect</strong> button in the panel to run a comprehensive harmonic analysis (STFT-based chromagram) across all active audio tracks. Once the analysis is complete, the estimated candidate keys will be displayed at the bottom of the panel.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/41-key-detected.png" alt="Key detection complete" className="manual-img" />
                    <div className="manual-figcaption">Clicking Detect switches the button to an <code>Analyzing...</code> state, then reveals the detected key details.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/42-key-list-window.png" alt="Key candidate list" className="manual-img" />
                    <div className="manual-figcaption">The key candidate list at the bottom suggests the most probable tonic and scale options.</div>
                  </div>

                  <h3 className="manual-h3">3. Applying Key Settings</h3>
                  <p className="manual-p">Select your preferred candidate key, or use the <strong>+</strong> / <strong>-</strong> buttons to adjust the semitones offset (up to ±6 semitones), then click <strong>APPLY</strong> to write the reference key to the project.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/43-key-applied.png" alt="Key indicator showing applied key" className="manual-img" />
                    <div className="manual-figcaption">After clicking APPLY, the estimated/selected key is displayed in the <strong>left</strong> portion of the Key indicator (e.g. <code>Ab</code>).</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/44-key-settings-change.png" alt="Offset changed and applied" className="manual-img" />
                    <div className="manual-figcaption">Changing the key offset (e.g. to <code>+1</code> semitone) and applying the changes.</div>
                  </div>

                  <h3 className="manual-h3">4. Real-time Pitch Shifting (Vari Key)</h3>
                  <p className="manual-p">Enable the <strong>Vari Key</strong> switch next to the Key indicator to apply your pitch shifts directly to the playback engine in real-time. Turning the switch off reverts the playback pitch back to the original recorded audio state.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/45-vari-key-on.png" alt="Vari Key switch turned on" className="manual-img" />
                    <div className="manual-figcaption">Enabling Vari Key updates the playback key (the right value) and shifts the pitch of the playing music in real-time.</div>
                  </div>

                  <div className="manual-warning">
                    <strong>Caution when combining Vari BPM and Vari Key</strong><br />
                    If both Vari BPM and Vari Key are enabled to make significant changes to both tempo and pitch at the same time, the combined real-time time-stretching and pitch-shifting processing will run concurrently. This can increase CPU overhead or cause audibly noticeable sound artifacts, so we recommend keeping adjustments within moderate ranges.
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/46-vari-bpm-key-warning.png" alt="Vari BPM and Vari Key active warning" className="manual-img" />
                    <div className="manual-figcaption">Both Vari BPM and Vari Key enabled at the same time. Excessive stretching and shifting may degrade audio quality.</div>
                  </div>
                </>
              )}
            </section>

            {/* 7. 볼륨 오토메이션 / Volume Automation */}
            <section id="automation" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">7. 볼륨 오토메이션</h2>
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
                    <img src="manual/live-screens/11-vol-auto-on.png" alt="VOL AUTO를 켠 화면" className="manual-img" />
                    <div className="manual-figcaption">VOL AUTO를 켜면 해당 트랙 위에 노란 볼륨 오토메이션 레인이 표시됩니다. 트랙 크기가 L일 때 Reset과 Curve 버튼도 함께 보입니다.</div>
                  </div>

                  <h3 className="manual-h3">포인트 조정</h3>
                  <p className="manual-p">오토메이션 선 위를 클릭해 포인트를 추가하고, 포인트를 드래그해 볼륨 변화 시점과 크기를 조절합니다. 아래로 내린 구간은 소리가 작아지고, 위로 올린 구간은 원래 볼륨에 가깝게 재생됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/12-vol-auto-edited.png" alt="볼륨 오토메이션을 조정한 화면" className="manual-img" />
                    <div className="manual-figcaption">여러 포인트를 배치해 구간별 볼륨을 조정한 화면입니다. 점과 선의 형태가 그대로 재생 및 내보내기에 적용됩니다.</div>
                  </div>

                  <h3 className="manual-h3">Curve 적용</h3>
                  <p className="manual-p"><strong>Curve</strong>를 켜면 포인트 사이가 직선이 아니라 부드러운 곡선으로 이어집니다. 급격한 볼륨 변화보다 자연스러운 페이드나 강조를 만들 때 유용합니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/13-vol-auto-curve.png" alt="볼륨 오토메이션 Curve 기능을 켠 화면" className="manual-img" />
                    <div className="manual-figcaption">Curve 기능을 켠 화면입니다. 점선은 기준 직선이고, 실제 적용 곡선은 부드럽게 보정되어 표시됩니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">7. Volume Automation</h2>
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
                    <img src="manual/live-screens/11-vol-auto-on.png" alt="Automation Lane Enabled" className="manual-img" />
                    <div className="manual-figcaption">Volume automation lane enabled on a track. Reset and Curve options are visible when track size is L.</div>
                  </div>

                  <h3 className="manual-h3">Adjusting Levels</h3>
                  <p className="manual-p">Add points and adjust them to shape volume over time. Pulling the line down attenuates volume, while dragging it up approaches original volume.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/12-vol-auto-edited.png" alt="Edited Automation Curve" className="manual-img" />
                    <div className="manual-figcaption">A customized automation curve. Point values and curves are applied to playback and exported mixdowns.</div>
                  </div>

                  <h3 className="manual-h3">Applying Smooth Curves</h3>
                  <p className="manual-p">Enabling **Curve** shapes the paths between points with smooth bezier curves. This is useful for creating organic fade-ins, fade-outs, or natural volume rises.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/13-vol-auto-curve.png" alt="Bezier Curve Automation" className="manual-img" />
                    <div className="manual-figcaption">Automation curves enabled. Dotted lines show linear references, while the solid line represents the active curve.</div>
                  </div>
                </>
              )}
            </section>

            {/* 8. 믹서와 마스터 / Mixer & Master */}
            <section id="mixer" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">8. 믹서와 마스터</h2>
                  <p className="manual-p">상단 오른쪽의 <strong>Mixer</strong> 버튼을 누르면 떠 있는 믹서 창이 열립니다. 믹서 창은 제목 표시줄을 드래그해 위치를 옮길 수 있습니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/04-mixer-master.png" alt="FocusDAW Studio 믹서 화면" className="manual-img" />
                    <div className="manual-figcaption">실제 앱에서 연 믹서 창입니다. 각 트랙의 채널 스트립과 오른쪽 MASTER 패널로 구성됩니다.</div>
                  </div>

                  <h3 className="manual-h3">채널 스트립</h3>
                  <ul className="manual-ul">
                    <li className="manual-li"><strong>VRB</strong>: 트랙 리버브 전송량을 조절합니다.</li>
                    <li className="manual-li"><strong>ECHO</strong>: 트랙 에코/딜레이 전송량을 조절합니다.</li>
                    <li className="manual-li"><strong>S/M</strong>: Solo와 Mute를 전환합니다.</li>
                    <li className="manual-li"><strong>PAN</strong>: 좌우 위치를 조정합니다.</li>
                    <li className="manual-li"><strong>Fader</strong>: 트랙 볼륨을 세로 페이더로 조절합니다.</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/live-screens/14-mixer-pan-gain-detail.png" alt="Mixer PAN 기능과 볼륨 Gain 조정 상세" className="manual-img" />
                    <div className="manual-figcaption">믹서 상세 화면입니다. 각 채널의 PAN 값과 하단 dB 값으로 좌우 위치와 볼륨 Gain 조정 상태를 확인할 수 있습니다.</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/15-mixer-pan-gain-full.png" alt="Mixer PAN 기능과 볼륨 Gain 조정 전체 화면" className="manual-img" />
                    <div className="manual-figcaption">Arrange 화면 위에 믹서를 띄운 상태입니다. 타임라인 파형을 보면서 트랙별 PAN과 Gain을 동시에 조정할 수 있습니다.</div>
                  </div>

                  <h3 className="manual-h3">MASTER 패널</h3>
                  <p className="manual-p">MASTER 패널은 최종 출력에 적용되는 설정입니다. 9밴드 Graphic EQ, FFT 또는 Level meter 보기, 마스터 볼륨, EQ 프리셋, 그리고 다섯 가지 <strong>OUTPUT EFFECTS</strong>(Reverb · Delay · Saturation · Widener · Exciter / Enhancer)를 제공합니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/16-mixer-eq-adjust.png" alt="믹서 EQ 조정 화면" className="manual-img" />
                    <div className="manual-figcaption">MASTER 패널의 EQ 조정 화면입니다. 60Hz부터 15kHz까지 각 포인트를 위아래로 움직여 저역, 중역, 고역의 성격을 조절합니다.</div>
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

                  <div className="manual-figure">
                    <img src="manual/live-screens/30-mixer-output-effects.png" alt="믹서 MASTER 패널의 새 OUTPUT EFFECTS" className="manual-img" />
                    <div className="manual-figcaption">믹서 MASTER 패널 하단의 OUTPUT EFFECTS입니다. 다섯 효과와 EQ 프리셋(Reset · POP · Classic · HIP HOP), 정밀 편집용 <strong>ADVANCED</strong> 버튼이 보입니다.</div>
                  </div>

                  <h3 className="manual-h3">OUTPUT FX 트랙</h3>
                  <p className="manual-p">타임라인 맨 아래의 OUTPUT FX 트랙은 Master 트랙 역할을 하며, 전체 믹스에 적용되는 페이드와 EQ/효과 상태를 보여줍니다. 이 트랙에서 Fade in/out 길이를 직접 조정할 수 있습니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/17-output-fx-fade-handles.png" alt="Output FX 트랙 Fade in/out 핸들" className="manual-img" />
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
                  <h2 className="manual-h2">8. Mixer & Master</h2>
                  <p className="manual-p">Click the <strong>Mixer</strong> button on the top right to open the floating mixer console. Drag its title bar to position it anywhere on the screen.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/04-mixer-master.png" alt="Mixer Panel Layout" className="manual-img" />
                    <div className="manual-figcaption">Floating Mixer window. Consists of track channel strips on the left and the MASTER panel on the right.</div>
                  </div>

                  <h3 className="manual-h3">Channel Strips</h3>
                  <ul className="manual-ul">
                    <li className="manual-li"><strong>VRB</strong>: Controls track Reverb effect send level.</li>
                    <li className="manual-li"><strong>ECHO</strong>: Controls track Echo/Delay effect send level.</li>
                    <li className="manual-li"><strong>S/M</strong>: Toggles Solo and Mute states.</li>
                    <li className="manual-li"><strong>PAN</strong>: Positions the track left or right in the stereo field.</li>
                    <li className="manual-li"><strong>Fader</strong>: A vertical slider for high-precision volume adjustments.</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/live-screens/14-mixer-pan-gain-detail.png" alt="Mixer Fader Detail" className="manual-img" />
                    <div className="manual-figcaption">Mixer strip detail showing PAN settings and exact volume values in decibels (dB).</div>
                  </div>

                  <div className="manual-figure">
                    <img src="manual/live-screens/15-mixer-pan-gain-full.png" alt="Mixer Floating View" className="manual-img" />
                    <div className="manual-figcaption">Floating Mixer active over the Arrange window. Allows adjusting levels and panning while viewing track waveforms.</div>
                  </div>

                  <h3 className="manual-h3">MASTER Panel</h3>
                  <p className="manual-p">The MASTER panel shapes the final stereo mixdown. It provides a 9-band Graphic EQ with FFT frequency spectrum or level meters, master volume, EQ presets, and five <strong>OUTPUT EFFECTS</strong> (Reverb, Delay, Saturation, Widener, and Exciter / Enhancer).</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/16-mixer-eq-adjust.png" alt="Master EQ Adjustments" className="manual-img" />
                    <div className="manual-figcaption">Shaping the 9-band Graphic EQ. Drag band points (60Hz to 15kHz) up or down to adjust Bass, Mids, and Treble.</div>
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

                  <div className="manual-figure">
                    <img src="manual/live-screens/30-mixer-output-effects.png" alt="New OUTPUT EFFECTS in the mixer MASTER panel" className="manual-img" />
                    <div className="manual-figcaption">The OUTPUT EFFECTS at the bottom of the mixer MASTER panel: five effects plus EQ presets (Reset · POP · Classic · HIP HOP) and the <strong>ADVANCED</strong> button.</div>
                  </div>

                  <h3 className="manual-h3">Master OUTPUT FX Track</h3>
                  <p className="manual-p">Located at the bottom of the timeline, the OUTPUT FX track represents the Master channel. Drag the handles on this track to shape master Fade-in and Fade-out curves directly.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/17-output-fx-fade-handles.png" alt="Master Fade Handles" className="manual-img" />
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
                  <h2 className="manual-h2">9. 고급 이펙트(Advanced Effects)</h2>
                  <p className="manual-p">상단 메뉴의 <strong>Advanced Effects</strong>에는 세 가지 전용 편집 창이 있습니다. 각 창은 마스터(프로젝트 전체) 출력에 적용되는 고급 효과를 넓은 화면에서 정밀하게 다루도록 만들어졌습니다.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/31-advanced-effects-menu.png" alt="Advanced Effects 메뉴" className="manual-img" />
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
                  <h2 className="manual-h2">9. Advanced Effects</h2>
                  <p className="manual-p">The top <strong>Advanced Effects</strong> menu opens three dedicated editing windows, each giving you a larger workspace to fine-tune advanced effects applied to the master (project-wide) output.</p>
                  <div className="manual-figure">
                    <img src="manual/live-screens/31-advanced-effects-menu.png" alt="Advanced Effects menu" className="manual-img" />
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
                  <h2 className="manual-h2">10. 믹스다운 내보내기</h2>
                  <p className="manual-p"><strong>Export</strong> 버튼 또는 <strong>Project &gt; Export...</strong> 메뉴를 누르면 Export mixdown 창이 열립니다. 실제 내보내기 창에서는 MP3와 WAV 중 하나를 고를 수 있습니다.</p>

                  <h3 className="manual-h3">Export 설정</h3>
                  <div className="manual-figure">
                    <img src="manual/live-screens/05-export-dialog.png" alt="Export mixdown 창" className="manual-img" />
                    <div className="manual-figcaption">실제 앱에서 연 Export mixdown 창입니다. 출력 형식, 비트레이트, 샘플레이트, Normalize, 오디오 태그를 설정합니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Format</th><td className="manual-td"><code>MP3</code> 또는 <code>WAV</code>를 선택합니다.</td></tr>
                      <tr><th className="manual-th">Bitrate</th><td className="manual-td">MP3 출력 시 192, 256, 320kbps 중에서 선택합니다.</td></tr>
                      <tr><th className="manual-th">Sample rate</th><td className="manual-td">44.1kHz 또는 48kHz로 렌더링합니다.</td></tr>
                      <tr><th className="manual-th">Normalize</th><td className="manual-td">스위치를 켜면 목표 음량(LUFS)에 맞춰 라우드니스 정규화를 적용합니다. -9(loud master), -12(loud), -14(streaming), -16(podcast), -23(broadcast) LUFS 중에서 목표를 고를 수 있습니다.</td></tr>
                      <tr><th className="manual-th">Keep pitch</th><td className="manual-td">Vari BPM으로 출력 템포를 바꿀 때 Export 파일에 피치 보존 Time Stretch를 적용합니다. Electron 데스크톱에서는 현재 <code className="manual-code">ffmpeg atempo</code> 기준선을 사용하며, 실시간 재생은 캐시형 Time Stretch 프리뷰를 사용합니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/live-screens/25-normalize-lufs.png" alt="Normalize LUFS 목표 선택" className="manual-img" />
                    <div className="manual-figcaption">Normalize를 켜면 목표 LUFS를 고르는 드롭다운이 나타납니다. 스트리밍 발매에는 -14 LUFS가 기본값입니다.</div>
                  </div>

                  <h3 className="manual-h3">Audio info 태그</h3>
                  <p className="manual-p">제목, 아티스트/작곡가, 앨범, 연도, 날짜를 입력할 수 있습니다. MP3 형식에서는 앨범 아트도 함께 넣을 수 있습니다. 프리셋 커버를 선택하거나 이미지 파일을 직접 고를 수 있습니다.</p>

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
                  <h2 className="manual-h2">10. Exporting Mixdown</h2>
                  <p className="manual-p">Click the <strong>Export</strong> button or go to <strong>Project &gt; Export...</strong> to open the Export dialog. The dialog supports exporting in either MP3 or WAV format.</p>

                  <h3 className="manual-h3">Export Settings</h3>
                  <div className="manual-figure">
                    <img src="manual/live-screens/05-export-dialog.png" alt="Export Dialog" className="manual-img" />
                    <div className="manual-figcaption">Export Mixdown window. Configure output format, bitrate, sample rate, normalization, and metadata tags.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Format</th><td className="manual-td">Choose <code>MP3</code> or <code>WAV</code> format.</td></tr>
                      <tr><th className="manual-th">Bitrate</th><td className="manual-td">Choose 192, 256, or 320kbps for MP3 compression quality.</td></tr>
                      <tr><th className="manual-th">Sample rate</th><td className="manual-td">Select 44.1kHz or 48kHz for output rendering.</td></tr>
                      <tr><th className="manual-th">Normalize</th><td className="manual-td">When enabled, applies loudness normalization to a target LUFS. Choose from -9 (loud master), -12 (loud), -14 (streaming), -16 (podcast), or -23 (broadcast) LUFS.</td></tr>
                      <tr><th className="manual-th">Keep pitch</th><td className="manual-td">Applies pitch-preserving Time Stretch to exported files when Vari BPM changes the output tempo. Electron desktop currently uses the <code className="manual-code">ffmpeg atempo</code> baseline; realtime playback uses a cached Time Stretch preview.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-figure">
                    <img src="manual/live-screens/25-normalize-lufs.png" alt="Normalize LUFS target" className="manual-img" />
                    <div className="manual-figcaption">Enabling Normalize reveals a LUFS target dropdown; -14 LUFS is the default for streaming releases.</div>
                  </div>

                  <h3 className="manual-h3">Audio Info Tags</h3>
                  <p className="manual-p">Enter Title, Artist/Composer, Album, Year, and Date tags. When exporting to MP3, you can embed Cover Art by choosing a preset cover or choosing a custom image file.</p>

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
                  <h2 className="manual-h2">11. 설정과 테마</h2>
                  <p className="manual-p">상단 메뉴의 <strong>Settings</strong>를 누르면 색상 테마를 변경하거나 분리된 믹서 창의 환경 설정을 관리할 수 있습니다.</p>
                  <ul className="manual-ul" style={{ paddingLeft: 20, margin: "10px 0", fontSize: 13, color: "var(--dim)" }}>
                    <li style={{ marginBottom: 6 }}><strong>Color Theme (색상 테마)</strong>: 다양한 색상 테마 중 하나를 선택하면 앱 전체와 믹서 콘솔의 외관 색상이 즉시 연동되어 바뀝니다.</li>
                    <li style={{ marginBottom: 6 }}><strong>Mixer Console Window (믹서 위치 및 크기 초기화)</strong>: 믹서의 위치를 드래그하여 화면 구석으로 치워두었거나 크기를 크게 늘렸던 정보를 초기 상태로 되돌리고 싶다면 <strong>Reset Position</strong> 버튼을 누르십시오. 믹서 창의 좌표와 크기 기억 값이 디폴트 상태로 깨끗이 지워져 다음 오픈 시 다시 화면 중앙에 나타나게 됩니다.</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/live-screens/06-settings-themes.png" alt="색상 테마 및 설정 화면" className="manual-img" />
                    <div className="manual-figcaption">실제 앱에서 연 Settings 창입니다. 10가지 색상 테마(Warm Analog, Classical Ivory, Modern Blue 등)와 믹서 리셋 항목이 표시됩니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">11. Settings &amp; Themes</h2>
                  <p className="manual-p">Click <strong>Settings</strong> in the menu bar to change color themes or manage settings for the detached Mixer window.</p>
                  <ul className="manual-ul" style={{ paddingLeft: 20, margin: "10px 0", fontSize: 13, color: "var(--dim)" }}>
                    <li style={{ marginBottom: 6 }}><strong>Color Theme</strong>: Choose from multiple color themes. The visual styles of the main window and Mixer console update instantly.</li>
                    <li style={{ marginBottom: 6 }}><strong>Mixer Console Window</strong>: If you need to restore the Mixer window size and screen coordinates to their default settings, click the <strong>Reset Position</strong> button. The cached window bounds will be cleared, causing the Mixer window to reappear in the center of the screen on the next open.</li>
                  </ul>

                  <div className="manual-figure">
                    <img src="manual/live-screens/06-settings-themes.png" alt="Settings Dialog" className="manual-img" />
                    <div className="manual-figcaption">Settings window. Switch between 10 color themes (Warm Analog, Classical Ivory, Modern Blue, and more) and reset the Mixer window bounds.</div>
                  </div>
                </>
              )}
            </section>

            {/* 12. 단축키 / Shortcuts */}
            <section id="shortcuts" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">12. 단축키</h2>
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
                </>
              ) : (
                <>
                  <h2 className="manual-h2">12. Shortcuts</h2>
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
                </>
              )}
            </section>

            {/* 13. 문제 해결 / Troubleshooting */}
            <section id="tips" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">13. 문제 해결</h2>
                  <h3 className="manual-h3">오디오가 들리지 않을 때</h3>
                  <ul className="manual-ul">
                    <li className="manual-li">트랙의 <strong>M</strong> 버튼이 켜져 있지 않은지 확인합니다.</li>
                    <li className="manual-li">다른 트랙의 <strong>S</strong> 버튼이 켜져 있으면 Solo가 켜진 트랙만 들립니다.</li>
                    <li className="manual-li">트랙 볼륨과 마스터 볼륨이 너무 낮지 않은지 확인합니다.</li>
                    <li className="manual-li">운영체제의 출력 장치와 볼륨을 확인합니다.</li>
                  </ul>

                  <h3 className="manual-h3">프로젝트를 열었는데 NO AUDIO가 보일 때</h3>
                  <p className="manual-p">원본 오디오 파일의 위치가 바뀌었을 가능성이 큽니다. 같은 파일을 다시 가져오면 앱이 누락된 트랙을 파일 이름 또는 경로 기준으로 재연결합니다.</p>

                  <h3 className="manual-h3">MP3 저장이 실패할 때</h3>
                  <p className="manual-p">데스크톱 앱은 내부적으로 ffmpeg를 사용해 MP3를 인코딩합니다. 개발 환경에서 문제가 있으면 의존성이 설치되어 있는지 확인한 뒤 <code className="manual-code">npm install</code>을 다시 실행하세요. 브라우저에서 직접 실행하는 경우에는 lamejs가 로드되어야 MP3 인코딩이 가능합니다.</p>

                  <h3 className="manual-h3">화면이 너무 좁을 때</h3>
                  <p className="manual-p">FocusDAW Studio의 최소 창 크기는 1258x600입니다. 믹서나 Export 창이 좁게 보이면 창을 넓히거나 타임라인을 스크롤해 필요한 영역을 확인하세요.</p>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">13. Troubleshooting</h2>
                  <h3 className="manual-h3">No Sound During Playback</h3>
                  <ul className="manual-ul">
                    <li className="manual-li">Check if the track **M** (Mute) button is turned on.</li>
                    <li className="manual-li">Check if another track has its **S** (Solo) button active (which mutes all other tracks).</li>
                    <li className="manual-li">Check track faders and master volume fader levels.</li>
                    <li className="manual-li">Verify system audio output device settings and volume levels.</li>
                  </ul>

                  <h3 className="manual-h3">NO AUDIO displays after loading a project</h3>
                  <p className="manual-p">This occurs when source audio files have been moved or deleted. Re-importing matching audio files will let the app auto-reconnect them.</p>

                  <h3 className="manual-h3">MP3 Render Fails</h3>
                  <p className="manual-p">The desktop app uses ffmpeg internally to encode MP3s. In a development environment, run <code className="manual-code">npm install</code> to restore dependencies. In a standalone browser, lamejs must be loaded to support MP3 exports.</p>

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
  range: "v1.17.4 - v1.17.10",
  date: "2026-07-08",
  features: [
    "Added the Source/Clip project model with schemaVersion 2, track kind, locked-to-zero file tracks, sources, clips, and takes metadata.",
    "Added project file drag and drop, so .focus files can be opened directly from the arrange view.",
    "Added a dedicated Save As... command while keeping Save Project for the current project path.",
    "Added file-track fold and unfold workflow with a collapsed waveform overlay for dense stem sessions.",
  ],
  improvements: [
    "Improved project audio reconnection: missing placeholders reconnect only by original file path or explicit track id, while same-name files from another folder import as new tracks.",
    "Improved native engine project switching by clearing stale native tracks and pending loads before a new project is imported.",
    "Improved hot-loaded file playback sync so decoded tracks join the current transport position with a short fade-in.",
    "Refined track scrolling and file-track overlay rendering for cleaner, more stable arrange navigation.",
    "NO AUDIO tracks now keep BPM Source, Solo, and Mute controls disabled until audio is re-linked.",
  ],
  fixes: [
    "Fixed hidden previous-project audio continuing to play after opening another project.",
    "Fixed repeated native File not found retries for missing placeholder paths during project import.",
    "Fixed NO AUDIO Solo state causing UI mute indicators and actual playback to disagree.",
    "Fixed newly imported audio from a different folder becoming NO AUDIO after saving and reopening.",
    "Fixed Save Project opening the save dialog when the project name and .focus file name differed.",
    "Fixed an Electron first-repeat handover case where the playhead could jump to the loop start unexpectedly.",
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
