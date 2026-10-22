(() => {
  const $ = (id) => document.getElementById(id);

  const chat = $("chat");
  const input = $("questionInput");
  const sendBtn = $("sendBtn");
  const statusEl = $("status");
  const stages = document.querySelectorAll("#stages li");

  let cfg = null;
  let docs = [];
  let activeId = null;
  let queryCount = 0;

  /* ── Helpers ── */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Turn [p.12], [web 2] and grouped [p.3, web 1] citations into tags (text is escaped first).
  const CITE_PART = /^(p\.\s?\d+(?:\s*-\s*\d+)?|web\s?\d+)$/;
  function renderAnswer(text) {
    return escapeHtml(text).replace(/\[([^\]]+)\]/g, (match, inner) => {
      const parts = inner.split(/\s*[,;]\s*/);
      if (!parts.every((p) => CITE_PART.test(p))) return match;
      return parts
        .map((p) => `<span class="cite${p.startsWith("web") ? " cite-web" : ""}">${p}</span>`)
        .join("");
    });
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let detail = await res.text();
      try { detail = JSON.parse(detail).detail || detail; } catch (_) { /* plain text */ }
      throw new Error(detail);
    }
    return res.json();
  }

  /* ── Console messages ── */
  function addMessage(content, role, label, html) {
    const div = el("div", `message ${role}`);
    div.appendChild(el("span", "mono-label muted", label));
    const bubble = el("div", "bubble");
    if (html) bubble.innerHTML = content;
    else bubble.textContent = content;
    div.appendChild(bubble);
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  let loadingEl = null;
  function showLoading() {
    loadingEl = addMessage("Retrieving, grading, refining ", "bot loading", "CRAG");
  }
  function hideLoading() {
    if (loadingEl) loadingEl.remove();
    loadingEl = null;
  }

  /* ── Pipeline stage diagram ── */
  function setStages(state) {
    stages.forEach((li) => li.classList.remove("active", "skipped", "running"));
    if (state === "running") return stages.forEach((li) => li.classList.add("running"));
    if (!state) return;
    const usedWeb = state !== "CORRECT";
    stages.forEach((li) => {
      const webStage = li.dataset.stage === "rewrite" || li.dataset.stage === "web";
      li.classList.add(webStage && !usedWeb ? "skipped" : "active");
    });
  }

  /* ── Per-document report ── */
  function reportBar(r) {
    const wrap = el("div", "report");
    if (!r || !r.questions) {
      wrap.appendChild(el("span", "muted", "No questions asked yet."));
      return wrap;
    }
    const bar = el("div", "report-bar");
    [["correct", r.correct_pct], ["ambiguous", r.ambiguous_pct], ["incorrect", r.incorrect_pct]].forEach(([k, v]) => {
      const seg = el("span", `seg seg-${k}`);
      seg.style.width = `${v}%`;
      bar.appendChild(seg);
    });
    wrap.appendChild(bar);
    wrap.appendChild(el("span", "report-text",
      `${r.questions} question${r.questions === 1 ? "" : "s"} · ${r.correct_pct}% from the PDF · ` +
      `${r.ambiguous_pct}% PDF + web · ${r.incorrect_pct}% not covered`));
    return wrap;
  }

  /* ── Knowledge base ── */
  function renderSpec() {
    const e = cfg.embeddings;
    const rows = [
      ["Model", e.model.replace("sentence-transformers/", "")],
      ["Dimensions", e.dimensions],
      ["Chunk size", `${e.chunk_size} chars`],
      ["Overlap", `${e.chunk_overlap} chars`],
      ["Retrieval", e.retrieval],
      ["Candidates", `${e.candidates} per retriever`],
      ["Graded", `top ${e.top_k} chunks`],
      ["Store", e.vector_store],
      ["LLM", cfg.llm],
      ["Web search", cfg.web_search ? "Tavily (on)" : "off: no TAVILY_API_KEY"],
    ];
    const body = $("kbSpec");
    body.innerHTML = "";
    rows.forEach(([k, v]) => {
      const tr = el("tr");
      tr.appendChild(el("td", "", k));
      tr.appendChild(el("td", "", String(v)));
      body.appendChild(tr);
    });
  }

  function renderDocs() {
    const wrap = $("kbDocs");
    wrap.innerHTML = "";
    if (!docs.length) {
      const card = el("div", "card kb-doc");
      card.appendChild(el("span", "mono-label muted", "No documents yet. Upload a PDF to get started."));
      wrap.appendChild(card);
      return;
    }
    docs.forEach((d) => {
      const ready = d.status === "ready";
      const card = el("article", `card kb-doc${d.doc_id === activeId ? " active" : ""}${ready ? " selectable" : ""}`);
      const head = el("div", "kb-doc-head");
      head.appendChild(el("span", "mono-label muted",
        `${d.doc_id === cfg.demo_doc_id ? "Demo" : "Upload"} · ${d.name}`));
      head.appendChild(el("span", `tag status-${d.status}`, d.status));
      card.appendChild(head);
      card.appendChild(el("h3", "", d.title || d.name));
      if (d.author) card.appendChild(el("div", "author", d.author));

      if (ready) {
        const meta = el("div", "kb-meta");
        const pages = d.total_pages && d.total_pages > d.pages ? `${d.pages} of ${d.total_pages} pages` : `${d.pages} pages`;
        meta.appendChild(el("span", "tag", pages));
        meta.appendChild(el("span", "tag tag-mint", `${(d.chunks || 0).toLocaleString()} chunks`));
        if (d.index_seconds !== undefined) meta.appendChild(el("span", "tag", `indexed in ${d.index_seconds} s`));
        card.appendChild(meta);
        card.appendChild(reportBar(d.report));

        if (d.doc_id === activeId && d.chapters && d.chapters.length) {
          card.appendChild(el("span", "mono-label muted kb-chapters-label", "Topics covered"));
          const list = el("ol", "kb-chapters");
          d.chapters.forEach((c) => list.appendChild(el("li", "", c)));
          card.appendChild(list);
        }
        card.addEventListener("click", () => selectDoc(d.doc_id));
      } else if (d.status === "error") {
        card.appendChild(el("p", "kb-error", d.error || "Indexing failed."));
      } else {
        const bar = el("div", "progress");
        const fill = el("span");
        fill.style.width = `${Math.round((d.progress || 0) * 100)}%`;
        bar.appendChild(fill);
        card.appendChild(bar);
      }
      wrap.appendChild(card);
    });
  }

  function selectDoc(docId) {
    activeId = docId;
    try { localStorage.setItem("crag.activeDoc", docId); } catch (_) { /* storage unavailable */ }
    const d = docs.find((x) => x.doc_id === docId);
    $("activeDoc").textContent = d ? `Asking: ${d.title || d.name}` : "No document selected";
    renderDocs();
    renderChips(d);
    $("metaReport").replaceChildren(reportBar(d && d.report));
  }

  function renderChips(d) {
    const chips = $("chips");
    chips.innerHTML = "";
    const qs = d && d.doc_id === cfg.demo_doc_id ? cfg.demo_questions : [];
    qs.forEach((q) => {
      const chip = el("button", "chip", q);
      chip.type = "button";
      chip.addEventListener("click", () => { input.value = q; ask(); });
      chips.appendChild(chip);
    });
  }

  async function refreshDocs() {
    docs = await api("/api/docs");
    const ready = docs.filter((d) => d.status === "ready");
    if (!docs.some((d) => d.doc_id === activeId && d.status === "ready")) {
      let saved = null;
      try { saved = localStorage.getItem("crag.activeDoc"); } catch (_) { /* storage unavailable */ }
      const pick = ready.find((d) => d.doc_id === saved) || ready.find((d) => d.doc_id === cfg.demo_doc_id) || ready[0];
      activeId = pick ? pick.doc_id : null;
    }
    selectDoc(activeId);
    // Keep polling while anything is still indexing.
    if (docs.some((d) => d.status === "queued" || d.status === "indexing")) setTimeout(refreshDocs, 1500);
  }

  /* ── Upload ── */
  const fileInput = $("fileInput");
  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    $("dzTitle").textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : "Drop a PDF here or click to choose";
    $("uploadBtn").disabled = !f;
    $("uploadMsg").textContent = "";
  });

  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event("change"));
    }
  });

  async function pollUpload(docId) {
    const s = await api(`/api/status/${docId}`);
    const pct = Math.round((s.progress || 0) * 100);
    $("uploadBar").style.width = `${pct}%`;
    if (s.status === "ready") {
      $("uploadMsg").textContent = `Indexed: ${s.pages} pages, ${s.chunks} chunks in ${s.index_seconds} s.`;
      $("uploadProgress").hidden = true;
      $("uploadBtn").disabled = false;
      activeId = docId;
      await refreshDocs();
      return;
    }
    if (s.status === "error") {
      $("uploadMsg").textContent = `Failed: ${s.error}`;
      $("uploadProgress").hidden = true;
      $("uploadBtn").disabled = false;
      await refreshDocs();
      return;
    }
    $("uploadMsg").textContent = s.status === "queued" ? "Queued…" : `Embedding… ${pct}%`;
    setTimeout(() => pollUpload(docId), 1000);
  }

  $("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > cfg.max_upload_mb * 1048576) {
      $("uploadMsg").textContent = `File is larger than ${cfg.max_upload_mb} MB.`;
      return;
    }
    $("uploadBtn").disabled = true;
    $("uploadProgress").hidden = false;
    $("uploadBar").style.width = "0%";
    $("uploadMsg").textContent = "Uploading and indexing…";
    try {
      const body = new FormData();
      body.append("file", f);
      const { doc_id } = await api("/api/upload", { method: "POST", body });
      fileInput.value = "";
      $("dzTitle").textContent = "Drop a PDF here or click to choose";
      refreshDocs();
      pollUpload(doc_id);
    } catch (err) {
      $("uploadMsg").textContent = `Upload failed: ${err.message}`;
      $("uploadProgress").hidden = true;
      $("uploadBtn").disabled = false;
    }
  });

  /* ── Trace panel ── */
  const VERDICT_TEXT = {
    CORRECT: "Answered from your PDF",
    AMBIGUOUS: "PDF and web combined",
    INCORRECT: "Not in your PDF, answered from the web",
  };

  function showTrace(r) {
    const v = $("metaVerdict");
    v.textContent = r.verdict;
    v.className = `verdict verdict-${r.verdict.toLowerCase()}`;
    $("metaVerdictText").textContent = `${VERDICT_TEXT[r.verdict] || ""}. ${r.reason}`;

    $("splitBook").style.width = `${r.evidence_from_book_pct}%`;
    $("splitWeb").style.width = `${r.evidence_from_web_pct}%`;
    $("splitBookLabel").textContent = `PDF ${r.evidence_from_book_pct}%`;
    $("splitWebLabel").textContent = `Web ${r.evidence_from_web_pct}%`;

    $("metaBest").textContent = r.best_book_score.toFixed(2);
    $("metaCalls").textContent = r.cached ? "0" : r.llm_calls;
    $("metaLatency").textContent = r.cached ? "—" : r.latency_s.toFixed(1);
    $("metaLatencyLabel").textContent = r.cached ? "Cached" : "Seconds";

    const body = $("metaChunks");
    body.innerHTML = "";
    r.chunk_scores.forEach((c) => {
      const tr = el("tr");
      tr.title = c.preview;
      tr.appendChild(el("td", "", c.rank));
      tr.appendChild(el("td", "", `p.${c.page}`));
      const sc = el("td");
      const meter = el("span", "meter");
      const fill = el("span");
      fill.style.width = `${Math.round(c.score * 100)}%`;
      meter.appendChild(fill);
      sc.appendChild(meter);
      sc.appendChild(el("span", "meter-num", c.score.toFixed(2)));
      tr.appendChild(sc);
      tr.appendChild(el("td", c.used ? "used-yes" : "muted", c.used ? "yes" : "no"));
      body.appendChild(tr);
    });

    const src = $("metaSources");
    src.innerHTML = "";
    src.appendChild(el("span", "mono-label muted", `Sources · ${r.sentences_kept}/${r.sentences_in} sentences kept`));
    if (r.book_pages_used.length) {
      const pages = el("div", "page-tags");
      r.book_pages_used.forEach((p) => pages.appendChild(el("span", "cite", `p.${p}`)));
      src.appendChild(pages);
    }
    if (r.web_sources.length) {
      src.appendChild(el("div", "web-query", `Web search: “${r.web_query}”`));
      const list = el("ol", "web-list");
      r.web_sources.forEach((w) => {
        const li = el("li");
        const a = el("a", "", w.title || w.url);
        a.href = w.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.appendChild(a);
        list.appendChild(li);
      });
      src.appendChild(list);
    }
    if (!r.book_pages_used.length && !r.web_sources.length) src.appendChild(el("p", "muted", "No sources used."));

    $("metaReport").replaceChildren(reportBar(r.book_report));
    setStages(r.verdict);
  }

  /* ── Ask ── */
  async function ask(e) {
    if (e) e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (!activeId) {
      addMessage("Upload a PDF or pick one in the knowledge base first.", "bot error", "Error");
      return;
    }

    input.value = "";
    sendBtn.disabled = true;
    statusEl.textContent = "Running";
    queryCount += 1;
    const n = String(queryCount).padStart(2, "0");

    addMessage(q, "user", `Query ${n}`);
    showLoading();
    setStages("running");

    try {
      const r = await api("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: activeId, question: q }),
      });
      hideLoading();
      addMessage(renderAnswer(r.answer), "bot", `Answer ${n}${r.cached ? " · cached" : ""}`, true);
      showTrace(r);
      const d = docs.find((x) => x.doc_id === activeId);
      if (d) { d.report = r.book_report; renderDocs(); }
      statusEl.textContent = "Ready";
    } catch (err) {
      hideLoading();
      setStages(null);
      addMessage(`Error: ${err.message}`, "bot error", "Error");
      statusEl.textContent = "Error";
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  /* ── Events & boot ── */
  $("askForm").addEventListener("submit", ask);

  $("metaClose").addEventListener("click", () => {
    const trace = document.querySelector(".trace");
    trace.classList.toggle("collapsed");
    $("metaClose").textContent = trace.classList.contains("collapsed") ? "Expand" : "Collapse";
  });

  (async () => {
    try {
      cfg = await api("/api/config");
      const short = cfg.llm.split("/").pop().replace("-instruct", "").toUpperCase();
      $("modelBadge").textContent = `${short} · ${cfg.web_search ? "WEB ON" : "WEB OFF"}`;
      $("uploadLimits").textContent = `Max ${cfg.max_upload_mb} MB · first ${cfg.max_pages} pages`;
      renderSpec();
      await refreshDocs();
    } catch (err) {
      $("kbDocs").innerHTML = "";
      const card = el("div", "card kb-doc");
      card.appendChild(el("span", "mono-label muted", `Could not reach the server: ${err.message}`));
      $("kbDocs").appendChild(card);
    }
  })();
})();
