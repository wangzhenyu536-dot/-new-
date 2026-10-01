#!/bin/zsh
cd "${0:A:h}"
PYTHON_BIN=""
for candidate in /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if [[ -x "$candidate" ]]; then PYTHON_BIN="$candidate"; break; fi
done
if [[ -z "$PYTHON_BIN" ]]; then
  echo "没有找到 Python 3。请先安装 Python 3，然后重新双击本文件。"
  read -k 1 "?按任意键关闭…"
  exit 1
fi
"$PYTHON_BIN" server.py

