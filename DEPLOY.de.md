# Auf Railway deployen, mit dem Claude Agent SDK & Web-Studio

[![Tests](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/test.yml/badge.svg)](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/test.yml)
[![Lint](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/lint.yml/badge.svg)](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/lint.yml)
[![Security](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/security.yml/badge.svg)](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/security.yml)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/TheNickCoolst/claudeonrailway/pkgs/container/claudeonrailway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Am Ende hast du ein vollwertiges **Cloud-Entwicklungsstudio im Browser** mit einer modernen Weboberfläche, angetrieben vom **Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)**. Du kannst direkt im Browser an deinen Projekten in der Cloud arbeiten, Aufgaben an den Claude-Agenten übergeben, Diffs prüfen und Änderungen per Knopfdruck committen und auf GitHub pushen.

Deine Tokens (Claude API / Abo und GitHub Token) liegen sicher in Railway. Der Agent kann sie nutzen, aber nicht auslesen oder leaken.

---

## Highlights der Weboberfläche

- 🤖 **Multi-Provider KI-Entwicklung:**
  - 🟣 **Claude (Anthropic):** Claude Agent SDK & Anthropic SDK (Claude 3.7 Sonnet, 3.5 Sonnet, 3.5 Haiku)
  - 🔵 **Antigravity (Google DeepMind):** Gemini 2.5 Pro & Gemini 2.0 Flash mit enormen Kontextfenstern
  - 🟢 **Codex / OpenAI:** GPT-4o, o3-mini & Codex Reasoning
  - 🟠 **OpenCode:** DeepSeek V3/R1, Qwen 2.5 Coder & freie Open-Source Modelle
  - 🎁 **Freebuff (Free Tier):** 100% kostenlose, werbefinanzierte Community-Modelle ohne Abo oder Kreditkarte!
- 📁 **Repository-Manager:** Bestehende Repositories auswählen oder neue Repos direkt von GitHub klonen (Authentifizierung erfolgt automatisch über das Gateway).
- 🔍 **Live Git-Diff:** Vor jedem Commit alle Dateiänderungen farblich hervorgehoben überprüfen.
- ✨ **KI-Commit-Message:** Automatisch treffende Conventional-Commit-Nachrichten aus dem Diff generieren lassen (funktioniert mit jedem gewählten Provider!).
- 🚀 **Commit & Push:** Mit einem Klick committen und direkt auf GitHub pushen.
- 💻 **Integrierter Cloud-Terminal:** Beliebige Shell-Befehle (`npm test`, `git log`, etc.) direkt im Projektverzeichnis ausführen.

---

## Unterstützte KI-Provider & Environment-Variablen

Du kannst einen oder mehrere Provider in den Railway Environment-Variablen hinterlegen:

| Provider | Modell-Beispiele | Benötigte Railway-Variable | Kostenlos / Free Tier? |
|---|---|---|---|
| **🐙 GitHub Models** | GPT-4o, DeepSeek-R1, Llama 3.3 | Nutzt automatisch dein `GITHUB_TOKEN` | **100% Kostenlos** (GitHub Prototyping Tier) |
| **🟠 OpenCode** | OpenRouter Auto, Qwen 2.5 Coder 32B, Gemini 2.0 Flash Exp | `OPENCODE_API_KEY` (kostenloser OpenRouter Key) oder `OPENCODE_BASE_URL` (lokales Ollama) | **100% Kostenlose Modelle** (`:free` Pool & Ollama) |
| **🎁 Freebuff** | Freebuff Auto, DeepSeek V3, GLM 4 | *(Kein Key nötig!)* oder `FREEBUFF_API_KEY` | **100% Kostenlos** (werbefinanziert) |
| **🔵 Antigravity (Google)** | Gemini 2.0 Flash, Gemini Thinking, 1.5 Flash | `ANTIGRAVITY_API_KEY` *oder* `GEMINI_API_KEY` | **100% Kostenloses Kontingent** (1500 Anfragen/Tag bei Google AI Studio) |
| **⚡ Groq** | Llama 3.3 70B, Qwen 2.5 Coder 32B | `GROQ_API_KEY` (kostenloser Key bei console.groq.com) | **100% Kostenlos** (Ultra-Fast 800 tok/s) |
| **🟣 Claude** | Claude 3.7 Sonnet, 3.5 Sonnet | `ANTHROPIC_API_KEY` *oder* `CLAUDE_CODE_OAUTH_TOKEN` | Pay-as-you-go / Pro-Abo |
| **🟢 Codex / OpenAI** | GPT-4o, o3-mini, o1 | `OPENAI_API_KEY` *oder* `CODEX_API_KEY` | OpenAI API Guthaben |

---

Es gibt drei Wege:

- **Weg A: Railway-Template mit Deploy-Button.** Einmal einrichten (ca. 10
  Minuten), danach ist jedes Deployment: Button klicken, Tokens eintragen,
  fertig. Railway braucht dafür keinen Zugriff auf dein privates Repo.
- **Weg B: Setup-Skript** (ca. 10 Minuten). Ein Befehl auf deinem Rechner;
  das Skript fragt alles ab und richtet Railway komplett ein.
- **Weg C: Von Hand im Railway-Dashboard** (ca. 15 Minuten).

## Die Tokens im Überblick

| Was | Wofür | Wo bekommst du es | Gültig | Landet in |
|---|---|---|---|---|
| **Railway-Login** | Das Skript richtet Railway für dich ein | `railway login` (Browser). Kein Token nötig | bis Logout | bleibt auf deinem Rechner |
| **Claude-Abo-Token** | Claude läuft über dein Pro/Max-Abo | `claude setup-token` auf deinem Rechner | 1 Jahr | Railway-Variable `CLAUDE_CODE_OAUTH_TOKEN` |
| *oder* **Claude-API-Key** | Abrechnung pro Nutzung statt Abo | [console.anthropic.com](https://console.anthropic.com) → API Keys | bis du ihn löschst | `ANTHROPIC_API_KEY` |
| **GitHub-Token** (fine-grained) | `git clone`/`push`, Pull Requests | [GitHub → neuer Token](https://github.com/settings/personal-access-tokens/new) | wählst du selbst | `GITHUB_TOKEN` |
| **Panel-Benutzername** | Login-Name im Web-Studio | fragt das Skript, Standard `dev` | bis du ihn änderst | `TERMINAL_USERNAME` |
| **Terminal-Passwort** | Login ins Web-Studio | erzeugt das Skript für dich | bis du es änderst | `TERMINAL_PASSWORD` |
| *optional:* **Railway-API-Token** | Nur für Automatisierung (CI) | Railway → Account Settings → Tokens | bis du ihn löschst | Umgebungsvariable `RAILWAY_API_TOKEN` beim Skriptaufruf. **Nicht** in die Box! |

Einstellungen für den **GitHub-Token**:

- **Repository access:** *Only select repositories*, nur die Repos, an denen
  Claude arbeiten soll.
- **Permissions:** *Contents* und *Pull requests* jeweils auf *Read and write*.
- Optional *Workflows: Read and write*, falls Claude auch GitHub-Actions-Dateien
  ändern soll (ohne das lehnt GitHub solche Pushes ab).

Claude kann alles tun, was der Token erlaubt. Gib ihm also nur das Nötige.

---

## Weg A: Railway-Template mit Deploy-Button

So funktioniert es: Nach jedem erfolgreichen Test auf `main` baut GitHub
Actions das fertige Image und legt es unter
`ghcr.io/thenickcoolst/claudeonrailway:latest` ab. Das Template startet genau
dieses Image. Railway muss also nichts bauen und braucht keinen Zugriff auf
dein Repo, das privat bleiben kann.

### Einmal einrichten

1. **Image veröffentlichen lassen:** Auf GitHub unter *Actions* muss der
   letzte Lauf "Tests" auf `main` grün sein, inklusive Job *Publish image*.
2. **Image öffentlich machen:** github.com → dein Profil → *Packages* →
   `claudeonrailway` → *Package settings* → ganz unten *Change visibility* →
   *Public*. Das Image enthält den Code dieses Repos, aber keine Geheimnisse:
   deine Tokens kommen erst beim Deployen dazu.
3. **Railway-CLI installieren und Template erstellen** (im Repo-Ordner):

   ```bash
   npm install -g @railway/cli
   ```

   ```bash
   scripts/create-railway-template.sh
   ```

   Das Skript macht Folgendes:
   - Es meldet dich bei Railway an und prüft, ob das Image öffentlich
     erreichbar ist.
   - Es baut ein Hilfsprojekt **ohne Tokens**: Image, Volume `/home/dev`,
     Adresse auf Port 8080 und leere Felder für deine Tokens.
   - Daraus macht es ein Template, veröffentlicht es und löscht das
     Hilfsprojekt wieder.
   - Am Ende zeigt es dir den **Deploy-Link** und einen fertigen Button für
     die README.

   Hinweis: Veröffentlichte Templates erscheinen im Railway-Marktplatz. Sie
   enthalten keine Geheimnisse; jeder, der deployt, trägt seine eigenen
   Tokens ein.

### Deployen (jedes Mal)

1. Den Deploy-Link öffnen und auf *Deploy* klicken.
2. Die Felder ausfüllen:
   - `CLAUDE_CODE_OAUTH_TOKEN`: dein Abo-Token aus `claude setup-token`
     (ein API-Key geht hier auch).
   - `GITHUB_TOKEN`: dein GitHub-Token.
   - `TERMINAL_PASSWORD`: ein langes Passwort deiner Wahl.
   - `GIT_USER_NAME` und `GIT_USER_EMAIL`: Name und E-Mail für deine Commits.
3. Warten, bis der Service läuft, dann seine Adresse öffnen und als `dev`
   einloggen (siehe [Ausprobieren](#ausprobieren)).

Updates: Neue Versionen landen automatisch als neues Image, sobald die Tests
auf `main` grün sind. In Railway reicht dann *Redeploy* am Service.

---

## Weg B: Setup-Skript

### Einmalig vorbereiten

1. **Railway-Konto:** auf [railway.com](https://railway.com) mit GitHub
   anmelden. Der Hobby-Plan (5 $/Monat inkl. 5 $ Nutzung) reicht.
2. **Railway-CLI installieren** (eins davon):

   ```bash
   npm install -g @railway/cli
   ```

   ```bash
   brew install railway
   ```

3. **Railway Zugriff aufs Repo geben:** auf GitHub unter
   [Settings → Applications](https://github.com/settings/installations) bei
   *Railway* auf *Configure* klicken und `claudeonrailway` freigeben.
4. **Claude Code auf deinem Rechner** (für `claude setup-token`). Hast du es
   noch nicht, kann das Skript dich trotzdem durchführen; den Token erstellst du
   dann in einem zweiten Terminalfenster.

### Skript starten

Im Ordner dieses Repos (Windows: in WSL oder Git Bash):

```bash
scripts/setup-railway.sh
```

Das Skript führt dich durch diese Schritte:

1. Prüft die Railway-CLI und meldet dich bei Railway an (Browser öffnet sich).
2. Fragt, welches Repo und welcher Branch deployt werden soll. Die Vorschläge
   kommen aus deinem Git-Checkout, Enter übernimmt sie.
3. Legt das Railway-Projekt und den Service an.
4. **Claude:** Wählst du *1 (Abo)*, startet es auf Wunsch `claude setup-token`.
   Den angezeigten Token fügst du ein. Die Eingabe ist unsichtbar.
5. **GitHub:** zeigt den Link und die nötigen Rechte, du fügst den Token ein.
   Er wird sofort bei GitHub geprüft.
6. Fragt den Login-Namen fürs Panel (Vorschlag `dev`, Enter übernimmt ihn) und
   erzeugt ein zufälliges Terminal-Passwort.
7. Speichert alles als Railway-Variablen, legt das Volume (`/home/dev`) und die
   Adresse an, verbindet das GitHub-Repo und startet den Build.
8. Wartet, bis die Box erreichbar ist, und zeigt **Adresse, Benutzer und
   Passwort**. Das Passwort sofort im Passwort-Manager speichern, es wird nur
   einmal angezeigt.

Sicherheit: Tokens werden nicht angezeigt und landen weder in deiner
Shell-History noch in der Prozessliste (sie gehen per Standardeingabe an
Railway). Prüft das Skript einen Token und er funktioniert nicht, bricht es ab,
bevor irgendetwas gespeichert wird.

### Später: Token erneuern, Einstellungen ändern

Einfach das Skript nochmal starten. Projekt, Service, Volume und Adresse werden
wiederverwendet. Leere Eingaben behalten den aktuellen Wert. Wechselst du von
API-Key zu Abo (oder umgekehrt), entfernt es den alten Schlüssel automatisch.

### Automatisch, ohne Fragen (für Fortgeschrittene)

Mit `--yes` liest das Skript alles aus Umgebungsvariablen:

```bash
RAILWAY_API_TOKEN=... CLAUDE_CODE_OAUTH_TOKEN=... GITHUB_TOKEN=... \
  SETUP_REPO=DEIN-NAME/claudeonrailway SETUP_BRANCH=main \
  scripts/setup-railway.sh --yes
```

Alle Variablen stehen oben im Skript.

---

## Weg C: Von Hand im Railway-Dashboard

1. **Projekt:** auf Railway *New Project → Deploy from GitHub repo* und
   `claudeonrailway` auswählen. Railway baut den `main`-Branch. Ist der Pull
   Request noch nicht gemerged, unter **Service → Settings → Source → Branch**
   den Branch `claude/stoic-planck-2ie72s` einstellen.
2. **Volume:** Rechtsklick auf den Service (oder `Strg/Cmd + K` → "Volume") →
   **Attach Volume**, Mount Path **`/home/dev`**.
3. **Variablen:** **Service → Variables → Raw Editor**:

   ```
   TERMINAL_PASSWORD=ein-langes-zufaelliges-passwort
   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
   GITHUB_TOKEN=github_pat_...
   GIT_USER_NAME=Dein Name
   GIT_USER_EMAIL=deine@email.de
   ```

   Danach die Änderungen deployen (Railway zeigt dafür einen *Deploy*-Button).
4. **Adresse:** **Service → Settings → Networking → Generate Domain**, Port `8080`.

---

## Ausprobieren

Die Adresse öffnen und anmelden: Benutzer aus dem Skript (Standard **`dev`**),
Passwort aus dem Skript (bzw. dein `TERMINAL_PASSWORD`). Im Terminal:

```bash
claude
```

Farbschema wählen, Hinweise bestätigen, dem Ordner vertrauen und "Hallo"
schreiben. Kommt eine Antwort, läuft alles.

Oben steht "API Usage Billing". Das ist nur eine Anzeige: Abgerechnet wird
über dein Abo, weil das Gateway deinen Abo-Token schickt. Das Standardmodell
ist Opus; mit `/model` kannst du wechseln, z. B. damit dein Limit länger hält.

Dann ein Repo holen und loslegen:

```bash
git clone https://github.com/DEIN-NAME/DEIN-REPO ~/projects/DEIN-REPO
```

```bash
cd ~/projects/DEIN-REPO && claude
```

`git push` funktioniert ganz normal. Wenn du den Tab schließt, läuft deine
Sitzung weiter, auch vom Handy aus erreichbar.

## Empfohlen danach (im Railway-Dashboard)

- **Tokens versiegeln:** Service → Variables → bei `CLAUDE_CODE_OAUTH_TOKEN`
  und `GITHUB_TOKEN` im Menü *Seal* wählen. Dann kann sie niemand mehr
  auslesen, auch du nicht im Dashboard; die Box bekommt sie trotzdem.
- **Schlafen lassen:** Service → Settings → *Serverless* einschalten. Die Box
  schläft nach etwa 10 Minuten ohne Aktivität und wacht beim Öffnen der Adresse
  wieder auf. Laufende Programme stoppen dabei, Dateien und Claude-Verlauf
  bleiben (`claude --continue` macht weiter).
- **Obergrenzen:** Service → Settings → *Resource limits* (z. B. 2 vCPU,
  2 GB) und in den Workspace-Einstellungen ein *Usage Limit*.
- **Erst testen, dann deployen:** Das Repo hat GitHub-Actions-Tests. Railway
  kann vor jedem Deploy auf grüne Checks warten (Service → Settings, Option
  *Wait for CI*, falls in deinem Dashboard vorhanden).

Gemessen: etwa 20 MB Arbeitsspeicher im Leerlauf, etwa 100 MB mit offenem
Claude Code.

## Wenn etwas nicht klappt

Logs ansehen: `railway logs --service claude-code` (bzw. `--build` für den
Build) oder im Dashboard **Service → Deployments → View logs**.

| Meldung | Bedeutung |
|---|---|
| `could not connect the repo` (Skript) | Railway sieht das Repo nicht. GitHub → Settings → Applications → Railway → Configure. |
| `anthropic: answered 401` | Token falsch oder abgelaufen. Skript nochmal starten und neuen Token mit `claude setup-token` eintragen. |
| `anthropic: answered 403` | Nicht erlaubt, z. B. Modell nicht in deinem Abo. Mit `/model` wechseln. |
| `anthropic: answered 429` | Nutzungslimit erreicht. Warten, bis es zurückgesetzt wird. |
| `github: answered 401/403/404` | GitHub-Token falsch, abgelaufen oder ohne Zugriff auf das Repo. |
| `Temporary password for this start only` | `TERMINAL_PASSWORD` fehlt. Das Passwort für diesen Start steht direkt dahinter. |
| `ERROR: cannot switch to the dev/broker users` | Railway erlaubt den Benutzerwechsel nicht. Der Container startet dann absichtlich nicht. |

## Wichtig zum Abo

Laut Anthropic ist der Abo-Zugang für die Person gedacht, die das Abo bezahlt.
Nutze die Box also nur selbst und gib das Terminal-Passwort nicht weiter.
