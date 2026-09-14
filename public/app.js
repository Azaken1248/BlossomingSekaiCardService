(function () {
  "use strict";

  const input = document.getElementById("discordId");
  const clearBtn = document.getElementById("clearBtn");
  const regenBtn = document.getElementById("regenBtn");

  const stateIdle = document.getElementById("stateIdle");
  const stateLoading = document.getElementById("stateLoading");
  const stateSuccess = document.getElementById("stateSuccess");
  const stateError = document.getElementById("stateError");

  const stepClear = document.getElementById("stepClear");
  const stepGenerate = document.getElementById("stepGenerate");
  const stepFinalize = document.getElementById("stepFinalize");

  const previewImg = document.getElementById("previewImg");
  const openCardLink = document.getElementById("openCardLink");
  const regenAgainBtn = document.getElementById("regenAgainBtn");
  const retryBtn = document.getElementById("retryBtn");
  const errorText = document.getElementById("errorText");

  function createParticles() {
    const container = document.getElementById("bgParticles");
    const count = 30;
    const colors = ["rgba(167,139,250,0.35)", "rgba(244,114,182,0.3)", "rgba(129,140,248,0.25)"];

    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.classList.add("particle");
      const size = Math.random() * 4 + 2;
      p.style.width = size + "px";
      p.style.height = size + "px";
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = (Math.random() * 15 + 10) + "s";
      p.style.animationDelay = (Math.random() * 10) + "s";
      container.appendChild(p);
    }
  }
  createParticles();

  function validateInput() {
    const val = input.value.trim();
    const valid = /^\d{17,20}$/.test(val);
    regenBtn.disabled = !valid;
    clearBtn.classList.toggle("visible", val.length > 0);
    return valid;
  }

  input.addEventListener("input", validateInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !regenBtn.disabled) {
      regenerate();
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    validateInput();
    input.focus();
  });

  regenBtn.addEventListener("click", regenerate);
  regenAgainBtn.addEventListener("click", regenerate);
  retryBtn.addEventListener("click", regenerate);

  function showState(state) {
    [stateIdle, stateLoading, stateSuccess, stateError].forEach((el) =>
      el.classList.add("hidden")
    );
    state.classList.remove("hidden");
  }

  function setStep(stepEl) {
    [stepClear, stepGenerate, stepFinalize].forEach((el) => {
      el.classList.remove("active", "done");
    });

    const steps = [stepClear, stepGenerate, stepFinalize];
    const idx = steps.indexOf(stepEl);

    for (let i = 0; i < idx; i++) {
      steps[i].classList.add("done");
    }
    if (stepEl) {
      stepEl.classList.add("active");
    }
  }

  function allStepsDone() {
    [stepClear, stepGenerate, stepFinalize].forEach((el) => {
      el.classList.remove("active");
      el.classList.add("done");
    });
  }

  async function regenerate() {
    const discordId = input.value.trim();
    if (!/^\d{17,20}$/.test(discordId)) return;

    regenBtn.classList.add("loading");
    regenBtn.disabled = true;
    input.disabled = true;

    showState(stateLoading);
    setStep(stepClear);

    try {
      await simulateDelay(400);
      setStep(stepGenerate);

      const response = await fetch(`/api/regenerate/${discordId}`, { method: "POST" });

      if (!response.ok) {
        // The server answers with JSON for rate limits (429) and for the busy
        // signal (503); fall back to plain text for anything else.
        let message = `HTTP ${response.status}`;
        try {
          const payload = await response.clone().json();
          if (payload?.error) message = payload.error;
        } catch {
          const text = await response.text();
          if (text) message = text;
        }
        throw new Error(message);
      }

      setStep(stepFinalize);
      await simulateDelay(300);
      allStepsDone();
      await simulateDelay(400);

      const cardUrl = `/api/card/${discordId}?t=${Date.now()}`;
      previewImg.src = cardUrl;
      openCardLink.href = cardUrl;

      showState(stateSuccess);
    } catch (err) {
      errorText.textContent = err.message || "Something went wrong.";
      showState(stateError);
    } finally {
      regenBtn.classList.remove("loading");
      input.disabled = false;
      validateInput();
    }
  }

  function simulateDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
