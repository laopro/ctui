@echo off
set CTUI_CWD=%CD%
"%~dp0..\node_modules\.bin\bun.cmd" --cwd "%~dp0.." src\index.tsx %*
