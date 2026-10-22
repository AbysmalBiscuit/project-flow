export const frameScript = `<script>
document.addEventListener("DOMContentLoaded", () => {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "card-lane-frame";
  button.textContent = "Frame lanes";
  const left = document.createElement("button");
  left.type = "button";
  left.id = "card-lane-frame-left";
  left.textContent = "Frame left lanes";
  const backlog = document.createElement("button");
  backlog.type = "button";
  backlog.id = "card-lane-frame-backlog";
  backlog.textContent = "Frame backlog";
  function frameEnd(edge) {
    const lanes = document.querySelector("[data-lanes]");
    const named = new URLSearchParams(location.search).get("frame") ?? "";
    const framed = named.startsWith("acme/widget#")
      ? document.querySelector("[data-lanes] button[data-ticket='" + named + "']")
      : document.querySelector("[data-ticket='acme/widget#7']");
    if (!(lanes instanceof HTMLElement) || !(framed instanceof HTMLElement)) {
      button.textContent = "lanes missing";
      left.textContent = "lanes missing";
      backlog.textContent = "lanes missing";
      return;
    }
    if (named.startsWith("acme/widget#")) {
      const lane = framed.closest("[data-lanes] > *");
      if (!(lane instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        return;
      }
      const copy = lane.cloneNode(true);
      if (!(copy instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        return;
      }
      const cards = [...copy.querySelectorAll("button[data-ticket]")];
      for (const card of cards) {
        if (card.getAttribute("data-ticket") !== named) {
          card.remove();
        }
      }
      lanes.replaceChildren(copy);
    } else if (edge === "left") {
      lanes.scrollLeft = 0;
    } else if (edge === "backlog") {
      const card = document.querySelector("[data-ticket='acme/widget#9']");
      if (!(card instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        backlog.textContent = "lanes missing";
        return;
      }
      const lane = card.closest("[data-lanes] > *");
      if (!(lane instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        backlog.textContent = "lanes missing";
        return;
      }
      const offset = lane.getBoundingClientRect().left - lanes.getBoundingClientRect().left;
      lanes.scrollLeft += offset;
    } else {
      const offset = framed.getBoundingClientRect().left - lanes.getBoundingClientRect().left;
      lanes.scrollLeft += offset;
    }
    button.textContent = "lanes framed";
    left.textContent = "lanes framed";
    backlog.textContent = "lanes framed";
  }
  button.addEventListener("click", () => {
    frameEnd("right");
  });
  left.addEventListener("click", () => {
    frameEnd("left");
  });
  backlog.addEventListener("click", () => {
    frameEnd("backlog");
  });
  document.body.append(button, left, backlog);
});
</script>`;
