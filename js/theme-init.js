// Applies a saved theme before first paint (loaded in <head>, render-blocking on purpose).
(function () {
  try {
    const t = localStorage.getItem("vitallens-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* storage blocked: follow the system theme */ }
})();
