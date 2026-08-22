const { Plugin, Modal, Notice, PluginSettingTab, Setting, MarkdownView, ItemView, requestUrl } = require("obsidian");

const VIEW_TYPE_DASHBOARD = "jhack-dashboard-view";

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
  history: [] // recently looked-up words, most recent first
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

    const titleRow = c.createDiv({ cls: "jhack-title-row" });
    titleRow.createEl("h2", { text: this.word, cls: "jhack-word" });
    const already = this.plugin.hasCard(this.word);
    if (already) titleRow.createSpan({ text: "In deck", cls: "jhack-badge jhack-badge-inbox" });

    const metaRow = c.createDiv({ cls: "jhack-meta-row" });
    if (this.data.phonetic) metaRow.createSpan({ text: `/${this.data.phonetic}/`, cls: "jhack-phonetic" });
    if (this.data.pos) metaRow.createSpan({ text: this.data.pos, cls: "jhack-pos" });

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
      this.data.synonyms.forEach((s) => chips.createSpan({ text: s, cls: "jhack-chip" }));
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

  onClose() { this.contentEl.empty(); }
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

    const stats = c.createDiv({ cls: "jhack-dash-stats" });
    this.statCard(stats, due, "Due today");
    this.statCard(stats, total, "Total cards");
    this.statCard(stats, this.plugin.settings.streak, "Day streak 🔥");

    const startBtn = c.createEl("button", { text: `▶ Start review (${due})`, cls: "jhack-btn jhack-btn-cta jhack-full" });
    startBtn.disabled = due === 0;
    startBtn.onclick = () => this.plugin.startReview();

    const lookupBtn = c.createEl("button", { text: "🔎 Lookup a word", cls: "jhack-btn jhack-full" });
    lookupBtn.onclick = () => this.plugin.runLookup();

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

    if (this.plugin.settings.history?.length) {
      c.createEl("h3", { text: "Recent lookups" });
      const hist = c.createDiv({ cls: "jhack-chips" });
      this.plugin.settings.history.slice(0, 12).forEach((w) => {
        const chip = hist.createSpan({ text: w, cls: "jhack-chip jhack-chip-clickable" });
        chip.onclick = () => new LookupModal(this.app, this.plugin, w).open();
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

    this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));

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
    this.addCommand({ id: "import-legacy-deck", name: "Import legacy Spaced Repetition deck", callback: () => this.importLegacyDeck() });

    this.addRibbonIcon("book-open-check", "Jhack Lingua: Lookup", () => this.runLookup());
    this.addRibbonIcon("layers", "Jhack Lingua: Review", () => this.startReview());

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
  }

  onunload() {
    window.speechSynthesis?.cancel();
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

    // Real machine translation for words missing from the curated Persian list —
    // this is what actually powers the "Online fallback" toggle for translation,
    // rather than just decorating the definition.
    if (!result.translation && this.settings.onlineFallback) {
      try {
        const res = await requestUrl({ url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|fa` });
        const payload = JSON.parse(res.text);
        const translated = payload?.responseData?.translatedText;
        if (translated && !/mymemory|invalid|query length/i.test(translated)) {
          result.translation = translated;
        }
      } catch (e) { /* offline or blocked — silently fall back */ }
    }

    return result;
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
    new Setting(c).setName("Online fallback").setDesc("When a word or its Persian translation is missing offline, query dictionaryapi.dev for definitions and MyMemory for translation (requires internet). Off by default to stay fully offline.")
      .addToggle((t) => t.setValue(this.plugin.settings.onlineFallback).onChange(async (v) => { this.plugin.settings.onlineFallback = v; await this.plugin.persist(); }));

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

    new Setting(c).setName("Import legacy Spaced Repetition deck").setDesc("One-time migration: scans your vault's #flashcards notes and copies cards into the new built-in Leitner system.")
      .addButton((b) => b.setButtonText("Import").onClick(() => this.plugin.importLegacyDeck()));

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
