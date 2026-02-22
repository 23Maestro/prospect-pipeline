const state = {
  searchResults: [],
  selected: null,
  selectedResolved: null,
  selectionRequestId: 0,
  searchRequestId: 0,
};

const el = {
  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  searchStatus: document.getElementById("searchStatus"),
  searchMeta: document.getElementById("searchMeta"),
  resultList: document.getElementById("resultList"),
  resultTemplate: document.getElementById("resultItemTemplate"),
  athleteHeader: document.getElementById("athleteHeader"),
  detailStatus: document.getElementById("detailStatus"),
  emptyState: document.getElementById("emptyState"),
  detailContent: document.getElementById("detailContent"),
  identityGrid: document.getElementById("identityGrid"),
  videoPanel: document.getElementById("videoPanel"),
  contactPanel: document.getElementById("contactPanel"),
  notesPanel: document.getElementById("notesPanel"),
  addNoteForm: document.getElementById("addNoteForm"),
  noteTitle: document.getElementById("noteTitle"),
  noteDescription: document.getElementById("noteDescription"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  panels: Array.from(document.querySelectorAll(".tab-panel")),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.detail || data?.message || text || `HTTP ${response.status}`;
    throw new Error(String(detail));
  }

  return data;
}

function setSearchStatus(message) {
  el.searchStatus.textContent = message;
}

function setDetailStatus(message) {
  el.detailStatus.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function infoMessage(text) {
  return `<div class="info-message">${escapeHtml(text)}</div>`;
}

function errorMessage(text) {
  return `<div class="error-message">${escapeHtml(text)}</div>`;
}

function pickAthleteId(task) {
  const raw = task?.athlete_id;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function dedupeByAthleteId(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.athlete_id || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function rawSearch(term) {
  const parts = term.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.length >= 2 ? parts[0] : undefined;
  const lastName = parts.length >= 2 ? parts.slice(1).join(" ") : undefined;

  return api("/api/v1/athlete/raw-search", {
    method: "POST",
    body: JSON.stringify({
      term,
      email: term.includes("@") ? term : undefined,
      first_name: firstName,
      last_name: lastName,
      include_admin_search: true,
      include_recent_search: false,
    }),
  });
}

function shouldUseFallbackSearch(term) {
  const trimmed = term.trim();
  return trimmed.includes("@") || /^\d{5,}$/.test(trimmed);
}

async function fallbackVideoSearch(term) {
  const payload = await api("/api/v1/video/progress", {
    method: "POST",
    body: JSON.stringify({
      search_all_fields: term,
    }),
  });

  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  const mapped = tasks
    .map((task) => {
      const athleteId = pickAthleteId(task);
      if (!athleteId) return null;
      return {
        athlete_id: athleteId,
        athlete_main_id: task.athlete_main_id ? String(task.athlete_main_id) : "",
        name: task.athletename || `Athlete ${athleteId}`,
        grad_year: task.grad_year || "",
        sport: task.sport_name || "",
        high_school: task.high_school || "",
        city: task.high_school_city || "",
        state: task.high_school_state || "",
        positions: [task.primaryposition, task.secondaryposition, task.thirdposition].filter(Boolean).join(" | "),
        source: "video_progress_fallback",
        contact_id: athleteId,
      };
    })
    .filter(Boolean);

  return {
    success: true,
    results: dedupeByAthleteId(mapped),
    sources: [{ source: "video_progress_fallback", count: mapped.length }],
  };
}

function renderResults(results) {
  el.resultList.innerHTML = "";

  if (!results.length) {
    const noRow = document.createElement("li");
    noRow.className = "info-message";
    noRow.textContent = "No results found.";
    el.resultList.appendChild(noRow);
    return;
  }

  for (const result of results) {
    const frag = el.resultTemplate.content.cloneNode(true);
    const li = frag.querySelector(".result-item");
    const button = frag.querySelector(".result-button");
    const main = frag.querySelector(".result-main");
    const sub = frag.querySelector(".result-sub");

    main.textContent = result.name || `Athlete ${result.athlete_id}`;
    sub.textContent = [
      result.grad_year ? `Class ${result.grad_year}` : null,
      result.sport || null,
      result.high_school || null,
      result.source ? `Source: ${result.source}` : null,
    ]
      .filter(Boolean)
      .join(" • ");

    if (state.selected && String(state.selected.athlete_id) === String(result.athlete_id)) {
      button.classList.add("active");
    }

    button.addEventListener("click", async () => {
      await selectAthlete(result);
    });

    li.appendChild(button);
    el.resultList.appendChild(li);
  }
}

function renderIdentity(result) {
  const values = [
    ["Athlete ID", result.athlete_id || "N/A"],
    ["Main ID", result.athlete_main_id || "N/A"],
    ["Contact ID", result.contact_id || result.athlete_id || "N/A"],
    ["Grad Year", result.grad_year || "N/A"],
    ["Sport", result.sport || "N/A"],
    ["High School", result.high_school || "N/A"],
    ["Location", [result.city, result.state].filter(Boolean).join(", ") || "N/A"],
  ];

  el.identityGrid.innerHTML = values
    .map(([label, value]) => `
      <article class="identity-card">
        <div class="identity-label">${escapeHtml(label)}</div>
        <div class="identity-value">${escapeHtml(value)}</div>
      </article>
    `)
    .join("");
}

function renderVideo(rows) {
  if (!rows.length) {
    el.videoPanel.innerHTML = infoMessage("No video progress rows found for this athlete.");
    return;
  }

  el.videoPanel.innerHTML = rows
    .map((row) => {
      const status = row.video_progress_status || row.status || "(blank)";
      const stage = row.video_progress_stage || row.stage || "(blank)";
      const editor = row.assignedvideoeditor || "Unassigned";
      const dueDate = row.video_due_date || "None";
      const id = row.id || "n/a";
      return `
        <article class="data-row">
          <strong>${escapeHtml(row.athletename || "Athlete")}</strong>
          <div class="data-sub">Task ID: ${escapeHtml(id)} • Stage: ${escapeHtml(stage)} • Status: ${escapeHtml(status)}</div>
          <div class="data-sub">Assigned Editor: ${escapeHtml(editor)} • Due Date: ${escapeHtml(dueDate)}</div>
        </article>
      `;
    })
    .join("");
}

function renderContact(contact) {
  if (!contact) {
    el.contactPanel.innerHTML = infoMessage("No contact info available.");
    return;
  }

  function contactBlock(label, person) {
    if (!person) return "";
    return `
      <article class="data-row">
        <strong>${escapeHtml(label)}: ${escapeHtml(person.name || "N/A")}</strong>
        <div class="data-sub">Email: ${escapeHtml(person.email || "N/A")}</div>
        <div class="data-sub">Phone: ${escapeHtml(person.phone || "N/A")}</div>
        ${person.relationship ? `<div class="data-sub">Relationship: ${escapeHtml(person.relationship)}</div>` : ""}
      </article>
    `;
  }

  const student = contact.studentAthlete || contact.student_athlete;
  const parent1 = contact.parent1;
  const parent2 = contact.parent2;

  const html = [
    contactBlock("Student Athlete", student),
    contactBlock("Parent 1", parent1),
    contactBlock("Parent 2", parent2),
  ].filter(Boolean).join("");

  el.contactPanel.innerHTML = html || infoMessage("No structured contact fields were returned.");
}

function renderNotes(notes) {
  if (!notes.length) {
    el.notesPanel.innerHTML = infoMessage("No notes found for this athlete.");
    return;
  }

  el.notesPanel.innerHTML = notes
    .map((note) => `
      <article class="data-row">
        <strong>${escapeHtml(note.title || "Note")}</strong>
        <div>${escapeHtml(note.description || "")}</div>
        <div class="data-sub">${escapeHtml(note.metadata || note.created_by || "")}</div>
      </article>
    `)
    .join("");
}

async function loadVideoSummary(selected, resolved) {
  const searchTerm = String(selected.athlete_id || "").trim();
  const response = await api("/api/v1/video/progress", {
    method: "POST",
    body: JSON.stringify({ search_all_fields: searchTerm }),
  });

  const allRows = Array.isArray(response?.tasks) ? response.tasks : [];
  const athleteId = String(resolved?.athlete_id || selected.athlete_id || "");
  const filteredRows = allRows.filter((row) => String(row?.athlete_id || "") === athleteId);
  renderVideo(filteredRows);
}

async function loadContact(selected, resolved) {
  const athleteMainId = resolved?.athlete_main_id || selected.athlete_main_id;
  const contactId = selected.contact_id || resolved?.contact_id || selected.athlete_id;

  if (!athleteMainId) {
    el.contactPanel.innerHTML = '<div class="error-message">Missing athlete_main_id. Contact info cannot be loaded.</div>';
    return;
  }

  const contact = await api(`/api/v1/contacts/${encodeURIComponent(contactId)}/enriched?athlete_main_id=${encodeURIComponent(athleteMainId)}`);
  renderContact(contact);
}

async function loadNotes(selected, resolved) {
  const athleteMainId = resolved?.athlete_main_id || selected.athlete_main_id;
  if (!athleteMainId) {
    el.notesPanel.innerHTML = '<div class="error-message">Missing athlete_main_id. Notes cannot be loaded.</div>';
    return;
  }

  const response = await api("/api/v1/notes/list", {
    method: "POST",
    body: JSON.stringify({
      athlete_id: String(selected.athlete_id),
      athlete_main_id: String(athleteMainId),
    }),
  });

  renderNotes(Array.isArray(response?.notes) ? response.notes : []);
}

async function selectAthlete(result) {
  const requestId = ++state.selectionRequestId;
  state.selected = {
    ...result,
    athlete_id: String(result.athlete_id),
    athlete_main_id: result.athlete_main_id ? String(result.athlete_main_id) : "",
    contact_id: result.contact_id ? String(result.contact_id) : String(result.athlete_id),
  };

  renderResults(state.searchResults);
  setDetailStatus("Loading");
  el.emptyState.classList.add("hidden");
  el.detailContent.classList.remove("hidden");
  el.athleteHeader.textContent = state.selected.name || `Athlete ${state.selected.athlete_id}`;
  renderIdentity(state.selected);
  el.videoPanel.innerHTML = infoMessage("Loading video progress...");
  el.contactPanel.innerHTML = infoMessage("Loading contact info...");
  el.notesPanel.innerHTML = infoMessage("Loading notes...");

  try {
    const resolved = await api(`/api/v1/athlete/${encodeURIComponent(state.selected.athlete_id)}/resolve`);
    if (requestId !== state.selectionRequestId) return;
    state.selectedResolved = resolved;

    const merged = {
      ...state.selected,
      ...resolved,
      contact_id: state.selected.contact_id || resolved.contact_id || state.selected.athlete_id,
    };
    state.selected = merged;

    renderIdentity(merged);
    await Promise.all([
      loadVideoSummary(merged, resolved),
      loadContact(merged, resolved),
      loadNotes(merged, resolved),
    ]);
    if (requestId !== state.selectionRequestId) return;

    setDetailStatus("Ready");
  } catch (error) {
    if (requestId !== state.selectionRequestId) return;
    setDetailStatus("Error");
    const message = error instanceof Error ? error.message : String(error);
    const errorHtml = errorMessage(message);
    el.videoPanel.innerHTML = errorHtml;
    el.contactPanel.innerHTML = errorHtml;
    el.notesPanel.innerHTML = errorHtml;
  }
}

async function runSearch(term) {
  const requestId = ++state.searchRequestId;
  const submitButton = el.searchForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Searching...";
  setSearchStatus("Searching");
  el.searchMeta.textContent = "Running global search...";

  try {
    let payload = await rawSearch(term);
    if (requestId !== state.searchRequestId) return;
    let results = Array.isArray(payload?.results) ? payload.results : [];

    if (!results.length && shouldUseFallbackSearch(term)) {
      const fallback = await fallbackVideoSearch(term);
      if (requestId !== state.searchRequestId) return;
      payload = {
        ...payload,
        results: fallback.results,
        sources: [
          ...(Array.isArray(payload?.sources) ? payload.sources : []),
          ...(Array.isArray(fallback.sources) ? fallback.sources : []),
        ],
      };
      results = payload.results;
    }

    state.searchResults = dedupeByAthleteId(results.map((result) => ({
      ...result,
      athlete_id: String(result.athlete_id),
      athlete_main_id: result.athlete_main_id ? String(result.athlete_main_id) : "",
      contact_id: result.contact_id ? String(result.contact_id) : String(result.athlete_id),
    })));

    renderResults(state.searchResults);

    const sourceLabel = (payload.sources || [])
      .map((source) => source.source)
      .filter(Boolean)
      .join(", ");

    el.searchMeta.textContent = `${state.searchResults.length} result(s)${sourceLabel ? ` • Sources: ${sourceLabel}` : ""}`;
    setSearchStatus("Ready");
  } catch (error) {
    if (requestId !== state.searchRequestId) return;
    state.searchResults = [];
    renderResults([]);
    setSearchStatus("Error");
    el.searchMeta.innerHTML = `<span class="error-message">${escapeHtml(error instanceof Error ? error.message : String(error))}</span>`;
  } finally {
    if (requestId !== state.searchRequestId) return;
    submitButton.disabled = false;
    submitButton.textContent = "Find";
  }
}

el.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const term = el.searchInput.value.trim();
  if (!term) return;
  await runSearch(term);
});

el.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    el.tabs.forEach((item) => item.classList.toggle("active", item === tab));
    el.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === target));
  });
});

el.addNoteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selected) return;

  const athleteMainId = state.selected.athlete_main_id || state.selectedResolved?.athlete_main_id;
  if (!athleteMainId) {
    el.notesPanel.innerHTML = errorMessage("Cannot add note: missing athlete_main_id.");
    return;
  }

  const title = el.noteTitle.value.trim();
  const description = el.noteDescription.value.trim();

  if (!title || !description) return;

  const submitButton = el.addNoteForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  try {
    await api("/api/v1/notes/add", {
      method: "POST",
      body: JSON.stringify({
        athlete_id: String(state.selected.athlete_id),
        athlete_main_id: String(athleteMainId),
        title,
        description,
      }),
    });

    el.noteTitle.value = "";
    el.noteDescription.value = "";

    await loadNotes(state.selected, state.selectedResolved || state.selected);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    el.notesPanel.innerHTML = errorMessage(`Failed to add note: ${message}`);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save Note";
  }
});
