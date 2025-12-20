@echo off
echo 🚀 GitHubへのアップロードを開始します...

:: 1. ファイルを追加
git add .

:: 2. コミット（日付と時刻をメッセージにします）
set datetime=%date% %time%
git commit -m "Update: %datetime%"

:: 3. GitHubへ送信
git push origin main

echo.
echo ✅ 更新が完了しました！
pause