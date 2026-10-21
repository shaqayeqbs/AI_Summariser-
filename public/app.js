const form = document.querySelector("#summarise-form");
const input = document.querySelector("#source-text");
const count = document.querySelector("#character-count");
const submitButton = document.querySelector("#summarise-button");
const resultCard = document.querySelector("#result-card");
const resultText = document.querySelector("#result-text");
const loadingIndicator = document.querySelector("#loading-indicator");
const errorMessage = document.querySelector("#error-message");
const clearButton = document.querySelector("#clear-button");
const languageButtons = document.querySelectorAll(".language-button");
const themeToggle = document.querySelector("#theme-toggle");
const themeColor = document.querySelector('meta[name="theme-color"]');

let activeController;
let currentLanguage = "en";

const translations = {
  en: {
    title: "Briefly — text summariser",
    homeLabel: "Briefly home",
    languageLabel: "Language",
    topNote: "Your thoughts, made clear",
    eyebrow: "THE CLARITY TOOL",
    headlineFirst: "Less text.",
    headlineSecond: "More meaning.",
    introFirst: "Drop in an article, a long email, or any wall of text.",
    introSecond: " Get the good bits, without the scroll.",
    workspace: "Text summariser",
    sourceLabel: "YOUR TEXT",
    placeholder: "Paste something worth understanding…",
    privacy: "Your text is only used to create this summary",
    submit: "Summarise",
    submitting: "Summarising…",
    resultEyebrow: "THE SHORT VERSION",
    resultTitle: "Your summary",
    clear: "Clear",
    loading: "Finding the signal in the noise…",
    connectionError: "Can't reach the app server. Make sure it is running with `npm start`, then try again.",
    footerFirst: "Made for the curious, and the short on time.",
    footerSecond: "ONE THING AT A TIME",
    themeToDark: "Switch to dark mode",
    themeToLight: "Switch to light mode"
  },
  fa: {
    title: "Briefly — خلاصه‌ساز متن",
    homeLabel: "صفحه‌ی اصلی Briefly",
    languageLabel: "زبان",
    topNote: "متن‌های شما، شفاف و خلاصه",
    eyebrow: "ابزار شفافیت",
    headlineFirst: "متن کمتر.",
    headlineSecond: "معنای بیشتر.",
    introFirst: "مقاله، ایمیل طولانی یا هر متن بلندی را وارد کنید.",
    introSecond: " نکته‌های مهم را بدون خواندن همه‌ی متن پیدا کنید.",
    workspace: "خلاصه‌ساز متن",
    sourceLabel: "متن شما",
    placeholder: "متنی را که می‌خواهید خلاصه شود وارد کنید…",
    privacy: "متن شما فقط برای ساخت این خلاصه استفاده می‌شود",
    submit: "خلاصه کن",
    submitting: "در حال خلاصه‌سازی…",
    resultEyebrow: "خلاصه‌ی کوتاه",
    resultTitle: "خلاصه‌ی شما",
    clear: "پاک کردن",
    loading: "در حال پیدا کردن نکته‌های اصلی…",
    connectionError: "ارتباط با سرور برنامه برقرار نشد. مطمئن شوید برنامه با دستور `npm start` اجرا شده است و دوباره تلاش کنید.",
    footerFirst: "برای کنجکاوان و کسانی که وقت کمی دارند.",
    footerSecond: "هر بار، یک کار",
    themeToDark: "تغییر به حالت تیره",
    themeToLight: "تغییر به حالت روشن"
  }
};

function applyTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeColor.setAttribute("content", dark ? "#141713" : "#f5f4f0");
  const copy = translations[currentLanguage];
  themeToggle.setAttribute("aria-pressed", String(dark));
  themeToggle.setAttribute("aria-label", dark ? copy.themeToLight : copy.themeToDark);
}

function setTheme(theme) {
  applyTheme(theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {}
}

themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

function setLanguage(language) {
  if (language !== "en" && language !== "fa") return;
  if (currentLanguage !== language) clearResult();
  currentLanguage = language;
  const copy = translations[language];
  const isPersian = language === "fa";
  document.documentElement.lang = language;
  document.documentElement.dir = isPersian ? "rtl" : "ltr";
  document.title = copy.title;
  document.querySelector("#wordmark").setAttribute("aria-label", copy.homeLabel);
  document.querySelector("#language-switch").setAttribute("aria-label", copy.languageLabel);
  document.querySelector("#top-note-text").textContent = copy.topNote;
  document.querySelector("#intro-eyebrow").textContent = copy.eyebrow;
  document.querySelector("#headline-first").textContent = copy.headlineFirst;
  document.querySelector("#headline-second").textContent = copy.headlineSecond;
  document.querySelector("#intro-copy-first").textContent = copy.introFirst;
  document.querySelector("#intro-copy-second").textContent = copy.introSecond;
  document.querySelector("#workspace").setAttribute("aria-label", copy.workspace);
  document.querySelector("#source-label").textContent = copy.sourceLabel;
  input.placeholder = copy.placeholder;
  document.querySelector("#privacy-text").textContent = copy.privacy;
  document.querySelector("#submit-label").textContent = submitButton.disabled ? copy.submitting : copy.submit;
  document.querySelector("#result-eyebrow").textContent = copy.resultEyebrow;
  document.querySelector("#result-title").textContent = copy.resultTitle;
  document.querySelector("#clear-label").textContent = copy.clear;
  document.querySelector("#loading-text").textContent = copy.loading;
  document.querySelector("#footer-first").textContent = copy.footerFirst;
  document.querySelector("#footer-second").textContent = copy.footerSecond;
  count.textContent = `${input.value.length.toLocaleString(language)} / ${(20_000).toLocaleString(language)}`;
  applyTheme(document.documentElement.dataset.theme);
  languageButtons.forEach((button) => {
    const selected = button.dataset.language === language;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

input.addEventListener("input", () => {
  count.textContent = `${input.value.length.toLocaleString(currentLanguage)} / ${(20_000).toLocaleString(currentLanguage)}`;
});

function setLoading(loading) {
  submitButton.disabled = loading;
  document.querySelector("#submit-label").textContent = loading
    ? translations[currentLanguage].submitting
    : translations[currentLanguage].submit;
  loadingIndicator.hidden = !loading;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearResult() {
  activeController?.abort();
  activeController = undefined;
  resultText.textContent = "";
  errorMessage.textContent = "";
  errorMessage.hidden = true;
  resultCard.hidden = true;
  setLoading(false);
}

clearButton.addEventListener("click", clearResult);
languageButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }

  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  resultText.textContent = "";
  errorMessage.textContent = "";
  errorMessage.hidden = true;
  resultCard.hidden = false;
  setLoading(true);

  try {
    const response = await fetch("/api/summarise", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, language: currentLanguage }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${response.status}).`);
    }
    if (!response.body) throw new Error("The server did not provide a summary stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    while (!finished) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const lines = event.split("\n");
        const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const dataLine = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (!dataLine) continue;

        const data = JSON.parse(dataLine);
        if (eventName === "delta") resultText.textContent += data.text;
        if (eventName === "error") throw new Error(data.error);
        if (eventName === "done") finished = true;
      }
      if (done) break;
    }
    if (!resultText.textContent && !controller.signal.aborted) {
      throw new Error("The summarisation service returned an empty summary.");
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      const message = error instanceof TypeError
        ? translations[currentLanguage].connectionError
        : error.message || "Something went wrong. Please try again.";
      showError(message);
    }
  } finally {
    if (activeController === controller) {
      activeController = undefined;
      setLoading(false);
    }
  }
});

setLanguage(currentLanguage);
