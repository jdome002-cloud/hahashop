/* HAHA SHOP — prepare images before upload.
   iPhone photos are often HEIC and 3–12 MB. Browsers that can decode them (Safari, recent Chrome)
   re-encode to JPEG here (max 1600px) so the upload is small and in a format the server accepts.
   Animated GIFs and already-small JPG/PNG/WebP are sent unchanged. */
(function () {
  "use strict";
  var MAX_SIDE = 1600, KEEP_BELOW = 1.5 * 1024 * 1024;
  var SAFE = { "image/jpeg": 1, "image/png": 1, "image/webp": 1 };

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { ok(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error("decode")); };
      img.src = url;
    });
  }
  function toJpeg(file) {
    return decode(file).then(function (bmp) {
      var w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
      if (!w || !h) throw new Error("decode");
      var k = Math.min(1, MAX_SIDE / Math.max(w, h));
      var c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      return new Promise(function (ok, bad) {
        c.toBlob(function (b) { b ? ok(b) : bad(new Error("encode")); }, "image/jpeg", 0.88);
      });
    }).then(function (blob) {
      var name = (file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    });
  }
  function isGif(file) { return file.type === "image/gif" || /\.gif$/i.test(file.name || ""); }

  /** Returns a File ready to upload (or the original when conversion is not needed/possible). */
  function prepare(file) {
    if (!file || !file.size) return Promise.resolve(file);
    if (isGif(file)) return Promise.resolve(file); // keep animation; server checks size
    if (SAFE[file.type] && file.size <= KEEP_BELOW) return Promise.resolve(file);
    return toJpeg(file).catch(function () { return file; }); // server gives a clear error if unsupported
  }

  function prepareFormData(fd) {
    var jobs = [];
    if (!fd || !fd.forEach) return Promise.resolve(fd);
    var entries = [];
    fd.forEach(function (v, k) { entries.push([k, v]); });
    entries.forEach(function (e) {
      if (typeof File !== "undefined" && e[1] instanceof File) {
        if (!e[1].size) { fd.delete(e[0]); return; } // empty file input → no change
        jobs.push(prepare(e[1]).then(function (f) { fd.set(e[0], f, f.name); }));
      }
    });
    return Promise.all(jobs).then(function () { return fd; });
  }

  // Live preview under any <input data-image-input>
  document.addEventListener("change", function (e) {
    var input = e.target;
    if (!input.matches || !input.matches("input[type=file][data-image-input]")) return;
    var form = input.form, pv = form && form.querySelector(".img-preview");
    if (!pv) { pv = document.createElement("div"); pv.className = "img-preview"; input.closest("label").after(pv); }
    var f = input.files && input.files[0];
    if (!f) { pv.innerHTML = ""; return; }
    var kb = Math.round(f.size / 1024);
    pv.innerHTML = "";
    var info = document.createElement("small"); info.className = "muted";
    info.textContent = (f.name || "image") + " · " + (kb > 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB");
    viaImg(f).then(function (img) { img.alt = ""; pv.prepend(img); })
      .catch(function () { info.textContent += " · ไม่สามารถแสดงตัวอย่างได้ (ระบบจะพยายามแปลงตอนบันทึก)"; });
    pv.appendChild(info);
  });

  window.HHImage = { prepare: prepare, prepareFormData: prepareFormData };
})();
