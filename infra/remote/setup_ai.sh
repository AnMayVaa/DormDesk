#!/bin/bash
# Runs ON ai-01 (Ubuntu 24.04, private subnet, 1 vCPU / 1 GB). Local LLM for the AI Insight feature:
# llama.cpp server + Qwen3-0.6B (Q4_K_M, ~400 MB, Apache-2.0). Only the API tier may call it (firewall + API key).
# env: LLM_API_KEY   usage: LLM_API_KEY=... bash setup_ai.sh
set -euo pipefail
LLAMA_TAG=${LLAMA_TAG:-b11207}
MODEL_URL=https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf
export DEBIAN_FRONTEND=noninteractive
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates libgomp1 >/dev/null; }
mkdir -p /opt/llm && cd /opt/llm
[ -x llama-$LLAMA_TAG/llama-server ] || { curl -sfL -o llama.tgz https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/llama-$LLAMA_TAG-bin-ubuntu-x64.tar.gz && tar xzf llama.tgz && rm llama.tgz; }
[ -s qwen3-0.6b-q4km.gguf ] || curl -sfL -o qwen3-0.6b-q4km.gguf "$MODEL_URL"
printf 'LLM_API_KEY=%s\n' "$LLM_API_KEY" > /opt/llm/.env; chmod 600 /opt/llm/.env
cat > /opt/llm/start.sh <<EOS
#!/bin/bash
# (no systemd in lab containers) start / restart the model server
. /opt/llm/.env
pkill -f "llama-server -m" 2>/dev/null || true; sleep 1
cd /opt/llm
nohup ./llama-$LLAMA_TAG/llama-server -m qwen3-0.6b-q4km.gguf --host 10.0.2.160 --port 8080 \\
  -c 2048 -t 1 --parallel 1 --api-key "\$LLM_API_KEY" --reasoning-budget 0 --no-webui \\
  >> /var/log/llm.log 2>&1 &
for i in \$(seq 1 60); do sleep 1; curl -sf http://10.0.2.160:8080/health >/dev/null && { echo LLM_OK; exit 0; }; done
echo "LLM did not start — see /var/log/llm.log"; exit 1
EOS
chmod 700 /opt/llm/start.sh
/opt/llm/start.sh
