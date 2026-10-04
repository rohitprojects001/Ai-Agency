# 🎙️ Mira — Your Free Mac Voice Assistant

Control your Mac with just your voice. Say **"Hey Mira"** to open apps, search the web, control volume, take screenshots, create notes, and much more.

**No API key required. No subscription. Runs completely locally using Ollama.**

---

# 🚀 Quick Start (Recommended)

Open Terminal and run:

```bash
cd mira-pro
bash setup.sh
```

The setup script will automatically:

* Install Ollama
* Install PortAudio
* Create a Python virtual environment
* Install all required Python packages
* Display the final instructions

Once the setup is complete, you can start Mira anytime with:

```bash
bash start.sh
```

---

# 📦 Manual Installation

## 1. Install Ollama

```bash
brew install ollama
ollama serve
```

Keep this terminal running.

Open a new Terminal window and download the AI model:

```bash
ollama pull llama3.2
```

---

## 2. Create the Python Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip3 install -r requirements.txt
```

---

## 3. Grant Microphone Permission

The first time you run Mira, macOS will ask for microphone access.

Click **Allow**.

---

## 4. Start Mira

Activate the virtual environment:

```bash
source .venv/bin/activate
```

Run Mira:

```bash
python3 mira.py
```

Or simply use:

```bash
bash start.sh
```

---

# 🎭 Optional Avatar

When Mira starts, you'll see something similar to:

```text
[Avatar] Open in Safari: http://localhost:8765
```

Open the link in Safari to see Mira's animated holographic avatar reacting in real time while listening, thinking, and speaking.

---

# 🎤 How to Use Mira

1. Say **"Hey Mira"**
2. Wait until Mira responds **"Yes?"**
3. Speak your command.

That's it! Mira is now ready to control your Mac using your voice.
