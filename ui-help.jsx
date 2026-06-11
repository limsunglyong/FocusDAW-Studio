/* ================= FocusDAW — Help Dialog (Manual) + About Dialog ================= */

function HelpDialog({ onClose }) {
  const scrollContainerRef = React.useRef(null);
  const [lang, setLang] = React.useState(() => localStorage.getItem("focusdaw-manual-lang") || "ko");
  const [activeSection, setActiveSection] = React.useState("overview");

  const changeLang = (l) => {
    setLang(l);
    localStorage.setItem("focusdaw-manual-lang", l);
  };

  const sections = lang === "ko" ? [
    { id: "overview", label: "1. 앱 개요" },
    { id: "start", label: "2. 시작과 프로젝트" },
    { id: "import", label: "3. 오디오 가져오기" },
    { id: "arrange", label: "4. 타임라인과 트랙" },
    { id: "automation", label: "5. 볼륨 오토메이션" },
    { id: "mixer", label: "6. 믹서와 마스터" },
    { id: "export", label: "7. 믹스다운 내보내기" },
    { id: "settings", label: "8. 설정과 테마" },
    { id: "shortcuts", label: "9. 단축키" },
    { id: "tips", label: "10. 문제 해결" },
  ] : [
    { id: "overview", label: "1. App Overview" },
    { id: "start", label: "2. Start & Projects" },
    { id: "import", label: "3. Importing Audio" },
    { id: "arrange", label: "4. Timeline & Tracks" },
    { id: "automation", label: "5. Volume Automation" },
    { id: "mixer", label: "6. Mixer & Master" },
    { id: "export", label: "7. Exporting Mixdown" },
    { id: "settings", label: "8. Settings & Themes" },
    { id: "shortcuts", label: "9. Shortcuts" },
    { id: "tips", label: "10. Troubleshooting" },
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

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      
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
      `}</style>

      <div style={{ background: "var(--bg2)", border: "1px solid var(--line-strong)", borderRadius: 14, width: 960, maxWidth: "95vw", height: "82vh", maxHeight: "720px", display: "flex", flexDirection: "column", boxShadow: "var(--shadow)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={24} />
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {lang === "ko" ? "FocusDAW Studio 사용자 메뉴얼" : "FocusDAW Studio User Manual"}
            </div>
            <div className="mono" style={{ fontSize: 10, border: "1px solid var(--line)", padding: "1px 6px", borderRadius: 4, color: "var(--dim)" }}>v0.16.21</div>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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
          <div style={{ width: 220, borderRight: "1px solid var(--line)", overflowY: "auto", padding: "14px 10px", background: "var(--bg)" }}>
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
            className="manual-container"
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

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">New Project</th><td className="manual-td">현재 세션을 비우고 새 프로젝트를 시작합니다.</td></tr>
                      <tr><th className="manual-th">Open Project...</th><td className="manual-td">저장된 <code className="manual-code">.focus</code> 프로젝트 파일을 엽니다.</td></tr>
                      <tr><th className="manual-th">Save Project</th><td className="manual-td">현재 프로젝트 상태를 <code className="manual-code">.focus</code> 파일로 저장합니다. 트랙 설정, 마스터 설정, 오토메이션, 클립 정보가 저장됩니다.</td></tr>
                      <tr><th className="manual-th">Import Stem Folder...</th><td className="manual-td">선택한 폴더의 루트에 있는 오디오 파일을 한 번에 등록합니다.</td></tr>
                      <tr><th className="manual-th">Import Audio Files...</th><td className="manual-td">개별 오디오 파일을 여러 개 선택해 트랙으로 추가합니다.</td></tr>
                      <tr><th className="manual-th">Load Demo Session</th><td className="manual-td">Drums, Bass, Keys, Lead 데모 트랙을 불러와 앱 기능을 시험합니다.</td></tr>
                      <tr><th className="manual-th">Export MP3...</th><td className="manual-td">믹스다운 내보내기 창을 엽니다. 실제 창에서는 MP3와 WAV를 선택할 수 있습니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-note">프로젝트 이름은 상단 오른쪽의 프로젝트 이름 영역을 클릭해 바로 수정할 수 있습니다. 저장 시 파일 이름의 기준으로도 사용됩니다.</div>
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

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">New Project</th><td className="manual-td">Clears the current session and creates a fresh project.</td></tr>
                      <tr><th className="manual-th">Open Project...</th><td className="manual-td">Opens an existing <code className="manual-code">.focus</code> project file.</td></tr>
                      <tr><th className="manual-th">Save Project</th><td className="manual-td">Saves the current session state to a <code className="manual-code">.focus</code> file, including track parameters, master effects, automation curves, and clip locations.</td></tr>
                      <tr><th className="manual-th">Import Stem Folder...</th><td className="manual-td">Imports and creates tracks for all audio files located in the root of the chosen folder.</td></tr>
                      <tr><th className="manual-th">Import Audio Files...</th><td className="manual-td">Opens a file selector to add multiple individual audio files as tracks.</td></tr>
                      <tr><th className="manual-th">Load Demo Session</th><td className="manual-td">Loads a pre-configured multi-track demo session (Drums, Bass, Keys, Lead) to test the app features.</td></tr>
                      <tr><th className="manual-th">Export MP3...</th><td className="manual-td">Opens the mixdown export dialog (supports MP3 and WAV export formats).</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-note">The project name can be renamed instantly by clicking the project title field on the top right. This name is also used as the default filename when saving.</div>
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
                      <tr><th className="manual-th">S 버튼</th><td className="manual-td">해당 트랙만 듣는 Solo 기능입니다. Solo가 켜진 트랙이 있으면 다른 트랙은 자동으로 들리지 않습니다.</td></tr>
                      <tr><th className="manual-th">M 버튼</th><td className="manual-td">해당 트랙을 음소거합니다.</td></tr>
                      <tr><th className="manual-th">레벨 미터</th><td className="manual-td">트랙의 현재 출력 레벨을 표시합니다.</td></tr>
                      <tr><th className="manual-th">삭제 버튼</th><td className="manual-td">트랙을 제거합니다. 확인 창에서 삭제를 확정해야 합니다.</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-warning">트랙 삭제와 오토메이션 초기화는 확인 후 즉시 적용됩니다. 필요하면 삭제 전에 프로젝트를 저장해 두세요.</div>
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
                      <tr><th className="manual-th">S Button</th><td className="manual-td">Solos the track (mutes all other non-soloed tracks).</td></tr>
                      <tr><th className="manual-th">M Button</th><td className="manual-td">Mutes the track.</td></tr>
                      <tr><th className="manual-th">Level Meter</th><td className="manual-td">Displays real-time playback output levels.</td></tr>
                      <tr><th className="manual-th">Delete Button</th><td className="manual-td">Deletes the track from the project (requires confirmation).</td></tr>
                    </tbody>
                  </table>

                  <div className="manual-warning">Track deletion and automation resets take effect immediately after confirmation. Save your project first if you are unsure.</div>
                </>
              )}
            </section>

            {/* 5. 볼륨 오토메이션 / Volume Automation */}
            <section id="automation" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">5. 볼륨 오토메이션</h2>
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
                  <h2 className="manual-h2">5. Volume Automation</h2>
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

            {/* 6. 믹서와 마스터 / Mixer & Master */}
            <section id="mixer" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">6. 믹서와 마스터</h2>
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
                  <p className="manual-p">MASTER 패널은 최종 출력에 적용되는 설정입니다. 9밴드 Graphic EQ, FFT 또는 Level meter 보기, 마스터 볼륨, 마스터 리버브/에코, EQ 프리셋을 제공합니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/16-mixer-eq-adjust.png" alt="믹서 EQ 조정 화면" className="manual-img" />
                    <div className="manual-figcaption">MASTER 패널의 EQ 조정 화면입니다. 60Hz부터 15kHz까지 각 포인트를 위아래로 움직여 저역, 중역, 고역의 성격을 조절합니다.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Graphic EQ · FFT</th><td className="manual-td">스펙트럼 배경 위에 EQ 곡선을 표시합니다. 각 밴드 포인트를 드래그해 -12dB부터 +12dB까지 조절합니다.</td></tr>
                      <tr><th className="manual-th">Level meter</th><td className="manual-td">주파수 대역별 레벨 미터를 표시합니다. EQ 포인트 오버레이도 함께 조작할 수 있습니다.</td></tr>
                      <tr><th className="manual-th">EQ PRESET</th><td className="manual-td">Flat, Pop, Classic, HipHop 프리셋을 바로 적용합니다.</td></tr>
                      <tr><th className="manual-th">Output Effects</th><td className="manual-td">최종 출력에 Reverb와 Echo / Delay를 추가합니다.</td></tr>
                    </tbody>
                  </table>

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
                  <h2 className="manual-h2">6. Mixer & Master</h2>
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
                  <p className="manual-p">The MASTER panel shapes the final stereo mixdown. It provides a 9-band Graphic EQ with FFT frequency spectrum or level meters, master volume, output effects (Reverb, Echo), and EQ presets.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/16-mixer-eq-adjust.png" alt="Master EQ Adjustments" className="manual-img" />
                    <div className="manual-figcaption">Shaping the 9-band Graphic EQ. Drag band points (60Hz to 15kHz) up or down to adjust Bass, Mids, and Treble.</div>
                  </div>

                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th">Graphic EQ / FFT</th><td className="manual-td">Displays the EQ curve over a real-time FFT spectrum background. Drag points to adjust gain from -12dB to +12dB.</td></tr>
                      <tr><th className="manual-th">Level meters</th><td className="manual-td">Displays real-time level bars for each frequency range alongside EQ controls.</td></tr>
                      <tr><th className="manual-th">EQ PRESETS</th><td className="manual-td">Instantly applies preset curves: Flat, Pop, Classic, and HipHop.</td></tr>
                      <tr><th className="manual-th">Output Effects</th><td className="manual-td">Applies global Reverb and Echo/Delay to the master stereo bus.</td></tr>
                    </tbody>
                  </table>

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

            {/* 7. 믹스다운 내보내기 / Exporting Mixdown */}
            <section id="export" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">7. 믹스다운 내보내기</h2>
                  <p className="manual-p"><strong>Export MP3</strong> 버튼 또는 <strong>Project &gt; Export MP3...</strong> 메뉴를 누르면 Export mixdown 창이 열립니다. 실제 내보내기 창에서는 MP3와 WAV 중 하나를 고를 수 있습니다.</p>

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
                      <tr><th className="manual-th">Normalize</th><td className="manual-td">최종 출력이 과도하게 커지지 않도록 렌더링 단계에서 정규화/리미팅을 적용합니다.</td></tr>
                    </tbody>
                  </table>

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
                  <h2 className="manual-h2">7. Exporting Mixdown</h2>
                  <p className="manual-p">Click the <strong>Export MP3</strong> button or go to <strong>Project &gt; Export MP3...</strong> to open the Export dialog. The dialog supports exporting in either MP3 or WAV format.</p>

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
                      <tr><th className="manual-th">Normalize</th><td className="manual-td">Applies peak normalization and limiting during rendering to maximize volume without clipping.</td></tr>
                    </tbody>
                  </table>

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

            {/* 8. 설정과 테마 / Settings & Themes */}
            <section id="settings" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">8. 설정과 테마</h2>
                  <p className="manual-p">상단 메뉴의 <strong>Settings</strong>를 누르면 색상 테마를 변경할 수 있습니다. 선택한 테마는 로컬 저장소에 저장되어 다음 실행 때도 유지됩니다.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/06-settings-themes.png" alt="색상 테마 선택 화면" className="manual-img" />
                    <div className="manual-figcaption">실제 앱에서 연 Settings 창입니다. Warm Analog, Classical Ivory, Modern Blue, Forest Green 테마를 선택할 수 있습니다.</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">8. Settings & Themes</h2>
                  <p className="manual-p">Click <strong>Settings</strong> in the menu bar to change color themes. The selected theme is stored in local storage and is applied automatically on relaunch.</p>

                  <div className="manual-figure">
                    <img src="manual/live-screens/06-settings-themes.png" alt="Settings Dialog" className="manual-img" />
                    <div className="manual-figcaption">Settings window. Switch between Warm Analog, Classical Ivory, Modern Blue, and Forest Green themes.</div>
                  </div>
                </>
              )}
            </section>

            {/* 9. 단축키 / Shortcuts */}
            <section id="shortcuts" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">9. 단축키</h2>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Space</kbd></th><td className="manual-td">재생 / 일시정지</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">S</kbd></th><td className="manual-td">프로젝트 저장</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">O</kbd></th><td className="manual-td">프로젝트 열기</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">실행 취소</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Y</kbd></th><td className="manual-td">다시 실행</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Shift</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">다시 실행</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">S</kbd></th><td className="manual-td">선택/탐색 도구 선택. 현재 화면에서는 도구 UI가 숨겨져 있을 수 있습니다.</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">C</kbd></th><td className="manual-td">클립 자르기 도구 선택. 현재 화면에서는 도구 UI가 숨겨져 있을 수 있습니다.</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">J</kbd></th><td className="manual-td">클립 합치기 도구 선택. 현재 화면에서는 도구 UI가 숨겨져 있을 수 있습니다.</td></tr>
                    </tbody>
                  </table>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">9. Shortcuts</h2>
                  <table className="manual-table">
                    <tbody>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Space</kbd></th><td className="manual-td">Play / Pause</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">S</kbd></th><td className="manual-td">Save Project</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">O</kbd></th><td className="manual-td">Open Project</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">Undo</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Y</kbd></th><td className="manual-td">Redo</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">Ctrl</kbd> + <kbd className="manual-kbd">Shift</kbd> + <kbd className="manual-kbd">Z</kbd></th><td className="manual-td">Redo</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">S</kbd></th><td className="manual-td">Select Select/Seek tool. (May be hidden depending on UI context)</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">C</kbd></th><td className="manual-td">Select Split tool. (May be hidden depending on UI context)</td></tr>
                      <tr><th className="manual-th"><kbd className="manual-kbd">J</kbd></th><td className="manual-td">Select Join tool. (May be hidden depending on UI context)</td></tr>
                    </tbody>
                  </table>
                </>
              )}
            </section>

            {/* 10. 문제 해결 / Troubleshooting */}
            <section id="tips" className="manual-section">
              {lang === "ko" ? (
                <>
                  <h2 className="manual-h2">10. 문제 해결</h2>
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
                  <p className="manual-p">FocusDAW Studio의 최소 창 크기는 960x600입니다. 믹서나 Export 창이 좁게 보이면 창을 넓히거나 타임라인을 스크롤해 필요한 영역을 확인하세요.</p>
                </>
              ) : (
                <>
                  <h2 className="manual-h2">10. Troubleshooting</h2>
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
                  <p className="manual-p">The minimum window resolution is 960x600. Resize your window or scroll horizontally on the timeline to locate hidden elements.</p>
                </>
              )}
            </section>

            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 20 }}>
              {lang === "ko"
                ? "FocusDAW Studio 사용자 메뉴얼 · 작성 기준 버전 v0.16.20"
                : "FocusDAW Studio User Manual · Written for version v0.16.20"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutDialog({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 850 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--line-strong)", borderRadius: 14, width: 400, maxWidth: "95vw", padding: "32px 24px", textAlign: "center", boxShadow: "var(--shadow)", position: "relative" }}>
        
        {/* Close Button */}
        <button className="iconbtn" onClick={onClose} style={{ position: "absolute", top: 16, right: 20, fontSize: 18, lineHeight: 1 }}>×</button>

        {/* Logo */}
        <Logo size={80} style={{ margin: "0 auto 16px", boxShadow: "0 8px 24px rgba(0,0,0,.3)" }} />

        {/* App Info */}
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cream)", marginBottom: 4 }}>FocusDAW Studio</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--amber)", marginBottom: 24 }}>v0.16.21</div>

        <div style={{ borderTop: "1px solid var(--line)", padding: "16px 0", textAlign: "left", fontSize: 12.5, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>Developer</span>
            <span style={{ color: "var(--cream)", fontWeight: 500 }}>focustone</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>Platform</span>
            <span style={{ color: "var(--cream)", fontWeight: 500 }}>Electron / React / Web Audio API</span>
          </div>
        </div>

        {/* OK Button */}
        <button className="btn primary" onClick={onClose} style={{ marginTop: 24, minWidth: 100, height: 36, justifyContent: "center" }}>
          OK
        </button>
      </div>
    </div>
  );
}
