import { PagePreview } from "../src/page-preview.js";

const sandbox = document.getElementById("sandbox");
const out = document.getElementById("out");
const results = [];
const pageErrors = [];

window.addEventListener("error", event => {
  pageErrors.push(String(event.message));
});
window.addEventListener("unhandledrejection", event => {
  pageErrors.push(String(event.reason && event.reason.stack || event.reason));
});

function check(group, name, ok, details) {
  results.push({
    group,
    name,
    ok: Boolean(ok),
    details: details == null ? "" : String(details)
  });
}

function abs(path) {
  return new URL(path, window.location.href).href;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function until(el, timeout = 5000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const status = el.getAttribute("data-status");
    if (status === "ready" || status === "error") return status;
    await delay(20);
  }
  return el.getAttribute("data-status");
}

function parts(el) {
  const root = el.shadowRoot;
  return {
    link: root.querySelector('a[part="link"]'),
    title: root.querySelector('[part="title"]'),
    heading: root.querySelector('[part="heading"]'),
    message: root.querySelector('[part="message"]')
  };
}

function isVisible(el) {
  const style = getComputedStyle(el);
  return style.display !== "none"
    && style.visibility !== "hidden"
    && style.opacity !== "0"
    && el.getClientRects().length > 0;
}

async function oracle(url) {
  const response = await fetch(url, { cache: "no-store" });
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const heading = doc.querySelector("h1");
  return {
    ok: response.ok,
    title: doc.title.trim(),
    heading: heading ? heading.textContent.trim() : ""
  };
}

function mount(src) {
  const el = document.createElement("page-preview");
  if (src !== undefined) el.setAttribute("src", src);
  sandbox.append(el);
  return el;
}

async function testRegistration() {
  const group = "Импорт и регистрация page-preview";
  check(group, "класс экспортирован и зарегистрирован", customElements.get("page-preview") === PagePreview);
  const again = await import("../src/page-preview.js");
  check(group, "повторный импорт не ломает регистрацию", again.PagePreview === PagePreview && customElements.get("page-preview") === PagePreview);
}

function testClassAndShadow() {
  const group = "Класс, открытый Shadow DOM, клонирование template";
  const first = mount();
  const second = mount();
  check(group, "экземпляр наследует HTMLElement", first instanceof HTMLElement && Object.getPrototypeOf(PagePreview) === HTMLElement);
  check(group, "есть connectedCallback", typeof first.connectedCallback === "function");
  check(group, "есть disconnectedCallback", typeof first.disconnectedCallback === "function");
  check(group, "есть attributeChangedCallback", typeof first.attributeChangedCallback === "function");
  check(group, "наблюдается src", Array.isArray(PagePreview.observedAttributes) && PagePreview.observedAttributes.includes("src"));
  check(group, "есть метод загрузки и поля состояния", typeof first.load === "function" && "controller" in first && "requestId" in first && "linkEl" in first);
  check(group, "shadow root открыт", first.shadowRoot !== null && first.shadowRoot.mode === "open" && second.shadowRoot.mode === "open");
  const firstTitle = first.shadowRoot.querySelector('[part="title"]');
  const secondTitle = second.shadowRoot.querySelector('[part="title"]');
  check(group, "у каждого экземпляра своя копия шаблона", firstTitle && secondTitle && firstTitle !== secondTitle && first.shadowRoot.querySelectorAll('[part="link"]').length === 1);
  check(group, "ссылка внутри шаблона является элементом a", first.shadowRoot.querySelector('[part="link"]') instanceof HTMLAnchorElement);
  first.remove();
  second.remove();
}

async function testSuccess() {
  const group = "Ссылка, название, первый h1, относительный URL";
  const relative = "../demo/example.html";
  const el = mount(relative);
  check(group, "до ответа установлен loading", el.getAttribute("data-status") === "loading", el.getAttribute("data-status"));
  const status = await until(el);
  const view = parts(el);
  const expectedUrl = abs(relative);
  const expected = await oracle(expectedUrl);
  check(group, "успешная страница получает ready", status === "ready", status);
  check(group, "название равно document.title.trim()", view.title.textContent === expected.title, `${view.title.textContent} != ${expected.title}`);
  check(group, "заголовок равен textContent первого h1", view.heading.textContent === "Первый заголовок" && view.heading.textContent === expected.heading, view.heading.textContent);
  check(group, "href ссылки равен разрешённому относительному URL", view.link.href === expectedUrl, view.link.href);
  check(group, "текст ссылки видим и содержит название", isVisible(view.link) && view.link.textContent.includes(expected.title), view.link.textContent);
  check(group, "название и заголовок видимы", isVisible(view.title) && isVisible(view.heading));

  const rooted = mount("/demo/example.html");
  await until(rooted);
  check(group, "корневой относительный URL разрешён от адреса страницы", parts(rooted).link.href === abs("/demo/example.html"), parts(rooted).link.href);

  const hashed = mount("/demo/example.html?x=1#top");
  await until(hashed);
  check(group, "query и hash сохраняются в href", parts(hashed).link.href === abs("/demo/example.html?x=1#top"), parts(hashed).link.href);
  check(group, "страница с query показывает своё название", parts(hashed).title.textContent === "Пробная страница");

  const multi = mount(abs("./fixtures/multi.html"));
  await until(multi);
  check(group, "из нескольких h1 берётся первый", parts(multi).heading.textContent === "Первый из двух", parts(multi).heading.textContent);

  const nested = mount(abs("./fixtures/nested.html"));
  await until(nested);
  const nestedExpected = await oracle(abs("./fixtures/nested.html"));
  check(group, "текст вложенных узлов h1 собирается через textContent", parts(nested).heading.textContent === "Hello world" && parts(nested).heading.textContent === nestedExpected.heading, parts(nested).heading.textContent);

  const spaces = mount(abs("./fixtures/spaces.html"));
  await until(spaces);
  const spacesExpected = await oracle(abs("./fixtures/spaces.html"));
  check(group, "внутренние пробелы заголовка сохранены", parts(spaces).heading.textContent === "A   B" && parts(spaces).heading.textContent === spacesExpected.heading, JSON.stringify(parts(spaces).heading.textContent));
  check(group, "название обрезано только по краям через document.title.trim()", parts(spaces).title.textContent === spacesExpected.title, JSON.stringify({ got: parts(spaces).title.textContent, expected: spacesExpected.title }));

  el.remove();
  rooted.remove();
  hashed.remove();
  multi.remove();
  nested.remove();
  spaces.remove();
}

async function testErrors() {
  const group = "Отсутствующие значения, состояния и ошибки";
  const noTitle = mount(abs("./fixtures/no-title.html"));
  const noTitleStatus = await until(noTitle);
  check(group, "без title статус ready", noTitleStatus === "ready", noTitleStatus);
  check(group, "пустое название заменяется фразой", parts(noTitle).title.textContent === "Название отсутствует", parts(noTitle).title.textContent);
  check(group, "ссылка без названия содержит URL и видима", isVisible(parts(noTitle).link) && parts(noTitle).link.textContent.includes(parts(noTitle).link.href), parts(noTitle).link.textContent);

  const noHeading = mount(abs("./fixtures/no-heading.html"));
  await until(noHeading);
  check(group, "без h1 пишется «Заголовок отсутствует»", parts(noHeading).heading.textContent === "Заголовок отсутствует", parts(noHeading).heading.textContent);
  check(group, "ссылка при живом названии содержит название", parts(noHeading).link.textContent.includes("Только название"), parts(noHeading).link.textContent);

  const empty = mount(abs("./fixtures/empty.html"));
  await until(empty);
  const emptyExpected = await oracle(abs("./fixtures/empty.html"));
  check(group, "пробельное название считается пустым", emptyExpected.title === "" && parts(empty).title.textContent === "Название отсутствует", JSON.stringify(emptyExpected.title));
  check(group, "пробельный h1 считается пустым", emptyExpected.heading === "" && parts(empty).heading.textContent === "Заголовок отсутствует", JSON.stringify({ oracle: emptyExpected.heading, got: parts(empty).heading.textContent }));

  const missingSrc = mount();
  check(group, "отсутствие src сразу даёт error", missingSrc.getAttribute("data-status") === "error", missingSrc.getAttribute("data-status"));
  check(group, "при отсутствии src есть текст ошибки", parts(missingSrc).message.textContent.length > 0, parts(missingSrc).message.textContent);

  const blank = mount("   ");
  check(group, "src из одних пробелов даёт error", blank.getAttribute("data-status") === "error");

  const bad = mount("http://[");
  check(group, "некорректный URL даёт error без исключения", bad.getAttribute("data-status") === "error", bad.getAttribute("data-status"));

  const missing = mount(abs("../demo/missing.html"));
  check(group, "перед ответом 404 статус loading", missing.getAttribute("data-status") === "loading");
  const missingStatus = await until(missing);
  check(group, "HTTP 404 даёт error", missingStatus === "error", missingStatus);
  check(group, "при HTTP-ошибке видно сообщение", isVisible(parts(missing).message) && parts(missing).message.textContent.length > 0, parts(missing).message.textContent);

  const network = mount("http://127.0.0.1:1/no-such-page");
  const networkStatus = await until(network, 6000);
  check(group, "сетевая ошибка даёт error", networkStatus === "error", networkStatus);

  noTitle.remove();
  noHeading.remove();
  empty.remove();
  missingSrc.remove();
  blank.remove();
  bad.remove();
  missing.remove();
  network.remove();
}

async function testRaces() {
  const group = "Смена src и защита от устаревшего ответа";
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("race-slow")) {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve(new Response("<!doctype html><title>OLD</title><h1>OLD</h1>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" }
          }));
        }, 350);
      });
    }
    if (url.includes("race-fast")) {
      return Promise.resolve(new Response("<!doctype html><title>NEW</title><h1>NEW</h1>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      }));
    }
    return realFetch(input, init);
  };

  try {
    const el = mount(abs("./fixtures/race-slow.html"));
    check(group, "смена src синхронно ставит loading", el.getAttribute("data-status") === "loading");
    el.setAttribute("src", abs("./fixtures/race-fast.html"));
    check(group, "новый src тоже переводит карточку в loading", el.getAttribute("data-status") === "loading");
    const status = await until(el);
    check(group, "после быстрой смены виден новый документ", status === "ready" && parts(el).title.textContent === "NEW" && parts(el).heading.textContent === "NEW", `${status} ${parts(el).title.textContent}`);
    await delay(500);
    check(group, "поздний старый ответ не перезаписывает новый", parts(el).title.textContent === "NEW" && parts(el).heading.textContent === "NEW" && el.getAttribute("data-status") === "ready", parts(el).title.textContent);

    window.fetch = realFetch;
    const live = mount(abs("../demo/example.html"));
    await until(live);
    live.setAttribute("src", abs("./fixtures/no-heading.html"));
    check(group, "реальная смена src сразу ставит loading", live.getAttribute("data-status") === "loading");
    await until(live);
    check(group, "реальная смена src меняет название и заголовок", parts(live).title.textContent === "Только название" && parts(live).heading.textContent === "Заголовок отсутствует", `${parts(live).title.textContent} / ${parts(live).heading.textContent}`);
    const urls = [
      abs("../demo/example.html"),
      abs("./fixtures/multi.html"),
      abs("./fixtures/entities.html"),
      abs("./fixtures/no-title.html"),
      abs("../demo/example.html")
    ];
    for (const url of urls) live.setAttribute("src", url);
    await until(live);
    await delay(400);
    check(group, "после серии переключений остаётся последний src", parts(live).title.textContent === "Пробная страница" && parts(live).heading.textContent === "Первый заголовок" && parts(live).link.href === urls[urls.length - 1], `${parts(live).title.textContent} ${parts(live).link.href}`);
    el.remove();
    live.remove();
  } finally {
    window.fetch = realFetch;
  }
}

async function testInstances() {
  const group = "Независимые экземпляры, удаление и повторное подключение";
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("race-slow")) {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve(new Response("<!doctype html><title>OLD</title><h1>OLD</h1>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" }
          }));
        }, 350);
      });
    }
    return realFetch(input, init);
  };

  try {
    const slow = mount(abs("./fixtures/race-slow.html"));
    const other = mount(abs("../demo/example.html"));
    await until(other);
    check(group, "вторая карточка готова, пока первая ещё грузится", other.getAttribute("data-status") === "ready" && slow.getAttribute("data-status") === "loading" && parts(other).title.textContent === "Пробная страница", `${slow.getAttribute("data-status")} / ${other.getAttribute("data-status")}`);
    other.setAttribute("src", abs("./fixtures/entities.html"));
    await until(other);
    await until(slow);
    check(group, "карточки не делят результат", parts(slow).title.textContent === "OLD" && parts(other).title.textContent === "Fish & Chips", `${parts(slow).title.textContent} / ${parts(other).title.textContent}`);

    const removable = mount(abs("./fixtures/race-slow.html"));
    check(group, "съём начинается из loading", removable.getAttribute("data-status") === "loading");
    removable.remove();
    await delay(500);
    check(group, "ответ не обновляет снятый элемент", removable.getAttribute("data-status") !== "ready" && parts(removable).title.textContent !== "OLD", `${removable.getAttribute("data-status")} ${parts(removable).title.textContent}`);
    sandbox.append(removable);
    const restored = await until(removable);
    check(group, "после повторного подключения карточка снова работает", restored === "ready" && parts(removable).title.textContent === "OLD" && parts(removable).heading.textContent === "OLD", `${restored} ${parts(removable).title.textContent}`);

    slow.remove();
    other.remove();
    removable.remove();
  } finally {
    window.fetch = realFetch;
  }
}

async function testSafeText() {
  const group = "Безопасный текстовый вывод";
  const el = mount(abs("./fixtures/xss.html"));
  await until(el);
  const view = parts(el);
  const payload = "<img src=x onerror=alert(1)>";
  check(group, "опасное название остаётся текстом", view.title.textContent === payload, view.title.textContent);
  check(group, "опасный заголовок остаётся текстом", view.heading.textContent === payload, view.heading.textContent);
  check(group, "в shadow нет созданного img", el.shadowRoot.querySelector("img") === null);
  check(group, "текст названия является текстовым узлом", view.title.childNodes.length === 1 && view.title.firstChild.nodeType === Node.TEXT_NODE);
  check(group, "ссылка тоже показывает строку, а не элемент", view.link.querySelector("img") === null && view.link.textContent === payload, view.link.textContent);

  const scripted = mount(abs("./fixtures/script-h1.html"));
  await until(scripted);
  const scriptExpected = await oracle(abs("./fixtures/script-h1.html"));
  check(group, "h1 читается через textContent, включая текст script", parts(scripted).heading.textContent === scriptExpected.heading, JSON.stringify({ got: parts(scripted).heading.textContent, expected: scriptExpected.heading }));
  el.remove();
  scripted.remove();
}

async function testDemoFrame() {
  const group = "Демо из методички";
  const frame = document.createElement("iframe");
  frame.src = abs("../demo/index.html");
  sandbox.append(frame);
  await new Promise(resolve => {
    frame.onload = resolve;
  });
  const doc = frame.contentDocument;
  const previews = [...doc.querySelectorAll("page-preview")];
  check(group, "на демо-странице два компонента", previews.length === 2, String(previews.length));
  const statuses = [];
  for (const preview of previews) statuses.push(await until(preview));
  const resources = frame.contentWindow.performance.getEntriesByType("resource");
  const exampleLoads = resources.filter(entry => entry.name.includes("/demo/example.html")).length;
  check(group, "пробная страница загружена один раз", exampleLoads === 1, String(exampleLoads));
  check(group, "первая демо-карточка показывает пробную страницу", statuses[0] === "ready" && parts(previews[0]).title.textContent === "Пробная страница" && parts(previews[0]).heading.textContent === "Первый заголовок", `${statuses[0]} ${parts(previews[0]).title.textContent} / ${parts(previews[0]).heading.textContent}`);
  check(group, "вторая демо-карточка получает error", statuses[1] === "error", statuses[1]);
  frame.remove();
}

async function main() {
  await testRegistration();
  testClassAndShadow();
  await testDemoFrame();
  await testSuccess();
  await testErrors();
  await testRaces();
  await testInstances();
  await testSafeText();
  check("Отсутствующие значения, состояния и ошибки", "необработанных исключений нет", pageErrors.length === 0, pageErrors.join("\n"));

  const failed = results.filter(item => !item.ok);
  const report = {
    passed: results.length - failed.length,
    failed: failed.length,
    total: results.length,
    errors: pageErrors,
    results
  };
  window.__labReport = report;
  out.textContent = results.map(item => `${item.ok ? "OK" : "FAIL"}  [${item.group}] ${item.name}${item.details ? " — " + item.details : ""}`).join("\n")
    + `\n\n${report.passed}/${report.total}`;
}

main().catch(error => {
  pageErrors.push(String(error && error.stack || error));
  out.textContent = pageErrors.join("\n");
  window.__labReport = { passed: 0, failed: 1, total: 1, errors: pageErrors, results };
});
