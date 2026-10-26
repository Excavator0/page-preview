const template = document.createElement("template");

const style = document.createElement("style");
style.textContent = `
:host {
  display: block;
  margin: 0 0 16px;
  color: #1b1b1b;
  font: 16px/1.45 "Segoe UI", Arial, sans-serif;
}
article {
  background: #fff;
  border: 1px solid #d0d0d0;
  border-radius: 10px;
  padding: 14px 16px;
  max-width: 42rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
a[part="link"] {
  display: inline;
  color: #0b57d0;
  font-size: 1.15rem;
  font-weight: 700;
  text-decoration: underline;
  overflow-wrap: anywhere;
}
p {
  margin: 8px 0 0;
}
[part="message"]:empty {
  display: none;
}
[part="message"] {
  color: #8d1d1d;
  font-weight: 600;
}
:host([data-status="loading"]) article {
  outline: 2px solid #f0c36a;
}
`;

const article = document.createElement("article");

const link = document.createElement("a");
link.setAttribute("part", "link");

const titleLine = document.createElement("p");
titleLine.append("Название: ");
const titleSlot = document.createElement("span");
titleSlot.setAttribute("part", "title");
titleLine.append(titleSlot);

const headingLine = document.createElement("p");
headingLine.append("Заголовок: ");
const headingSlot = document.createElement("span");
headingSlot.setAttribute("part", "heading");
headingLine.append(headingSlot);

const message = document.createElement("p");
message.setAttribute("part", "message");

article.append(link, titleLine, headingLine, message);
template.content.append(style, article);

const MISSING_TITLE = "Название отсутствует";
const MISSING_HEADING = "Заголовок отсутствует";

export class PagePreview extends HTMLElement {
  static observedAttributes = ["src"];

  controller = null;
  requestId = 0;
  pendingUrl = null;
  linkEl = null;
  titleEl = null;
  headingEl = null;
  messageEl = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.append(template.content.cloneNode(true));
    this.linkEl = shadow.querySelector('[part="link"]');
    this.titleEl = shadow.querySelector('[part="title"]');
    this.headingEl = shadow.querySelector('[part="heading"]');
    this.messageEl = shadow.querySelector('[part="message"]');
  }

  get src() {
    return this.getAttribute("src");
  }

  set src(value) {
    if (value == null) {
      this.removeAttribute("src");
    } else {
      this.setAttribute("src", value);
    }
  }

  connectedCallback() {
    this.load();
  }

  disconnectedCallback() {
    this.invalidate();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name !== "src" || oldValue === newValue || !this.isConnected) {
      return;
    }
    this.load();
  }

  invalidate() {
    this.requestId += 1;
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    this.pendingUrl = null;
  }

  resolveUrl(src) {
    return new URL(src, window.location.href).href;
  }

  isCurrent(generation, url) {
    if (!this.isConnected || generation !== this.requestId || this.pendingUrl !== url) {
      return false;
    }
    const raw = this.getAttribute("src");
    if (raw == null || raw.trim() === "") {
      return false;
    }
    try {
      return this.resolveUrl(raw) === url;
    } catch {
      return false;
    }
  }

  renderMissing(message) {
    if (!this.isConnected) {
      return;
    }
    this.linkEl.removeAttribute("href");
    this.linkEl.textContent = "";
    this.titleEl.textContent = MISSING_TITLE;
    this.headingEl.textContent = MISSING_HEADING;
    this.messageEl.textContent = message;
    this.setAttribute("data-status", "error");
  }

  renderError(url, message) {
    if (!this.isConnected) {
      return;
    }
    this.linkEl.href = url;
    this.linkEl.textContent = url;
    this.titleEl.textContent = MISSING_TITLE;
    this.headingEl.textContent = MISSING_HEADING;
    this.messageEl.textContent = message;
    this.setAttribute("data-status", "error");
  }

  renderReady(url, title, heading) {
    if (!this.isConnected) {
      return;
    }
    const titleText = title.trim();
    const headingText = heading.trim();
    this.titleEl.textContent = titleText || MISSING_TITLE;
    this.headingEl.textContent = headingText || MISSING_HEADING;
    this.linkEl.href = url;
    this.linkEl.textContent = titleText || url;
    this.messageEl.textContent = "";
    this.setAttribute("data-status", "ready");
  }

  async load() {
    let generation = this.requestId;
    let url = "";
    try {
      const raw = this.getAttribute("src");
      if (raw == null || raw.trim() === "") {
        this.invalidate();
        this.renderMissing("Адрес страницы не указан");
        return;
      }

      try {
        url = this.resolveUrl(raw);
      } catch {
        this.invalidate();
        this.renderMissing("Некорректный адрес страницы");
        return;
      }

      if (this.controller && this.pendingUrl === url) {
        return;
      }

      const previous = this.controller;
      const controller = new AbortController();
      this.controller = controller;
      this.pendingUrl = url;
      generation = ++this.requestId;
      if (previous) {
        previous.abort();
      }

      this.linkEl.href = url;
      this.linkEl.textContent = url;
      this.messageEl.textContent = "Загрузка…";
      this.setAttribute("data-status", "loading");

      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });
      if (!this.isCurrent(generation, url)) {
        return;
      }
      if (!response.ok) {
        this.renderError(url, "Не удалось загрузить страницу");
        return;
      }

      const html = await response.text();
      if (!this.isCurrent(generation, url)) {
        return;
      }

      const doc = new DOMParser().parseFromString(html, "text/html");
      const firstHeading = doc.querySelector("h1");
      const heading = firstHeading ? firstHeading.textContent : "";
      if (!this.isCurrent(generation, url)) {
        return;
      }
      this.renderReady(url, doc.title, heading);
    } catch (error) {
      if (!this.isCurrent(generation, url)) {
        return;
      }
      if (error && error.name === "AbortError") {
        return;
      }
      this.renderError(url || this.pendingUrl || "", "Не удалось загрузить страницу");
    }
  }
}

if (!customElements.get("page-preview")) {
  customElements.define("page-preview", PagePreview);
}
