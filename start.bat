@echo off
set PORT=8008
set URL=http://localhost:%PORT%/studio.html

:: Python 서버 백그라운드 실행
start "" python -m http.server %PORT%

:: 포트 응답 대기 (최대 10초)
:WAIT
powershell -Command "try { (New-Object Net.Sockets.TcpClient('localhost', %PORT%)).Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto WAIT
)

:: 브라우저 열기
start "" %URL%
