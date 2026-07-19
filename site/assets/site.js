document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("is-ready");

  document.querySelectorAll("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
  const caseItems = Array.from(document.querySelectorAll(".case-item"));

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.getAttribute("data-filter") || "all";
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      caseItems.forEach((item) => {
        item.hidden = filter !== "all" && item.getAttribute("data-category") !== filter;
      });
    });
  });

  const locale = document.body.getAttribute("data-locale") || "en";
  const labels = locale === "zh-CN"
    ? { close: "关闭案例预览", previous: "上一个案例", next: "下一个案例", open: "放大查看" }
    : { close: "Close case preview", previous: "Previous case", next: "Next case", open: "Open full preview" };

  const lightbox = document.createElement("div");
  lightbox.className = "case-lightbox";
  lightbox.hidden = true;
  lightbox.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="${labels.close}" title="${labels.close}">×</button>
    <button class="lightbox-previous" type="button" aria-label="${labels.previous}" title="${labels.previous}">←</button>
    <figure><img alt="" /><figcaption><span></span><h3></h3><p></p></figcaption></figure>
    <button class="lightbox-next" type="button" aria-label="${labels.next}" title="${labels.next}">→</button>
  `;
  document.body.append(lightbox);

  const lightboxImage = lightbox.querySelector("img");
  const lightboxMeta = lightbox.querySelector("figcaption span");
  const lightboxTitle = lightbox.querySelector("figcaption h3");
  const lightboxDescription = lightbox.querySelector("figcaption p");
  let activeIndex = 0;
  let lastTrigger;

  const visibleCases = () => caseItems.filter((item) => !item.hidden);
  const renderCase = (index) => {
    const items = visibleCases();
    if (!items.length) return;
    activeIndex = (index + items.length) % items.length;
    const item = items[activeIndex];
    const image = item.querySelector("img");
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt;
    lightboxMeta.textContent = item.querySelector("span")?.textContent || "";
    lightboxTitle.textContent = item.querySelector("h3")?.textContent || "";
    lightboxDescription.textContent = item.querySelector("p")?.textContent || "";
  };
  const openCase = (item, trigger) => {
    const items = visibleCases();
    lastTrigger = trigger;
    renderCase(Math.max(0, items.indexOf(item)));
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
    lightbox.querySelector(".lightbox-close").focus();
  };
  const closeCase = () => {
    lightbox.hidden = true;
    document.body.classList.remove("lightbox-open");
    lastTrigger?.focus();
  };

  caseItems.forEach((item) => {
    const figure = item.querySelector("figure");
    const title = item.querySelector("h3")?.textContent || "";
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-label", `${labels.open}: ${title}`);
    figure.addEventListener("click", () => openCase(item, figure));
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCase(item, figure);
      }
    });
  });

  lightbox.querySelector(".lightbox-close").addEventListener("click", closeCase);
  lightbox.querySelector(".lightbox-previous").addEventListener("click", () => renderCase(activeIndex - 1));
  lightbox.querySelector(".lightbox-next").addEventListener("click", () => renderCase(activeIndex + 1));
  lightbox.addEventListener("click", (event) => { if (event.target === lightbox) closeCase(); });
  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") closeCase();
    if (event.key === "ArrowLeft") renderCase(activeIndex - 1);
    if (event.key === "ArrowRight") renderCase(activeIndex + 1);
  });
});
