"""
Mira Configuration
===================
Sab settings yahan hain - apps add/remove karne ho, wake word change
karna ho, ya AI model badalna ho, sab yahi se karo.
"""

# Alag alag tareeke jinse "Hey Mira" sunai de sakta hai (Google STT
# kabhi kabhi "Mira" ko galat sunta hai, isliye kaafi variations rakhi hain)
WAKE_WORDS = [
    "hey mira", "hey mirror", "hey mia", "hey myra",
    "hey mera", "hey mihra", "mira", "hi mira", "hey meera"
]

# App ke bolchal wale naam -> actual Mac application ka naam
APP_ALIASES = {
    "safari": "Safari",
    "chrome": "Google Chrome",
    "whatsapp": "WhatsApp",
    "messages": "Messages",
    "message": "Messages",
    "notes": "Notes",
    "mail": "Mail",
    "email": "Mail",
    "calendar": "Calendar",
    "spotify": "Spotify",
    "music": "Music",
    "terminal": "Terminal",
    "finder": "Finder",
    "photos": "Photos",
    "calculator": "Calculator",
    "facetime": "FaceTime",
    "maps": "Maps",
    "reminders": "Reminders",
    "settings": "System Settings",
    "system settings": "System Settings",
    "preview": "Preview",
    "textedit": "TextEdit",
    "vs code": "Visual Studio Code",
    "vscode": "Visual Studio Code",
    "code": "Visual Studio Code",
    "slack": "Slack",
    "discord": "Discord",
    "zoom": "zoom.us",
}


OLLAMA_MODEL = "llama3.2"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_TIMEOUT = 20         
USE_AI_FALLBACK = True       
REQUIRE_WAKE_WORD = False    
# Speech recognition settings
LISTEN_LANGUAGE = "en-IN"
COMMAND_TIMEOUT = 6
WAKE_PHRASE_LIMIT = 4

# Girl / female voice settings for macOS.
# "girl" resolves to Veena, and if that voice is unavailable it will fall back to a female voice.
SPEECH_VOICE = "girl"
SPEECH_VOICE_ALIASES = {
    "girl": "Veena",
    "female": "Veena",
    "woman": "Veena",
    "veena": "Veena",
    "samantha": "veena",
    "karen": "veena",
    "tessa": "Veena",
}
SPEECH_FALLBACK_VOICES = ["veena", "veena", "veena"]
SPEECH_RATE = 155