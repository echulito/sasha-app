// Sasha v121: "Sacar foto" con la cámara adentro de la app.
// Abrir la app de cámara del celular hace que Android, con poca memoria, cierre la app ("Memoria insuficiente para
// completar la operación anterior") y la foto se pierde. Acá la cámara se abre en la misma pantalla y la foto llega al
// mismo campo de siempre (como si se hubiera elegido), así cada pantalla sigue funcionando igual.
(function () {
  if (window.__camaraSasha) return; window.__camaraSasha = true;
  var saltear = null;
  function esCamara(input) { return input && input.tagName === 'INPUT' && input.type === 'file' && input.hasAttribute('capture'); }
  function inputDe(el) {
    if (!el || !el.closest) return null;
    var i = el.closest('input'); if (esCamara(i)) return i;
    var l = el.closest('label'); if (!l) return null;
    i = l.control || l.querySelector('input[type=file]');
    return esCamara(i) ? i : null;
  }
  document.addEventListener('click', function (e) {
    var input = inputDe(e.target);
    if (!input) return;
    if (saltear === input) { saltear = null; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    e.preventDefault(); e.stopPropagation();
    abrir(input);
  }, true);

  function boton(txt, css) { var b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.style.cssText = css; return b; }
  function abrir(input) {
    var d = document, cap = d.createElement('div'), video = d.createElement('video'), stream = null;
    cap.setAttribute('data-camara-sasha', '');
    cap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;display:flex;flex-direction:column;align-items:stretch;justify-content:space-between';
    video.setAttribute('playsinline', ''); video.muted = true; video.autoplay = true;
    video.style.cssText = 'flex:1;min-height:0;width:100%;object-fit:contain;background:#000';
    var aviso = d.createElement('div'); aviso.textContent = 'Abriendo la cámara…';
    aviso.style.cssText = 'color:#fff;font:15px system-ui,sans-serif;text-align:center;padding:12px 16px';
    var barra = d.createElement('div');
    barra.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px calc(20px + env(safe-area-inset-bottom));background:#000';
    var cancelar = boton('Cancelar', 'background:none;border:0;color:#fff;font:600 16px system-ui,sans-serif;padding:10px;min-width:90px;text-align:left');
    var sacar = boton('', 'width:72px;height:72px;border-radius:50%;border:5px solid #fff;background:#fff;box-shadow:inset 0 0 0 4px #000;flex:none');
    sacar.setAttribute('aria-label', 'Sacar foto'); sacar.disabled = true;
    var otra = boton('Cámara del celular', 'background:none;border:0;color:#cfd8e3;font:13px system-ui,sans-serif;padding:10px;min-width:90px;text-align:right');
    barra.appendChild(cancelar); barra.appendChild(sacar); barra.appendChild(otra);
    cap.appendChild(aviso); cap.appendChild(video); cap.appendChild(barra);
    d.body.appendChild(cap);
    var cerrar = function () { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); if (cap.parentNode) cap.parentNode.removeChild(cap); };
    cancelar.onclick = cerrar;
    otra.onclick = function () { cerrar(); saltear = input; input.click(); };
    navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false})
      .then(function (s) {
        stream = s; video.srcObject = s;
        if (!cap.parentNode) { cerrar(); return; }
        aviso.textContent = 'Encuadrá el comprobante y tocá el botón blanco';
        var listo = function () { sacar.disabled = false; };
        if (video.readyState >= 2) listo(); else video.onloadeddata = listo;
        var p = video.play(); if (p && p.catch) p.catch(function () {});
      })
      .catch(function () { aviso.textContent = 'No se pudo abrir la cámara acá (¿no le diste permiso?). Tocá "Cámara del celular" o Cancelar.'; video.style.display = 'none'; });
    sacar.onclick = function () {
      var w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      var esc = Math.min(1, 1600 / Math.max(w, h)), c = d.createElement('canvas');
      c.width = Math.round(w * esc); c.height = Math.round(h * esc);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      sacar.disabled = true;
      c.toBlob(function (b) {
        cerrar();
        if (!b) return;
        var win = input.ownerDocument.defaultView || window;
        var f = new win.File([b], 'foto-' + Date.now() + '.jpg', {type: 'image/jpeg'});
        var dt = new win.DataTransfer(); dt.items.add(f); input.files = dt.files;
        input.dispatchEvent(new win.Event('input', {bubbles: true}));
        input.dispatchEvent(new win.Event('change', {bubbles: true}));
      }, 'image/jpeg', 0.85);
    };
  }
})();
