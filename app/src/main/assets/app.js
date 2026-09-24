(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const state = {
    query: "",
    mode: "all",
    categories: new Set(),
    statuses: new Set(),
    integrityStates: new Set(),
    sort: "latest",
    view: "library",
    favorites: new Set(readStore("regulabank-favorites", [])),
    notes: readStore("regulabank-notes-v1", {}),
    checklist: readStore("regulabank-checklists-v1", {}),
    checklistId: readStore("regulabank-active-checklist", LICENSING_CHECKLISTS[0].id),
    expandedItems: new Set(),
    offlineMatches: new Map(),
    offlineSearchTimer: null,
    noteSaveTimer: null,
    savedAlertsOnly: readStore("regulabank-saved-alerts-only", false),
    attentionOnly: false
  };

  const elements = {
    input: $("#searchInput"),
    clear: $("#clearSearch"),
    list: $("#regulationList"),
    savedList: $("#savedList"),
    count: $("#resultCount"),
    title: $("#resultTitle"),
    kicker: $("#resultKicker"),
    filters: $("#filters"),
    filterButton: $("#filterButton"),
    filterCount: $("#filterCount"),
    categoryFilters: $("#categoryFilters"),
    statusFilters: $("#statusFilters"),
    integrityFilters: $("#integrityFilters"),
    resetFilter: $("#resetFilter"),
    sort: $("#sortSelect"),
    empty: $("#emptyState"),
    savedEmpty: $("#savedEmpty"),
    backdrop: $("#sheetBackdrop"),
    sheet: $("#detailSheet"),
    detail: $("#detailContent"),
    toast: $("#toast"),
    offlineState: $("#offlineSearchState")
  };

  function readStore(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      showToast("Penyimpanan lokal tidak tersedia.");
    }
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(value) {
    const safe = escapeHtml(value);
    const terms = normalize(state.query).split(" ").filter((term) => term.length > 1);
    if (!terms.length) return safe;
    const expression = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
    return safe.replace(expression, "<mark>$1</mark>");
  }

  function dateScore(regulation) {
    return new Date(`${regulation.issued}T00:00:00`).getTime() || 0;
  }

  function formatDate(value) {
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric", month: "short", year: "numeric"
    }).format(parsed);
  }

  function levenshteinAtMostOne(left, right) {
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1) return false;
    let edits = 0;
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        i += 1;
        j += 1;
      } else {
        edits += 1;
        if (edits > 1) return false;
        if (left.length > right.length) i += 1;
        else if (right.length > left.length) j += 1;
        else {
          i += 1;
          j += 1;
        }
      }
    }
    return edits + (i < left.length || j < right.length ? 1 : 0) <= 1;
  }

  function phraseMatches(haystack, phrase) {
    if (haystack.includes(phrase)) return true;
    if (phrase.includes(" ") || phrase.length < 5) return false;
    return haystack.split(" ").some((word) => levenshteinAtMostOne(word, phrase));
  }

  function queryGroups() {
    return normalize(state.query).split(" ").filter(Boolean).map((term) => {
      const alternatives = [term, ...(SEARCH_SYNONYMS[term] || [])];
      return [...new Set(alternatives.map(normalize).filter(Boolean))];
    });
  }

  function searchableFields(regulation) {
    const offlineSnippet = state.offlineMatches.get(regulation.id) || "";
    return {
      number: normalize(`${regulation.type} ${regulation.number}`),
      title: normalize(regulation.title),
      content: normalize([
        regulation.summary,
        regulation.content,
        regulation.topics.join(" "),
        regulation.aliases.join(" "),
        regulation.changeSummary,
        regulation.deadlines.join(" "),
        offlineSnippet
      ].join(" "))
    };
  }

  function scoreRegulation(regulation) {
    const query = normalize(state.query);
    if (!query) return 1;

    const fields = searchableFields(regulation);
    const selected = state.mode === "all"
      ? `${fields.number} ${fields.title} ${fields.content}`
      : fields[state.mode];
    const groups = queryGroups();

    if (!groups.every((alternatives) => alternatives.some((term) => phraseMatches(selected, term)))) {
      return 0;
    }

    let score = 1;
    if (fields.number.includes(query)) score += 100;
    if (fields.title.includes(query)) score += 60;
    if (fields.content.includes(query)) score += 25;
    if (fields.number === query) score += 100;
    if (fields.title === query) score += 70;
    if (state.offlineMatches.has(regulation.id)) score += 35;

    groups.forEach((alternatives) => {
      if (alternatives.some((term) => fields.number.includes(term))) score += 18;
      if (alternatives.some((term) => fields.title.includes(term))) score += 10;
      if (alternatives.some((term) => fields.content.includes(term))) score += 4;
    });

    return score;
  }

  function contentSnippet(regulation) {
    const offline = state.offlineMatches.get(regulation.id);
    if (offline) return `PDF offline: ${offline}`;
    if (!state.query || (state.mode !== "content" && state.mode !== "all")) return regulation.summary;

    const source = regulation.content;
    const term = normalize(state.query).split(" ").find((token) => token.length > 2);
    if (!term) return regulation.summary;
    const hit = normalize(source).indexOf(term);
    if (hit < 0) return regulation.summary;
    const start = Math.max(0, hit - 72);
    const end = Math.min(source.length, hit + 150);
    return `${start > 0 ? "… " : ""}${source.slice(start, end).trim()}${end < source.length ? " …" : ""}`;
  }

  function statusClass(status) {
    return normalize(status).replace(/\s+/g, "-");
  }

  const INTEGRITY_LABELS = Object.freeze({
    current: "Terkini",
    review: "Tinjau ulang",
    stale: "Kedaluwarsa",
    unknown: "Belum pasti"
  });

  function integrityState(regulation) {
    return regulation.integrity?.state || "unknown";
  }

  function integrityLabel(regulation) {
    return INTEGRITY_LABELS[integrityState(regulation)] || INTEGRITY_LABELS.unknown;
  }

  function integrityPriority(regulation) {
    return { stale: 4, review: 3, unknown: 2, current: 1 }[integrityState(regulation)] || 0;
  }

  function integrityAgeLabel(regulation) {
    const age = regulation.integrity?.ageDays;
    return Number.isFinite(age) ? `${age} hari sejak verifikasi` : "usia verifikasi tidak tersedia";
  }

  function cardTemplate(regulation) {
    const favorite = state.favorites.has(regulation.id);
    const hasNote = Boolean((state.notes[regulation.id] || "").trim());
    return `
      <article class="regulation-card ${hasNote ? "has-note" : ""}" data-id="${escapeHtml(regulation.id)}">
        <div class="card-top">
          <span class="doc-badge">${escapeHtml(regulation.type)}</span>
          <span class="card-number">${highlight(regulation.number)}</span>
          <button class="bookmark ${favorite ? "active" : ""}" data-bookmark="${escapeHtml(regulation.id)}"
                  aria-label="${favorite ? "Hapus dari tersimpan" : "Simpan ketentuan"}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10v15l-5-3-5 3z"></path></svg>
          </button>
        </div>
        <div class="card-body" data-open="${escapeHtml(regulation.id)}">
          <h3>${highlight(regulation.title)}</h3>
          <p class="card-summary">${highlight(contentSnippet(regulation))}</p>
          <div class="card-footer">
            <span class="category-tag">${escapeHtml(regulation.category)}</span>
            <span class="status-tag ${statusClass(regulation.status)}">${escapeHtml(regulation.status)}</span>
            <span class="integrity-tag integrity-${escapeHtml(integrityState(regulation))}">${escapeHtml(integrityLabel(regulation))}</span>
          </div>
          <div class="verification-row">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>
            <span>${escapeHtml(regulation.verification)} · dicek ${escapeHtml(regulation.verifiedAt)}</span>
          </div>
        </div>
      </article>`;
  }

  function filteredRegulations() {
    const scored = REGULATIONS
      .map((regulation) => ({ regulation, score: scoreRegulation(regulation) }))
      .filter(({ regulation, score }) => {
        if (score <= 0) return false;
        if (state.categories.size && !state.categories.has(regulation.category)) return false;
        if (state.statuses.size && !state.statuses.has(regulation.status)) return false;
        if (state.integrityStates.size && !state.integrityStates.has(integrityState(regulation))) return false;
        if (state.attentionOnly) {
          const needsAttention = regulation.status.includes("dicabut")
            || regulation.status.includes("verifikasi")
            || ["review", "stale", "unknown"].includes(integrityState(regulation));
          if (!needsAttention) return false;
        }
        return true;
      });

    scored.sort((a, b) => {
      if (state.sort === "relevance") {
        return b.score - a.score || dateScore(b.regulation) - dateScore(a.regulation);
      }
      if (state.sort === "number") {
        return a.regulation.number.localeCompare(b.regulation.number, "id", { numeric: true });
      }
      if (state.sort === "integrity") {
        return integrityPriority(b.regulation) - integrityPriority(a.regulation)
          || dateScore(b.regulation) - dateScore(a.regulation);
      }
      return dateScore(b.regulation) - dateScore(a.regulation);
    });
    return scored.map(({ regulation }) => regulation);
  }

  function renderLibrary() {
    const regulations = filteredRegulations();
    elements.list.innerHTML = regulations.map(cardTemplate).join("");
    elements.count.textContent = `${regulations.length} dari ${REGULATIONS.length} ketentuan`;
    elements.empty.hidden = regulations.length > 0;
    elements.list.hidden = regulations.length === 0;

    if (state.query) {
      elements.kicker.textContent = "HASIL PENCARIAN";
      elements.title.textContent = `“${state.query}”`;
    } else {
      elements.kicker.textContent = "PILIHAN TERBARU";
      elements.title.textContent = "Ketentuan perbankan";
    }
    bindCardEvents(elements.list);
  }

  function renderSaved() {
    const saved = REGULATIONS.filter((regulation) => state.favorites.has(regulation.id))
      .sort((a, b) => dateScore(b) - dateScore(a));
    elements.savedList.innerHTML = saved.map(cardTemplate).join("");
    elements.savedList.hidden = saved.length === 0;
    elements.savedEmpty.hidden = saved.length > 0;
    $("#savedCount").textContent = String(saved.length);
    $("#noteCount").textContent = String(Object.values(state.notes).filter((note) => String(note).trim()).length);
    bindCardEvents(elements.savedList);
  }

  function bindCardEvents(container) {
    container.querySelectorAll("[data-open]").forEach((node) => {
      node.addEventListener("click", () => openDetail(node.dataset.open));
    });
    container.querySelectorAll("[data-bookmark]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavorite(button.dataset.bookmark);
      });
    });
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      showToast("Dihapus dari koleksi.");
    } else {
      state.favorites.add(id);
      showToast("Disimpan ke koleksi.");
    }
    writeStore("regulabank-favorites", Array.from(state.favorites));
    renderLibrary();
    renderSaved();
    renderAlerts();
  }

  function renderFilters() {
    const categories = [...new Set(REGULATIONS.map((item) => item.category))].sort();
    const statuses = [...new Set(REGULATIONS.map((item) => item.status))].sort();
    const integrityStates = ["stale", "review", "unknown", "current"]
      .filter((value) => REGULATIONS.some((item) => integrityState(item) === value));
    elements.categoryFilters.innerHTML = categories.map((category) =>
      `<button class="filter-pill ${state.categories.has(category) ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
    ).join("");
    elements.statusFilters.innerHTML = statuses.map((status) =>
      `<button class="filter-pill ${state.statuses.has(status) ? "active" : ""}" data-status="${escapeHtml(status)}">${escapeHtml(status)}</button>`
    ).join("");
    elements.integrityFilters.innerHTML = integrityStates.map((value) =>
      `<button class="filter-pill integrity-filter ${state.integrityStates.has(value) ? "active" : ""}" data-integrity="${escapeHtml(value)}">${escapeHtml(INTEGRITY_LABELS[value])}</button>`
    ).join("");

    elements.categoryFilters.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleSet(state.categories, button.dataset.category);
        renderFilters();
        renderLibrary();
      });
    });
    elements.statusFilters.querySelectorAll("[data-status]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleSet(state.statuses, button.dataset.status);
        renderFilters();
        renderLibrary();
      });
    });
    elements.integrityFilters.querySelectorAll("[data-integrity]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleSet(state.integrityStates, button.dataset.integrity);
        renderFilters();
        renderLibrary();
      });
    });

    const count = state.categories.size + state.statuses.size + state.integrityStates.size;
    elements.filterCount.textContent = String(count);
    elements.filterCount.hidden = count === 0;
  }

  function toggleSet(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
  }

  function citationFor(regulation) {
    return `${regulation.type} ${regulation.number}, ${regulation.title}. Sumber resmi OJK: ${regulation.source} (indeks RegulaBank diperiksa ${regulation.verifiedAt}).`;
  }

  function nativeAvailable(method) {
    return typeof NativeApp !== "undefined" && typeof NativeApp[method] === "function";
  }

  function pdfBridgeAvailable() {
    return typeof AndroidApp !== "undefined" && typeof AndroidApp.downloadAllPdfs === "function";
  }

  function downloadedPdfCount(id) {
    if (!pdfBridgeAvailable()) return 0;
    try {
      return AndroidApp.getDownloadedPdfCount(id);
    } catch (_) {
      return 0;
    }
  }

  function hasOfflineIndex(id) {
    if (!nativeAvailable("hasOfflineIndex")) return false;
    try {
      return NativeApp.hasOfflineIndex(id);
    } catch (_) {
      return false;
    }
  }

  function openDetail(id, addHistory = true) {
    const regulation = REGULATIONS.find((item) => item.id === id);
    if (!regulation) return;

    const downloaded = downloadedPdfCount(regulation.id);
    const favorite = state.favorites.has(regulation.id);
    const related = regulation.relatedIds
      .map((relatedId) => REGULATIONS.find((item) => item.id === relatedId))
      .filter(Boolean);

    elements.detail.innerHTML = `
      <div class="detail-close-row">
        <span class="detail-label">DOSSIER KETENTUAN</span>
        <button class="detail-close" id="detailClose" aria-label="Tutup">×</button>
      </div>
      <h2 class="detail-title">${escapeHtml(regulation.title)}</h2>
      <div class="detail-number">${escapeHtml(regulation.type)} ${escapeHtml(regulation.number)}</div>
      <div class="detail-actions">
        <button id="detailBookmark" class="${favorite ? "active" : ""}">${favorite ? "Tersimpan" : "Simpan"}</button>
        <button id="copyCitation">Salin sitasi</button>
        <button id="shareCitation">Bagikan</button>
      </div>
      <div class="detail-meta">
        <div><span>Subsektor</span><strong>${escapeHtml(regulation.category)}</strong></div>
        <div><span>Status indeks</span><strong>${escapeHtml(regulation.status)}</strong></div>
        <div><span>Tanggal terbit</span><strong>${formatDate(regulation.issued)}</strong></div>
        <div><span>Efektif</span><strong>${escapeHtml(regulation.effective)}</strong></div>
      </div>
      <div class="verification-card">
        <div><span>Verifikasi manusia</span><strong>${escapeHtml(regulation.verification)}</strong></div>
        <div><span>Terakhir diperiksa</span><strong>${escapeHtml(regulation.verifiedAt)}</strong></div>
        <div><span>Freshness</span><strong class="integrity-text integrity-${escapeHtml(integrityState(regulation))}">${escapeHtml(integrityLabel(regulation))}</strong></div>
        <div><span>Usia verifikasi</span><strong>${escapeHtml(integrityAgeLabel(regulation))}</strong></div>
      </div>
      <p class="integrity-note">Freshness dihitung dari usia verifikasi kurasi. Status ini bukan penetapan status hukum ketentuan dan tidak menggantikan verifikasi pada sumber resmi OJK.</p>
      <section class="detail-section">
        <h3>Ikhtisar</h3>
        <p>${escapeHtml(regulation.summary)}</p>
      </section>
      <section class="detail-section">
        <h3>Isi yang terindeks</h3>
        <p>${highlight(regulation.content)}</p>
      </section>
      <section class="detail-section">
        <h3>Apa yang perlu diperhatikan</h3>
        <p class="change-card">${escapeHtml(regulation.changeSummary)}</p>
      </section>
      <section class="detail-section">
        <h3>Tanggal &amp; tindak lanjut</h3>
        <ul class="deadline-list">${regulation.deadlines.map((deadline) => `<li>${escapeHtml(deadline)}</li>`).join("")}</ul>
      </section>
      <section class="detail-section">
        <h3>Topik terkait</h3>
        <div class="topic-list">${regulation.topics.map((topic) => `<span>${escapeHtml(topic)}</span>`).join("")}</div>
      </section>
      ${related.length ? `
        <section class="detail-section">
          <h3>Ketentuan terkait</h3>
          <div class="related-list">
            ${related.map((item) => `
              <button class="related-button" data-related="${escapeHtml(item.id)}">
                <span>${escapeHtml(item.type)} ${escapeHtml(item.number)}</span>
                <strong>${escapeHtml(item.title)}</strong>
              </button>`).join("")}
          </div>
        </section>` : ""}
      <section class="pdf-panel">
        <div class="pdf-panel-heading">
          <div class="pdf-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4M9.5 13h5M9.5 16h5"></path></svg>
          </div>
          <div>
            <strong>Dokumen resmi OJK · tekan untuk unduh</strong>
            <p>Gunakan tombol di bawah untuk mengunduh naskah, abstrak, FAQ, dan lampiran OJK. Setelah tersimpan, tombol “Buka PDF” akan muncul.</p>
            ${hasOfflineIndex(regulation.id) ? `<span class="offline-index-badge">Teks PDF sudah terindeks</span>` : ""}
          </div>
        </div>
        <div class="pdf-actions">
          <button class="pdf-download" id="downloadPdfs" ${pdfBridgeAvailable() ? "" : "disabled"}>${downloaded ? "Perbarui PDF" : "Unduh semua PDF"}</button>
          <button class="pdf-open" id="openPdfs" ${downloaded ? "" : "hidden"}>Buka PDF (${downloaded})</button>
        </div>
        <div class="pdf-progress" id="pdfProgress" hidden>
          <div class="pdf-progress-track"><span id="pdfProgressBar"></span></div>
          <p id="pdfStatus">Menyiapkan unduhan…</p>
        </div>
      </section>
      <section class="detail-section">
        <h3>Catatan pribadi</h3>
        <textarea class="note-box" id="regulationNote" maxlength="3000" placeholder="Tulis interpretasi internal, PIC, atau tindak lanjut…">${escapeHtml(state.notes[regulation.id] || "")}</textarea>
        <span class="note-status" id="noteStatus">Tersimpan hanya di perangkat</span>
      </section>
      <a class="source-button" href="${escapeHtml(regulation.source)}">Buka sumber resmi OJK</a>
      <p class="source-note">Periksa naskah lengkap dan status terbaru pada sumber resmi sebelum mengambil keputusan.</p>`;

    elements.backdrop.hidden = false;
    elements.sheet.hidden = false;
    elements.sheet.dataset.regulationId = regulation.id;
    document.body.classList.add("sheet-open");

    $("#detailClose").addEventListener("click", closeDetail);
    $("#detailBookmark").addEventListener("click", () => {
      toggleFavorite(regulation.id);
      $("#detailBookmark").classList.toggle("active", state.favorites.has(regulation.id));
      $("#detailBookmark").textContent = state.favorites.has(regulation.id) ? "Tersimpan" : "Simpan";
    });
    $("#copyCitation").addEventListener("click", () => copyCitation(regulation));
    $("#shareCitation").addEventListener("click", () => shareCitation(regulation));
    $("#regulationNote").addEventListener("input", (event) => saveNote(regulation.id, event.target.value));
    elements.detail.querySelectorAll("[data-related]").forEach((button) => {
      button.addEventListener("click", () => openDetail(button.dataset.related));
    });

    if (pdfBridgeAvailable()) {
      $("#downloadPdfs").addEventListener("click", () => {
        $("#pdfProgress").hidden = false;
        $("#pdfStatus").textContent = "Menghubungkan ke OJK…";
        $("#downloadPdfs").disabled = true;
        AndroidApp.downloadAllPdfs(regulation.id, regulation.title, regulation.source);
      });
      $("#openPdfs").addEventListener("click", () => AndroidApp.showDownloadedPdfs(regulation.id, regulation.title));
    }

    if (addHistory && (!history.state || history.state.detail !== id)) {
      history.pushState({ detail: id }, "", `#${id}`);
    }
  }

  function closeDetail(useHistory = true) {
    elements.backdrop.hidden = true;
    elements.sheet.hidden = true;
    document.body.classList.remove("sheet-open");
    if (useHistory && history.state && history.state.detail) history.back();
  }

  function saveNote(id, value) {
    state.notes[id] = value;
    const status = $("#noteStatus");
    if (status) status.textContent = "Menyimpan…";
    clearTimeout(state.noteSaveTimer);
    state.noteSaveTimer = setTimeout(() => {
      if (!value.trim()) delete state.notes[id];
      writeStore("regulabank-notes-v1", state.notes);
      if (status) status.textContent = "Tersimpan hanya di perangkat";
      renderSaved();
    }, 350);
  }

  function copyCitation(regulation) {
    const citation = citationFor(regulation);
    if (nativeAvailable("copyText")) {
      try {
        NativeApp.copyText("Sitasi ketentuan", citation);
        showToast("Sitasi disalin.");
        return;
      } catch (_) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(citation).then(() => showToast("Sitasi disalin."));
    } else {
      showToast("Fitur salin tersedia pada APK Android.");
    }
  }

  function shareCitation(regulation) {
    if (nativeAvailable("shareText")) {
      try {
        NativeApp.shareText(`RegulaBank · ${regulation.type} ${regulation.number}`, citationFor(regulation));
        return;
      } catch (_) {}
    }
    showToast("Fitur bagikan tersedia pada APK Android.");
  }

  function renderAlerts() {
    const onlySaved = $("#savedAlertsOnly");
    onlySaved.checked = state.savedAlertsOnly;
    const alerts = REGULATORY_ALERTS.filter((alert) => !state.savedAlertsOnly || state.favorites.has(alert.regulationId));
    $("#alertList").innerHTML = alerts.map((alert) => {
      const regulation = REGULATIONS.find((item) => item.id === alert.regulationId);
      const label = alert.level === "upcoming" ? "Akan berlaku" : alert.level === "verify" ? "Verifikasi" : "Perubahan";
      return `
        <article class="alert-card ${escapeHtml(alert.level)}">
          <div class="alert-heading"><span>${label}</span><small>${formatDate(alert.date)}</small></div>
          <h3>${escapeHtml(alert.title)}</h3>
          <p>${escapeHtml(alert.message)}</p>
          ${regulation ? `<button data-alert-open="${escapeHtml(regulation.id)}">Buka ${escapeHtml(regulation.type)} ${escapeHtml(regulation.number)} →</button>` : ""}
        </article>`;
    }).join("");
    $("#alertList").querySelectorAll("[data-alert-open]").forEach((button) => {
      button.addEventListener("click", () => openDetail(button.dataset.alertOpen));
    });
    $("#alertEmpty").hidden = alerts.length > 0;
  }

  function checklistTemplate() {
    return LICENSING_CHECKLISTS.find((template) => template.id === state.checklistId) || LICENSING_CHECKLISTS[0];
  }

  function checklistItemState(templateId, itemId) {
    state.checklist[templateId] = state.checklist[templateId] || {};
    state.checklist[templateId][itemId] = state.checklist[templateId][itemId] || {
      done: false, pic: "", due: "", evidence: ""
    };
    return state.checklist[templateId][itemId];
  }

  function saveChecklist() {
    writeStore("regulabank-checklists-v1", state.checklist);
  }

  function renderChecklist() {
    const template = checklistTemplate();
    $("#checklistSelect").innerHTML = LICENSING_CHECKLISTS.map((item) =>
      `<option value="${escapeHtml(item.id)}" ${item.id === template.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`
    ).join("");
    $("#checklistTitle").textContent = template.title;
    $("#checklistDescription").textContent = template.description;

    const completed = template.items.filter((item) => checklistItemState(template.id, item.id).done).length;
    const percent = template.items.length ? Math.round((completed / template.items.length) * 100) : 0;
    $("#checklistPercent").textContent = `${percent}%`;
    $("#checklistProgressRing").style.setProperty("--progress", `${percent * 3.6}deg`);

    $("#checklistList").innerHTML = template.items.map((item) => {
      const itemState = checklistItemState(template.id, item.id);
      const key = `${template.id}:${item.id}`;
      const expanded = state.expandedItems.has(key);
      return `
        <article class="checklist-item ${itemState.done ? "completed" : ""}" data-check-item="${escapeHtml(item.id)}">
          <div class="checklist-primary">
            <input type="checkbox" data-check-done="${escapeHtml(item.id)}" ${itemState.done ? "checked" : ""} aria-label="Tandai selesai">
            <span><small>${escapeHtml(item.group)}</small><strong>${escapeHtml(item.title)}</strong>${item.basis ? `<em class="checklist-basis">${escapeHtml(item.basis)}</em>` : ""}${item.ref ? `<em class="checklist-ref">${escapeHtml(item.ref)}</em>` : ""}</span>
            <button class="expand-item" data-expand-item="${escapeHtml(item.id)}" aria-label="Detail">${expanded ? "−" : "+"}</button>
          </div>
          <div class="checklist-fields" ${expanded ? "" : "hidden"}>
            <label>PIC<input data-check-field="pic" data-item-id="${escapeHtml(item.id)}" value="${escapeHtml(itemState.pic)}" placeholder="Nama/unit"></label>
            <label>Target internal<input type="date" data-check-field="due" data-item-id="${escapeHtml(item.id)}" value="${escapeHtml(itemState.due)}"></label>
            <label>Bukti / catatan<textarea data-check-field="evidence" data-item-id="${escapeHtml(item.id)}" rows="2" placeholder="Nama dokumen, tautan, atau catatan">${escapeHtml(itemState.evidence)}</textarea></label>
            ${item.appendix ? `<button type="button" class="appendix-action" data-open-appendix="${escapeHtml(item.id)}">Buka rujukan lampiran</button>` : ""}
          </div>
        </article>`;
    }).join("");

    $("#checklistList").querySelectorAll("[data-check-done]").forEach((input) => {
      input.addEventListener("change", () => {
        checklistItemState(template.id, input.dataset.checkDone).done = input.checked;
        saveChecklist();
        renderChecklist();
      });
    });
    $("#checklistList").querySelectorAll("[data-expand-item]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = `${template.id}:${button.dataset.expandItem}`;
        if (state.expandedItems.has(key)) state.expandedItems.delete(key);
        else state.expandedItems.add(key);
        renderChecklist();
      });
    });
    $("#checklistList").querySelectorAll("[data-open-appendix]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = template.items.find((entry) => entry.id === button.dataset.openAppendix);
        openDetail(template.regulationId);
        if (item?.appendix) showToast(`${item.appendix}${item.ref ? " · " + item.ref : ""} — gunakan tombol Dokumen resmi OJK untuk membuka/unduh naskah dan lampiran.`);
      });
    });
    $("#checklistList").querySelectorAll("[data-check-field]").forEach((input) => {
      input.addEventListener("input", () => {
        checklistItemState(template.id, input.dataset.itemId)[input.dataset.checkField] = input.value;
        saveChecklist();
      });
    });
  }

  function renderRecentSearches() {
    const recent = readStore("regulabank-recent", []);
    $("#recentSearches").hidden = recent.length === 0 || Boolean(state.query);
    $("#recentSearchPills").innerHTML = recent.map((query) =>
      `<button data-recent="${escapeHtml(query)}">${escapeHtml(query)}</button>`
    ).join("");
    $("#recentSearchPills").querySelectorAll("[data-recent]").forEach((button) => {
      button.addEventListener("click", () => runSearch(button.dataset.recent, true));
    });
  }

  function saveRecentSearch(query) {
    if (!query || query.length < 2) return;
    const recent = readStore("regulabank-recent", []).filter((item) => item !== query);
    recent.unshift(query);
    writeStore("regulabank-recent", recent.slice(0, 6));
    renderRecentSearches();
  }

  function searchOfflinePdfs() {
    clearTimeout(state.offlineSearchTimer);
    state.offlineMatches.clear();
    const query = state.query;
    if (query.length < 3 || state.mode === "number" || state.mode === "title" || !nativeAvailable("searchOfflinePdfIndex")) {
      elements.offlineState.textContent = "";
      renderLibrary();
      return;
    }

    elements.offlineState.textContent = "menelusuri PDF…";
    state.offlineSearchTimer = setTimeout(() => {
      try {
        const result = JSON.parse(NativeApp.searchOfflinePdfIndex(query));
        (result.matches || []).forEach((match) => state.offlineMatches.set(match.id, match.snippet));
        elements.offlineState.textContent = result.indexedDocuments
          ? `${result.indexedDocuments} PDF offline ditelusuri`
          : "";
      } catch (_) {
        elements.offlineState.textContent = "";
      }
      renderLibrary();
    }, 280);
  }

  function runSearch(query, save = false) {
    state.attentionOnly = false;
    setView("library");
    elements.input.value = query;
    elements.input.dispatchEvent(new Event("input"));
    if (save) saveRecentSearch(query);
  }

  function setView(view) {
    state.view = view;
    $("#libraryView").hidden = view !== "library";
    $("#alertsView").hidden = view !== "alerts";
    $("#checklistView").hidden = view !== "checklist";
    $("#savedView").hidden = view !== "saved";
    $("#aboutView").hidden = view !== "about";
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    if (view === "alerts") renderAlerts();
    if (view === "checklist") renderChecklist();
    if (view === "saved") renderSaved();
    if (view === "about") updateStorageStats();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 2600);
  }

  function confirmAction(title, message, actionLabel, callback) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    $("#confirmAction").textContent = actionLabel;
    $("#confirmDialog").hidden = false;
    $("#confirmAction").onclick = () => {
      $("#confirmDialog").hidden = true;
      callback();
    };
  }

  function updateStorageStats() {
    if (!nativeAvailable("getOfflineStorageStats")) {
      $("#storageSize").textContent = "Tersedia di APK Android";
      $("#storageFiles").textContent = "PDF dan indeks offline";
      return;
    }
    try {
      const stats = JSON.parse(NativeApp.getOfflineStorageStats());
      $("#storageSize").textContent = stats.formattedBytes;
      $("#storageFiles").textContent = `${stats.pdfFiles} PDF · ${stats.indexFiles} indeks teks`;
    } catch (_) {
      $("#storageSize").textContent = "Tidak dapat dihitung";
    }
  }

  let previousQuery = "";
  elements.input.addEventListener("input", () => {
    state.query = elements.input.value.trim();
    elements.input.parentElement.classList.toggle("has-value", state.query.length > 0);
    if (!previousQuery && state.query) {
      state.sort = "relevance";
      elements.sort.value = "relevance";
    } else if (previousQuery && !state.query) {
      state.sort = "latest";
      elements.sort.value = "latest";
    }
    previousQuery = state.query;
    renderRecentSearches();
    renderLibrary();
    searchOfflinePdfs();
  });

  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      elements.input.blur();
      saveRecentSearch(state.query);
    }
  });

  elements.clear.addEventListener("click", () => {
    elements.input.value = "";
    elements.input.dispatchEvent(new Event("input"));
    elements.input.focus();
  });

  $$(".mode").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      $$(".mode").forEach((item) => item.classList.toggle("active", item === button));
      renderLibrary();
      searchOfflinePdfs();
    });
  });

  $("#quickSearches").querySelectorAll("[data-query]").forEach((button) => {
    button.addEventListener("click", () => runSearch(button.dataset.query, true));
  });

  elements.filterButton.addEventListener("click", () => {
    elements.filters.hidden = !elements.filters.hidden;
  });

  elements.resetFilter.addEventListener("click", () => {
    state.categories.clear();
    state.statuses.clear();
    state.integrityStates.clear();
    state.attentionOnly = false;
    renderFilters();
    renderLibrary();
  });

  elements.sort.addEventListener("change", () => {
    state.sort = elements.sort.value;
    renderLibrary();
  });

  $("#emptyReset").addEventListener("click", () => {
    elements.input.value = "";
    state.query = "";
    state.categories.clear();
    state.statuses.clear();
    state.integrityStates.clear();
    state.attentionOnly = false;
    state.offlineMatches.clear();
    previousQuery = "";
    elements.input.parentElement.classList.remove("has-value");
    elements.sort.value = "latest";
    state.sort = "latest";
    renderFilters();
    renderLibrary();
    renderRecentSearches();
  });

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  $("#aboutButton").addEventListener("click", () => setView("about"));
  elements.backdrop.addEventListener("click", closeDetail);

  $("#savedAlertsOnly").addEventListener("change", (event) => {
    state.savedAlertsOnly = event.target.checked;
    writeStore("regulabank-saved-alerts-only", state.savedAlertsOnly);
    renderAlerts();
  });

  $("#checklistSelect").addEventListener("change", (event) => {
    state.checklistId = event.target.value;
    writeStore("regulabank-active-checklist", state.checklistId);
    renderChecklist();
  });

  $("#openChecklistRegulation").addEventListener("click", () => openDetail(checklistTemplate().regulationId));
  $("#resetChecklist").addEventListener("click", () => {
    const template = checklistTemplate();
    confirmAction(
      "Atur ulang checklist?",
      `Semua progres, PIC, target, dan bukti pada “${template.title}” akan dihapus.`,
      "Atur ulang",
      () => {
        delete state.checklist[template.id];
        saveChecklist();
        renderChecklist();
        showToast("Checklist berhasil diatur ulang.");
      }
    );
  });

  $("#clearOfflineData").addEventListener("click", () => {
    confirmAction(
      "Hapus semua PDF offline?",
      "Semua PDF dan indeks teks yang diunduh akan dihapus. Bookmark, catatan, dan checklist tetap aman.",
      "Hapus PDF",
      () => {
        if (!nativeAvailable("clearOfflineData")) {
          showToast("Kontrol penyimpanan tersedia pada APK Android.");
          return;
        }
        try {
          const removed = NativeApp.clearOfflineData();
          state.offlineMatches.clear();
          updateStorageStats();
          showToast(`${removed} file offline dihapus.`);
        } catch (_) {
          showToast("Data offline tidak dapat dihapus.");
        }
      }
    );
  });

  $("#confirmCancel").addEventListener("click", () => {
    $("#confirmDialog").hidden = true;
  });

  window.onPdfDownloadUpdate = (id, downloadState, completed, total, message, saved) => {
    if (elements.sheet.dataset.regulationId !== id || elements.sheet.hidden) return;
    const progress = $("#pdfProgress");
    const bar = $("#pdfProgressBar");
    const status = $("#pdfStatus");
    const downloadButton = $("#downloadPdfs");
    const openButton = $("#openPdfs");
    if (!progress || !bar || !status || !downloadButton || !openButton) return;

    progress.hidden = false;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 8;
    bar.style.width = `${Math.max(8, percentage)}%`;
    status.textContent = message;
    status.classList.toggle("error", downloadState === "error");

    if (downloadState === "complete" || downloadState === "error") {
      downloadButton.disabled = false;
      downloadButton.textContent = downloadState === "complete" ? "Perbarui PDF" : "Coba lagi";
      if (downloadState === "complete" && nativeAvailable("prepareOfflineIndex")) {
        status.textContent = `${message} Menyiapkan indeks teks…`;
        setTimeout(() => {
          try {
            const indexed = NativeApp.prepareOfflineIndex(id);
            status.textContent = `${message} ${indexed} PDF berhasil diindeks.`;
          } catch (_) {
            status.textContent = `${message} Indeks teks akan dibuat saat pencarian.`;
          }
          updateStorageStats();
        }, 80);
      }
    }
    if (saved > 0) {
      openButton.hidden = false;
      openButton.textContent = `Buka PDF (${saved})`;
    }
  };

  window.addEventListener("popstate", (event) => {
    if (event.state && event.state.detail) {
      openDetail(event.state.detail, false);
    } else if (!elements.sheet.hidden) {
      closeDetail(false);
    }
  });

  function applyDashboardShortcut(kind) {
    state.query = "";
    state.categories.clear();
    state.statuses.clear();
    state.integrityStates.clear();
    state.attentionOnly = kind === "attention";
    if (kind === "upcoming") state.statuses.add("Akan berlaku");
    state.view = "library";
    setView("library");
    renderFilters();
    renderLibrary();
    window.scrollTo({ top: document.querySelector(".library").offsetTop - 64, behavior: "smooth" });
  }

  $(".trust-shortcut").forEach((button) => {
    button.addEventListener("click", () => applyDashboardShortcut(button.dataset.shortcut));
  });

  $("#indexedCount").textContent = String(REGULATIONS.length);
  $("#upcomingCount").textContent = String(REGULATIONS.filter((item) => item.status === "Akan berlaku").length);
  $("#attentionCount").textContent = String(REGULATIONS.filter((item) =>
    item.status.includes("dicabut") ||
    item.status.includes("verifikasi") ||
    ["review", "stale", "unknown"].includes(integrityState(item))
  ).length);

  renderFilters();
  renderLibrary();
  renderSaved();
  renderAlerts();
  renderChecklist();
  renderRecentSearches();
  updateStorageStats();
})();
