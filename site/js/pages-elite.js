/**
 * Shared elite helpers for static pages (toast, a11y shell).
 */
(function (global) {
  "use strict";

  function ensureStack() {
    let el = document.getElementById("pg-toast-stack");
    if (!el) {
      el = document.createElement("div");
      el.id = "pg-toast-stack";
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    return el;
  }

  function announce(msg) {
    let a = document.getElementById("pg-announcer");
    if (!a) {
      a = document.createElement("div");
      a.id = "pg-announcer";
      a.setAttribute("role", "status");
      a.setAttribute("aria-live", "polite");
      a.setAttribute("aria-atomic", "true");
      a.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;";
      document.body.appendChild(a);
    }
    a.textContent = "";
    requestAnimationFrame(function () {
      a.textContent = msg;
    });
  }

  const PageElite = {
    init: function () {
      document.documentElement.classList.add("pg-elite");
    },

    toast: function (message, kind, ms) {
      const text = String(message || "").trim();
      if (!text) return;
      const stack = ensureStack();
      const div = document.createElement("div");
      div.className = "pg-toast" + (kind ? " pg-toast-" + kind : "");
      div.textContent = text;
      stack.appendChild(div);
      const ttl = ms != null ? ms : kind === "bad" ? 4200 : 3200;
      setTimeout(function () {
        div.style.opacity = "0";
        div.style.transform = "translateY(8px)";
        div.style.transition = "opacity .28s ease, transform .28s ease";
        setTimeout(function () {
          div.remove();
        }, 300);
      }, ttl);
    },

    announce: announce,
  };

  global.PageElite = PageElite;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      PageElite.init();
    });
  } else {
    PageElite.init();
  }
})(typeof window !== "undefined" ? window : globalThis);
