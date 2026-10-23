@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set PORT=8777
set TITLE=ZOS-R-Server

echo.
echo   ==========================================================
echo     生化危机模拟器  ZOS-R
echo     一键重启 ^& 启动      http://127.0.0.1:%PORT%/
echo   ==========================================================
echo.

if not exist "index.html" (
    echo   [x] 当前目录找不到 index.html
    echo       请把这个 bat 放在项目根目录（和 index.html 同级）
    echo.
    pause
    exit /b 1
)
if not exist "data\city.json" (
    echo   [!] 警告：data\city.json 不存在，游戏会提示缺少城市数据
    echo.
)

set PY=
where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py
if not defined PY (
    echo   [x] 找不到 Python，请先安装 Python 3 并勾选 Add to PATH
    echo.
    pause
    exit /b 1
)

set KILLED=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    if not "%%P"=="0" (
        taskkill /F /PID %%P /T >nul 2>&1
        set KILLED=1
    )
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*http.server %PORT%*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }" >nul 2>&1

if "!KILLED!"=="1" (
    echo   [1/4] 已停止旧服务，端口 %PORT% 已释放
) else (
    echo   [1/4] 端口 %PORT% 空闲，无需停止
)

ping -n 2 -w 300 127.0.0.1 >nul

start "%TITLE%" /min %PY% -m http.server %PORT% --bind 127.0.0.1
echo   [2/4] 新服务已启动，等待端口就绪...

set OK=0
for /l %%I in (1,1,50) do (
    if "!OK!"=="0" (
        netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1 && set OK=1
        if "!OK!"=="0" ping -n 1 -w 200 127.0.0.1 >nul
    )
)
if "!OK!"=="0" (
    echo   [x] 端口 %PORT% 15 秒内没有就绪，启动失败
    echo       看看任务栏里 ZOS-R-Server 窗口的报错信息
    echo.
    pause
    exit /b 1
)
echo   [3/4] 端口 %PORT% 就绪 OK

if not defined ZOS_NOBROWSER (
    set "STAMP=!RANDOM!!RANDOM!!RANDOM!"
    start "" "http://127.0.0.1:%PORT%/index.html?v=!STAMP!"
    echo   [4/4] 已打开浏览器（URL 带随机串，强制拉新文件）
) else (
    echo   [4/4] 跳过打开浏览器
)

echo.
echo   ----------------------------------------------------------
echo     地址 : http://127.0.0.1:%PORT%/
echo     停止 : 关掉任务栏里的 ZOS-R-Server 窗口，或再双击本文件
echo     提示 : 若画面像是旧的，浏览器里按 Ctrl + F5 强刷
echo   ----------------------------------------------------------
echo.
if defined ZOS_NOWAIT exit /b 0
timeout /t 4 >nul
exit /b 0
