/**
 * Hit-A-Lick Elite UI layer — command palette, toasts, shortcuts, a11y hooks.
 * Requires HitElite.init(api) after app bootstrap (see app.html).
 */
(function (global) {
  "use strict";

  const HitElite = {
    _api: null,
    _paletteMounted: false,
    _paletteOpen: false,
    _filter: "",
    _activeIndex: 0,
    _commands: [],
    _bound: false,
    _lastRefreshLabel: "",

    init(api) {
      if (!api || typeof api !== "object") return;
      this._api = api;
      global.openCommandPalette = () => this.openPalette();
      global.closeCommandPalette = () => this.closePalette();
      global.eliteToast = (msg, kind, ms) => this.toast(msg, kind, ms);
      this._ensureDom();
      this._applyShellClasses();
      this._bindKeyboard();
      this._hookTabObserver();
      this._hookStatus();
      document.documentElement.classList.add("elite-ui-ready");
      this.announce("Elite interface ready. Press Command K for command menu.");
    },

    _applyShellClasses() {
      const q = (sel) => document.querySelector(sel);
      q(".app-layout")?.classList.add("elite-shell-enhanced");
      q(".side-rail")?.classList.add("elite-rail-v2", "elite-rail");
      q(".rail-head")?.classList.add("elite-rail-head");
      q(".top")?.classList.add("elite-top-bar");
      q(".brand")?.classList.add("elite-brand");
      q(".hero")?.classList.add("elite-hero-v2");
      q(".toolbar")?.classList.add("elite-toolbar", "elite-toolbar-sticky");
      q(".tabs")?.classList.add("elite-tabs");
      document.querySelectorAll(".tab-btn").forEach((el) => el.classList.add("elite-tab"));
      q(".bottom-nav")?.classList.add("elite-bottom-nav", "elite-bottom-nav");
      q(".bottom-tab")?.classList.add("elite-bottom-tab");
      q(".quick-actions")?.classList.add("elite-quick-actions");
      q("#searchInput")?.classList.add("elite-search-glow");
      document.querySelectorAll(".pill-stat").forEach((el) => el.classList.add("elite-pill"));
      document.querySelectorAll(".rail-link").forEach((el) => {
        if (el.tagName === "BUTTON" || el.tagName === "A") el.classList.add("elite-rail-link");
      });
    },

    _ensureDom() {
      if (!document.getElementById("elite-announcer")) {
        const ann = document.createElement("div");
        ann.id = "elite-announcer";
        ann.setAttribute("role", "status");
        ann.setAttribute("aria-live", "polite");
        ann.setAttribute("aria-atomic", "true");
        document.body.appendChild(ann);
      }

      if (!document.getElementById("elite-toast-stack")) {
        const stack = document.createElement("div");
        stack.id = "elite-toast-stack";
        document.body.appendChild(stack);
      }

      if (document.getElementById("elite-command-root")) {
        this._paletteMounted = true;
        return;
      }

      const root = document.createElement("div");
      root.id = "elite-command-root";
      root.setAttribute("role", "presentation");
      root.innerHTML = `
        <div class="elite-command-dialog" role="dialog" aria-modal="true" aria-labelledby="elite-cmd-title" id="elite-command-dialog">
          <div class="elite-command-head">
            <label id="elite-cmd-title">Command</label>
            <input type="text" class="elite-command-input elite-focus-ring" id="elite-command-input" placeholder="Jump to tab, refresh, search…" autocomplete="off" autocorrect="off" spellcheck="false" />
          </div>
          <div class="elite-command-list" id="elite-command-list" role="listbox"></div>
          <div class="elite-command-footer">
            <span class="kbd">↑</span><span class="kbd">↓</span> navigate · <span class="kbd">Enter</span> run · <span class="kbd">Esc</span> close
          </div>
        </div>
      `;
      document.body.appendChild(root);

      root.addEventListener("click", (e) => {
        if (e.target === root) this.closePalette();
      });

      const input = document.getElementById("elite-command-input");
      input.addEventListener("input", () => {
        this._filter = String(input.value || "").toLowerCase().trim();
        this._renderCommandList();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this._moveActive(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this._moveActive(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          this._runActive();
        }
      });

      this._paletteMounted = true;
    },

    _buildCommands() {
      const api = this._api;
      const tab = (id, label, hint) => ({
        id: "tab-" + id,
        label,
        hint: hint || "",
        run: () => {
          if (typeof api.setActiveTab === "function") api.setActiveTab(id);
        },
      });
      return [
        tab("home", "Home — signals & studio", "Board overview"),
        tab("dash", "Elite Desk — live legs", "Prop matrix"),
        tab("players", "Players — trends & props", "Stat charts"),
        tab("games", "Games — matchups", "Per-game legs"),
        tab("props", "Prop — all legs", "Search & toolbar filters"),
        tab("ai", "AI — copilot & plays", "Snapshots"),
        tab("posts", "Bruce & Giap — feed", "Curator"),
        tab("premium", "Premium — picks hub", ""),
        tab("alerts", "Alerts — steam / edge", ""),
        tab("account", "Account — session & billing", ""),
        tab("integrity", "Integrity — roster lock", ""),
        {
          id: "refresh",
          label: "Refresh all data feeds",
          hint: "Props, games, players",
          run: () => {
            if (typeof api.refreshAll === "function") void api.refreshAll();
          },
        },
        {
          id: "search-focus",
          label: "Focus search",
          hint: "Toolbar",
          run: () => {
            const el = document.getElementById("searchInput");
            if (el) {
              el.focus();
              el.select?.();
            }
          },
        },
        {
          id: "desk-jump",
          label: "Open Elite Desk (toolbar)",
          hint: "",
          run: () => {
            const b = document.getElementById("hlDeskJump");
            b?.click();
          },
        },
        {
          id: "theme-dark",
          label: "Theme: Dark",
          hint: "",
          run: () => {
            const s = document.getElementById("themeSelect");
            if (s) {
              s.value = "dark";
              s.dispatchEvent(new Event("change"));
            }
          },
        },
        {
          id: "theme-light",
          label: "Theme: Light",
          hint: "",
          run: () => {
            const s = document.getElementById("themeSelect");
            if (s) {
              s.value = "light";
              s.dispatchEvent(new Event("change"));
            }
          },
        },
        {
          id: "open-pricing",
          label: "Open membership pricing",
          hint: "New tab",
          run: () => {
            global.open("/pricing.html", "_blank", "noopener,noreferrer");
          },
        },
        {
          id: "open-account",
          label: "Open account page",
          hint: "New tab",
          run: () => {
            global.open("/account.html", "_blank", "noopener,noreferrer");
          },
        },
      ].concat(this._extraCommands());
    },

    _extraCommands() {
      const sport = (val, label) => ({
        id: "sport-" + val,
        label: "Sport: " + label,
        hint: "Toolbar league",
        run: () => {
          const s = document.getElementById("sportSelect");
          if (s) {
            s.value = val;
            s.dispatchEvent(new Event("change"));
          }
        },
      });
      return [
        sport("all", "All 4 leagues"),
        sport("nba", "NBA"),
        sport("nfl", "NFL"),
        sport("mlb", "MLB"),
        sport("wnba", "WNBA"),
        {
          id: "filters-toggle",
          label: "Toggle advanced filters",
          hint: "Spread, venue, books…",
          run: () => HitElite.toggleAdvancedFilters(),
        },
        {
          id: "scroll-top",
          label: "Scroll workspace to top",
          hint: "",
          run: () => HitElite.scrollMainToTop(),
        },
        {
          id: "copy-status",
          label: "Copy last status line",
          hint: "Clipboard",
          run: async () => {
            const st = document.getElementById("globalStatus");
            const t = (st?.textContent || "").trim();
            if (!t) {
              HitElite.toast("No status text yet.", "warn", 2400);
              return;
            }
            try {
              await navigator.clipboard.writeText(t);
              HitElite.toast("Status copied.", "ok", 2200);
            } catch {
              HitElite.toast("Clipboard unavailable.", "bad", 2600);
            }
          },
        },
        {
          id: "help-keys",
          label: "Show shortcut reminder (toast)",
          hint: "⌘K · 1–9 tabs · / search",
          run: () => {
            HitElite.toast("⌘K menu · keys 1–9 tabs · / search · Esc closes", "ok", 5000);
          },
        },
      ];
    },

    openPalette() {
      this._ensureDom();
      this._commands = this._buildCommands();
      this._filter = "";
      this._activeIndex = 0;
      const root = document.getElementById("elite-command-root");
      const input = document.getElementById("elite-command-input");
      if (!root || !input) return;
      root.classList.add("elite-open");
      this._paletteOpen = true;
      input.value = "";
      this._renderCommandList();
      setTimeout(() => {
        input.focus();
      }, 30);
      document.body.style.overflow = "hidden";
      this.announce("Command menu opened.");
    },

    closePalette() {
      const root = document.getElementById("elite-command-root");
      if (!root) return;
      root.classList.remove("elite-open");
      this._paletteOpen = false;
      document.body.style.overflow = "";
      this.announce("Command menu closed.");
    },

    _visibleCommands() {
      const f = this._filter;
      if (!f) return this._commands.slice();
      return this._commands.filter((c) => {
        const hay = (c.label + " " + (c.hint || "") + " " + c.id).toLowerCase();
        return hay.includes(f);
      });
    },

    _renderCommandList() {
      const list = document.getElementById("elite-command-list");
      if (!list) return;
      const vis = this._visibleCommands();
      if (this._activeIndex >= vis.length) this._activeIndex = Math.max(0, vis.length - 1);
      list.innerHTML = vis
        .map((c, i) => {
          const active = i === this._activeIndex ? " elite-cmd-active" : "";
          const hint = c.hint ? `<small>${escapeHtml(c.hint)}</small>` : "";
          return `<button type="button" class="elite-command-item${active}" role="option" data-idx="${i}" aria-selected="${i === this._activeIndex}">
            <span class="elite-cmd-meta"><span>${escapeHtml(c.label)}</span>${hint}</span>
            <span class="kbd">↵</span>
          </button>`;
        })
        .join("");
      list.querySelectorAll("button[data-idx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-idx"));
          const v = this._visibleCommands();
          const cmd = v[idx];
          if (cmd) {
            this.closePalette();
            try {
              cmd.run();
            } catch (e) {
              console.warn("Elite command failed", e);
            }
            this.toast(cmd.label, "ok", 2200);
          }
        });
      });
    },

    _moveActive(delta) {
      const vis = this._visibleCommands();
      if (!vis.length) return;
      this._activeIndex = (this._activeIndex + delta + vis.length) % vis.length;
      this._renderCommandList();
    },

    _runActive() {
      const vis = this._visibleCommands();
      const cmd = vis[this._activeIndex];
      if (!cmd) return;
      this.closePalette();
      try {
        cmd.run();
      } catch (e) {
        console.warn("Elite command failed", e);
      }
      this.toast(cmd.label, "ok", 2200);
    },

    _bindKeyboard() {
      if (this._bound) return;
      this._bound = true;
      document.addEventListener(
        "keydown",
        (e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.key.toLowerCase() === "k") {
            e.preventDefault();
            if (this._paletteOpen) this.closePalette();
            else this.openPalette();
            return;
          }
          if (this._paletteOpen && e.key === "Escape") {
            e.preventDefault();
            this.closePalette();
            return;
          }
          if (this._paletteOpen) return;
          if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) {
            if (e.key === "/" && !mod) {
              const sid = document.getElementById("searchInput");
              if (sid && e.target !== sid) {
                e.preventDefault();
                sid.focus();
              }
            }
            return;
          }
          if (e.key === "/" && !mod) {
            const sid = document.getElementById("searchInput");
            if (sid) {
              e.preventDefault();
              sid.focus();
            }
          }
        },
        true,
      );
    },

    _hookTabObserver() {
      const panels = document.querySelectorAll(".panel");
      if (!panels.length) return;
      const observer = new MutationObserver(() => {
        document.querySelectorAll(".panel.active").forEach((p) => {
          p.classList.add("elite-panel-active");
        });
      });
      panels.forEach((p) => {
        observer.observe(p, { attributes: true, attributeFilter: ["class"] });
      });
    },

    _hookStatus() {
      const el = document.getElementById("globalStatus");
      if (!el) return;
      const obs = new MutationObserver(() => {
        const t = (el.textContent || "").trim();
        if (t && t !== this._lastRefreshLabel) {
          this._lastRefreshLabel = t;
          if (/Loaded \d+ players/i.test(t)) {
            this.toast("Data refreshed", "ok", 2800);
          }
        }
      });
      obs.observe(el, { childList: true, characterData: true, subtree: true });
    },

    toast(message, kind = "default", duration = 3200) {
      this._ensureDom();
      const stack = document.getElementById("elite-toast-stack");
      if (!stack || !message) return;
      const t = document.createElement("div");
      t.className = "elite-toast";
      if (kind === "warn") t.classList.add("elite-toast-warn");
      if (kind === "bad" || kind === "error") t.classList.add("elite-toast-bad");
      if (kind === "ok" || kind === "success") t.classList.add("elite-toast-ok");
      t.textContent = message;
      stack.appendChild(t);
      const rm = () => {
        t.style.opacity = "0";
        t.style.transform = "translateX(8px)";
        setTimeout(() => t.remove(), 280);
      };
      setTimeout(rm, duration);
    },

    announce(msg) {
      const el = document.getElementById("elite-announcer");
      if (!el) return;
      el.textContent = "";
      setTimeout(() => {
        el.textContent = msg;
      }, 20);
    },
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** @type {Record<string, string>} */
  const TAB_DIGIT_MAP = {
    "1": "home",
    "2": "dash",
    "3": "players",
    "4": "games",
    "5": "props",
    "6": "ai",
    "7": "posts",
    "8": "premium",
    "9": "alerts",
    "0": "account",
  };

  HitElite._bindDigitTabs = function () {
    document.addEventListener(
      "keydown",
      (e) => {
        if (HitElite._paletteOpen) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
        const tab = TAB_DIGIT_MAP[e.key];
        if (!tab) return;
        if (typeof HitElite._api?.setActiveTab === "function") {
          e.preventDefault();
          HitElite._api.setActiveTab(tab);
          HitElite.announce(`Tab ${e.key}: ${tab}`);
        }
      },
      true,
    );
  };

  HitElite._bindDigitTabs();

  HitElite._applyReducedMotion = function () {
    try {
      if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.documentElement.classList.add("elite-reduced-motion");
      }
    } catch (_) {}
  };
  HitElite._applyReducedMotion();

  HitElite._bindVisibility = function () {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        HitElite.announce("App focused.");
      }
    });
  };
  HitElite._bindVisibility();

  /** Debounce helper for expensive UI work. */
  HitElite.debounce = function (fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  /** Throttle helper for scroll/resize. */
  HitElite.throttle = function (fn, ms) {
    let last = 0;
    let t;
    return function (...args) {
      const now = Date.now();
      const remaining = ms - (now - last);
      if (remaining <= 0) {
        last = now;
        fn.apply(this, args);
      } else {
        clearTimeout(t);
        t = setTimeout(() => {
          last = Date.now();
          fn.apply(this, args);
        }, remaining);
      }
    };
  };

  HitElite.scrollMainToTop = function () {
    const col = document.querySelector(".app-main-col");
    if (col) col.scrollTo({ top: 0, behavior: "smooth" });
    else global.scrollTo({ top: 0, behavior: "smooth" });
  };

  HitElite.toggleAdvancedFilters = function () {
    const btn = document.getElementById("hlFilterToggle");
    const adv = document.getElementById("hlToolbarAdvanced");
    if (btn && adv) {
      adv.hidden = !adv.hidden;
      btn.setAttribute("aria-expanded", adv.hidden ? "false" : "true");
      btn.textContent = adv.hidden ? "All filters ▾" : "All filters ▴";
    }
  };

  /** Optional: mark performance milestones for debugging. */
  HitElite.mark = function (name) {
    try {
      if (global.performance && performance.mark) performance.mark("elite:" + name);
    } catch (_) {}
  };

  HitElite.mark("script-loaded");

  global.HitElite = HitElite;
})(typeof window !== "undefined" ? window : globalThis);
