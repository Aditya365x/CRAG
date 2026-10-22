(() => {
  const chat = document.getElementById("chat");
  const form = document.getElementById("askForm");
  const input = document.getElementById("questionInput");
  const sendBtn = document.getElementById("sendBtn");
  const statusEl = document.getElementById("status");

  // Metadata elements
  const metaVerdict = document.getElementById("metaVerdict");
  const metaReason = document.getElementById("metaReason");
  const metaGoodDocs = document.getElementById("metaGoodDocs");
  const metaWebDocs = document.getElementById("metaWebDocs");
  const metaContext = document.getElementById("metaContext");
  const metaLatency = document.getElementById("metaLatency");
  const metaClose = document.getElementById("metaClose");
  const stages = document.querySelectorAll("#stages li");

  let queryCount = 0;

  /* ── Add a message to the console ── */
  function addMessage(text, role, label) {
    const div = document.createElement("div");
    div.className = `message ${role}`;

    const tag = document.createElement("span");
    tag.className = "mono-label muted";
    tag.textContent = label;
    div.appendChild(tag);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    div.appendChild(bubble);

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  /* ── Show / hide loading indicator ── */
  let loadingEl = null;

  function showLoading() {
    loadingEl = document.createElement("div");
    loadingEl.className = "message bot loading";
    loadingEl.innerHTML =
      '<span class="mono-label muted">CRAG</span><div class="bubble">Retrieving, grading, refining </div>';
    chat.appendChild(loadingEl);
    chat.scrollTop = chat.scrollHeight;
  }

  function hideLoading() {
    if (loadingEl) {
      loadingEl.remove();
      loadingEl = null;
    }
  }

  /* ── Pipeline stage diagram ── */
  function setStages(state) {
    stages.forEach((li) => li.classList.remove("active", "skipped", "running"));
    if (state === "running") {
      stages.forEach((li) => li.classList.add("running"));
      return;
    }
    if (!state) return;
    const usedWeb = state !== "CORRECT";
    stages.forEach((li) => {
      const skip = li.dataset.stage === "web" && !usedWeb;
      li.classList.add(skip ? "skipped" : "active");
    });
  }

  /* ── Update the pipeline trace ── */
  function showMetadata(data, ms) {
    const vClass =
      data.verdict === "CORRECT"     ? "verdict-correct"
    : data.verdict === "INCORRECT"   ? "verdict-incorrect"
    : data.verdict === "AMBIGUOUS"   ? "verdict-ambiguous"
    : "";

    metaVerdict.textContent = data.verdict;
    metaVerdict.className = "verdict " + vClass;

    metaReason.textContent = data.reason;
    metaGoodDocs.textContent = data.good_docs_count;
    metaWebDocs.textContent = data.web_docs_count;
    metaContext.textContent = data.refined_context || "(empty)";
    metaLatency.textContent = `${(ms / 1000).toFixed(1)} s`;
    setStages(data.verdict);
  }

  /* ── Send a question ── */
  async function ask(e) {
    if (e) e.preventDefault();
    const q = input.value.trim();
    if (!q) return;

    input.value = "";
    sendBtn.disabled = true;
    statusEl.textContent = "Running";
    queryCount += 1;
    const n = String(queryCount).padStart(2, "0");

    addMessage(q, "user", `Query ${n}`);
    showLoading();
    setStages("running");
    const t0 = performance.now();

    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      hideLoading();
      addMessage(data.answer, "bot", `Answer ${n}`);
      showMetadata(data, performance.now() - t0);
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

  /* ── Knowledge base ── */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderDocs(docs) {
    const wrap = document.getElementById("kbDocs");
    wrap.innerHTML = "";
    if (!docs.length) {
      const card = el("div", "card kb-doc");
      card.appendChild(el("span", "mono-label muted", "No documents indexed — every answer uses web search."));
      wrap.appendChild(card);
      return;
    }
    docs.forEach((d, i) => {
      const card = el("article", "card kb-doc");
      card.appendChild(el("span", "mono-label muted", `Source ${String(i + 1).padStart(2, "0")} · ${d.file}`));
      card.appendChild(el("h3", "", d.title));
      if (d.author) card.appendChild(el("div", "author", d.author));

      const meta = el("div", "kb-meta");
      meta.appendChild(el("span", "tag", `${d.pages} pages`));
      meta.appendChild(el("span", "tag tag-mint", `${d.chunks.toLocaleString()} chunks`));
      if (d.chapters.length) meta.appendChild(el("span", "tag tag-peri", `${d.chapters.length} chapters`));
      card.appendChild(meta);

      if (d.chapters.length) {
        card.appendChild(el("span", "mono-label muted kb-chapters-label", "Topics covered"));
        const list = el("ol", "kb-chapters");
        d.chapters.forEach((c) => list.appendChild(el("li", "", c)));
        card.appendChild(list);
      }
      wrap.appendChild(card);
    });
  }

  function renderSpec(e) {
    document.getElementById("kbVectors").textContent = `${e.vectors.toLocaleString()} vectors`;
    const rows = [
      ["Model", e.model],
      ["Dimensions", e.dimensions],
      ["Vectors", e.vectors.toLocaleString()],
      ["Chunk size", `${e.chunk_size} chars`],
      ["Overlap", `${e.chunk_overlap} chars`],
      ["Retrieved", `top ${e.top_k} per query`],
      ["Store", e.vector_store],
    ];
    const body = document.getElementById("kbSpec");
    body.innerHTML = "";
    rows.forEach(([k, v]) => {
      const tr = el("tr");
      tr.appendChild(el("td", "", k));
      tr.appendChild(el("td", "", String(v)));
      body.appendChild(tr);
    });
  }

  function renderChips(questions) {
    const chips = document.getElementById("chips");
    chips.innerHTML = "";
    questions.forEach((q) => {
      const chip = el("button", "chip", q);
      chip.type = "button";
      chip.addEventListener("click", () => {
        input.value = q;
        ask();
      });
      chips.appendChild(chip);
    });
  }

  async function loadKnowledgeBase() {
    try {
      const res = await fetch("/documents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const kb = await res.json();
      renderDocs(kb.documents);
      renderSpec(kb.embeddings);
      renderChips(kb.example_questions);
    } catch (err) {
      document.getElementById("kbDocs").innerHTML =
        '<div class="card kb-doc"><span class="mono-label muted">Could not load the knowledge base.</span></div>';
    }
  }

  /* ── Events ── */
  form.addEventListener("submit", ask);
  loadKnowledgeBase();

  metaClose.addEventListener("click", () => {
    const trace = document.querySelector(".trace");
    trace.classList.toggle("collapsed");
    metaClose.textContent = trace.classList.contains("collapsed") ? "Expand" : "Collapse";
  });
})();
