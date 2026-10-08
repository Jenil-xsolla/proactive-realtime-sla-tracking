/**
 * Binds disclosure rows in the initial HTML. The dev client does not finish
 * hydrating, so this cannot be a React onClick.
 */
export const OUTAGE_DISCLOSURE_SCRIPT = `(function () {
  var rows = document.querySelectorAll("details[data-disclosure]");
  for (var i = 0; i < rows.length; i++) {
    var details = rows[i];
    if (details.getAttribute("data-bound") === "true") continue;
    details.setAttribute("data-bound", "true");
    var summary = details.querySelector("summary");
    details.addEventListener("toggle", function () {
      var control = this.querySelector("summary");
      if (!control) return;
      var open = this.open;
      control.setAttribute("aria-expanded", open ? "true" : "false");
      var label = control.getAttribute("aria-label") || "";
      var next = open ? label.replace(/^Show /, "Hide ") : label.replace(/^Hide /, "Show ");
      if (next !== label) control.setAttribute("aria-label", next);
    });
    if (!summary) continue;
    summary.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      var parent = this.closest("details");
      if (!parent) return;
      parent.open = !parent.open;
    });
  }
})();`;
