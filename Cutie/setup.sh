#!/bin/bash
# Mira - One-shot setup script
# Chalao: bash setup.sh

set -e

echo "🎙️  Mira Setup Shuru Ho Raha Hai..."
echo ""

# 1. Homebrew check
if ! command -v brew &> /dev/null; then
    echo "❌ Homebrew nahi mila. Pehle ye install karo: https://brew.sh"
    exit 1
fi
echo "✅ Homebrew mil gaya"

# 2. Ollama install
if ! command -v ollama &> /dev/null; then
    echo "📦 Ollama install kar raha hoon..."
    brew install ollama
else
    echo "✅ Ollama already installed hai"
fi

# 3. Portaudio (PyAudio ke liye zaruri)
if ! brew list portaudio &> /dev/null; then
    echo "📦 Portaudio install kar raha hoon..."
    brew install portaudio
else
    echo "✅ Portaudio already installed hai"
fi

# 4. Virtual environment banao
if [ ! -d ".venv" ]; then
    echo "📦 Python virtual environment bana raha hoon..."
    python3 -m venv .venv
else
    echo "✅ Virtual environment already hai"
fi

source .venv/bin/activate

# 5. Packages install (Python 3.14 compatibility fixes ke saath)
echo "📦 Python packages install kar raha hoon..."
pip3 install --upgrade pip -q
pip3 install -r requirements.txt -q
pip3 install setuptools standard-aifc standard-chunk audioop-lts -q 2>/dev/null || true

echo ""
echo "✅ Setup complete!"
echo ""
echo "Ab ye 2 kaam karo:"
echo "  1. Naye terminal tab me: ollama serve"
echo "  2. Model download karo (~2GB, one time): ollama pull llama3.2"
echo ""
echo "Uske baad Mira chalane ke liye:"
echo "  source .venv/bin/activate"
echo "  python3 mira.py"
