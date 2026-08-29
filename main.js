const { Plugin, Modal, Notice, PluginSettingTab, Setting, MarkdownView, ItemView, requestUrl, Editor, editorEditor, Platform } = require("obsidian");

const VIEW_TYPE_DASHBOARD = "jhack-dashboard-view";
const VIEW_TYPE_PLAYER = "jhack-player-view";

/* ---------------------------------------------------------------------- *
 *  Defaults
 * ---------------------------------------------------------------------- */

const DEFAULT_INTERVALS = [1, 2, 3, 7, 14, 30, 60]; // days, one per Leitner box (0..6)

const DEFAULTS = {
  accent: "us",
  rate: 0.95,
  pitch: 1,
  voiceURI: "",
  autoSpeak: false,
  onlineFallback: false,
  dailyNewLimit: 15,
  dailyReviewLimit: 60,
  intervals: DEFAULT_INTERVALS.slice(),
  theme: "crimson",
  onboarded: false,
  streak: 0,
  lastStudyDay: "",
  history: [], // recently looked-up words, most recent first
  cards: {},
  audioFileName: "",
  audioData: "", // base64-encoded bytes of the loaded audio file, persisted fully offline
  audioMime: "",
  audioVolume: 1.0,
  highlightLeitnerWords: true,
  singleClickSelect: true,
  showSimilarWords: true,
  dailyProgress: {}, // { "2024-01-15": { added: 5, reviewed: 12 } }
  dailyReminder: true, // one Notice per day if cards are due
  lastReminderDay: "",
  useGoogleTranslate: true, // free, keyless translate.googleapis.com endpoint — tried before MyMemory
  userTranslations: {}, // words translated online get cached here, so they become offline-available from then on
  fetchWordImages: true // fetch a picture for each word from Wikipedia — online only, never saved to disk
};

const THEMES = {
  crimson: "#e50914",
  ocean: "#2563eb",
  forest: "#16a34a",
  amber: "#d97706",
  violet: "#7c3aed"
};

const GRADE_LABELS = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

/* ---------------------------------------------------------------------- *
 *  Small utilities
 * ---------------------------------------------------------------------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function formatTime(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

/* ---------------------------------------------------------------------- *
 *  Lookup Modal
 * ---------------------------------------------------------------------- */

class LookupModal extends Modal {
  constructor(app, plugin, word, context = "") {
    super(app);
    this.plugin = plugin;
    this.word = word;
    this.context = context;
    this.data = null;
  }

  async onOpen() {
    this.plugin.pauseAudioForModal();
    this.contentEl.empty();
    this.contentEl.addClass("jhack-modal");
    this.renderSkeleton();
    try {
      this.data = await this.plugin.lookup(this.word);
    } catch (e) {
      console.error("Jhack Lingua lookup error:", e);
      this.data = { translation: "", definition: "", example: "", pos: "", phonetic: "", synonyms: [] };
    }
    this.plugin.pushHistory(this.word);
    this.render();
  }

  renderSkeleton() {
    const c = this.contentEl;
    c.empty();
    c.addClass("jhack-modal");
    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Lingua Bridge" });
    });
    c.createEl("h2", { text: this.word, cls: "jhack-word" });
    const sk = c.createDiv({ cls: "jhack-skeleton" });
    sk.createDiv({ cls: "jhack-sk-line jhack-sk-w60" });
    sk.createDiv({ cls: "jhack-sk-line jhack-sk-w90" });
    sk.createDiv({ cls: "jhack-sk-line jhack-sk-w40" });
  }

  render() {
    const c = this.contentEl;
    c.empty();
    c.addClass("jhack-modal");

    const header = c.createDiv({ cls: "jhack-header" });
    header.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Lingua Bridge" });
    });

    const imgHolder = c.createDiv({ cls: "jhack-word-image-holder" });
    this.plugin.getWordImage(this.word).then((src) => {
      if (!src || this._closed) return;
      imgHolder.empty();
      imgHolder.createEl("img", { cls: "jhack-word-image", attr: { src } });
    });

    const titleRow = c.createDiv({ cls: "jhack-title-row" });
    titleRow.createEl("h2", { text: this.word, cls: "jhack-word" });
    const already = this.plugin.hasCard(this.word);
    if (already) titleRow.createSpan({ text: "In deck", cls: "jhack-badge jhack-badge-inbox" });

    const metaRow = c.createDiv({ cls: "jhack-meta-row" });
    if (this.data.phonetic) metaRow.createSpan({ text: `/${this.data.phonetic}/`, cls: "jhack-phonetic" });
    if (this.data.pos) metaRow.createSpan({ text: this.data.pos, cls: "jhack-pos" });

    // Similar words: other inflected forms of this word, plus similarly-spelled
    // dictionary entries — both clickable so the user can hop straight to them.
    if (this.plugin.settings.showSimilarWords) {
      const forms = this.plugin.getWordForms(this.word);
      const similar = this.plugin.getSimilarWords(this.word);
      if (forms.length || similar.length) {
        const simBox = c.createDiv({ cls: "jhack-similar-box" });
        if (forms.length) {
          simBox.createDiv({ text: "Other forms", cls: "jhack-box-label" });
          const formChips = simBox.createDiv({ cls: "jhack-chips" });
          forms.forEach((f) => {
            const chip = formChips.createSpan({ text: f, cls: "jhack-chip jhack-chip-clickable" });
            chip.onclick = () => new LookupModal(this.app, this.plugin, f).open();
          });
        }
        if (similar.length) {
          simBox.createDiv({ text: "Similar words", cls: "jhack-box-label" });
          const simChips = simBox.createDiv({ cls: "jhack-chips" });
          similar.forEach((s) => {
            const chip = simChips.createSpan({ text: s, cls: "jhack-chip jhack-chip-clickable" });
            chip.onclick = () => new LookupModal(this.app, this.plugin, s).open();
          });
        }
      }
    }

    if (this.data.definition) {
      const box = c.createDiv({ cls: "jhack-box" });
      box.createDiv({ text: "Definition", cls: "jhack-box-label" });
      box.createDiv({ text: this.data.definition, cls: "jhack-box-body" });
    }
    if (this.data.example) {
      const box = c.createDiv({ cls: "jhack-box" });
      box.createDiv({ text: "Example", cls: "jhack-box-label" });
      box.createDiv({ text: this.data.example, cls: "jhack-box-body jhack-italic" });
    }
    const trBox = c.createDiv({ cls: "jhack-box jhack-box-translation" });
    trBox.createDiv({ text: "ترجمه", cls: "jhack-box-label" });
    trBox.createDiv({ text: this.data.translation || "No Persian translation found.", cls: "jhack-box-body jhack-fa" });

    if (this.data.synonyms?.length) {
      const syn = c.createDiv({ cls: "jhack-synonyms" });
      syn.createDiv({ text: "Synonyms", cls: "jhack-box-label" });
      const chips = syn.createDiv({ cls: "jhack-chips" });
      this.data.synonyms.forEach((s) => {
        const chip = chips.createSpan({ text: s, cls: "jhack-chip jhack-chip-clickable" });
        chip.onclick = () => new LookupModal(this.app, this.plugin, this.plugin.clean(s)).open();
      });
    }

    const actions = c.createDiv({ cls: "jhack-actions" });

    const speak = actions.createEl("button", { text: "🔊 Pronounce", cls: "jhack-btn" });
    speak.onclick = () => this.plugin.speak(this.word);

    if (this.data.translation) {
      const speakFa = actions.createEl("button", { text: "🔊 تلفظ فارسی", cls: "jhack-btn" });
      speakFa.onclick = () => this.plugin.speak(this.data.translation, "fa");
    }

    const add = actions.createEl("button", {
      text: already ? "✓ Already in Leitner deck" : "＋ Add to Leitner deck",
      cls: "jhack-btn jhack-btn-cta"
    });
    add.disabled = already;
    add.onclick = async () => {
      try {
        await this.plugin.addCard(this.word, this.data, this.context);
        add.setText("✓ Added");
        add.disabled = true;
        titleRow.createSpan({ text: "In deck", cls: "jhack-badge jhack-badge-inbox" });
        new Notice(`"${this.word}" added to your Leitner deck.`);
      } catch (e) {
        console.error(e);
        new Notice("Could not add card: " + e.message);
      }
    };

    const close = actions.createEl("button", { text: "Close", cls: "jhack-btn jhack-btn-ghost" });
    close.onclick = () => this.close();

    if (this.plugin.settings.autoSpeak) this.plugin.speak(this.word);
  }

  onClose() {
    this._closed = true;
    this.contentEl.empty();
    this.plugin.resumeAudioAfterModal();
  }
}

/* ---------------------------------------------------------------------- *
 *  Review Modal (built-in Leitner SRS — no external plugin required)
 * ---------------------------------------------------------------------- */

class ReviewModal extends Modal {
  constructor(app, plugin, queue) {
    super(app);
    this.plugin = plugin;
    this.queue = queue;
    this.index = 0;
    this.revealed = false;
    this.stats = { again: 0, hard: 0, good: 0, easy: 0 };
  }

  onOpen() {
    this.plugin.pauseAudioForModal();
    this.contentEl.addClass("jhack-modal", "jhack-review-modal");
    this.scope.register([], " ", (evt) => { evt.preventDefault(); this.toggleReveal(); });
    this.scope.register([], "1", () => this.revealed && this.grade("again"));
    this.scope.register([], "2", () => this.revealed && this.grade("hard"));
    this.scope.register([], "3", () => this.revealed && this.grade("good"));
    this.scope.register([], "4", () => this.revealed && this.grade("easy"));
    this.scope.register([], "p", () => this.card && this.plugin.speak(this.card.word));
    this.render();
  }

  get card() { return this.queue[this.index]; }

  toggleReveal() {
    if (!this.card) return;
    this.revealed = !this.revealed;
    this.render();
  }

  grade(g) {
    this.stats[g]++;
    this.plugin.reviewCard(this.card, g);
    this.index++;
    this.revealed = false;
    if (this.index >= this.queue.length) this.renderDone();
    else this.render();
  }

  render() {
    const c = this.contentEl;
    c.empty();
    if (!this.card) { this.renderDone(); return; }

    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Lingua Bridge — Review" });
    });

    const progress = c.createDiv({ cls: "jhack-progress" });
    const pct = Math.round((this.index / this.queue.length) * 100);
    progress.createDiv({ cls: "jhack-progress-fill" }).style.width = pct + "%";
    c.createDiv({ text: `${this.index + 1} / ${this.queue.length}`, cls: "jhack-progress-label" });

    const boxRow = c.createDiv({ cls: "jhack-box-badges" });
    boxRow.createSpan({ text: `Box ${this.card.box + 1}`, cls: "jhack-badge jhack-badge-box" });

    const card = c.createDiv({ cls: "jhack-flip-card" });
    const imgHolder = card.createDiv({ cls: "jhack-word-image-holder" });
    this.plugin.getWordImage(this.card.word).then((src) => { if (src) imgHolder.createEl("img", { cls: "jhack-word-image", attr: { src } }); });
    card.createEl("h1", { text: this.card.word, cls: "jhack-flip-word" });
    if (this.card.data.phonetic) card.createDiv({ text: `/${this.card.data.phonetic}/`, cls: "jhack-phonetic" });

    if (this.revealed) {
      if (this.card.data.definition) card.createDiv({ text: this.card.data.definition, cls: "jhack-box-body" });
      if (this.card.data.example) card.createDiv({ text: this.card.data.example, cls: "jhack-box-body jhack-italic" });
      card.createDiv({ text: this.card.data.translation || "—", cls: "jhack-box-body jhack-fa jhack-flip-translation" });

      const grades = c.createDiv({ cls: "jhack-grades" });
      const specs = [
        ["again", "1 · Again", "jhack-grade-again"],
        ["hard", "2 · Hard", "jhack-grade-hard"],
        ["good", "3 · Good", "jhack-grade-good"],
        ["easy", "4 · Easy", "jhack-grade-easy"]
      ];
      specs.forEach(([g, label, cls]) => {
        const btn = grades.createEl("button", { text: label, cls: "jhack-btn " + cls });
        btn.onclick = () => this.grade(g);
      });
    } else {
      const reveal = c.createDiv({ cls: "jhack-reveal-hint" }, (el) => {
        el.setText("Press Space to reveal");
      });
      reveal.onclick = () => this.toggleReveal();
    }

    const bottom = c.createDiv({ cls: "jhack-actions jhack-actions-center" });
    const speak = bottom.createEl("button", { text: "🔊 P", cls: "jhack-btn" });
    speak.onclick = () => this.plugin.speak(this.card.word);
    const quit = bottom.createEl("button", { text: "End session", cls: "jhack-btn jhack-btn-ghost" });
    quit.onclick = () => this.renderDone();
  }

  renderDone() {
    const c = this.contentEl;
    c.empty();
    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Lingua Bridge" });
    });
    c.createEl("h2", { text: "Session complete 🎉" });
    const total = this.stats.again + this.stats.hard + this.stats.good + this.stats.easy;
    const summary = c.createDiv({ cls: "jhack-summary" });
    Object.entries(this.stats).forEach(([k, v]) => {
      summary.createDiv({ cls: "jhack-summary-row" }, (row) => {
        row.createSpan({ text: GRADE_LABELS[k] });
        row.createSpan({ text: String(v), cls: "jhack-summary-count" });
      });
    });
    summary.createDiv({ text: `Streak: ${this.plugin.settings.streak} day(s) 🔥`, cls: "jhack-streak" });
    if (total === 0) c.createDiv({ text: "No cards were due. Nice, you're all caught up!", cls: "jhack-box-body" });
    const actions = c.createDiv({ cls: "jhack-actions" });
    const close = actions.createEl("button", { text: "Close", cls: "jhack-btn jhack-btn-cta" });
    close.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
    this.plugin.resumeAudioAfterModal();
  }
}

/* ---------------------------------------------------------------------- *
 *  Pronunciation Practice Modal
 * ---------------------------------------------------------------------- */

/**
 * Web Speech Recognition (webkitSpeechRecognition) needs Google's online speech
 * service and is frequently missing/blocked entirely inside Electron apps like
 * Obsidian — that was the "doesn't work" bug: it either doesn't exist, throws
 * immediately, or fires a silent 'network'/'not-allowed' error. Rather than
 * failing the whole feature, this modal now probes it once and transparently
 * drops into a "record & self-check" mode (record your voice with MediaRecorder,
 * play it back next to the reference pronunciation, grade yourself) whenever
 * live recognition isn't actually usable. Practice always works, one way or another.
 */
class PronunciationPracticeModal extends Modal {
  constructor(app, plugin, queue) {
    super(app);
    this.plugin = plugin;
    this.queue = queue.slice(0, 20); // Limit to 20 cards per session
    this.index = 0;
    this.scores = { correct: 0, total: 0 };
    this.mode = "checking"; // "recognition" | "record" | "unavailable"
    this.recognition = null;
    this.imageUrl = "";
  }

  get card() { return this.queue[this.index]; }

  async onOpen() {
    this.plugin.pauseAudioForModal();
    this.contentEl.addClass("jhack-modal", "jhack-pronunciation-modal");
    this.scope.register([], "p", () => this.card && this.plugin.speak(this.card.word));
    this.renderChecking();
    await this.detectMode();
    this.render();
  }

  renderChecking() {
    const c = this.contentEl;
    c.empty();
    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Pronunciation Practice 🎤" });
    });
    c.createDiv({ text: "Checking microphone and speech recognition…", cls: "jhack-subtle" });
  }

  async detectMode() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let micOk = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micOk = true;
    } catch (e) {
      console.error("Jhack Lingua: microphone permission denied", e);
      this.mode = "unavailable";
      return;
    }
    if (!SR) { this.mode = "record"; return; }

    this.recognition = new SR();
    this.recognition.lang = "en-US";
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.onresult = (event) => {
      const spoken = event.results[0][0].transcript.toLowerCase().trim();
      this.checkPronunciation(spoken, this.card.word.toLowerCase());
    };
    this.recognition.onerror = (event) => {
      console.error("Jhack Lingua speech recognition error:", event.error);
      if (event.error === "network" || event.error === "service-not-allowed" || event.error === "not-allowed") {
        // The recognition *service* is unreachable/blocked (very common inside
        // Electron/Obsidian) — silently switch the rest of the session to record mode.
        this.mode = "record";
        new Notice("Speech recognition service isn't reachable here — switching to record & self-check mode.", 4000);
      } else {
        new Notice("Didn't catch that — try again.");
      }
      this.setMicBusy(false);
      this.render();
    };
    this.recognition.onend = () => this.setMicBusy(false);
    this.mode = "recognition";
  }

  setMicBusy(busy) {
    const btn = this.contentEl.querySelector(".jhack-mic-btn");
    if (btn) btn.disabled = busy;
  }

  checkPronunciation(spoken, target) {
    this.scores.total++;
    const cleanSpoken = spoken.replace(/[^a-z]/g, "");
    const cleanTarget = target.replace(/[^a-z]/g, "");
    const isCorrect = cleanSpoken === cleanTarget || cleanSpoken.includes(cleanTarget) || cleanTarget.includes(cleanSpoken);
    if (isCorrect) { this.scores.correct++; new Notice(`✓ Correct! You said "${spoken}"`, 3000); }
    else new Notice(`Try again! Target: "${target}", You said: "${spoken}"`, 4000);
    setTimeout(() => this.nextCard(), 1500);
  }

  startListening() {
    this.setMicBusy(true);
    try { this.recognition.start(); }
    catch (e) {
      console.error("Jhack Lingua: failed to start recognition:", e);
      this.mode = "record";
      this.render();
    }
  }

  async startRecording() {
    this.setMicBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        this.renderSelfCheck(url);
      };
      recorder.start();
      new Notice("🔴 Recording… speak now", 1800);
      setTimeout(() => { try { recorder.stop(); } catch (e) {} }, 2500);
    } catch (e) {
      console.error("Jhack Lingua: recording failed", e);
      new Notice("Microphone access failed — check permissions.");
      this.setMicBusy(false);
    }
  }

  nextCard() {
    this.index++;
    if (this.index >= this.queue.length) this.renderDone();
    else this.render();
  }

  renderCardHeader(c) {
    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Pronunciation Practice 🎤" });
    });
    const progress = c.createDiv({ cls: "jhack-progress" });
    const pct = Math.round((this.index / this.queue.length) * 100);
    progress.createDiv({ cls: "jhack-progress-fill" }).style.width = pct + "%";
    c.createDiv({ text: `${this.index + 1} / ${this.queue.length}`, cls: "jhack-progress-label" });

    const card = c.createDiv({ cls: "jhack-flip-card" });
    const imgHolder = card.createDiv({ cls: "jhack-word-image-holder" });
    card.createEl("h1", { text: this.card.word, cls: "jhack-flip-word" });
    if (this.card.data.phonetic) card.createDiv({ text: `/${this.card.data.phonetic}/`, cls: "jhack-phonetic" });
    if (this.card.data.translation) card.createDiv({ text: this.card.data.translation, cls: "jhack-box-body jhack-fa" });

    this.plugin.getWordImage(this.card.word).then((src) => {
      if (!src) return;
      imgHolder.createEl("img", { cls: "jhack-word-image", attr: { src } });
    });
    return card;
  }

  render() {
    const c = this.contentEl;
    c.empty();
    if (!this.card) { this.renderDone(); return; }

    if (this.mode === "recognition") {
      this.renderCardHeader(c);
      const micBtn = c.createEl("button", { text: "🎤 Speak now", cls: "jhack-btn jhack-mic-btn jhack-btn-cta" });
      micBtn.style.fontSize = "1.2em";
      micBtn.style.padding = "1em 2em";
      micBtn.onclick = () => this.startListening();
      c.createDiv({ text: "Say the word clearly into your microphone", cls: "jhack-subtle", style: "text-align: center; margin-top: 0.5em;" });
    } else if (this.mode === "record") {
      this.renderCardHeader(c);
      const recBtn = c.createEl("button", { text: "⏺ Record my voice (2.5s)", cls: "jhack-btn jhack-mic-btn jhack-btn-cta" });
      recBtn.style.fontSize = "1.2em";
      recBtn.style.padding = "1em 2em";
      recBtn.onclick = () => this.startRecording();
      c.createDiv({ text: "Live speech recognition isn't reachable here, so record yourself and compare to the reference audio instead.", cls: "jhack-subtle", style: "text-align: center; margin-top: 0.5em;" });
    } else {
      this.renderCardHeader(c);
      c.createDiv({ text: "Microphone isn't available — listen to the reference and grade yourself.", cls: "jhack-subtle", style: "text-align: center; margin-top: 0.5em;" });
      const grades = c.createDiv({ cls: "jhack-grades" });
      const good = grades.createEl("button", { text: "✓ I can say this", cls: "jhack-btn jhack-grade-good" });
      good.onclick = () => { this.scores.correct++; this.scores.total++; this.nextCard(); };
      const bad = grades.createEl("button", { text: "✗ Needs practice", cls: "jhack-btn jhack-grade-again" });
      bad.onclick = () => { this.scores.total++; this.nextCard(); };
    }

    const bottom = c.createDiv({ cls: "jhack-actions jhack-actions-center" });
    const speak = bottom.createEl("button", { text: "🔊 Hear it", cls: "jhack-btn" });
    speak.onclick = () => this.plugin.speak(this.card.word);
    const skip = bottom.createEl("button", { text: "Skip", cls: "jhack-btn jhack-btn-ghost" });
    skip.onclick = () => this.nextCard();
  }

  renderSelfCheck(recordingUrl) {
    const c = this.contentEl;
    c.empty();
    this.renderCardHeader(c);
    const playRow = c.createDiv({ cls: "jhack-actions jhack-actions-center" });
    const playMine = playRow.createEl("button", { text: "▶ Play my recording", cls: "jhack-btn" });
    playMine.onclick = () => new Audio(recordingUrl).play().catch((e) => console.error(e));
    const playRef = playRow.createEl("button", { text: "🔊 Reference", cls: "jhack-btn" });
    playRef.onclick = () => this.plugin.speak(this.card.word);

    c.createDiv({ text: "Compare your recording to the reference, then grade yourself:", cls: "jhack-subtle", style: "text-align: center; margin: 0.5em 0;" });
    const grades = c.createDiv({ cls: "jhack-grades" });
    const good = grades.createEl("button", { text: "✓ Sounded right", cls: "jhack-btn jhack-grade-good" });
    good.onclick = () => { this.scores.correct++; this.scores.total++; this.nextCard(); };
    const bad = grades.createEl("button", { text: "✗ Needs work", cls: "jhack-btn jhack-grade-again" });
    bad.onclick = () => { this.scores.total++; this.nextCard(); };
  }

  renderDone() {
    const c = this.contentEl;
    c.empty();
    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Practice Complete!" });
    });

    const accuracy = this.scores.total > 0 ? Math.round((this.scores.correct / this.scores.total) * 100) : 0;

    c.createEl("h2", { text: "Great job! 🎉" });
    c.createDiv({ cls: "jhack-summary" }, (summary) => {
      summary.createDiv({ cls: "jhack-summary-row" }, (row) => {
        row.createSpan({ text: "Words practiced" });
        row.createSpan({ text: String(this.scores.total), cls: "jhack-summary-count" });
      });
      summary.createDiv({ cls: "jhack-summary-row" }, (row) => {
        row.createSpan({ text: "Correct pronunciations" });
        row.createSpan({ text: String(this.scores.correct), cls: "jhack-summary-count" });
      });
      summary.createDiv({ cls: "jhack-summary-row" }, (row) => {
        row.createSpan({ text: "Accuracy" });
        row.createSpan({ text: `${accuracy}%`, cls: "jhack-summary-count" });
      });
    });

    const actions = c.createDiv({ cls: "jhack-actions" });
    const close = actions.createEl("button", { text: "Close", cls: "jhack-btn jhack-btn-cta" });
    close.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
    try { this.recognition?.stop(); } catch (e) {}
    this.plugin.resumeAudioAfterModal();
  }
}

/* ---------------------------------------------------------------------- *
 *  Dashboard sidebar view
 * ---------------------------------------------------------------------- */

class DashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE_DASHBOARD; }
  getDisplayText() { return "Jhack Lingua"; }
  getIcon() { return "book-open-check"; }

  async onOpen() { this.render(); }

  render() {
    const c = this.containerEl.children[1];
    c.empty();
    c.addClass("jhack-dashboard");

    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Lingua Bridge" });
    });

    const cards = this.plugin.settings.cards || {};
    const list = Object.values(cards);
    const due = this.plugin.getDueCards().length;
    const total = list.length;

    // Search box for large decks
    if (total > 20) {
      const searchBox = c.createEl("input", { 
        type: "text", 
        placeholder: "🔍 Search cards...", 
        cls: "jhack-search-input" 
      });
      searchBox.style.width = "100%";
      searchBox.style.padding = "0.5em";
      searchBox.style.marginBottom = "0.5em";
      searchBox.style.borderRadius = "var(--jhack-radius)";
      searchBox.style.border = "1px solid var(--background-modifier-border)";
      
      let searchTimeout;
      searchBox.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          this.filterCards(searchBox.value.toLowerCase());
        }, 300);
      };
    }

    const stats = c.createDiv({ cls: "jhack-dash-stats" });
    this.statCard(stats, due, "Due today");
    this.statCard(stats, total, "Total cards");
    this.statCard(stats, this.plugin.settings.streak, "Day streak 🔥");

    const startBtn = c.createEl("button", { text: `▶ Start review (${due})`, cls: "jhack-btn jhack-btn-cta jhack-full" });
    startBtn.disabled = due === 0;
    startBtn.onclick = () => this.plugin.startReview();

    const lookupBtn = c.createEl("button", { text: "🔎 Lookup a word", cls: "jhack-btn jhack-full" });
    lookupBtn.onclick = () => this.plugin.runLookup();

    const playerBtn = c.createEl("button", { text: "🎧 Open audio player", cls: "jhack-btn jhack-full" });
    playerBtn.onclick = () => this.plugin.openPlayer();

    // Daily progress chart
    this.renderProgressChart(c);

    c.createEl("h3", { text: "Leitner boxes" });
    const boxRow = c.createDiv({ cls: "jhack-box-chart" });
    const maxIntervals = this.plugin.settings.intervals.length;
    const counts = new Array(maxIntervals).fill(0);
    list.forEach((card) => { counts[Math.min(card.box, maxIntervals - 1)]++; });
    const maxCount = Math.max(1, ...counts);
    counts.forEach((n, i) => {
      const col = boxRow.createDiv({ cls: "jhack-box-col" });
      const bar = col.createDiv({ cls: "jhack-box-bar" });
      bar.style.height = Math.max(4, (n / maxCount) * 80) + "px";
      col.createDiv({ text: String(n), cls: "jhack-box-count" });
      col.createDiv({ text: "B" + (i + 1), cls: "jhack-box-tick" });
    });

    // Card list with search results container
    if (total > 0) {
      c.createEl("h3", { text: "Your Cards", cls: "jhack-cards-header" });
      this.cardListContainer = c.createDiv({ cls: "jhack-card-list" });
      this.renderCardList(list.slice(0, 50)); // Show first 50 by default
    }

    if (this.plugin.settings.history?.length) {
      c.createEl("h3", { text: "Recent lookups" });
      const hist = c.createDiv({ cls: "jhack-chips" });
      this.plugin.settings.history.slice(0, 12).forEach((w) => {
        const chip = hist.createSpan({ text: w, cls: "jhack-chip jhack-chip-clickable" });
        chip.onclick = () => new LookupModal(this.app, this.plugin, w).open();
      });
    }
  }

  renderProgressChart(container) {
    const progress = this.plugin.settings.dailyProgress || {};
    const today = todayStr();
    
    // Get last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = addDays(today, -i);
      const data = progress[date] || { added: 0, reviewed: 0 };
      days.push({ date, ...data });
    }

    container.createEl("h3", { text: "Daily Progress (last 7 days)" });
    const chart = container.createDiv({ cls: "jhack-progress-chart" });
    
    const maxVal = Math.max(1, ...days.map(d => Math.max(d.added, d.reviewed)));
    
    days.forEach(day => {
      const dayCol = chart.createDiv({ cls: "jhack-progress-col" });
      
      // Added bar
      const addedBar = dayCol.createDiv({ cls: "jhack-progress-bar jhack-progress-added" });
      addedBar.style.height = Math.max(2, (day.added / maxVal) * 60) + "px";
      addedBar.title = `Added: ${day.added}`;
      
      // Reviewed bar
      const reviewedBar = dayCol.createDiv({ cls: "jhack-progress-bar jhack-progress-reviewed" });
      reviewedBar.style.height = Math.max(2, (day.reviewed / maxVal) * 60) + "px";
      reviewedBar.title = `Reviewed: ${day.reviewed}`;
      
      // Date label
      const dateLabel = dayCol.createDiv({ 
        text: day.date.slice(5), // MM-DD
        cls: "jhack-progress-date" 
      });
    });
    
    // Legend
    const legend = container.createDiv({ cls: "jhack-progress-legend" });
    legend.createSpan({ text: "■ ", cls: "jhack-legend-added" });
    legend.createSpan({ text: "Added  ", cls: "jhack-subtle" });
    legend.createSpan({ text: "■ ", cls: "jhack-legend-reviewed" });
    legend.createSpan({ text: "Reviewed", cls: "jhack-subtle" });
  }

  filterCards(query) {
    if (!this.cardListContainer) return;
    
    const cards = this.plugin.settings.cards || {};
    const list = Object.values(cards);
    const filtered = query 
      ? list.filter(c => c.word.toLowerCase().includes(query))
      : list;
    
    this.renderCardList(filtered.slice(0, 100));
  }

  renderCardList(cards) {
    this.cardListContainer.empty();
    
    if (cards.length === 0) {
      this.cardListContainer.createDiv({ text: "No cards found.", cls: "jhack-subtle" });
      return;
    }
    
    cards.forEach(card => {
      const row = this.cardListContainer.createDiv({ cls: "jhack-card-row" });
      row.createSpan({ text: card.word, cls: "jhack-card-word" });
      row.createSpan({ text: `Box ${card.box + 1}`, cls: "jhack-badge jhack-badge-box" });
      row.createSpan({ text: `Due: ${card.due}`, cls: "jhack-card-due" });
      
      row.style.cursor = "pointer";
      row.onclick = () => {
        new LookupModal(this.app, this.plugin, card.word, card.context).open();
      };
    });
    
    if (cards.length === 100) {
      this.cardListContainer.createDiv({ 
        text: "... and more. Use search to find specific cards.", 
        cls: "jhack-subtle" 
      });
    }
  }

  statCard(parent, value, label) {
    const el = parent.createDiv({ cls: "jhack-stat" });
    el.createDiv({ text: String(value), cls: "jhack-stat-value" });
    el.createDiv({ text: label, cls: "jhack-stat-label" });
  }

  async onClose() {}
}

/* ---------------------------------------------------------------------- *
 *  Audio Player sidebar view
 * ---------------------------------------------------------------------- */

class PlayerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE_PLAYER; }
  getDisplayText() { return "Jhack Audio Player"; }
  getIcon() { return "headphones"; }

  async onOpen() { this.render(); }

  render() {
    const c = this.containerEl.children[1];
    c.empty();
    c.addClass("jhack-player");

    c.createDiv({ cls: "jhack-brand" }, (b) => {
      b.createSpan({ text: "Jhack", cls: "jhack-brand-strong" });
      b.createSpan({ text: " Audio Player" });
    });
    c.createDiv({ text: "Load a local audio file to listen to while you read — playback automatically pauses during Lookup and Review.", cls: "jhack-subtle" });

    const fileBtn = c.createEl("button", { text: "📁 Choose audio file", cls: "jhack-btn jhack-full" });
    fileBtn.onclick = () => this.chooseFile();

    this.box = c.createDiv({ cls: "jhack-player-box" });
    this.renderBox();
  }

  chooseFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.className = "jhack-file-input";
    input.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await this.plugin.loadAudioFile(file);
      this.renderBox();
    };
    input.click();
  }

  renderBox() {
    if (!this.box) return;
    if (this._statusInterval) { clearInterval(this._statusInterval); this._statusInterval = null; }
    this.box.empty();
    const name = this.plugin.settings.audioFileName || "";
    if (!name || !this.plugin.settings.audioData) {
      this.box.createDiv({ text: "No audio file loaded yet.", cls: "jhack-subtle" });
      return;
    }
    this.box.createDiv({ text: name, cls: "jhack-box-body" });

    const controls = this.box.createDiv({ cls: "jhack-player-controls" });
    const playBtn = controls.createEl("button", { text: "▶ Play", cls: "jhack-btn" });
    playBtn.onclick = () => this.plugin.playAudio();
    const pauseBtn = controls.createEl("button", { text: "⏸ Pause", cls: "jhack-btn" });
    pauseBtn.onclick = () => this.plugin.pauseAudio();
    const stopBtn = controls.createEl("button", { text: "⏹ Stop", cls: "jhack-btn" });
    stopBtn.onclick = () => this.plugin.stopAudio();

    controls.createSpan({ text: "🔊", cls: "jhack-vol-label" });
    const vol = controls.createEl("input", { type: "range" });
    vol.min = "0"; vol.max = "1"; vol.step = "0.05";
    vol.value = String(this.plugin.settings.audioVolume ?? 1);
    vol.oninput = () => this.plugin.setAudioVolume(parseFloat(vol.value));

    this.statusEl = this.box.createDiv({ cls: "jhack-player-status" });
    this.updateStatus();
    this._statusInterval = setInterval(() => this.updateStatus(), 1000);
  }

  updateStatus() {
    if (!this.statusEl) return;
    const el = this.plugin.audioEl;
    if (!el) { this.statusEl.setText(""); return; }
    const state = el.paused ? (el.currentTime > 0 ? "Paused" : "Stopped") : "Playing";
    const cur = formatTime(el.currentTime || 0);
    const dur = formatTime(el.duration || 0);
    this.statusEl.setText(`${state} — ${cur} / ${dur}`);
  }

  async onClose() {
    if (this._statusInterval) clearInterval(this._statusInterval);
  }
}

/* ---------------------------------------------------------------------- *
 *  Leitner word highlighting + single-click select / double-click lookup
 *  editor extension (CodeMirror 6, exposed by Obsidian at runtime).
 * ---------------------------------------------------------------------- */

function buildLeitnerExtension(plugin) {
  let cmView, cmState;
  try {
    cmView = require("@codemirror/view");
    cmState = require("@codemirror/state");
  } catch (e) {
    console.error("Jhack Lingua: CodeMirror modules unavailable — word highlighting/click-select disabled", e);
    return null;
  }
  const { ViewPlugin, Decoration, EditorView } = cmView;
  const { RangeSetBuilder } = cmState;

  function getWordSet() {
    const cards = plugin.settings.cards || {};
    const set = new Set();
    Object.values(cards).forEach((c) => set.add(c.word.toLowerCase()));
    return set;
  }

  function buildDecorations(view) {
    const builder = new RangeSetBuilder();
    if (!plugin.settings.highlightLeitnerWords) return builder.finish();
    const words = getWordSet();
    if (!words.size) return builder.finish();
    const wordRe = /[A-Za-z']+/g;
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      let m;
      wordRe.lastIndex = 0;
      while ((m = wordRe.exec(text))) {
        const w = m[0].toLowerCase();
        if (words.has(w)) {
          const start = from + m.index;
          const end = start + m[0].length;
          builder.add(start, end, Decoration.mark({ class: "jhack-leitner-word" }));
        }
      }
    }
    return builder.finish();
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view);
      }
      update(update) {
        // Recomputed on every editor transaction (not just doc/viewport changes) so that
        // adding or removing a Leitner card is reflected immediately — the plugin forces
        // a no-op transaction on open editors (see refreshEditors()) specifically to
        // trigger this. The scan itself is cheap since it's limited to visibleRanges.
        this.decorations = buildDecorations(update.view);
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click(event, view) {
          if (!plugin.settings.singleClickSelect) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const word = view.state.wordAt(pos);
          if (word) view.dispatch({ selection: { anchor: word.from, head: word.to } });
          return false;
        },
        dblclick(event, view) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const word = view.state.wordAt(pos);
          if (!word) return false;
          const text = view.state.sliceDoc(word.from, word.to);
          const line = view.state.doc.lineAt(word.from).text;
          new LookupModal(plugin.app, plugin, plugin.clean(text), line).open();
          return false;
        }
      }
    }
  );
}

/* ---------------------------------------------------------------------- *
 *  Plugin
 * ---------------------------------------------------------------------- */

class JhackLingua extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULTS, saved);
    this.settings.cards = (saved && saved.cards) || {};
    this.settings.intervals = (saved && saved.intervals) || DEFAULT_INTERVALS.slice();
    this.settings.history = (saved && saved.history) || [];

    this.voices = [];
    this.loadVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.addEventListener?.("voiceschanged", () => this.loadVoices());
    }

    this.applyTheme();

    // Restore the audio element from persisted bytes so playback (and auto
    // pause/resume) works even before the player sidebar view is opened.
    if (this.settings.audioData) {
      try { this.setupAudioElement(); } catch (e) { console.error("Jhack Lingua: failed to restore audio player", e); }
    }

    this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TYPE_PLAYER, (leaf) => new PlayerView(leaf, this));

    const leitnerExt = buildLeitnerExtension(this);
    if (leitnerExt) this.registerEditorExtension(leitnerExt);

    this.addCommand({ id: "lookup-selection", name: "Lookup selection or clipboard", callback: () => this.runLookup() });
    this.addCommand({
      id: "markdown-selection",
      name: "Lookup Markdown selection",
      editorCallback: (editor) => {
        const t = editor.getSelection().trim();
        if (!t) { new Notice("Select a word first."); return; }
        new LookupModal(this.app, this, this.clean(t), editor.getLine(editor.getCursor().line)).open();
      }
    });
    this.addCommand({ id: "pdf-epub-selection", name: "Lookup PDF/EPUB clipboard selection", callback: () => this.runClipboardLookup() });
    this.addCommand({ id: "start-review", name: "Start Leitner review session", callback: () => this.startReview() });
    this.addCommand({ id: "open-dashboard", name: "Open Jhack Lingua dashboard", callback: () => this.openDashboard() });
    this.addCommand({ id: "open-player", name: "Open Jhack Lingua audio player", callback: () => this.openPlayer() });
    this.addCommand({ id: "import-legacy-deck", name: "Import legacy Spaced Repetition deck", callback: () => this.importLegacyDeck() });
    this.addCommand({ id: "import-excel-csv", name: "Import cards from Excel/CSV file", callback: () => this.importExcelFile() });
    this.addCommand({ id: "pronunciation-practice", name: "Start pronunciation practice session", callback: () => this.startPronunciationPractice() });

    this.addRibbonIcon("book-open-check", "Jhack Lingua: Lookup", () => this.runLookup());
    this.addRibbonIcon("layers", "Jhack Lingua: Review", () => this.startReview());
    this.addRibbonIcon("headphones", "Jhack Lingua: Audio Player", () => this.openPlayer());

    this.addSettingTab(new JhackSettings(this.app, this));

    // First time this plugin is enabled in a vault, surface the dashboard automatically
    // so the user immediately sees it land in the sidebar. Subsequent app launches
    // respect whatever layout the user already has (won't force-reopen every time).
    if (!this.settings.onboarded) {
      this.app.workspace.onLayoutReady(() => {
        this.openDashboard();
        this.settings.onboarded = true;
        this.persist();
      });
    }

    this.app.workspace.onLayoutReady(() => this.checkDailyReminder());
  }

  /** Once per day, if there are cards due, a single Notice — same idea as the "you have cards due" nudge, just wired to this plugin's actual due-count logic instead of a separate tracker. */
  checkDailyReminder() {
    if (!this.settings.dailyReminder) return;
    const today = todayStr();
    if (this.settings.lastReminderDay === today) return;
    const due = this.getDueCards().length;
    if (due > 0) new Notice(`📚 You have ${due} card(s) due for review today.`);
    this.settings.lastReminderDay = today;
    this.persist();
  }

  onunload() {
    window.speechSynthesis?.cancel();
    try { this.audioEl?.pause(); } catch (e) {}
  }

  /* ---------------- persistence ---------------- */

  async persist() { await this.saveData(this.settings); }

  applyTheme() {
    const hex = THEMES[this.settings.theme] || THEMES.crimson;
    document.body.style.setProperty("--jhack-accent", hex);
  }

  /* ---------------- selection / clipboard ---------------- */

  async getClipboard() {
    try {
      const { clipboard } = require("electron");
      return clipboard.readText().trim();
    } catch (e) {
      try { return (await navigator.clipboard.readText()).trim(); } catch (e2) { return ""; }
    }
  }
  getSelection() {
    try { return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection().trim() || ""; }
    catch (e) { return ""; }
  }
  getContext() {
    try {
      const v = this.app.workspace.getActiveViewOfType(MarkdownView);
      return v?.editor.getLine(v.editor.getCursor().line) || "";
    } catch (e) { return ""; }
  }
  clean(t) {
    return t.replace(/\s+/g, " ").trim().replace(/^[“"'`]+|[”"'`.,!?;:]+$/g, "").split(/\s+/)[0];
  }

  runLookup() {
    const sel = this.getSelection();
    if (sel) { new LookupModal(this.app, this, this.clean(sel), this.getContext()).open(); return; }
    this.getClipboard().then((t) => {
      if (!t) { new Notice("Select a word, or copy it with Ctrl+C."); return; }
      new LookupModal(this.app, this, this.clean(t), this.getContext()).open();
    });
  }

  runClipboardLookup() {
    this.getClipboard().then((t) => {
      if (!t) { new Notice("Select text in PDF/EPUB and press Ctrl+C first."); return; }
      new LookupModal(this.app, this, this.clean(t)).open();
    });
  }

  pushHistory(word) {
    const w = word.toLowerCase();
    this.settings.history = [w, ...this.settings.history.filter((x) => x !== w)].slice(0, 30);
    this.persist();
  }

  /* ---------------- dictionary lookup ---------------- */

  async ensureDictLoaded() {
    if (this.dictCache) return;
    this.dictCache = { persian: {}, offline: {} };
    try {
      const p = `${this.manifest.dir}/data/persian-index.json`;
      if (await this.app.vault.adapter.exists(p)) {
        this.dictCache.persian = JSON.parse(await this.app.vault.adapter.read(p));
      }
    } catch (e) { console.error("Jhack Lingua: failed to load persian-index.json", e); }
    try {
      const p2 = `${this.manifest.dir}/data/offline-dictionary.json`;
      if (await this.app.vault.adapter.exists(p2)) {
        this.dictCache.offline = JSON.parse(await this.app.vault.adapter.read(p2));
      }
    } catch (e) { console.error("Jhack Lingua: failed to load offline-dictionary.json", e); }
  }

  mergeField(result, item) {
    if (!item) return;
    if (!result.translation && item.translation) result.translation = item.translation;
    if (!result.definition && item.definition) result.definition = item.definition;
    if (!result.example && item.example) result.example = item.example;
    if (!result.pos && item.pos) result.pos = item.pos;
    if (!result.phonetic && item.phonetic) result.phonetic = item.phonetic;
    if (!result.synonyms.length && item.synonyms?.length) result.synonyms = item.synonyms;
  }

  async lookup(word) {
    const n = word.toLowerCase();
    const result = { translation: "", definition: "", example: "", pos: "", phonetic: "", synonyms: [] };

    await this.ensureDictLoaded();

    // Words translated online in a past session are cached here — check this first,
    // it's free and fully offline from the second lookup onward.
    if (this.settings.userTranslations[n]) result.translation = this.settings.userTranslations[n];

    // Curated Persian entries take priority, then the large offline English dictionary
    // (108k+ words). Neither source short-circuits the other any more, so every field
    // gets a chance to be filled from whichever source actually has it.
    const singular = n.endsWith("s") ? n.slice(0, -1) : n;
    for (const idx of [this.dictCache.persian, this.dictCache.offline]) {
      this.mergeField(result, idx[n] || idx[singular]);
    }

    if ((!result.definition || !result.example) && this.settings.onlineFallback) {
      try {
        const res = await requestUrl({ url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(n)}` });
        const entry = JSON.parse(res.text)?.[0];
        if (entry) {
          const meaning = entry.meanings?.[0];
          const def = meaning?.definitions?.[0];
          this.mergeField(result, {
            phonetic: (entry.phonetic || "").replace(/\//g, ""),
            pos: meaning?.partOfSpeech || "",
            definition: def?.definition || "",
            example: def?.example || "",
            synonyms: (meaning?.synonyms || []).slice(0, 12)
          });
        }
      } catch (e) { /* offline or blocked — silently fall back */ }
    }

    // Real machine translation for words missing everywhere else. Google Translate's
    // free keyless endpoint is tried first (generally the most accurate for short
    // phrases), then MyMemory as a second opinion if Google is blocked/unavailable.
    // Whatever comes back is cached to userTranslations so it's offline from now on.
    if (!result.translation && this.settings.onlineFallback) {
      let translated = "";
      if (this.settings.useGoogleTranslate) translated = await this.translateViaGoogle(word);
      if (!translated) translated = await this.translateViaMyMemory(word);
      if (translated) {
        result.translation = translated;
        this.settings.userTranslations[n] = translated;
        this.persist();
      }
    }

    return result;
  }

  /** Free, keyless Google Translate endpoint (the same one translate.google.com's own web page calls). */
  async translateViaGoogle(word) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(word)}`;
      const res = await requestUrl({ url });
      const payload = JSON.parse(res.text);
      const translated = payload?.[0]?.map((chunk) => chunk[0]).join("").trim();
      return translated && translated.toLowerCase() !== word.toLowerCase() ? translated : "";
    } catch (e) { return ""; }
  }

  async translateViaMyMemory(word) {
    try {
      const res = await requestUrl({ url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|fa` });
      const payload = JSON.parse(res.text);
      const translated = payload?.responseData?.translatedText;
      return translated && !/mymemory|invalid|query length/i.test(translated) ? translated : "";
    } catch (e) { return ""; }
  }

  /**
   * Word images are online-only by design: fetched fresh from Wikipedia's free
   * public API every time and returned as a direct https image URL. Nothing is
   * saved to disk/settings — an in-memory Map just avoids hammering the API
   * twice for the same word inside a single Obsidian session, and it's gone the
   * moment the app closes. Needs "Online fallback" + "Fetch word images" on.
   */
  async getWordImage(word) {
    const n = word.toLowerCase();
    if (!this._imageMemCache) this._imageMemCache = new Map();
    if (this._imageMemCache.has(n)) return this._imageMemCache.get(n);
    if (!this.settings.onlineFallback || !this.settings.fetchWordImages) return "";
    let url = "";
    try {
      const res = await requestUrl({ url: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}` });
      const data = JSON.parse(res.text);
      url = data?.thumbnail?.source || "";
    } catch (e) { url = ""; }
    this._imageMemCache.set(n, url);
    return url;
  }

  /* ---------------- similar words / other forms ---------------- */

  dictHas(word) {
    const n = word.toLowerCase();
    return !!((this.dictCache?.persian && this.dictCache.persian[n]) || (this.dictCache?.offline && this.dictCache.offline[n]));
  }

  /** Cheap heuristic inflections (plural/singular, -ing/-ed) filtered to ones that actually exist in the offline dictionary. */
  getWordForms(word) {
    if (!this.dictCache) return [];
    const w = word.toLowerCase();
    const forms = new Set();
    const add = (f) => { if (f && f !== w) forms.add(f); };
    if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
    if (w.endsWith("es")) add(w.slice(0, -2));
    if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
    else add(w + "s");
    if (w.endsWith("y")) add(w.slice(0, -1) + "ies");
    if (w.endsWith("ing")) { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
    else add(w + "ing");
    if (w.endsWith("ed")) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    else add(w + "ed");
    return Array.from(forms).filter((f) => this.dictHas(f));
  }

  /** Dictionary entries within a small edit distance of the given word — same-prefix scan to keep it fast against a 100k+ word list. */
  getSimilarWords(word, limit = 8) {
    if (!this.dictCache?.offline) return [];
    const w = word.toLowerCase();
    if (w.length < 3) return [];
    const prefix = w.slice(0, 2);
    const keys = Object.keys(this.dictCache.offline);
    const candidates = keys.filter((k) => k.startsWith(prefix) && Math.abs(k.length - w.length) <= 2 && k !== w);
    return candidates
      .map((k) => ({ k, d: levenshtein(w, k) }))
      .filter((x) => x.d > 0 && x.d <= 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((x) => x.k);
  }

  /* ---------------- Leitner deck ---------------- */

  hasCard(word) {
    const n = word.toLowerCase();
    return Object.values(this.settings.cards).some((c) => c.word.toLowerCase() === n);
  }

  async addCard(word, data, context) {
    if (this.hasCard(word)) return;
    const card = {
      id: uid(),
      word,
      data,
      context: context || "",
      box: 0,
      due: todayStr(),
      reps: 0,
      lapses: 0,
      created: Date.now()
    };
    this.settings.cards[card.id] = card;
    
    // Track daily progress
    const today = todayStr();
    if (!this.settings.dailyProgress[today]) {
      this.settings.dailyProgress[today] = { added: 0, reviewed: 0 };
    }
    this.settings.dailyProgress[today].added++;
    
    await this.persist();
    this.refreshDashboard();
    return card;
  }

  getDueCards() {
    const today = todayStr();
    return Object.values(this.settings.cards).filter((c) => c.due <= today);
  }

  startReview() {
    const due = this.getDueCards();
    if (!due.length) { new Notice("No cards are due right now. Great job staying on top of it!"); return; }
    const limited = due
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.max(1, this.settings.dailyReviewLimit || 60));
    this.bumpStreak();
    new ReviewModal(this.app, this, limited).open();
  }

  reviewCard(card, grade) {
    const maxBox = this.settings.intervals.length - 1;
    card.reps++;
    if (grade === "again") {
      card.box = 0;
      card.lapses++;
    } else if (grade === "hard") {
      card.box = Math.max(0, card.box - 0);
    } else if (grade === "good") {
      card.box = Math.min(maxBox, card.box + 1);
    } else if (grade === "easy") {
      card.box = Math.min(maxBox, card.box + 2);
    }
    const days = this.settings.intervals[card.box] ?? this.settings.intervals[maxBox];
    card.due = addDays(todayStr(), grade === "again" ? 0 : days);
    card.lastReview = Date.now();
    this.settings.cards[card.id] = card;
    
    // Track daily progress for reviews
    const today = todayStr();
    if (!this.settings.dailyProgress[today]) {
      this.settings.dailyProgress[today] = { added: 0, reviewed: 0 };
    }
    this.settings.dailyProgress[today].reviewed++;
    
    this.persist();
    this.refreshDashboard();
  }

  bumpStreak() {
    const today = todayStr();
    if (this.settings.lastStudyDay === today) return;
    const yesterday = addDays(today, -1);
    this.settings.streak = this.settings.lastStudyDay === yesterday ? this.settings.streak + 1 : 1;
    this.settings.lastStudyDay = today;
    this.persist();
  }

  /* ---------------- dashboard view ---------------- */

  async openDashboard() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
    if (existing) { this.app.workspace.revealLeaf(existing); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshDashboard() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD).forEach((leaf) => {
      if (leaf.view instanceof DashboardView) leaf.view.render();
    });
    this.refreshEditors();
  }

  /** Forces every open Markdown editor to re-run the Leitner highlighting decoration
   *  immediately after the deck changes, instead of waiting for the next keystroke/scroll. */
  refreshEditors() {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      try { leaf.view.editor?.cm?.dispatch({}); } catch (e) { /* older Obsidian build without CM6 access — highlighting still updates on next edit/scroll */ }
    });
  }

  /* ---------------- audio player view ---------------- */

  async openPlayer() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PLAYER)[0];
    if (existing) { this.app.workspace.revealLeaf(existing); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_PLAYER, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshPlayer() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PLAYER).forEach((leaf) => {
      if (leaf.view instanceof PlayerView) leaf.view.renderBox();
    });
  }

  /* ---------------- audio player engine ---------------- */

  async loadAudioFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      this.settings.audioData = base64;
      this.settings.audioMime = file.type || "audio/mpeg";
      this.settings.audioFileName = file.name;
      await this.persist();
      this.setupAudioElement();
      new Notice(`Loaded "${file.name}"`);
    } catch (e) {
      console.error("Jhack Lingua: failed to load audio file", e);
      new Notice("Could not load audio file.");
    }
  }

  setupAudioElement() {
    if (!this.settings.audioData) return;
    try {
      const blob = base64ToBlob(this.settings.audioData, this.settings.audioMime);
      const url = URL.createObjectURL(blob);
      if (this.audioEl) {
        this.audioEl.pause();
        try { URL.revokeObjectURL(this.audioEl.src); } catch (e) {}
      }
      this.audioEl = new Audio(url);
      this.audioEl.volume = this.settings.audioVolume ?? 1;
    } catch (e) {
      console.error("Jhack Lingua: failed to set up audio element", e);
    }
  }

  playAudio() {
    if (!this.audioEl) this.setupAudioElement();
    if (this.audioEl) this.audioEl.play().catch((e) => console.error("Jhack Lingua: audio play failed", e));
  }
  pauseAudio() { this.audioEl?.pause(); }
  stopAudio() {
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.currentTime = 0; }
  }
  setAudioVolume(v) {
    this.settings.audioVolume = v;
    if (this.audioEl) this.audioEl.volume = v;
    this.persist();
  }

  /** Auto pause/resume: called by Lookup/Review/Pronunciation modals so listening never overlaps with a lookup or study session. */
  pauseAudioForModal() {
    if (this.audioEl && !this.audioEl.paused) {
      this.audioEl.pause();
      this._resumeAudioAfterModal = true;
    }
  }
  resumeAudioAfterModal() {
    if (this._resumeAudioAfterModal && this.audioEl) {
      this.audioEl.play().catch(() => {});
    }
    this._resumeAudioAfterModal = false;
  }

  /* ---------------- migration from the Spaced Repetition plugin ---------------- */

  async importLegacyDeck() {
    const files = this.app.vault.getMarkdownFiles();
    let imported = 0;
    for (const f of files) {
      let text;
      try { text = await this.app.vault.cachedRead(f); } catch (e) { continue; }
      if (!/#flashcards/i.test(text)) continue;

      const multi = [...text.matchAll(/\n([^\n?]+)\n\?\n([\s\S]*?)(?=\n\n|\n[^\n?]+\n\?\n|$)/g)];
      for (const m of multi) {
        const word = m[1].trim();
        if (!word || this.hasCard(word)) continue;
        const answer = m[2].trim();
        const data = { translation: answer.split("\n")[0] || "", definition: "", example: "", pos: "", phonetic: "", synonyms: [] };
        await this.addCard(word, data, `Imported from ${f.path}`);
        imported++;
      }

      const single = [...text.matchAll(/^\s*([^\n:]+?)\s*::\s*(.+)$/gm)];
      for (const m of single) {
        const word = m[1].trim();
        if (!word || this.hasCard(word)) continue;
        const data = { translation: m[2].trim(), definition: "", example: "", pos: "", phonetic: "", synonyms: [] };
        await this.addCard(word, data, `Imported from ${f.path}`);
        imported++;
      }
    }
    new Notice(imported ? `Imported ${imported} card(s) into your Leitner deck.` : "No legacy flashcards found.");
  }

  /* ---------------- Excel/CSV Import ---------------- */

  async importExcelFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xlsx,.xls,.tsv";

    input.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const fileName = file.name.toLowerCase();

      try {
        if (fileName.endsWith(".xlsx")) {
          const buf = await file.arrayBuffer();
          const rows = this.parseXlsx(buf);
          await this.importRows(rows);
        } else if (fileName.endsWith(".xls")) {
          new Notice("Legacy .xls binary format isn't supported — please re-save as .xlsx or .csv in Excel/LibreOffice and import that instead.");
        } else {
          const content = await file.text();
          const rows = this.parseDelimited(content);
          await this.importRows(rows);
        }
      } catch (err) {
        console.error("Jhack Lingua: import error", err);
        new Notice("Could not read that file — see the developer console (Ctrl+Shift+I) for details.");
      }
    };

    input.click();
  }

  /** RFC4180-ish delimited text parser: handles quoted fields, escaped quotes, and comma/semicolon/tab delimiters. */
  parseDelimited(content) {
    const delim = content.indexOf("\t") !== -1 ? "\t" : (content.indexOf(";") !== -1 && content.indexOf(",") === -1 ? ";" : ",");
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i], next = content[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === delim) { row.push(field); field = ""; }
        else if (ch === "\r") { /* skip */ }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  /** Minimal, dependency-free .xlsx reader: unzips with Node's built-in zlib (xlsx is a ZIP of XML files),
   *  then parses sharedStrings.xml + the first worksheet's XML with the browser's DOMParser. */
  parseXlsx(arrayBuffer) {
    const zlib = require("zlib");
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    // Walk local file headers (signature 0x04034b50) rather than the central directory —
    // simpler to get right and sufficient for reading the two files we need.
    const files = {};
    let offset = 0;
    while (offset + 4 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;
      const method = view.getUint16(offset + 8, true);
      const compSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
      const dataStart = nameStart + nameLen + extraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      try {
        files[name] = method === 0
          ? Buffer.from(raw)
          : zlib.inflateRawSync(Buffer.from(raw));
      } catch (e) { /* skip unreadable entry */ }
      offset = dataStart + compSize;
    }

    const parser = new DOMParser();
    const sharedStrings = [];
    if (files["xl/sharedStrings.xml"]) {
      const doc = parser.parseFromString(files["xl/sharedStrings.xml"].toString("utf8"), "application/xml");
      doc.querySelectorAll("si").forEach((si) => {
        const text = Array.from(si.querySelectorAll("t")).map((t) => t.textContent).join("");
        sharedStrings.push(text);
      });
    }

    // Find the first worksheet — usually xl/worksheets/sheet1.xml.
    const sheetName = Object.keys(files).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
      || Object.keys(files).find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n));
    if (!sheetName) throw new Error("No worksheet found in .xlsx file");

    const sheetDoc = parser.parseFromString(files[sheetName].toString("utf8"), "application/xml");
    const rows = [];
    sheetDoc.querySelectorAll("row").forEach((rowEl) => {
      const row = [];
      rowEl.querySelectorAll("c").forEach((cellEl) => {
        const ref = cellEl.getAttribute("r") || "";
        const colIdx = this.xlsxColIndex(ref);
        const type = cellEl.getAttribute("t");
        const vEl = cellEl.querySelector("v");
        let value = "";
        if (type === "s" && vEl) value = sharedStrings[parseInt(vEl.textContent, 10)] ?? "";
        else if (type === "inlineStr") value = cellEl.querySelector("is t")?.textContent ?? "";
        else if (vEl) value = vEl.textContent ?? "";
        while (row.length < colIdx) row.push("");
        row[colIdx] = value;
      });
      rows.push(row);
    });
    return rows;
  }

  xlsxColIndex(ref) {
    const letters = (ref.match(/[A-Z]+/) || ["A"])[0];
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  async importRows(rows) {
    if (!rows.length) { new Notice("File appears to be empty."); return; }

    const header = rows[0].map((h) => String(h || "").toLowerCase().trim());
    const wordIdx = header.findIndex((h) => h.includes("word"));
    const meaningIdx = header.findIndex((h) => h.includes("meaning") || h.includes("translation") || h.includes("definition"));
    const exampleIdx = header.findIndex((h) => h.includes("example"));
    const pronunciationIdx = header.findIndex((h) => h.includes("pronunciation") || h.includes("phonetic"));

    if (wordIdx === -1) {
      new Notice("Could not find a 'Word' column in the header row. Expected columns like: Word, Meaning, Example, Pronunciation.");
      return;
    }

    let imported = 0, skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const parts = rows[i];
      const word = (parts[wordIdx] || "").toString().trim();
      if (!word) continue;
      if (this.hasCard(word)) { skipped++; continue; }

      const data = {
        translation: meaningIdx !== -1 ? String(parts[meaningIdx] || "").trim() : "",
        definition: "",
        example: exampleIdx !== -1 ? String(parts[exampleIdx] || "").trim() : "",
        pos: "",
        phonetic: pronunciationIdx !== -1 ? String(parts[pronunciationIdx] || "").trim() : "",
        synonyms: []
      };
      await this.addCard(word, data, "Imported from file");
      imported++;
      if (imported % 100 === 0) await new Promise((r) => setTimeout(r, 10));
    }

    new Notice(`Imported ${imported} card(s)${skipped > 0 ? `, skipped ${skipped} duplicate(s)` : ""}.`);
    this.refreshDashboard();
  }

  /* ---------------- export / import / reset ---------------- */

  exportDeckJSON() { return JSON.stringify(this.settings.cards, null, 2); }

  async importDeckJSON(json) {
    const incoming = JSON.parse(json);
    let count = 0;
    for (const card of Object.values(incoming)) {
      if (!card.word || this.hasCard(card.word)) continue;
      const id = uid();
      this.settings.cards[id] = Object.assign({}, card, { id });
      count++;
    }
    await this.persist();
    this.refreshDashboard();
    return count;
  }

  async resetDeck() {
    this.settings.cards = {};
    await this.persist();
    this.refreshDashboard();
  }

  /* ---------------- pronunciation ---------------- */
  //
  // Layered speech engine, in order of preference:
  //   1. Web Speech API (window.speechSynthesis) — best quality when the OS has voices.
  //   2. A bundled, fully offline speech engine (meSpeak — a JS/asm.js build of eSpeak)
  //      shipped inside this plugin's own `engine/mespeak` folder. This needs nothing
  //      installed on the system at all, so it's the reliable fallback for the common
  //      case (seen on fresh Linux installs) where Chromium reports Web Speech as
  //      available but has zero actual voices and silently plays nothing.
  //   3. The system's espeak-ng binary, if present, as a last resort.
  // If literally none of the three work, the user gets a clear, actionable Notice.

  loadVoices() {
    try { this.voices = window.speechSynthesis?.getVoices() || []; } catch (e) { this.voices = []; }
  }

  pickVoice(lang) {
    if (!this.voices.length) this.loadVoices();
    if (this.settings.voiceURI) {
      const chosen = this.voices.find((v) => v.voiceURI === this.settings.voiceURI);
      if (chosen) return chosen;
    }
    const wantLang = lang === "fa" ? "fa" : (this.settings.accent === "uk" ? "en-GB" : "en-US");
    return (
      this.voices.find((v) => v.lang?.toLowerCase() === wantLang.toLowerCase()) ||
      this.voices.find((v) => v.lang?.toLowerCase().startsWith(lang === "fa" ? "fa" : "en")) ||
      this.voices[0] ||
      null
    );
  }

  speak(text, lang = "en") {
    if (!text) return;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    const voice = synth ? this.pickVoice(lang) : null;

    // No engine, or the engine has no voices at all (the common broken-Linux case) —
    // go straight to the bundled engine instead of calling speak() into the void.
    if (!synth || !voice) {
      this.speakViaBundledEngine(text, lang);
      return;
    }

    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.voice = voice;
      utter.lang = voice.lang || (lang === "fa" ? "fa-IR" : (this.settings.accent === "uk" ? "en-GB" : "en-US"));
      utter.rate = this.settings.rate || 1;
      utter.pitch = this.settings.pitch || 1;

      let started = false;
      utter.onstart = () => { started = true; };
      utter.onerror = (e) => {
        console.error("Jhack Lingua TTS error:", e);
        if (!started) this.speakViaBundledEngine(text, lang);
      };
      synth.speak(utter);

      // Safety net: some Linux configs never fire onstart or onerror and just
      // stay silent. If nothing actually started shortly after speak(), fall back.
      setTimeout(() => {
        if (!started && !synth.speaking) this.speakViaBundledEngine(text, lang);
      }, 600);
    } catch (e) {
      console.error("Jhack Lingua TTS error:", e);
      this.speakViaBundledEngine(text, lang);
    }
  }

  /** Lazily loads the bundled meSpeak engine (pure JS, no system dependency, English only). */
  loadBundledEngine() {
    if (this._meSpeak !== undefined) return this._meSpeak;
    this._meSpeak = null;
    try {
      const path = require("path");
      const fs = require("fs");
      const base = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
      const dir = path.join(base, this.manifest.dir, "engine", "mespeak");
      const indexPath = path.join(dir, "index.js");
      if (!fs.existsSync(indexPath)) return null;
      const meSpeak = require(indexPath);
      meSpeak.loadConfig(JSON.parse(fs.readFileSync(path.join(dir, "mespeak_config.json"), "utf8")));
      meSpeak.loadVoice(JSON.parse(fs.readFileSync(path.join(dir, "voices", "en-us.json"), "utf8")));
      meSpeak.loadVoice(JSON.parse(fs.readFileSync(path.join(dir, "voices", "en-gb.json"), "utf8")));
      meSpeak.setDefaultVoice("en/en-us");
      this._meSpeak = meSpeak;
    } catch (e) {
      console.error("Jhack Lingua: bundled speech engine failed to load", e);
      this._meSpeak = null;
    }
    return this._meSpeak;
  }

  speakViaBundledEngine(text, lang) {
    if (lang === "fa") { this.speakViaSystemEspeak(text, lang); return; } // no bundled Persian voice
    const meSpeak = this.loadBundledEngine();
    if (!meSpeak) { this.speakViaSystemEspeak(text, lang); return; }
    try {
      const voiceId = this.settings.accent === "uk" ? "en/en" : "en/en-us";
      const ok = meSpeak.speak(text, {
        voice: voiceId,
        speed: Math.round(175 * (this.settings.rate || 1)),
        pitch: Math.round(50 * (this.settings.pitch || 1))
      });
      if (!ok) this.speakViaSystemEspeak(text, lang);
    } catch (e) {
      console.error("Jhack Lingua: bundled engine playback failed", e);
      this.speakViaSystemEspeak(text, lang);
    }
  }

  findEspeakBinary() {
    if (this._espeakPath !== undefined) return this._espeakPath;
    let fs;
    try { fs = require("fs"); } catch (e) { this._espeakPath = null; return null; }
    const candidates = [
      "/usr/bin/espeak-ng", "/usr/local/bin/espeak-ng", "/snap/bin/espeak-ng",
      "/usr/bin/espeak", "/usr/local/bin/espeak",
      "/opt/homebrew/bin/espeak-ng", "/opt/homebrew/bin/espeak"
    ];
    this._espeakPath = candidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
    return this._espeakPath;
  }

  speakViaSystemEspeak(text, lang) {
    let execFile;
    try { ({ execFile } = require("child_process")); } catch (e) {
      new Notice("Pronunciation isn't available on this platform.");
      return;
    }
    const bin = this.findEspeakBinary() || "espeak-ng"; // fall back to relying on PATH
    const voiceFlag = lang === "fa" ? "fa" : (this.settings.accent === "uk" ? "en-gb" : "en-us");
    execFile(bin, ["-v", voiceFlag, "-s", String(Math.round((this.settings.rate || 1) * 160)), text], (err) => {
      if (err) {
        console.error("Jhack Lingua fallback speech error:", err);
        new Notice(lang === "fa"
          ? "No Persian voice available offline. Enable Online fallback in settings, or install a Persian voice/espeak-ng."
          : "Pronunciation failed on every available engine. Please check the console for details.");
      }
    });
  }

  /* ---------------- Pronunciation Practice Mode ---------------- */

  async startPronunciationPractice() {
    const due = this.getDueCards();
    if (!due.length) {
      new Notice("No cards available for pronunciation practice. Add some words first!");
      return;
    }
    // The modal itself probes microphone + speech recognition availability and
    // transparently falls back to record-and-self-check mode when needed, so it
    // always works — no upfront capability check (or Notice-and-bail) needed here.
    new PronunciationPracticeModal(this.app, this, due).open();
  }
}

/* ---------------------------------------------------------------------- *
 *  Settings tab
 * ---------------------------------------------------------------------- */

class JhackSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const c = this.containerEl;
    c.empty();
    c.addClass("jhack-settings");
    c.createEl("h1", { text: "Jhack Lingua Bridge" });
    c.createEl("p", { text: "Offline-first English ⇄ Persian lookup with a built-in Leitner spaced-repetition system. No companion plugin required.", cls: "jhack-subtle" });

    c.createEl("h2", { text: "Pronunciation" });
    c.createEl("p", { text: "Playback tries your device's built-in speech engine first, then falls back to a fully offline speech engine bundled inside this plugin (no installs needed), then your system's espeak-ng as a last resort.", cls: "jhack-subtle" });

    const voiceCount = this.plugin.voices?.length || 0;
    const bundled = !!this.plugin.loadBundledEngine();
    const espeak = this.plugin.findEspeakBinary();
    let statusText, statusOk;
    if (voiceCount > 0) { statusText = `✓ ${voiceCount} system voice(s) detected — best quality pronunciation active.`; statusOk = true; }
    else if (bundled) { statusText = "✓ No system voices found, but the bundled offline speech engine is active — pronunciation will still work."; statusOk = true; }
    else if (espeak) { statusText = `⚠ No system voices and the bundled engine failed to load, but espeak-ng was detected at ${espeak} — that fallback will be used.`; statusOk = true; }
    else { statusText = "✗ No speech engine could be found at all. This shouldn't normally happen — try reinstalling the plugin."; statusOk = false; }
    const statusEl = c.createDiv({ cls: "jhack-status" });
    statusEl.setText(statusText);
    statusEl.addClass(statusOk ? "jhack-status-ok" : "jhack-status-bad");

    new Setting(c).setName("Accent").setDesc("Preferred English accent when no specific voice is chosen below.")
      .addDropdown((d) => d.addOptions({ us: "US English", uk: "UK English" }).setValue(this.plugin.settings.accent)
        .onChange(async (v) => { this.plugin.settings.accent = v; await this.plugin.persist(); }));

    const voiceSetting = new Setting(c).setName("Voice").setDesc("Pick an exact system voice (optional).");
    this.plugin.loadVoices();
    const options = { "": "Auto (use accent above)" };
    this.plugin.voices.forEach((v) => { options[v.voiceURI] = `${v.name} (${v.lang})`; });
    voiceSetting.addDropdown((d) => d.addOptions(options).setValue(this.plugin.settings.voiceURI)
      .onChange(async (v) => { this.plugin.settings.voiceURI = v; await this.plugin.persist(); }));
    voiceSetting.addExtraButton((b) => b.setIcon("refresh-cw").setTooltip("Reload voice list").onClick(() => { this.plugin.loadVoices(); this.display(); }));

    new Setting(c).setName("Speech rate").setDesc("0.5 (slow) – 1.5 (fast)")
      .addSlider((s) => s.setLimits(0.5, 1.5, 0.05).setValue(this.plugin.settings.rate).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.rate = v; await this.plugin.persist(); }));

    new Setting(c).setName("Pitch")
      .addSlider((s) => s.setLimits(0.5, 1.5, 0.05).setValue(this.plugin.settings.pitch).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.pitch = v; await this.plugin.persist(); }));

    new Setting(c).setName("Auto-pronounce on lookup").setDesc("Speak the word automatically whenever the lookup card opens.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoSpeak).onChange(async (v) => { this.plugin.settings.autoSpeak = v; await this.plugin.persist(); }));

    new Setting(c).setName("Test pronunciation")
      .addButton((b) => b.setButtonText("▶ Play sample").onClick(() => this.plugin.speak("pronunciation")))
      .addExtraButton((b) => b.setIcon("refresh-cw").setTooltip("Re-check speech engine status").onClick(() => { this.plugin._espeakPath = undefined; this.plugin._meSpeak = undefined; this.plugin.loadVoices(); this.display(); }));

    c.createEl("h2", { text: "Dictionary" });
    c.createEl("p", { text: "Ships with 148,000+ English words offline, 84,000+ of them with real Persian translations, plus 243 hand-curated entries for the most common words (always used first when available).", cls: "jhack-subtle" });
    new Setting(c).setName("Online fallback").setDesc("When a word or its Persian translation is missing offline, query dictionaryapi.dev for definitions and Google Translate/MyMemory for translation (requires internet). Off by default to stay fully offline.")
      .addToggle((t) => t.setValue(this.plugin.settings.onlineFallback).onChange(async (v) => { this.plugin.settings.onlineFallback = v; await this.plugin.persist(); }));

    new Setting(c).setName("Use Google Translate").setDesc("Tries Google Translate's free endpoint first (usually more accurate), falling back to MyMemory if it's unreachable. Requires 'Online fallback' above to be on.")
      .addToggle((t) => t.setValue(this.plugin.settings.useGoogleTranslate).onChange(async (v) => { this.plugin.settings.useGoogleTranslate = v; await this.plugin.persist(); }));

    const cachedCount = Object.keys(this.plugin.settings.userTranslations || {}).length;
    new Setting(c).setName("Learned translations cache").setDesc(`${cachedCount} word(s) translated online so far are now saved and available fully offline from now on.`)
      .addButton((b) => b.setButtonText("Clear cache").onClick(async () => {
        this.plugin.settings.userTranslations = {};
        await this.plugin.persist();
        new Notice("Learned translations cache cleared.");
        this.display();
      }));

    c.createEl("h2", { text: "Word images" });
    c.createEl("p", { text: "Pictures are fetched live from Wikipedia and shown in the Lookup card and Review flashcards — online only, nothing is ever saved to disk. Requires 'Online fallback' above.", cls: "jhack-subtle" });
    new Setting(c).setName("Fetch word images").setDesc("Show a picture for the current word when online.")
      .addToggle((t) => t.setValue(this.plugin.settings.fetchWordImages).onChange(async (v) => { this.plugin.settings.fetchWordImages = v; await this.plugin.persist(); }));

    c.createEl("h2", { text: "Editor & lookup card" });
    new Setting(c).setName("Highlight Leitner deck words in notes").setDesc("Underline/highlight words that are already in your Leitner deck while you're editing a Markdown note.")
      .addToggle((t) => t.setValue(this.plugin.settings.highlightLeitnerWords).onChange(async (v) => { this.plugin.settings.highlightLeitnerWords = v; await this.plugin.persist(); this.plugin.refreshEditors(); }));

    new Setting(c).setName("Single-click to select word").setDesc("Click once on a word in the editor to select it; double-click a word to open its Lookup card directly.")
      .addToggle((t) => t.setValue(this.plugin.settings.singleClickSelect).onChange(async (v) => { this.plugin.settings.singleClickSelect = v; await this.plugin.persist(); }));

    new Setting(c).setName("Show similar words").setDesc("In the Lookup card, show other inflected forms and similarly-spelled dictionary entries, each clickable.")
      .addToggle((t) => t.setValue(this.plugin.settings.showSimilarWords).onChange(async (v) => { this.plugin.settings.showSimilarWords = v; await this.plugin.persist(); }));

    c.createEl("h2", { text: "Audio player" });
    c.createEl("p", { text: "Load a local audio file and control playback from the sidebar. Play/Pause/Stop and volume are all available there, and playback automatically pauses whenever a Lookup or Review session opens, resuming when it closes.", cls: "jhack-subtle" });
    new Setting(c).setName("Open audio player").addButton((b) => b.setButtonText("Open").onClick(() => this.plugin.openPlayer()));
    if (this.plugin.settings.audioFileName) {
      new Setting(c).setName("Loaded file").setDesc(this.plugin.settings.audioFileName)
        .addButton((b) => b.setButtonText("Clear").onClick(async () => {
          this.plugin.stopAudio();
          this.plugin.audioEl = null;
          this.plugin.settings.audioData = "";
          this.plugin.settings.audioFileName = "";
          this.plugin.settings.audioMime = "";
          await this.plugin.persist();
          this.plugin.refreshPlayer();
          this.display();
        }));
    }

    c.createEl("h2", { text: "Leitner spaced repetition" });
    c.createEl("p", { text: "Built in — nothing else to install. Cards move up a box on Good/Easy and reset to Box 1 on Again.", cls: "jhack-subtle" });

    new Setting(c).setName("Box intervals (days)").setDesc("Comma-separated, one value per box, e.g. 1,2,3,7,14,30,60")
      .addText((t) => t.setValue(this.plugin.settings.intervals.join(",")).onChange(async (v) => {
        const nums = v.split(",").map((x) => parseInt(x.trim(), 10)).filter((x) => !isNaN(x) && x > 0);
        if (nums.length) { this.plugin.settings.intervals = nums; await this.plugin.persist(); }
      }));

    new Setting(c).setName("Max reviews per session")
      .addText((t) => t.setValue(String(this.plugin.settings.dailyReviewLimit)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0) { this.plugin.settings.dailyReviewLimit = n; await this.plugin.persist(); }
      }));

    new Setting(c).setName("Daily due-cards reminder").setDesc("Show one Notice per day if you have cards due for review.")
      .addToggle((t) => t.setValue(this.plugin.settings.dailyReminder).onChange(async (v) => { this.plugin.settings.dailyReminder = v; await this.plugin.persist(); }));

    new Setting(c).setName("Import legacy Spaced Repetition deck").setDesc("One-time migration: scans your vault's #flashcards notes and copies cards into the new built-in Leitner system.")
      .addButton((b) => b.setButtonText("Import").onClick(() => this.plugin.importLegacyDeck()));

    new Setting(c).setName("Import from Excel/CSV").setDesc("Upload a file with columns: Word, Meaning, Example, Pronunciation. Supports CSV and basic XLSX.")
      .addButton((b) => b.setButtonText("Upload File").onClick(() => this.plugin.importExcelFile()));

    c.createEl("h2", { text: "Appearance" });
    new Setting(c).setName("Accent color")
      .addDropdown((d) => d.addOptions({ crimson: "Crimson", ocean: "Ocean", forest: "Forest", amber: "Amber", violet: "Violet" })
        .setValue(this.plugin.settings.theme)
        .onChange(async (v) => { this.plugin.settings.theme = v; await this.plugin.persist(); this.plugin.applyTheme(); }));

    c.createEl("h2", { text: "Data management" });
    new Setting(c).setName("Open dashboard").addButton((b) => b.setButtonText("Open").onClick(() => this.plugin.openDashboard()));

    new Setting(c).setName("Export deck").setDesc("Copies your full Leitner deck as JSON to the clipboard.")
      .addButton((b) => b.setButtonText("Export").onClick(async () => {
        const json = this.plugin.exportDeckJSON();
        try { await navigator.clipboard.writeText(json); new Notice("Deck JSON copied to clipboard."); }
        catch (e) { new Notice("Could not copy automatically — check console for the JSON."); console.log(json); }
      }));

    new Setting(c).setName("Export to Anki (.txt)").setDesc("Tab-separated Front/Back file — in Anki use File → Import and set the separator to Tab.")
      .addButton((b) => b.setButtonText("Export").onClick(async () => {
        const rows = Object.values(this.plugin.settings.cards).map((card) => {
          const front = card.word.replace(/\t/g, " ");
          const back = [card.data.translation, card.data.definition, card.data.example].filter(Boolean).join("<br>").replace(/\t/g, " ");
          return `${front}\t${back}`;
        });
        try { await navigator.clipboard.writeText(rows.join("\n")); new Notice(`Copied ${rows.length} card(s) as tab-separated text — paste into a .txt file and import into Anki.`); }
        catch (e) { new Notice("Could not copy automatically — check console for the data."); console.log(rows.join("\n")); }
      }));

    let importArea;
    new Setting(c).setName("Import deck").setDesc("Paste exported JSON, then click Import.")
      .addTextArea((t) => { importArea = t; t.inputEl.rows = 4; t.inputEl.style.width = "100%"; })
      .addButton((b) => b.setButtonText("Import").onClick(async () => {
        try {
          const n = await this.plugin.importDeckJSON(importArea.getValue());
          new Notice(`Imported ${n} card(s).`);
        } catch (e) { new Notice("Invalid JSON."); }
      }));

    new Setting(c).setName("Reset deck").setDesc("Deletes every card. This cannot be undone.")
      .addButton((b) => b.setButtonText("Reset").setWarning().onClick(async () => {
        await this.plugin.resetDeck();
        new Notice("Deck cleared.");
      }));
  }
}

module.exports = JhackLingua;
