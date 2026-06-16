@echo off
setlocal enabledelayedexpansion

echo [FocusDAW Build] Changing directory to script location...
cd /d "%~dp0"

echo [FocusDAW Build] Setting up MSVC Build Environment...
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to load MSVC Build Environment.
    exit /b %ERRORLEVEL%
)

echo [FocusDAW Build] Cleaning and creating build directory...
if exist build (
    rmdir /s /q build
)
mkdir build

cd build

echo [FocusDAW Build] Running CMake Configuration with JUCE_PATH...
cmake -A x64 -DJUCE_PATH="d:/roseWorks/programming/JUCE" ..

if %ERRORLEVEL% neq 0 (
    echo [ERROR] CMake configuration failed.
    exit /b %ERRORLEVEL%
)

echo [FocusDAW Build] Compiling C++ Native Audio Engine (Release config)...
cmake --build . --config Release

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Native build compilation failed.
    exit /b %ERRORLEVEL%
)

echo [FocusDAW Build] Compilation Succeeded. Copying binary to destination paths...
cd ..

if not exist "..\bin" (
    mkdir "..\bin"
)

copy /y "build\FocusDAW-AudioEngine_artefacts\Release\FocusDAW-AudioEngine.exe" "..\bin\FocusDAW-AudioEngine.exe"
if exist "..\dist\win-unpacked\resources\app.asar.unpacked\bin" (
    copy /y "build\FocusDAW-AudioEngine_artefacts\Release\FocusDAW-AudioEngine.exe" "..\dist\win-unpacked\resources\app.asar.unpacked\bin\FocusDAW-AudioEngine.exe"
)

echo [FocusDAW Build] Completed Successfully.
