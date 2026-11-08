import DOMPurify from "dompurify";

const LOCAL_ASSET = /^\/@vault\/file\?|^vault:\/\/localhost\//;

const RENDERER_DATA = new Set([
  "data-candidates",
  "data-anchor",
  "data-path",
  "data-embed",
  "data-fold",
  "data-callout",
  "data-type",
  "data-lang",
  "data-lines",
  "data-diagram",
  "data-src",
  "data-key",
  "data-external",
  "data-attachment",
]);

let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (!(node instanceof Element)) return;
    if (data.tagName === "iframe") {
      const src = node.getAttribute("src") ?? "";
      if (!node.parentElement?.classList.contains("embed-pdf") || !LOCAL_ASSET.test(src)) node.remove();
    }
    if (data.tagName === "img") {
      const src = node.getAttribute("src") ?? "";
      if (src && !LOCAL_ASSET.test(src) && !src.startsWith("data:image/")) {
        const placeholder = node.ownerDocument.createElement("span");
        placeholder.className = "remote-image";
        placeholder.dataset.src = src;
        placeholder.textContent = node.getAttribute("alt") || src;
        node.replaceWith(placeholder);
      }
    }
  });
  /* Only the data attributes the renderer emits survive, so note HTML cannot trigger app actions (data-act). */
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName.startsWith("data-") && !RENDERER_DATA.has(data.attrName)) data.keepAttr = false;
  });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement && /^https?:/i.test(node.getAttribute("href") ?? "")) {
      node.setAttribute("rel", "noreferrer noopener");
    }
  });
}

/** Note HTML is untrusted: no scripts, no handlers, no forms, no remote loads. */
export function sanitize(html: string): DocumentFragment {
  if (!DOMPurify.isSupported) throw new Error("HTML sanitizer unavailable; refusing to render note HTML");
  configure();
  return DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: ["iframe", "semantics", "annotation", "eq", "eqn"],
    ADD_ATTR: ["sandbox", "type", "aria-expanded", "encoding", "loading", "decoding"],
    FORBID_TAGS: ["style", "form", "input", "textarea", "select", "object", "embed", "link", "meta", "base"],
    FORBID_ATTR: ["srcset", "action", "formaction", "ping"],
    /* Plain numbers and keywords, which the strict URL pattern below would otherwise reject. */
    ADD_URI_SAFE_ATTR: ["start", "colspan", "rowspan", "width", "height", "align", "dir", "lang"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/@vault\/file\?|vault:\/\/)/i,
  });
}
