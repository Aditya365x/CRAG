(() => {
  const chat = document.getElementById("chat");
  const input = document.getElementById("questionInput");
  const sendBtn = document.getElementById("sendBtn");

  // Metadata elements
  const metaVerdict = document.getElementById("metaVerdict");
  const metaReason = document.getElementById("metaReason");
  const metaGoodDocs = document.getElementById("metaGoodDocs");
  const metaWebDocs = document.getElementById("metaWebDocs");
  const metaContext = document.getElementById("metaContext");
  const metaClose = document.getElementById("metaClose");

  /* ── Add a message bubble to the chat ── */
  function addMessage(text, role) {
    const div = document.createElement("div");
    div.className = `message ${role}`;

    // Replace newlines with <br> and render inline code
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
    loadingEl.innerHTML = '<div class="bubble">Thinking…</div>';
    chat.appendChild(loadingEl);
    chat.scrollTop = chat.scrollHeight;
  }

  function hideLoading() {
    if (loadingEl) {
      loadingEl.remove();
      loadingEl = null;
    }
  }

  /* ── Update the metadata sidebar ── */
  function showMetadata(data) {
    const vClass =
      data.verdict === "CORRECT"     ? "verdict-correct"
    : data.verdict === "INCORRECT"   ? "verdict-incorrect"
    : data.verdict === "AMBIGUOUS"   ? "verdict-ambiguous"
    : "";

    metaVerdict.textContent = data.verdict;
    metaVerdict.className = "meta-value " + vClass;

    metaReason.textContent = data.reason;
    metaGoodDocs.textContent = data.good_docs_count;
    metaWebDocs.textContent = data.web_docs_count;
    metaContext.textContent = data.refined_context || "(empty)";
  }

  /* ── Send a question ── */
  async function ask() {
    const q = input.value.trim();
    if (!q) return;

    input.value = "";
    sendBtn.disabled = true;

    addMessage(q, "user");
    showLoading();

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
      addMessage(data.answer, "bot");
      showMetadata(data);
    } catch (err) {
      hideLoading();
      addMessage(`Error: ${err.message}`, "bot");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  /* ── Events ── */
  sendBtn.addEventListener("click", ask);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  });

  metaClose.addEventListener("click", () => {
    document.querySelector(".metadata").classList.toggle("collapsed");
  });
})();
