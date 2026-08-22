# Jhack Lingua Bridge — v3.5.0

Offline-first English ⇄ Persian lookup for Markdown, PDF and EPUB — now with its
**own built-in Leitner spaced-repetition system** and **cross-platform pronunciation**.
No companion plugin needed.

## What's new in 3.5.0

- **Fixed "no Persian translation found" for almost every word.** The 148,000-word
  offline dictionary added in 3.2.0 only ever had English definitions — it never
  actually had Persian translations, so anything outside the 243 hand-curated words
  always came back empty on the Persian side. Real English → Persian translations
  (84,000+ words) have now been merged in from an open bilingual dictionary dataset,
  so the vast majority of English words now return an actual Persian translation
  fully offline. The 243 hand-curated entries still take priority when available,
  since they're the most reliable.

## What's new in 3.4.0

- **A real speech engine now ships inside the plugin itself.** Previous versions
  relied on the OS's Web Speech voices, then a system `espeak-ng` binary as a
  fallback — but on machines where neither was configured correctly, pronunciation
  still failed. `engine/mespeak/` now bundles a complete, self-contained JavaScript
  speech engine (meSpeak, a JS port of eSpeak) that runs entirely inside Obsidian
  with **zero system dependencies**. Pronunciation now works out of the box even
  on a bare Linux install with nothing extra configured.
- New fallback order: (1) system Web Speech voices when present (best quality),
  (2) the bundled engine (always available, English), (3) system espeak-ng as a
  last resort. Settings → Pronunciation shows exactly which layer is active.

## What's new in 3.3.0

- **Fixed pronunciation not playing.** On many Linux setups (a fresh Zorin OS
  install included), Chromium's Web Speech API reports itself as available but
  has zero installed voices, so `speak()` was calling into the void — no sound,
  no visible error. Jhack Lingua now detects this at call time and automatically
  falls back to calling **espeak-ng** directly if it's present on the system,
  instead of silently doing nothing.
- Settings → Pronunciation now shows a live status line telling you exactly
  which path is active (system voices / espeak-ng fallback / neither, with the
  install command to fix it).
- If neither is available, you get a clear, actionable Notice instead of silence:
  `sudo apt install espeak-ng speech-dispatcher` (Linux), or a check-your-volume
  hint on Windows/macOS where this should normally work out of the box.

## What's new in 3.2.0

- **A real offline dictionary is now bundled.** `data/offline-dictionary.json` ships
  with **107,900+ English words** (definitions, part of speech, examples, synonyms),
  built from the open-source Wordset Dictionary. Combined with the 243 hand-curated
  Persian entries, almost every English word you look up now returns something
  useful with zero internet connection.
- **Fixed the "Online fallback" toggle** — it used to return as soon as *any* offline
  source matched, even if that source only had an English definition and no Persian
  translation, so the online step was effectively decorative for most words. It now
  merges results from all sources properly and, when still missing a translation,
  actually calls a real translation service (MyMemory) instead of only fetching more
  English data.
- Dictionary lookups are now cached in memory after the first read, so repeated
  lookups are instant instead of re-parsing a multi-megabyte file every time.

## What's new in 3.1.1

- Added ~65 everyday, high-frequency words (language, book, time, learn, computer,
  friend, easy, happy, understand, remember...) that were missing from the 3.1.0
  academic-leaning word list. Curated Persian dictionary reached 243 entries.

## What's new in 3.1.0

- The offline built-in dictionary was expanded from 5 seed words to **179 curated
  English → Persian entries** (translation, definition, example, part of speech,
  IPA phonetic, synonyms), so lookups work fully offline immediately after install,
  no script required.
- The dashboard now **opens automatically in the sidebar the first time the plugin
  is enabled**, so you always know it's there.
- Fixed a startup edge case and packaged the files needed for Obsidian community
  plugin store submission (`LICENSE`, `versions.json`).

Want a bigger dictionary? Run `install-offline-databases.sh` any time to pull the
full Open English WordNet 2025+ index on top of the built-in 179 words — or send
me a `persian-index.json` / word list and I'll merge it in.

## What changed in 3.0.0

1. **Rebranded** — the plugin is now written and displayed as **Jhack Lingua Bridge**
   everywhere (ribbon, modals, settings, command palette).
2. **Built-in Leitner SRS.** You no longer need the *Spaced Repetition* community
   plugin. Jhack Lingua now ships its own 7-box Leitner engine:
   - `＋ Add to Leitner deck` stores the card directly in the plugin's own data —
     no Markdown deck file required.
   - **Start Leitner review session** (command, ribbon icon, or dashboard button)
     opens a full review flow: reveal → grade **Again / Hard / Good / Easy**
     (keys `1`–`4`, `Space` to reveal, `P` to hear the word).
   - Already have an old `#flashcards` deck from the Spaced Repetition plugin?
     Run **Import legacy Spaced Repetition deck** once and it's migrated in.
3. **Pronunciation rewritten.** The old version shelled out to
   `/usr/bin/espeak-ng`, which only worked on one specific Linux machine and
   broke silently everywhere else. Jhack Lingua now uses the **Web Speech API**
   built into Obsidian's Chromium engine — no binary, no path to configure, works
   on Windows, macOS and Linux out of the box. You can pick an exact system voice,
   accent, rate and pitch in settings, and even hear the Persian translation
   spoken back (if a Persian voice is installed on your OS).
4. **Ready to drop into Obsidian.** `isDesktopOnly` is now `false`, there's no
   required install script, and everything works the moment the plugin is enabled.
5. **Modern UI.** Redesigned modals, a live loading skeleton, colour-coded
   definition/example/translation cards, synonym chips, and a full **dashboard
   sidebar view** (due-today count, total cards, day streak, a Leitner box-distribution
   chart, and your recent lookups as clickable chips).
6. **Extras:**
   - Optional **online dictionary fallback** (dictionaryapi.dev) for words missing
     from the offline indexes — off by default so the plugin stays fully offline.
   - **Study streak** tracking.
   - **Export / import** your whole deck as JSON, and a **reset** button.
   - 5 accent color themes.
   - Works from Markdown selection, PDF/EPUB clipboard, or the command palette.

## Installation

1. Copy the entire `jhack-lingua-bridge` folder into `.obsidian/plugins/` in your vault.
2. Enable **Jhack Lingua Bridge** in Settings → Community plugins.
3. That's it — pronunciation and the Leitner system work immediately with zero setup.

### Optional: an even bigger dictionary

The plugin already ships with 107,900+ English words offline out of the box — no
setup needed. If you specifically want the Open English WordNet dataset layered
on top (richer, more academic definitions for some entries), you can still run:

```bash
chmod +x install-offline-databases.sh
./install-offline-databases.sh
```

This only touches dictionary data — pronunciation and spaced repetition already
work fully without it, and the plugin works fully offline even if you never run it.

## Commands

| Command | Description |
|---|---|
| Lookup selection or clipboard | Looks up the current selection, or clipboard if nothing is selected |
| Lookup Markdown selection | Looks up the current editor selection |
| Lookup PDF/EPUB clipboard selection | Looks up whatever you just copied from a PDF/EPUB |
| Start Leitner review session | Opens the review flow for all due cards |
| Open Jhack Lingua dashboard | Opens the sidebar dashboard |
| Import legacy Spaced Repetition deck | One-time migration from `#flashcards` notes |

## Data & privacy

Everything — your deck, settings, and lookup history — is stored locally inside
the plugin's own data file in your vault. Pronunciation uses your operating
system's speech engine. Nothing is sent anywhere unless you explicitly enable
**Online fallback** in settings.
