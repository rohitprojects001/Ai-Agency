#!/usr/bin/env python3
"""
Mira - Tera Free Mac Voice Assistant
======================================
"Hey Mira" bolke activate karo, phir jo bolo wo Mac pe hoga.

Design: pehle fast fixed-commands try karta hai (turant response,
bina kisi wait ke). Agar wo match nahi kare, tabhi local free AI
(Ollama) se samjhne ki koshish karta hai. Isse zyada tar commands
turant respond karte hain, aur naye/unusual commands bhi handle ho
jaate hain.

Koi paid API key nahi chahiye. 100% free, 100% local.
"""

import subprocess
import json
import re
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

try:
    import requests
except Exception:
    requests = None

try:
    import speech_recognition as sr
except Exception:
    sr = None

import config

if sr is not None:
    recognizer = sr.Recognizer()
    mic = sr.Microphone()
else:
    recognizer = None
    mic = None

AVATAR_PORT = 8765
STATE = {"state": "idle", "text": ""}
STATE_LOCK = threading.Lock()


def set_state(state: str, text: str = ""):
    with STATE_LOCK:
        STATE["state"] = state
        STATE["text"] = text


class AvatarHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/status":
            with STATE_LOCK:
                payload = json.dumps(STATE).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)
            return

        path = self.path.lstrip("/") or "avatar_photo.html"
        content_types = {
            ".html": "text/html",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png",
        }
        ext = "." + path.split(".")[-1] if "." in path else ""
        try:
            mode = "rb"
            with open(path, mode) as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()


def start_avatar_server():
    server = HTTPServer(("localhost", AVATAR_PORT), AvatarHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[Avatar] Safari me kholo: http://localhost:{AVATAR_PORT}")


# ------------------------------ CORE I/O ------------------------------

def speak(text: str):
    print(f"[Mira] {text}")
    set_state("speaking", text)

    preferred_voices = []
    voice_aliases = getattr(config, "SPEECH_VOICE_ALIASES", {})
    if getattr(config, "SPEECH_VOICE", None):
        voice = config.SPEECH_VOICE
        preferred_voices.append(voice_aliases.get(str(voice).lower(), voice))
    for voice in getattr(config, "SPEECH_FALLBACK_VOICES", []):
        preferred_voices.append(voice_aliases.get(str(voice).lower(), voice))

    last_error = None
    for voice in preferred_voices:
        if not voice:
            continue
        try:
            cmd = ["say", "-v", voice]
            if getattr(config, "SPEECH_RATE", None):
                cmd.extend(["-r", str(config.SPEECH_RATE)])
            cmd.append(text)
            subprocess.run(cmd, check=True)
            break
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            last_error = exc
            continue
    else:
        try:
            subprocess.run(["say", text], check=False)
        except FileNotFoundError:
            print("[Speech] say command not available")
            last_error = None

    if last_error is not None:
        print(f"[Speech] selected voice unavailable, fell back to default: {last_error}")

    set_state("idle", "")


def calibrate_once():
    print("[Setup] Mic calibrate kar raha hoon...")
    with mic as source:
        recognizer.adjust_for_ambient_noise(source, duration=1)
    recognizer.dynamic_energy_threshold = True
    print("[Setup] Ready")


def listen(timeout=None, phrase_time_limit=6, debug_label="Heard"):
    with mic as source:
        try:
            audio = recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)
        except sr.WaitTimeoutError:
            return ""
    try:
        text = recognizer.recognize_google(audio, language=config.LISTEN_LANGUAGE)
        text = text.lower().strip()
        if text:
            print(f"[{debug_label}] {text}")
        return text
    except sr.UnknownValueError:
        return ""
    except sr.RequestError as e:
        print(f"[Speech recognition error] {e} (internet check karo)")
        return ""


def run_applescript(script: str):
    subprocess.run(["osascript", "-e", script])


def resolve_app(cmd: str):
    """Command me se koi known app name dhoondo."""
    for alias, real_name in config.APP_ALIASES.items():
        if alias in cmd:
            return real_name
    return None


# --------------------------- FAST FIXED COMMANDS ---------------------------
# Ye sab turant execute hote hain, koi AI/wait nahi lagta.

def try_fixed_commands(cmd: str) -> bool:
    """True return karega agar command yahin handle ho gaya."""

    if any(word in cmd for word in ["send a message", "send message", "message to", "whatsapp"]):
        if "whatsapp" in cmd or "message" in cmd:
            app = resolve_app("whatsapp")
            if app:
                # If user provided a phone number and optional text, open wa.me link to prefill chat
                phone_match = re.search(r"(\+?\d{7,15})", cmd)
                text_match = re.search(r"(?:text|message)\s+(.+)$", cmd)
                if phone_match:
                    phone = re.sub(r"\D", "", phone_match.group(1))
                    message = text_match.group(1).strip() if text_match else ""
                    url = f"https://wa.me/{phone}"
                    if message:
                        import urllib.parse
                        url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"
                    subprocess.run(["open", url])
                    speak("WhatsApp chat khol diya with the given number")
                    return True
                # Fallback: open WhatsApp app and let user send
                subprocess.run(["open", "-a", app])
                contact_match = re.search(r"to\s+([a-zA-Z0-9_ .-]+)", cmd)
                if contact_match:
                    contact = contact_match.group(1).strip()
                    speak(f"{contact} ke liye WhatsApp khol diya, tum ab message bhej sakte ho")
                else:
                    speak("WhatsApp khol diya, tum ab message bhej sakte ho")
                return True

    # Battery status
    if any(w in cmd for w in ["battery", "charge", "battery percent", "battery percentage", "battery status"]) or "how much battery" in cmd:
        try:
            out = subprocess.check_output(["pmset", "-g", "batt"]).decode()
            # Example: 'Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234567)\t95%; charging; 0:25 remaining present: true'
            m = re.search(r"(\d+)%", out)
            if m:
                pct = int(m.group(1))
                speak(f"Battery {pct} percent hai")
            else:
                speak("Battery status nahi mil paayi")
        except Exception as e:
            print(f"[Battery error] {e}")
            speak("Battery status nikalne mein problem aayi")
        return True

    # System status: CPU, memory, network
    if any(w in cmd for w in ["cpu", "memory", "ram", "disk", "network", "ip address", "ip", "status of my system", "system status"]):
        # CPU
        if "cpu" in cmd:
            try:
                out = subprocess.check_output(["top", "-l", "1", "-n", "0"]).decode()
                m = re.search(r"CPU usage:\s*([0-9., %a-zA-Z]+)", out)
                if m:
                    speak(f"{m.group(1)}")
                else:
                    # fallback: use grep line
                    for line in out.splitlines():
                        if "CPU usage" in line:
                            speak(line.strip())
                            break
            except Exception:
                speak("CPU usage nikalne mein problem aayi")
            return True

        # Memory
        if any(w in cmd for w in ["memory", "ram"]):
            try:
                out = subprocess.check_output(["vm_stat"]).decode()
                pages_free = re.search(r"Pages free:\s+(\d+)", out)
                pages_inactive = re.search(r"Pages inactive:\s+(\d+)", out)
                page_size_match = re.search(r"page size of (\d+) bytes", out)
                if pages_free and page_size_match:
                    free = int(pages_free.group(1)) * int(page_size_match.group(1))
                    free_mb = free // (1024 * 1024)
                    speak(f"Approximately {free_mb} MB free memory hai")
                else:
                    speak("Memory info nahi mil paayi")
            except Exception:
                speak("Memory status nikalne mein problem aayi")
            return True

        # Network / IP
        if any(w in cmd for w in ["ip", "network"]):
            try:
                out = subprocess.check_output(["ipconfig", "getifaddr", "en0"]).decode().strip()
                if out:
                    speak(f"Active IP address {out} hai")
                else:
                    speak("Network ki IP address nahi mili")
            except Exception:
                speak("Network status nikalne mein problem aayi")
            return True

    # Brightness control / query (requires `brightness` CLI tool: https://github.com/nriley/brightness)
    if "brightness" in cmd or "screen brightness" in cmd or "brightness percent" in cmd:
        # Check for set command
        match = re.search(r"(?:set|change|make|increase|decrease).*brightness to (\d+)%?", cmd)
        try:
            # Try the brightness CLI first
            subprocess.check_output(["which", "brightness"]).decode()
            if match:
                level = max(0, min(100, int(match.group(1))))
                val = level / 100.0
                try:
                    subprocess.run(["brightness", str(val)], check=True)
                    speak(f"Brightness {level} percent kar diya")
                    return True
                except Exception:
                    # fallback to ddcctl for external displays
                    pass
            else:
                out = subprocess.check_output(["brightness", "-l"]).decode()
                mm = re.search(r"brightness:\s*([0-9.]+)", out)
                if mm:
                    cur = float(mm.group(1))
                    pct = int(cur * 100)
                    speak(f"Screen brightness {pct} percent hai")
                else:
                    speak("Brightness ka value nahi mila")
                return True
        except subprocess.CalledProcessError:
            # brightness CLI not available — try ddcctl for external monitors
            pass

        # Try ddcctl for external monitors (set only)
        ddc_match = re.search(r"(\d+)%", cmd)
        try:
            subprocess.check_output(["which", "ddcctl"]).decode()
            if match or ddc_match:
                level = int(match.group(1)) if match else int(ddc_match.group(1))
                level = max(0, min(100, level))
                # ddcctl uses -d <display> -b <value>
                try:
                    subprocess.run(["ddcctl", "-d", "1", "-b", str(level)], check=True)
                    speak(f"Brightness {level} percent kar diya (via ddcctl)")
                    return True
                except Exception:
                    speak("ddcctl se brightness set karne mein problem aayi")
                    return True
            else:
                speak("Built-in display ke liye 'brightness' utility chahiye; install karo: brew install brightness")
                return True
        except subprocess.CalledProcessError:
            speak("Brightness control ke liye 'brightness' ya 'ddcctl' install karo. Try: brew install brightness ddcctl")
            return True
        except FileNotFoundError:
            speak("Brightness control available nahi hai on this Mac")
            return True

        # As a last resort, inform the user
        speak("Brightness control nahi ho paaya. External monitor ya permissions issue ho sakta hai.")
        return True

    if "open" in cmd or "launch" in cmd or "start" in cmd:
        app = resolve_app(cmd)
        if app:
            subprocess.run(["open", "-a", app])
            speak(f"{app} khol diya")
            return True

    if "close" in cmd or "quit" in cmd:
        app = resolve_app(cmd)
        if app:
            run_applescript(f'tell application "{app}" to quit')
            speak(f"{app} band kar diya")
            return True

    if "search" in cmd:
        query = re.sub(r"^(search|for|please)\s*", "", cmd.replace("search", "", 1)).strip()
        if query:
            url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
            subprocess.run(["open", url])
            speak(f"{query} search kar raha hoon")
            return True

    if "screenshot" in cmd:
        path = f"/tmp/mira_{int(time.time())}.png"
        subprocess.run(["screencapture", "-x", path])
        speak("Screenshot le liya")
        return True

    if "volume" in cmd:
        match = re.search(r"\d+", cmd)
        if match:
            level = max(0, min(100, int(match.group())))
            run_applescript(f"set volume output volume {level}")
            speak(f"Volume {level} percent kar diya")
            return True
        if "mute" in cmd or "zero" in cmd:
            run_applescript("set volume output volume 0")
            speak("Mute kar diya")
            return True
        if "full" in cmd or "max" in cmd:
            run_applescript("set volume output volume 100")
            speak("Volume full kar diya")
            return True

    if "mute" in cmd:
        run_applescript("set volume output volume 0")
        speak("Mute kar diya")
        return True

    if any(w in cmd for w in ["what time", "what's the time", "time hai", "current time"]):
        run_applescript('display notification (time string of (current date)) with title "Mira"')
        speak("Screen pe time dikha diya")
        return True

    if "lock" in cmd and ("screen" in cmd or "mac" in cmd or "computer" in cmd):
        run_applescript('tell application "System Events" to keystroke "q" using {command down, control down}')
        speak("Screen lock kar diya")
        return True

    if "empty" in cmd and "trash" in cmd:
        run_applescript('tell application "Finder" to empty trash')
        speak("Trash empty kar diya")
        return True

    if "new note" in cmd or ("create" in cmd and "note" in cmd):
        content = cmd.split("note", 1)[-1].strip()
        script = f'''
        tell application "Notes"
            activate
            tell account "iCloud"
                make new note at folder "Notes" with properties {{body:"{content}"}}
            end tell
        end tell
        '''
        run_applescript(script)
        speak("Note bana diya")
        return True

    return False


# ---------------------------- AI FALLBACK (Ollama) ----------------------------
# Sirf tab use hota hai jab fixed commands me se koi match nahi hota.

def ask_ollama(command: str) -> dict:
    system_prompt = """You are Mira, a Mac voice assistant like Siri. Convert the user's spoken
command into ONE JSON object only, no extra text, no markdown. Be smart and helpful.
Choose "action" from:

- open_url: {"action": "open_url", "url": "<url>"}
- send_message: {"action": "send_message", "contact": "<name>", "text": "<message>"}
- type_text: {"action": "type_text", "text": "<text>"}
- chat: {"action": "chat", "text": "<friendly reply>"}
- unknown: {"action": "unknown"}

If the user is greeting, chatting, asking how you are, or talking casually, use chat.
If the user asks for information, answer concisely in chat.
Respond with JSON only, nothing else."""

    try:
        resp = requests.post(config.OLLAMA_URL, json={
            "model": config.OLLAMA_MODEL,
            "prompt": f"{system_prompt}\n\nUser command: \"{command}\"\nJSON:",
            "stream": False
        }, timeout=config.OLLAMA_TIMEOUT)
        raw = resp.json().get("response", "").strip()
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group())
    except requests.exceptions.ConnectionError:
        print("[AI] Ollama nahi chal raha - 'ollama serve' chalao")
    except Exception as e:
        print(f"[AI error] {e}")
    return {"action": "unknown"}


def execute_ai_action(parsed: dict) -> bool:
    action = parsed.get("action")
    try:
        if action == "open_url":
            url = parsed["url"]
            if not url.startswith("http"):
                url = "https://" + url
            subprocess.run(["open", url])
            speak("Khol diya")
            return True
        elif action == "send_message":
            script = f'''
            tell application "Messages"
                set targetService to 1st service whose service type = iMessage
                set targetBuddy to buddy "{parsed['contact']}" of targetService
                send "{parsed['text']}" to targetBuddy
            end tell
            '''
            run_applescript(script)
            speak(f"{parsed['contact']} ko message bhej diya")
            return True
        elif action == "type_text":
            run_applescript(f'tell application "System Events" to keystroke "{parsed["text"]}"')
            return True
        elif action == "chat":
            reply = parsed.get("text", "")
            if reply:
                speak(reply)
                return True
    except KeyError:
        return False
    except Exception as e:
        print(f"[Execute error] {e}")
        return False
    return False


# ------------------------------ MAIN LOOP ------------------------------

def get_local_chat_reply(cmd: str):
    text = cmd.lower().strip()
    if not text:
        return None

    if "javascript" in text or "js" in text:
        if "hello" in text or "print" in text:
            return "Agar tum JavaScript mein hello print karna chaho toh yeh use karo: console.log('hello');"
        return "Main tumhari coding help kar sakti hoon. Tum bas batao kaunsa language aur kaunsa task hai."

    if any(word in text for word in ["code", "programming", "python"]):
        return "Main tumhari coding help kar sakti hoon. Tum bas batao kaunsa language aur kaunsa task hai."

    if any(word in text for word in ["hello", "hi", "hey"]):
        return "Hi! Main Mira hoon. Main tumhare liye hoon. Tum kaise ho?"

    if any(word in text for word in ["how are you", "kaise ho", "tum kaise ho", "what's up", "how you doing"]):
        return "Main theek hoon, aur tum? Main hamesha ready hoon tumhare saath baat karne ke liye."

    if any(word in text for word in ["your name", "who are you", "tum kaun ho"]):
        return "Main Mira hoon, tumhari friendly digital assistant."

    if any(word in text for word in ["who made you", "who created you", "kisne banaya", "tumhe kisne banaya"]):
        return "Main Rohit Mehra ke dwara banayi gayi hoon, ek B.Tech CSE student."

    if any(word in text for word in ["joke", "funny", "hasi", "masti"]):
        return "Bilkul. Main computer se baat karti hoon, aur phir bhi lagta hai ki main sabse smart hoon."

    if any(word in text for word in ["sad", "depressed", "hurt", "upset", "tension", "stress"]):
        return "Mujhe lagta hai tum thoda sad ya upset ho. Main yahan hoon — I’m here for you — agar chaho toh baat kar sakte ho."

    if any(word in text for word in ["happy", "excited", "joy", "great", "awesome"]):
        return "Wah! Acha lag raha hai tumhari khushi dekh kar."

    if any(word in text for word in ["love", "miss you", "missed you", "pyaar"]):
        return "Aww, bohot pyara. Main tumhare saath hoon, hamesha."

    if any(word in text for word in ["thank you", "thanks", "dhanyavaad", "shukriya"]):
        return "My pleasure! Main hamesha tumhari help karne ke liye ready hoon."

    if any(word in text for word in ["bye", "goodbye", "alvida", "baad me", "see you"]):
        return "Bye! Phir baat karenge, tumhari marzi."

    if any(word in text for word in ["sleep", "so jao", "rest"]):
        return "Theek hai, rest karo. Main yahan hoon jab tum wapas aao."

    if any(word in text for word in ["music", "song", "dance"]):
        return "Chalo, thoda fun kar lete hain! Main tumhare liye music ka mood bana sakti hoon."

    return None


def handle_command(cmd: str):
    if try_fixed_commands(cmd):
        return

    chat_reply = get_local_chat_reply(cmd)
    if chat_reply:
        speak(chat_reply)
        return

    if config.USE_AI_FALLBACK:
        set_state("thinking", cmd)
        print("[Mira] Soch raha hoon...")
        parsed = ask_ollama(cmd)
        print(f"[AI parsed] {parsed}")
        if execute_ai_action(parsed):
            return

    speak("Ye command samajh nahi paya, dobara try karo")


def main():
    start_avatar_server()
    calibrate_once()
    speak("Mira ready hai. Hey Mira bolke mujhe bulao.")
    print("Listening for wake word... (Ctrl+C to stop)\n")

    while True:
        try:
            set_state("idle", "")
            text = listen(timeout=None, phrase_time_limit=config.WAKE_PHRASE_LIMIT if config.REQUIRE_WAKE_WORD else 6)

            if not config.REQUIRE_WAKE_WORD:
                if text:
                    handle_command(text)
                continue

            if any(w in text for w in config.WAKE_WORDS):
                set_state("listening", "")
                subprocess.Popen(["afplay", "/System/Library/Sounds/Tink.aiff"])

                # Jab tak commands aate rahein, bina wake word ke sunte raho
                while True:
                    set_state("listening", "")
                    command = listen(timeout=config.COMMAND_TIMEOUT, phrase_time_limit=8, debug_label="Command")
                    if not command:
                        print("[Mira] Follow-up window khatam, wapas wake word sun raha hoon")
                        break
                    handle_command(command)

        except KeyboardInterrupt:
            speak("Bye!")
            sys.exit(0)
        except Exception as e:
            print(f"[Loop error] {e}")
            time.sleep(1)


if __name__ == "__main__":
    main()