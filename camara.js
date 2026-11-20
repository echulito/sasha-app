// Sasha v121: "Sacar foto" con la cámara adentro de la app.
// Abrir la app de cámara del celular hace que Android, con poca memoria, cierre la app ("Memoria insuficiente para
// completar la operación anterior") y la foto se pierde. Acá la cámara se abre en la misma pantalla y la foto llega al
// mismo campo de siempre (como si se hubiera elegido), así cada pantalla sigue funcionando igual.
// v185: enfocar. La cámara queda con enfoque automático continuo; tocando la imagen enfoca en ese punto (con un
// recuadro que lo muestra). Si el celular tiene más de una cámara atrás, "Lente" pasa a la otra (algunas, como la gran
// angular, no enfocan de cerca). La foto se saca con la resolución completa de la cámara cuando el celular lo permite.
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

  // Lo que el celular permite hacer con el enfoque (cada marca de celular trae algo distinto).
  function capacidades(track) { try { return track && track.getCapabilities ? track.getCapabilities() || {} : {}; } catch (e) { return {}; } }
  function aplicar(track, cons) { try { var p = track.applyConstraints({advanced: [cons]}); return p && p.catch ? p.catch(function () {}) : Promise.resolve(); } catch (e) { return Promise.resolve(); } }
  function enfoqueContinuo(track) {
    var c = capacidades(track), modos = c.focusMode || [];
    if (modos.indexOf('continuous') >= 0) return aplicar(track, {focusMode: 'continuous'});
    return Promise.resolve();
  }
  // Enfocar en un punto (x, y de 0 a 1). Si no se puede elegir el punto, igual vuelve a enfocar.
  function enfocarEn(track, x, y) {
    var c = capacidades(track), modos = c.focusMode || [], cons = {};
    if ('pointsOfInterest' in c) cons.pointsOfInterest = [{x: x, y: y}];
    if (modos.indexOf('single-shot') >= 0) cons.focusMode = 'single-shot';
    else if (modos.indexOf('continuous') >= 0) cons.focusMode = 'continuous';
    if (!Object.keys(cons).length) return Promise.resolve(false);
    return aplicar(track, cons).then(function () { return true; });
  }
  window.__camaraSashaEnfoque = {capacidades: capacidades, enfocarEn: enfocarEn, enfoqueContinuo: enfoqueContinuo};

  function boton(txt, css) { var b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.style.cssText = css; return b; }
  function abrir(input) {
    var d = document, cap = d.createElement('div'), video = d.createElement('video'), stream = null, track = null, lentes = [], lente = -1;
    cap.setAttribute('data-camara-sasha', '');
    cap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;display:flex;flex-direction:column;align-items:stretch;justify-content:space-between';
    video.setAttribute('playsinline', ''); video.muted = true; video.autoplay = true;
    video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;touch-action:manipulation';
    var zona = d.createElement('div'); zona.style.cssText = 'flex:1;min-height:0;position:relative';
    var cuadro = d.createElement('div'); cuadro.setAttribute('data-enfoque', '');
    cuadro.style.cssText = 'position:absolute;width:70px;height:70px;margin:-35px 0 0 -35px;border:2px solid #ffd54a;border-radius:8px;display:none;pointer-events:none;transition:transform .25s';
    zona.appendChild(video); zona.appendChild(cuadro);
    var aviso = d.createElement('div'); aviso.textContent = 'Abriendo la cámara…';
    aviso.style.cssText = 'color:#fff;font:15px system-ui,sans-serif;text-align:center;padding:12px 16px';
    var barra = d.createElement('div');
    barra.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px calc(20px + env(safe-area-inset-bottom));background:#000';
    var cancelar = boton('Cancelar', 'background:none;border:0;color:#fff;font:600 16px system-ui,sans-serif;padding:10px;min-width:90px;text-align:left');
    var sacar = boton('', 'width:72px;height:72px;border-radius:50%;border:5px solid #fff;background:#fff;box-shadow:inset 0 0 0 4px #000;flex:none');
    sacar.setAttribute('aria-label', 'Sacar foto'); sacar.disabled = true;
    var otra = boton('Cámara del celular', 'background:none;border:0;color:#cfd8e3;font:13px system-ui,sans-serif;padding:10px;min-width:90px;text-align:right');
    var derecha = d.createElement('div'); derecha.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;min-width:90px';
    var cambiar = boton('🔄 Lente', 'background:none;border:0;color:#fff;font:600 14px system-ui,sans-serif;padding:6px 10px;display:none');
    cambiar.setAttribute('aria-label', 'Cambiar de lente');
    derecha.appendChild(cambiar); derecha.appendChild(otra);
    barra.appendChild(cancelar); barra.appendChild(sacar); barra.appendChild(derecha);
    cap.appendChild(aviso); cap.appendChild(zona); cap.appendChild(barra);
    d.body.appendChild(cap);
    var parar = function () { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; track = null; };
    var cerrar = function () { parar(); if (cap.parentNode) cap.parentNode.removeChild(cap); };
    cancelar.onclick = cerrar;
    otra.onclick = function () { cerrar(); saltear = input; input.click(); };

    var textoListo = 'Encuadrá el comprobante, tocá la imagen para enfocar y después el botón blanco';
    function encender(deviceId) {
      sacar.disabled = true;
      var video0 = {width: {ideal: 1920}, height: {ideal: 1080}};
      if (deviceId) video0.deviceId = {exact: deviceId}; else video0.facingMode = {ideal: 'environment'};
      return navigator.mediaDevices.getUserMedia({video: video0, audio: false}).then(function (s) {
        if (!cap.parentNode) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        parar(); stream = s; track = s.getVideoTracks()[0]; video.srcObject = s;
        aviso.textContent = textoListo;
        enfoqueContinuo(track);
        var listo = function () { sacar.disabled = false; };
        if (video.readyState >= 2) listo(); else video.onloadeddata = listo;
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        // Las cámaras de atrás (para el botón "Lente"); los nombres aparecen recién con el permiso dado.
        if (!lentes.length && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (ds) {
          var cams = ds.filter(function (x) { return x.kind === 'videoinput'; });
          var atras = cams.filter(function (x) { return /back|rear|trasera|environment/i.test(x.label); });
          lentes = (atras.length ? atras : cams).map(function (x) { return x.deviceId; });
          var actual = track && track.getSettings ? track.getSettings().deviceId : '';
          lente = Math.max(0, lentes.indexOf(actual));
          if (lentes.length > 1) cambiar.style.display = '';
        }).catch(function () {});
      });
    }
    encender('').catch(function () { aviso.textContent = 'No se pudo abrir la cámara acá (¿no le diste permiso?). Tocá "Cámara del celular" o Cancelar.'; video.style.display = 'none'; });
    cambiar.onclick = function () {
      if (lentes.length < 2) return;
      lente = (lente + 1) % lentes.length;
      aviso.textContent = 'Cambiando de lente…';
      encender(lentes[lente]).catch(function () { aviso.textContent = 'Esa lente no se pudo abrir. Probá de nuevo.'; });
    };

    // Tocar para enfocar.
    zona.addEventListener('click', function (e) {
      if (!track) return;
      var r = video.getBoundingClientRect(), vw = video.videoWidth || r.width, vh = video.videoHeight || r.height;
      var k = Math.min(r.width / vw, r.height / vh), iw = vw * k, ih = vh * k, ox = r.left + (r.width - iw) / 2, oy = r.top + (r.height - ih) / 2;
      var x = Math.min(1, Math.max(0, (e.clientX - ox) / iw)), y = Math.min(1, Math.max(0, (e.clientY - oy) / ih));
      var z = zona.getBoundingClientRect();
      cuadro.style.left = (e.clientX - z.left) + 'px'; cuadro.style.top = (e.clientY - z.top) + 'px';
      cuadro.style.display = 'block'; cuadro.style.borderColor = '#ffd54a'; cuadro.style.transform = 'scale(1.25)';
      setTimeout(function () { cuadro.style.transform = 'scale(1)'; }, 30);
      enfocarEn(track, x, y).then(function (pudo) {
        cuadro.style.borderColor = pudo ? '#4cd964' : '#ffd54a';
        aviso.textContent = pudo ? 'Enfocado. Tocá el botón blanco para sacar la foto' : 'Este celular enfoca solo: acercate o alejate un poco hasta que se lea bien';
        setTimeout(function () { cuadro.style.display = 'none'; }, 1200);
      });
    });

    function entregar(b) {
      cerrar();
      if (!b) return;
      var win = input.ownerDocument.defaultView || window;
      var f = new win.File([b], 'foto-' + Date.now() + '.jpg', {type: 'image/jpeg'});
      var dt = new win.DataTransfer(); dt.items.add(f); input.files = dt.files;
      input.dispatchEvent(new win.Event('input', {bubbles: true}));
      input.dispatchEvent(new win.Event('change', {bubbles: true}));
    }
    // La imagen se achica a 2400 px de lado como mucho (se lee bien y no pesa de más).
    function aJpg(fuente, w, h) {
      var esc = Math.min(1, 2400 / Math.max(w, h)), c = d.createElement('canvas');
      c.width = Math.round(w * esc); c.height = Math.round(h * esc);
      c.getContext('2d').drawImage(fuente, 0, 0, c.width, c.height);
      c.toBlob(entregar, 'image/jpeg', 0.88);
    }
    function delVideo() { var w = video.videoWidth, h = video.videoHeight; if (!w || !h) { sacar.disabled = false; return; } aJpg(video, w, h); }
    sacar.onclick = function () {
      if (!video.videoWidth) return;
      sacar.disabled = true;
      // Con ImageCapture la foto sale con la resolución completa (y el celular termina de enfocar antes de sacarla).
      var IC = window.ImageCapture;
      if (!IC || !track || !window.createImageBitmap) return delVideo();
      var listo = false, reserva = setTimeout(function () { if (!listo) { listo = true; delVideo(); } }, 4000);
      try {
        new IC(track).takePhoto().then(function (blob) { return createImageBitmap(blob); }).then(function (img) {
          if (listo) return; listo = true; clearTimeout(reserva); aJpg(img, img.width, img.height);
        }).catch(function () { if (!listo) { listo = true; clearTimeout(reserva); delVideo(); } });
      } catch (e) { listo = true; clearTimeout(reserva); delVideo(); }
    };
  }
})();
