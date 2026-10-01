#!/bin/zsh
cd "${0:A:h}"
echo "请输入你的 OpenAI API Key。输入内容不会显示："
read -s API_KEY
echo
if [[ -z "$API_KEY" ]]; then echo "没有输入，配置已取消。"; exit 1; fi
{
  echo "OPENAI_API_KEY=$API_KEY"
  echo "OPENAI_MODEL=gpt-5.4-nano"
  echo "HOST=127.0.0.1"
  echo "PORT=8765"
} > .env
chmod 600 .env
echo "配置完成。现在可以双击 start-evertrace.command。"
read -k 1 "?按任意键关闭…"
