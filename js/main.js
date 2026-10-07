// Shared nav/theme behavior across pages
(function () {
  const root = document.documentElement;
  const KEY = "vitallens-theme";

  function applyTheme(t) {
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
  }
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked (privacy mode, sandboxed frame) */ }
  if (saved) applyTheme(saved);

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.querySelector("[data-theme-toggle]");
    if (btn) {
      btn.addEventListener("click", () => {
        const current = root.getAttribute("data-theme");
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const effectiveCurrent = current || (prefersDark ? "dark" : "light");
        const next = effectiveCurrent === "dark" ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem(KEY, next); } catch (e) { /* not persisted */ }
        btn.textContent = next === "dark" ? "☀" : "🌙";
      });
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const effective = root.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
      btn.textContent = effective === "dark" ? "☀" : "🌙";
    }

    const navToggle = document.querySelector("[data-nav-toggle]");
    const navLinks = document.querySelector(".nav-links");
    if (navToggle && navLinks) {
      const setOpen = (open) => {
        navLinks.classList.toggle("open", open);
        navToggle.setAttribute("aria-expanded", String(open));
        navToggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
      };
      navToggle.addEventListener("click", () => {
        const open = !navLinks.classList.contains("open");
        setOpen(open);
        if (open) { const first = navLinks.querySelector("a"); if (first) first.focus(); }
      });
      navLinks.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && navLinks.classList.contains("open")) { setOpen(false); navToggle.focus(); } });
    }

    // mark current nav link
    const path = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav-links a[href]").forEach((a) => {
      if (a.getAttribute("href") === path) a.setAttribute("aria-current", "page");
    });

    // simple reveal-on-scroll (content is visible without it; this only adds the animation)
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("fade-in"); io.unobserve(e.target); } });
      }, { threshold: 0.12 });
      document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    }
  });
})();
