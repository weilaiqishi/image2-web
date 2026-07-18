document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("is-ready");

  document.querySelectorAll("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  document.querySelectorAll("[data-compare]").forEach((comparison) => {
    const image = comparison.querySelector("[data-compare-image]");
    const caption = comparison.querySelector("[data-compare-caption]");
    const buttons = comparison.querySelectorAll("[data-view]");
    if (!(image instanceof HTMLImageElement) || !caption || buttons.length !== 2) return;

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.getAttribute("data-view");
        const prefix = view === "after" ? "after" : "before";
        image.src = comparison.getAttribute(`data-${prefix}-src`) || image.src;
        image.alt = comparison.getAttribute(`data-${prefix}-alt`) || image.alt;
        caption.textContent = comparison.getAttribute(`data-${prefix}-caption`) || "";

        buttons.forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
      });
    });
  });
});
