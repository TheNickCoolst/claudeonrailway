# Auf Railway deployen, mit Claude-Abo

Schritt für Schritt, etwa 15 Minuten. Am Ende hast du Claude Code in einem
Browser-Terminal, das über dein Claude Pro/Max-Abo läuft und auf deine
GitHub-Repos zugreifen kann. Deine Tokens liegen nur in Railway; Claude Code
kann sie benutzen, aber nicht sehen.

## 1. Abo-Token erstellen (auf deinem eigenen Rechner)

Du brauchst dafür einmalig Claude Code auf deinem Computer. Dann im Terminal:

```bash
claude setup-token
```

Es öffnet sich der Browser. Melde dich mit deinem Claude-Konto (Pro oder Max)
an. Danach zeigt das Terminal einen Token an, der mit `sk-ant-oat01-` beginnt.
Kopier ihn dir weg: Er wird nirgends gespeichert und gilt ein Jahr.

## 2. GitHub-Token erstellen

Auf GitHub: **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**
([direkter Link](https://github.com/settings/personal-access-tokens/new)).

- **Repository access:** *Only select repositories*, dann die Repos auswählen,
  an denen Claude arbeiten soll.
- **Permissions:** *Contents* auf *Read and write* und *Pull requests* auf
  *Read and write*.
- Token erstellen und kopieren (beginnt mit `github_pat_`).

Gib dem Token nur die Repos, die wirklich nötig sind: Claude kann alles tun,
was der Token erlaubt.

## 3. Projekt auf Railway anlegen

1. Auf [railway.com](https://railway.com) mit GitHub anmelden. Der Hobby-Plan
   (5 $/Monat, inklusive 5 $ Nutzung) reicht.
2. **New Project → Deploy from GitHub repo** und `claudeonrailway` auswählen.
   Falls das Repo nicht auftaucht: Railway über *Configure GitHub App* Zugriff
   darauf geben.
3. Railway baut sofort los. Der erste Start ohne Variablen ist egal, wir
   ergänzen sie gleich.

Railway baut den `main`-Branch. Solange der Pull Request noch nicht gemerged
ist, stell unter **Service → Settings → Source → Branch** den Branch
`claude/stoic-planck-2ie72s` ein.

## 4. Volume anlegen (damit nichts verloren geht)

Rechtsklick auf den Service (oder `Strg/Cmd + K` → "Volume") → **Attach
Volume**, Mount Path: **`/home/dev`**.

Dort landen deine Projekte, der Claude-Verlauf und die Einstellungen. Ohne
Volume ist bei jedem Deploy alles weg.

## 5. Variablen eintragen

**Service → Variables → Raw Editor**, dann einfügen und anpassen:

```
TERMINAL_PASSWORD=ein-langes-zufaelliges-passwort
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
GITHUB_TOKEN=github_pat_...
GIT_USER_NAME=Dein Name
GIT_USER_EMAIL=deine@email.de
```

- `TERMINAL_PASSWORD` schützt dein Terminal. Nimm mindestens 16 zufällige
  Zeichen, z. B. aus deinem Passwort-Manager. Wer es kennt, kann auf deine
  Repos pushen.
- Leerzeichen oder Zeilenumbrüche beim Einfügen sind kein Problem, die werden
  entfernt.

Speichern und die Änderungen deployen (Railway zeigt dafür einen
*Deploy*-Button an).

## 6. Adresse erzeugen

**Service → Settings → Networking → Generate Domain**. Wenn nach einem Port
gefragt wird: `8080`.

## 7. Ausprobieren

Die Adresse öffnen und anmelden: Benutzer **`dev`**, Passwort = dein
`TERMINAL_PASSWORD`. Im Terminal:

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

## Wenn etwas nicht klappt

In Railway: **Service → Deployments → View logs**. Das Gateway schreibt dort
verständliche Meldungen:

| Meldung | Bedeutung |
|---|---|
| `anthropic: answered 401` | Token falsch oder abgelaufen. Neuen mit `claude setup-token` erstellen. |
| `anthropic: answered 403` | Nicht erlaubt, z. B. Modell nicht in deinem Abo. Mit `/model` wechseln. |
| `anthropic: answered 429` | Nutzungslimit erreicht. Warten, bis es zurückgesetzt wird. |
| `github: answered 401/403/404` | GitHub-Token falsch, abgelaufen oder ohne Zugriff auf das Repo. |
| `Temporary password for this start only` | `TERMINAL_PASSWORD` fehlt. Das Passwort für diesen Start steht direkt dahinter. |
| `ERROR: cannot switch to the dev/broker users` | Railway erlaubt den Benutzerwechsel nicht. Der Container startet dann absichtlich nicht. |

## Kosten niedrig halten

- **Service → Settings → Serverless** einschalten: Die Box schläft nach etwa
  10 Minuten ohne Aktivität und wacht beim Öffnen der Adresse wieder auf.
  Laufende Programme stoppen dabei, Dateien und Claude-Verlauf bleiben
  (`claude --continue` macht weiter).
- Unter **Settings → Resource limits** eine Obergrenze setzen, z. B. 2 vCPU und 2 GB.
- In den Railway-Workspace-Einstellungen ein **Usage Limit** festlegen.

Gemessen: etwa 20 MB Arbeitsspeicher im Leerlauf, etwa 100 MB mit offenem
Claude Code.

## Wichtig zum Abo

Laut Anthropic ist der Abo-Zugang für die Person gedacht, die das Abo bezahlt.
Nutze die Box also nur selbst und gib das Terminal-Passwort nicht weiter.
