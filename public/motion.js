const scene = document.querySelector(".scene");
const go = document.querySelector(".go");
const logo = document.querySelector(".logo-wrap");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
let pointerFrame;

function resetPointer() {
  cancelAnimationFrame(pointerFrame);
  scene.style.setProperty("--pointer-x", "0px");
  scene.style.setProperty("--pointer-y", "0px");
}

function renderMotion() {
  if (reducedMotion.matches) {
    resetPointer();
  }
}

reducedMotion.addEventListener("change", renderMotion);

function motionDirection(element, x = Math.SQRT1_2, y = -Math.SQRT1_2) {
  const angle = Math.atan2(y, x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const distance = element === go ? 8 : 10;
  element.style.setProperty("--hover-x", `${dx * distance}px`);
  element.style.setProperty("--hover-y", `${dy * distance}px`);
  element.style.setProperty(
    "--hover-rotation",
    `${dx * (element === go ? 3 : 8)}deg`,
  );
  if (element !== go) return;
  const rotation = (((angle * 180) / Math.PI + 45 + 540) % 360) - 180;
  go.style.setProperty("--arrow-x", `${dx * 6}px`);
  go.style.setProperty("--arrow-y", `${dy * 6}px`);
  go.style.setProperty("--arrow-rotation", `${rotation}deg`);
  go.style.setProperty("--sheen-angle", `${(angle * 180) / Math.PI + 90}deg`);
  go.style.setProperty("--sheen-start", `${50 + dx * 70}% ${50 + dy * 70}%`);
  go.style.setProperty("--sheen-end", `${50 - dx * 70}% ${50 - dy * 70}%`);
}

for (const element of [go, logo]) {
  element.addEventListener("pointerenter", (event) => {
    if (!finePointer.matches || event.pointerType === "touch") return;
    const anchor = element === go ? go.parentElement : element;
    const rect = anchor.getBoundingClientRect();
    motionDirection(
      element,
      (event.clientX - rect.left - rect.width / 2) / rect.width,
      (event.clientY - rect.top - rect.height / 2) / rect.height,
    );
  });
}
for (const element of [go, logo]) {
  element.addEventListener("focus", () => {
    if (element.matches(":focus-visible")) motionDirection(element);
  });
}

scene.addEventListener("pointermove", (event) => {
  if (
    reducedMotion.matches ||
    !finePointer.matches ||
    event.pointerType === "touch"
  )
    return;
  cancelAnimationFrame(pointerFrame);
  pointerFrame = requestAnimationFrame(() => {
    const rect = scene.getBoundingClientRect();
    scene.style.setProperty(
      "--pointer-x",
      `${(event.clientX - rect.left - rect.width / 2) * 0.025}px`,
    );
    scene.style.setProperty(
      "--pointer-y",
      `${(event.clientY - rect.top - rect.height / 2) * 0.025}px`,
    );
  });
});
scene.addEventListener("pointerleave", resetPointer);

document.addEventListener("visibilitychange", () => {
  scene.classList.toggle("is-hidden", document.hidden);
});

renderMotion();
