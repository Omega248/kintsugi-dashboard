/* ============================================================
   Kintsugi Dashboard — Shared Table Helper
   Provides a single, consistent way to render table bodies
   across all pages.
   ============================================================ */

/**
 * kRenderTable — populate a <tbody> from data rows and column definitions.
 *
 * Every table body on every page should use this function so rendering
 * behaviour (empty states, fragments, cell content) stays identical.
 *
 * @param {HTMLElement} tbody
 *   The <tbody> element to populate. Its content is cleared before rendering.
 *
 * @param {Array<object>} rows
 *   Data rows to display.
 *
 * @param {Array<{
 *   className?: string,
 *   render: function(row: object, td: HTMLElement): string|Node|null|undefined
 * }>} columns
 *   Column definitions. Each entry must supply a `render` function that:
 *   - Receives the data `row` and the already-created `<td>` element.
 *   - May mutate `td` directly (e.g. add classes via `td.classList.add(...)` or
 *     set `td.style.*` properties) before returning content.
 *   - Returns one of:
 *       • a DOM Node  → appended with appendChild
 *       • a non-empty string → set via textContent
 *       • null / undefined / '' → cell is left empty (no content set)
 *   An optional `className` string is applied to every <td> in that column.
 *
 * @param {object} [options]
 * @param {string}   [options.emptyMessage='No data available.']
 *   Message shown when rows is empty.
 * @param {number}   [options.emptyColspan]
 *   colspan for the empty-state cell; defaults to columns.length.
 * @param {function} [options.onRowClick]
 *   Called with (row, tr) when a row is clicked.
 * @param {function} [options.rowClass]
 *   Called with (row) and should return a CSS class string (or '') for the <tr>.
 * @param {function} [options.rowAttrs]
 *   Called with (row, tr) for setting dataset/aria attributes on the <tr>.
 */
function kRenderTable(tbody, rows, columns, options) {
  if (!tbody) return;

  options = options || {};

  // Clear existing content
  tbody.innerHTML = "";

  var emptyColspan = options.emptyColspan != null
    ? options.emptyColspan
    : columns.length;
  var emptyMessage = options.emptyMessage || "No data available.";

  // Empty state
  if (!rows || rows.length === 0) {
    var emptyTr = document.createElement("tr");
    var emptyTd = document.createElement("td");
    emptyTd.colSpan = emptyColspan;
    emptyTd.className = "table-empty-cell";
    emptyTd.textContent = emptyMessage;
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }

  // Use a DocumentFragment for a single DOM insertion (better performance)
  var frag = document.createDocumentFragment();

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var tr = document.createElement("tr");

    // Optional row class
    if (typeof options.rowClass === "function") {
      var cls = options.rowClass(row);
      if (cls) tr.className = cls;
    }

    // Optional dataset / aria attributes
    if (typeof options.rowAttrs === "function") {
      options.rowAttrs(row, tr);
    }

    // Optional click handler
    if (typeof options.onRowClick === "function") {
      (function (r, t) {
        t.addEventListener("click", function () { options.onRowClick(r, t); });
      }(row, tr));
    }

    // Build cells
    for (var j = 0; j < columns.length; j++) {
      var col = columns[j];
      var td = document.createElement("td");

      if (col.className) td.className = col.className;

      var content = col.render(row, td);

      if (content instanceof Node) {
        td.appendChild(content);
      } else if (content !== null && content !== undefined && content !== "") {
        td.textContent = String(content);
      }

      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);
}

/* -------------------------------------------------------
   kMakeButton — helper to create a styled <button> node.
   Keeps button creation consistent and avoids innerHTML.

   @param {string} text          Visible button text
   @param {object} [opts]
   @param {string} [opts.className]    CSS class(es)
   @param {string} [opts.title]        Tooltip
   @param {object} [opts.dataset]      key/value pairs for dataset
   @param {function} [opts.onClick]    Click handler
   @returns {HTMLButtonElement}
   ------------------------------------------------------- */
function kMakeButton(text, opts) {
  opts = opts || {};
  var btn = document.createElement("button");
  btn.textContent = text;
  if (opts.className) btn.className = opts.className;
  if (opts.title) btn.title = opts.title;
  if (opts.dataset) {
    var keys = Object.keys(opts.dataset);
    for (var k = 0; k < keys.length; k++) {
      btn.dataset[keys[k]] = opts.dataset[keys[k]];
    }
  }
  if (typeof opts.onClick === "function") {
    btn.addEventListener("click", opts.onClick);
  }
  return btn;
}

/* -------------------------------------------------------
   kMakePill — helper to create a pill/badge <span> node.

   @param {string} text          Visible text
   @param {string} className     CSS class(es)
   @param {string} [title]       Optional tooltip
   @returns {HTMLSpanElement}
   ------------------------------------------------------- */
function kMakePill(text, className, title) {
  var span = document.createElement("span");
  span.textContent = text;
  span.className = className;
  if (title) span.title = title;
  return span;
}
