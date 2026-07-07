import { NextRequest } from "next/server";
import { getShareConfig } from "@/lib/share";

/**
 * Embeddable launcher script. Site owners add:
 *   <script src="https://your-app/widget.js" async></script>
 * It injects a floating chat button that opens the /embed/widget iframe.
 */
export async function GET(req: NextRequest) {
  const config = await getShareConfig("widget");
  const origin = new URL(req.url).origin;
  const side = config.position === "left" ? "left" : "right";
  const color = JSON.stringify(config.color || "#0e7f93");

  const js = `(function () {
  if (window.__nonakiWidget) return;
  window.__nonakiWidget = true;

  var color = ${color};
  var origin = ${JSON.stringify(origin)};
  var side = ${JSON.stringify(side)};

  var btn = document.createElement("button");
  btn.setAttribute("aria-label", "Open chat");
  btn.style.cssText =
    "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;" +
    "width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;" +
    "background:" + color + ";color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.22);" +
    "display:flex;align-items:center;justify-content:center;transition:transform .15s";
  btn.onmouseenter = function () { btn.style.transform = "scale(1.06)"; };
  btn.onmouseleave = function () { btn.style.transform = "scale(1)"; };

  var chatIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  btn.innerHTML = chatIcon;

  var frame = document.createElement("iframe");
  frame.src = origin + "/embed/widget";
  frame.title = "Chat";
  frame.style.cssText =
    "position:fixed;bottom:88px;" + side + ":20px;z-index:2147483000;" +
    "width:380px;height:560px;max-height:calc(100vh - 110px);max-width:calc(100vw - 40px);" +
    "border:none;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.28);" +
    "background:#fff;display:none;opacity:0;transform:translateY(8px);" +
    "transition:opacity .18s,transform .18s";

  var open = false;
  btn.onclick = function () {
    open = !open;
    btn.innerHTML = open ? closeIcon : chatIcon;
    if (open) {
      frame.style.display = "block";
      requestAnimationFrame(function () {
        frame.style.opacity = "1";
        frame.style.transform = "translateY(0)";
      });
    } else {
      frame.style.opacity = "0";
      frame.style.transform = "translateY(8px)";
      setTimeout(function () { if (!open) frame.style.display = "none"; }, 200);
    }
  };

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(btn);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();`;

  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
