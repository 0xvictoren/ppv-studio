/*!
 * PayPerWatch embed. One line:
 *   <script src="https://YOUR-PPW-HOST/embed.js" data-ppw="catalog" async></script>
 *
 * Or mark any element and load the script once:
 *   <div data-ppw="video" data-video="0x…videoId"></div>
 *   <div data-ppw="catalog" data-category="tutorials" data-creator="0x…"></div>
 *   <div data-ppw="upload"></div>
 *
 * Add data-ref="0x…yourWallet" to video or catalog embeds to earn 5% of what viewers you
 * bring in spend (your wallet must have watched that creator's content first).
 *
 * Renders a sandboxed iframe that resizes to fit. Viewers connect their own wallet inside it.
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;
  var frames = [];

  function src(el) {
    var type = el.getAttribute("data-ppw") || "catalog";
    var params = new URLSearchParams();
    var path = "/embed/browse";
    var ref = el.getAttribute("data-ref");
    if (ref && type !== "upload") params.set("ref", ref);
    if (type === "video") {
      path = "/embed/watch/" + encodeURIComponent(el.getAttribute("data-video") || "");
    } else if (type === "upload") {
      path = "/embed/upload";
    } else {
      ["category", "creator"].forEach(function (k) {
        var v = el.getAttribute("data-" + k);
        if (v) params.set(k, v);
      });
    }
    var qs = params.toString();
    return { url: origin + path + (qs ? "?" + qs : ""), type: type };
  }

  function mount(el) {
    if (el.__ppwMounted) return;
    el.__ppwMounted = true;
    var s = src(el);
    var f = document.createElement("iframe");
    f.src = s.url;
    f.title = el.getAttribute("data-title") || "PayPerWatch";
    f.allow = "fullscreen; clipboard-write; autoplay";
    f.setAttribute("allowfullscreen", "");
    f.loading = "lazy";
    f.style.cssText = "display:block;width:100%;border:0;background:transparent;min-height:" + (s.type === "video" ? "480px" : "640px");
    frames.push(f);
    if (el.tagName === "SCRIPT") el.parentNode.insertBefore(f, el.nextSibling);
    else el.appendChild(f);
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== "ppw:height") return;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = e.data.height + "px";
        frames[i].style.minHeight = "0";
      }
    }
  });

  function scan() {
    if (script.hasAttribute("data-ppw")) mount(script);
    var els = document.querySelectorAll("[data-ppw]:not(script)");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
  window.PayPerWatch = { mount: mount, scan: scan };
})();
