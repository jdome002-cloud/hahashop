/* HAHA SHOP — registers the service worker (HTTPS only). External file for CSP. */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () { /* PWA is optional */ });
  });
})();
