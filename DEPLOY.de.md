# Auf Railway deployen, mit Claude-Abo

Am Ende hast du Claude Code in einem Browser-Terminal, das über dein Claude
Pro/Max-Abo läuft und auf deine GitHub-Repos zugreifen kann. Deine Tokens
liegen nur in Railway; Claude Code kann sie benutzen, aber nicht sehen.

Es gibt zwei Wege:

- **Weg A: Setup-Skript** (empfohlen, ca. 10 Minuten). Ein Befehl auf deinem
  Rechner; das Skript fragt alles ab und richtet Railway komplett ein.
- **Weg B: Von Hand im Railway-Dashboard** (ca. 15 Minuten).

## Die Tokens im Überblick

| Was | Wofür | Wo bekommst du es | Gültig | Landet in |
|---|---|---|---|---|
| **Railway-Login** | Das Skript richtet Railway für dich ein | `railway login` (Browser). Kein Token nötig | bis Logout | bleibt auf deinem Rechner |
| **Claude-Abo-Token** | Claude Code läuft über dein Pro/Max-Abo | `claude setup-token` auf deinem Rechner | 1 Jahr | Railway-Variable `CLAUDE_CODE_OAUTH_TOKEN` |
| *oder* **Claude-API-Key** | Abrechnung pro Nutzung statt Abo | [console.anthropic.com](https://console.anthropic.com) → API Keys | bis du ihn löschst | `ANTHROPIC_API_KEY` |
| **GitHub-Token** (fine-grained) | `git clone`/`push`, Pull Requests | [GitHub → neuer Token](https://github.com/settings/personal-access-tokens/new) | wählst du selbst | `GITHUB_TOKEN` |
| **Terminal-Passwort** | Login ins Browser-Terminal | erzeugt das Skript für dich | bis du es änderst | `TERMINAL_PASSWORD` |
| *optional:* **Railway-API-Token** | Nur für Automatisierung (CI) | Railway → Account Settings → Tokens | bis du ihn löschst | Umgebungsvariable `RAILWAY_API_TOKEN` beim Skriptaufruf. **Nicht** in die Box! |

Einstellungen für den **GitHub-Token**:

- **Repository access:** *Only select repositories*, nur die Repos, an denen
  Claude arbeiten soll.
- **Permissions:** *Contents* und *Pull requests* jeweils auf *Read and write*.
- Optional *Workflows: Read and write*, falls Claude auch GitHub-Actions-Dateien
  ändern soll (ohne das lehnt GitHub solche Pushes ab).

Claude kann alles tun, was der Token erlaubt. Gib ihm also nur das Nötige.

---

## Weg A: Setup-Skript

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
6. Erzeugt ein zufälliges Terminal-Passwort.
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

## Weg B: Von Hand im Railway-Dashboard

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

Die Adresse öffnen und anmelden: Benutzer **`dev`**, Passwort aus dem Skript
(bzw. dein `TERMINAL_PASSWORD`). Im Terminal:

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
