# Jhack Lingua Bridge — Credits

Author: JHack

## Offline speech engine (pronunciation)

`engine/mespeak/` bundles **meSpeak** (a JavaScript/asm.js build of the eSpeak
speech synthesizer) by Norbert Landsteiner, https://www.masswerk.at/mespeak/,
itself based on `speak.js` by Ondřej Žára / Alon Zakai and the eSpeak project.
This runs entirely inside the plugin with no system installation required and
is used as the offline fallback when the operating system's own Web Speech
voices aren't available. Licensed under the GNU General Public License (GPL);
source is included as-is in `engine/mespeak/`.

## Offline English → Persian translations

Real Persian translations for 84,000+ of the offline dictionary's words come from
the **generic-2** dataset in VahidN/EnglishToPersianDictionaries
(https://github.com/VahidN/EnglishToPersianDictionaries), a long-standing open
collection of digitized English–Persian dictionary data. Note: as with any
digitized older dictionary corpus, a small fraction of entries carry OCR/merge
artifacts from the original scanning process — the 243 hand-curated words in
`persian-index.json` remain the most reliable and always take priority over this
larger source when both exist for the same word.

## Offline English dictionary

The bundled `data/offline-dictionary.json` (107,900+ words) is derived from the
**Wordset Dictionary** (https://github.com/wordset/wordset-dictionary), an open,
freely-shareable community dictionary project. Only word, part of speech,
definition, example and synonyms were kept; identifiers, editor/contributor
metadata and labels were stripped during processing.

## Open English WordNet (optional expansion)

Open English WordNet 2025+ is provided by the Open English WordNet community.
License: Creative Commons Attribution 4.0 (CC BY 4.0).
Official downloads: https://en-word.net/downloads

## Online fallback services (optional, off by default)

- Definitions: https://dictionaryapi.dev (free, no key required).
- Translation: https://mymemory.translated.net (free, no key required).

## Pronunciation

Three layers, tried in order: (1) your OS's own Web Speech voices, (2) a fully
offline speech engine bundled inside this plugin (no installs needed, English
only), (3) your system's espeak-ng if present. See CREDITS.md for the bundled
engine's license (GPL).

## Spaced repetition

The built-in Leitner spaced-repetition system is native to this plugin as of
v3.0.0 and replaces the earlier dependency on the community "Spaced Repetition"
plugin. A one-time importer is included for anyone migrating an existing
`#flashcards` deck.
