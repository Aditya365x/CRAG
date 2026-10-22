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

  /* ── Events ── */
  form.addEventListener("submit", ask);

  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      input.value = chip.textContent;
      ask();
    })
  );

  metaClose.addEventListener("click", () => {
    const trace = document.querySelector(".trace");
    trace.classList.toggle("collapsed");
    metaClose.textContent = trace.classList.contains("collapsed") ? "Expand" : "Collapse";
  });
})();
