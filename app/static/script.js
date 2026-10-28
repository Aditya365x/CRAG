(() => {
  const $ = (id) => document.getElementById(id);

  const app = $("app");
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

  function icon(name, extra) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", `ico${extra ? ` ${extra}` : ""}`);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function timeNow() {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

  /* ── Views (Ask · Documents · Trace) ── */
  const TITLES = { ask: "Ask your document", docs: "Documents", trace: "Pipeline trace" };

  function setView(view) {
    // The Trace tab only exists on narrow screens; wide screens show the side panel instead.
    if (view === "trace" && window.matchMedia("(min-width: 1080px)").matches) view = "ask";
    app.dataset.view = view;
    $("viewTitle").textContent = TITLES[view];
    document.querySelectorAll("[data-go]").forEach((b) => {
      const on = b.dataset.go === view;
      if (b.getAttribute("role") === "tab") b.setAttribute("aria-selected", String(on));
      else if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  document.querySelectorAll("[data-go]").forEach((b) => {
    b.addEventListener("click", () => {
      setView(b.dataset.go);
      window.scrollTo({ top: 0 });
    });
  });

  $("railUpload").addEventListener("click", () => {
    setView("docs");
    $("fileInput").click();
  });

  /* ── Posts ── */
  function post({ role, label, html, content, extraClass }) {
    const art = el("article", `post post-${role}${extraClass ? ` ${extraClass}` : ""}`);
    let avatar;
    if (role === "question") {
      avatar = el("span", "avatar avatar-you", "You");
    } else {
      avatar = el("span", "avatar avatar-mark");
      avatar.innerHTML = '<svg><use href="#i-mark" /></svg>';
    }
    avatar.setAttribute("aria-hidden", "true");
    art.appendChild(avatar);

    const body = el("div", "post-body");
    const head = el("div", "post-head");
    head.appendChild(el("span", "post-name", role === "question" ? "You" : "CRAG"));
    head.appendChild(el("span", "post-handle", label));
    head.appendChild(el("span", "post-time", timeNow()));
    body.appendChild(head);

    const text = el("div", "post-text");
    if (html) text.innerHTML = html;
    else if (content !== undefined) text.textContent = content;
    body.appendChild(text);
    art.appendChild(body);
    return art;
  }

  function addError(message) {
    chat.prepend(post({ role: "answer", label: "Error", content: message, extraClass: "post-error" }));
  }

  function loadingPost() {
    const art = post({ role: "answer", label: "Working" });
    const box = el("div", "thinking");
    for (let i = 0; i < 3; i += 1) box.appendChild(el("span", "thinking-line"));
    const step = el("span", "thinking-step", "Retrieving passages…");
    box.appendChild(step);
    art.querySelector(".post-text").replaceWith(box);
    const steps = ["Retrieving passages…", "Grading each chunk…", "Filtering sentences…", "Writing the answer…"];
    let i = 0;
    art._timer = setInterval(() => { i = Math.min(i + 1, steps.length - 1); step.textContent = steps[i]; }, 2200);
    return art;
  }

  function metric(name, text, title) {
    const m = el("span", "metric");
    m.appendChild(icon(name));
    m.appendChild(el("span", "", text));
    if (title) m.title = title;
    return m;
  }

  function answerFoot(r) {
    const foot = el("div", "post-foot");
    const v = el("span", `verdict verdict-${r.verdict.toLowerCase()}`, r.verdict);
    v.title = VERDICT_TEXT[r.verdict] || "";
    foot.appendChild(v);
    foot.appendChild(metric("book", String(r.book_pages_used.length), "PDF pages cited"));
    foot.appendChild(metric("globe", String(r.web_sources.length), "Web sources used"));
    foot.appendChild(metric("zap", r.cached ? "0" : String(r.llm_calls), "LLM calls"));
    foot.appendChild(metric("clock", r.cached ? "cached" : `${r.latency_s.toFixed(1)} s`, "Latency"));

    const copy = el("button", "icon-btn");
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy answer");
    copy.appendChild(icon("copy"));
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r.answer);
        copy.replaceChildren(icon("check"));
        setTimeout(() => copy.replaceChildren(icon("copy")), 1600);
      } catch (_) { /* clipboard unavailable */ }
    });
    foot.appendChild(copy);
    return foot;
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
      wrap.appendChild(el("span", "report-text", "No questions asked yet."));
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
      wrap.appendChild(el("div", "empty", "No documents yet. Upload a PDF to get started."));
      return;
    }
    docs.forEach((d) => {
      const ready = d.status === "ready";
      const card = el("article", `doc-card${d.doc_id === activeId ? " active" : ""}${ready ? " selectable" : ""}`);
      const ic = el("span", "doc-icon");
      ic.appendChild(icon("docs"));
      card.appendChild(ic);

      const body = el("div", "doc-body");
      const top = el("div", "doc-top");
      top.appendChild(el("span", "doc-title", d.title || d.name));
      top.appendChild(el("span", `doc-state state-${d.status}`, d.status));
      body.appendChild(top);
      body.appendChild(el("span", "doc-sub",
        `${d.doc_id === cfg.demo_doc_id ? "Demo" : "Upload"} · ${d.author ? `${d.author} · ` : ""}${d.name}`));

      if (ready) {
        const meta = el("div", "doc-meta");
        const pages = d.total_pages && d.total_pages > d.pages ? `${d.pages} of ${d.total_pages}` : `${d.pages}`;
        const add = (b, t) => { const s = el("span"); s.appendChild(el("b", "", b)); s.append(` ${t}`); meta.appendChild(s); };
        add(pages, "pages");
        add((d.chunks || 0).toLocaleString(), "chunks");
        if (d.index_seconds !== undefined) add(`${d.index_seconds} s`, "to index");
        body.appendChild(meta);
        body.appendChild(reportBar(d.report));

        if (d.doc_id === activeId && d.chapters && d.chapters.length) {
          body.appendChild(el("span", "chapters-label", "Topics covered"));
          const list = el("ul", "chapters");
          d.chapters.forEach((c) => list.appendChild(el("li", "", c)));
          body.appendChild(list);
        }
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-pressed", String(d.doc_id === activeId));
        card.addEventListener("click", () => selectDoc(d.doc_id));
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectDoc(d.doc_id); }
        });
      } else if (d.status === "error") {
        body.appendChild(el("p", "doc-error", d.error || "Indexing failed."));
      } else {
        const bar = el("div", "progress");
        const fill = el("span");
        fill.style.width = `${Math.round((d.progress || 0) * 100)}%`;
        bar.appendChild(fill);
        body.appendChild(bar);
      }
      card.appendChild(body);
      wrap.appendChild(card);
    });
  }

  function selectDoc(docId) {
    activeId = docId;
    try { localStorage.setItem("crag.activeDoc", docId); } catch (_) { /* storage unavailable */ }
    const d = docs.find((x) => x.doc_id === docId);
    $("activeDoc").textContent = d ? (d.title || d.name) : "No document selected";
    renderDocs();
    renderChips(d);
    $("metaReport").replaceChildren(reportBar(d && d.report));
  }

  function renderChips(d) {
    const chips = $("chips");
    chips.innerHTML = "";
    const qs = d && d.doc_id === cfg.demo_doc_id ? cfg.demo_questions : [];
    $("suggest").hidden = !qs.length;
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
    src.appendChild(el("span", "row-label", `Sources · ${r.sentences_kept}/${r.sentences_in} sentences kept`));
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
  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
  }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
  });

  async function ask(e) {
    if (e) e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    setView("ask");
    if (!activeId) {
      addError("Upload a PDF or pick one under Documents first.");
      return;
    }

    input.value = "";
    autosize();
    sendBtn.disabled = true;
    statusEl.textContent = "Running the pipeline…";
    statusEl.classList.add("is-running");
    queryCount += 1;
    const n = String(queryCount).padStart(2, "0");

    // Newest exchange goes to the top, question threaded above its answer.
    const group = el("div", "exchange");
    group.appendChild(post({ role: "question", label: `Question ${n}`, content: q, extraClass: "threaded" }));
    const loading = loadingPost();
    group.appendChild(loading);
    chat.prepend(group);
    setStages("running");

    try {
      const r = await api("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: activeId, question: q }),
      });
      clearInterval(loading._timer);
      const ans = post({ role: "answer", label: `Answer ${n}${r.cached ? " · cached" : ""}`, html: renderAnswer(r.answer) });
      ans.querySelector(".post-body").appendChild(answerFoot(r));
      loading.replaceWith(ans);
      showTrace(r);
      const d = docs.find((x) => x.doc_id === activeId);
      if (d) { d.report = r.book_report; renderDocs(); }
      statusEl.textContent = "Ready";
    } catch (err) {
      clearInterval(loading._timer);
      const errPost = post({ role: "answer", label: "Error", content: `Error: ${err.message}`, extraClass: "post-error" });
      loading.replaceWith(errPost);
      setStages(null);
      statusEl.textContent = "Something went wrong";
    } finally {
      statusEl.classList.remove("is-running");
      sendBtn.disabled = false;
      input.focus();
    }
  }

  /* ── Events & boot ── */
  $("askForm").addEventListener("submit", ask);
  setView("ask");

  (async () => {
    try {
      cfg = await api("/api/config");
      const short = cfg.llm.split("/").pop().replace("-instruct", "");
      $("modelName").textContent = short;
      $("modelBadge").textContent = cfg.web_search ? "web search on" : "web search off";
      $("uploadLimits").textContent = `Max ${cfg.max_upload_mb} MB · first ${cfg.max_pages} pages`;
      renderSpec();
      await refreshDocs();
    } catch (err) {
      $("modelName").textContent = "Offline";
      $("kbDocs").replaceChildren(el("div", "empty", `Could not reach the server: ${err.message}`));
    }
  })();
})();
