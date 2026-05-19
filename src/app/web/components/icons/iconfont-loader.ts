const ICONFONT_SCRIPT_ID = "myagent-iconfont-symbols";
const ICONFONT_SYMBOL_URL =
  "https://at.alicdn.com/t/c/font_5180532_i7568v6nlff.js?file=font_5180532_i7568v6nlff.js";

let loading: Promise<void> | undefined;

export function ensureIconfontSprite() {
  if (typeof document === "undefined") return Promise.resolve();
  loading ??= loadIconfontScript();
  return loading;
}

function loadIconfontScript() {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(ICONFONT_SCRIPT_ID);
    if (existing instanceof HTMLScriptElement) {
      normalizeIconfontFill();
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = ICONFONT_SCRIPT_ID;
    script.src = ICONFONT_SYMBOL_URL;
    script.async = true;
    script.onload = () => {
      normalizeIconfontFill();
      resolve();
    };
    script.onerror = () => reject(new Error(`failed to load ${ICONFONT_SYMBOL_URL}`));
    document.head.appendChild(script);
  });
}

function normalizeIconfontFill() {
  window.setTimeout(() => {
    for (const node of document.querySelectorAll<SVGElement>(
      'symbol[id^="icon-"] [fill]',
    )) {
      node.setAttribute("fill", "currentColor");
    }
  }, 0);
}
