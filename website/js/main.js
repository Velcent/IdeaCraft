/* ============================================================
   IdeaCraft — Paper Sky engine
   floating pages · idea sparks · one quiet camera
   ============================================================ */
(function () {
  "use strict";

  var docEl = document.documentElement;

  /* ---------- clipboard for the install command ---------- */
  var copyBtn = document.querySelector(".copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var text = document.getElementById("install-cmd").textContent.trim();
      function done() {
        copyBtn.textContent = "Copied";
        copyBtn.classList.add("ok");
        setTimeout(function () {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("ok");
        }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
    });
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* no-op */ }
    document.body.removeChild(ta);
  }

  /* ---------- WebGL capability probe ---------- */
  var probeCanvas = document.createElement("canvas");
  var hasWebGL = false;
  try {
    hasWebGL = !!window.WebGLRenderingContext &&
      (probeCanvas.getContext("webgl2") || probeCanvas.getContext("webgl"));
  } catch (err) { hasWebGL = false; }

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var isSmall = window.matchMedia("(max-width: 700px)");

  if (!hasWebGL) {
    docEl.classList.add("no-webgl");
  }

  /* ---------- pause-the-sky control ---------- */
  var skyToggle = document.getElementById("sky-toggle");
  var manualPaused = false;
  if (skyToggle) {
    if (!hasWebGL) skyToggle.hidden = true; /* nothing animates without the sky */
    skyToggle.addEventListener("click", function () {
      manualPaused = !manualPaused;
      skyToggle.setAttribute("aria-pressed", String(manualPaused));
      skyToggle.setAttribute("aria-label", manualPaused ? "Resume the sky animation" : "Pause the sky animation");
      var pauseMark = skyToggle.querySelector(".mark-pause");
      var playMark = skyToggle.querySelector(".mark-play");
      if (pauseMark) pauseMark.hidden = manualPaused;
      if (playMark) playMark.hidden = !manualPaused;
    });
  }

  /* ---------- lightweight reveal choreography (GSAP optional) ---------- */
  var revealEls = document.querySelectorAll("[data-reveal]");
  var gsapReady = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  if (gsapReady && !reducedMotion.matches && revealEls.length) {
    try {
      gsap.registerPlugin(ScrollTrigger);
      docEl.classList.add("js");
      revealEls.forEach(function (el) {
        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration: 0.38,
          ease: "power1.out",
          scrollTrigger: { trigger: el, start: "top 88%", once: true }
        });
      });
    } catch (revealErr) {
      docEl.classList.remove("js"); /* never leave content invisible */
    }
  }

  /* ============================================================
     THE SKY
     ============================================================ */
  if (!hasWebGL) return;

  var FEATURES = [
    { title: "Block editor", body: "Headings, lists, to-dos, quotes, code and dividers — type Markdown and the block appears. Pages keep their own history." },
    { title: "Pages with character", body: "Icons, covers and a favorites shelf. Give each page a face at a glance." },
    { title: "Search and templates", body: "Full-text search across everything you ever wrote, plus templates to beat the blank page." },
    { title: "Trash, history, comments", body: "Nothing vanishes by accident. Deleted pages rest in a trash you control." },
    { title: "Export and sync", body: "Back up the whole workspace, or sync it through any folder you already trust." },
    { title: "Local AI, optional", body: "Point at an Ollama endpoint and the assistant runs on your machine. Off by default." }
  ];

  var PALETTE = {
    paper: 0xf6f2e8,
    pageFace: 0xfdfaf1,
    ink: 0x1a150c,
    spark: 0xf5a300
  };

  var canvas = document.getElementById("sky");

  import("three").then(function (THREE) {

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setClearColor(PALETTE.paper, 1);

    var DPR_CAP = isSmall.matches ? 1.75 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
    renderer.setSize(window.innerWidth, window.innerHeight);

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PALETTE.paper, 9, 17);

    var camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 40);
    var CAM_HOME = new THREE.Vector3(0, 0, isSmall.matches ? 9.4 : 7.4);
    camera.position.copy(CAM_HOME);
    camera.lookAt(0, 0, 0);

    /* lights — soft studio, paper feel */
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfba, 1.35));
    var key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-4, 6, 6);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    /* ---------- page textures: little document mockups ---------- */
    function pageTexture(variant) {
      var scale = 2;
      var w = 320 * scale, h = 426 * scale;
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var g = c.getContext("2d");

      g.fillStyle = "#fdfaf1";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#1a150c";
      g.lineWidth = 3 * scale;
      g.strokeRect(14 * scale, 14 * scale, w - 28 * scale, h - 28 * scale);

      var pad = 40 * scale;
      var y = pad;
      g.fillStyle = "#1a150c";
      /* title strokes */
      var titleW = w * (0.55 + 0.25 * variant);
      g.fillRect(pad, y, titleW, 13 * scale);
      y += 34 * scale;
      /* rule under the title */
      g.fillStyle = "#f5a300";
      g.fillRect(pad, y, titleW * 0.5, 5 * scale);
      y += 26 * scale;

      g.fillStyle = "#26211a";
      var lh = 15 * scale;
      var maxLines = 12;
      for (var i = 0; i < maxLines && y < h - pad - lh; i++) {
        var width = w - pad * 2;
        var seg = 2 + ((i + variant) % 3);
        if (i % 4 === 3) {
          /* hollow square = a to-do */
          g.strokeStyle = "#3a3225";
          g.lineWidth = 2 * scale;
          g.strokeRect(pad, y + 2 * scale, 9 * scale, 9 * scale);
          width -= 16 * scale;
          g.fillRect(pad + 16 * scale, y, width * (0.45 + 0.3 * ((i * 7 + variant) % 4) / 4), lh * 0.72);
        } else {
          g.fillRect(pad, y, width * (0.55 + 0.4 * (((i * 13 + variant * 5) % 7) / 7)), lh * 0.72);
        }
        y += lh + 8 * scale;
      }
      var tex = new THREE.CanvasTexture(c);
      tex.anisotropy = 4;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    var pageGeo = new THREE.BoxGeometry(1.42, 1.9, 0.045);
    var pageCount = isSmall.matches ? 12 : 18;
    var pages = [];
    for (var i = 0; i < pageCount; i++) {
      var tex = pageTexture(i % 4);
      var mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.85,
        metalness: 0
      });
      var mesh = new THREE.Mesh(pageGeo, mat);
      var feature = FEATURES[i % FEATURES.length];
      mesh.userData = {
        feature: feature,
        home: new THREE.Vector3(),
        homeRot: new THREE.Euler(),
        drift: Math.random() * Math.PI * 2,
        driftSpeed: 0.25 + Math.random() * 0.35,
        hover: 0
      };
      pages.push(mesh);
      scene.add(mesh);
    }

    /* layout: layered depth planes + lockstep drift = sheets overlap on screen
       like layered paper, but their planes stay separated so they can never
       pass *through* one another. */
    var LAYER_PHASES = [0, 1.7, 3.4, 5.1, 0.85, 2.55];
    function assignHomes() {
      var wide = !isSmall.matches;
      var layers = wide ? 4 : 5;
      var cols = wide ? 3 : 2;
      var perLayer = Math.ceil(pages.length / layers);
      var rows = Math.ceil(perLayer / cols);
      var cellW = wide ? 2.55 : 2.2;
      var cellH = wide ? 2.65 : 2.5;
      var layerGap = wide ? 1.15 : 0.8;
      var x0 = wide ? 0.75 : -0.35;
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var u = p.userData;
        var layer = i % layers;
        var slot = Math.floor(i / layers);
        var col = slot % cols;
        var row = Math.floor(slot / cols);
        u.home.set(
          x0 + col * cellW + (row % 2) * (cellW / 2) * 0.55,
          (row - (rows - 1) / 2) * -cellH,
          -(0.55 + layer * layerGap)
        );
        /* constant tilts only: rotation.x/.y must never animate — animating
           them would swing card corners out of their depth plane */
        u.homeRot.set(
          (Math.sin(i * 12.9898)) * 0.14,
          (Math.sin(i * 78.233)) * 0.18,
          (Math.sin(i * 43.211)) * 0.09
        );
        /* lockstep drift: every card in a layer shares phase + speed, so
           relative positions within a layer never change */
        u.drift = LAYER_PHASES[layer % LAYER_PHASES.length];
        u.driftSpeed = 0.3 + layer * 0.06;
        p.scale.setScalar(wide ? 1 : 0.82);
      }
    }
    assignHomes();

    /* ---------- idea sparks (instanced, unlit marigold) ---------- */
    var sparkCount = isSmall.matches ? 70 : 140;
    var sparksGeo = new THREE.OctahedronGeometry(0.055, 0);
    var sparksMat = new THREE.MeshBasicMaterial({ color: PALETTE.spark });
    var sparks = new THREE.InstancedMesh(sparksGeo, sparksMat, sparkCount);
    sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(sparks);

    var dummy = new THREE.Object3D();
    var sparkSeeds = [];
    for (var s = 0; s < sparkCount; s++) {
      sparkSeeds.push({
        a: Math.random() * Math.PI * 2,
        r: 2 + Math.random() * 4.5,
        y0: (Math.random() - 0.5) * 5,
        speed: 0.12 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
        scale: 0.55 + Math.random() * 0.45
      });
    }
    function updateSparks(t) {
      for (var i = 0; i < sparkCount; i++) {
        var sp = sparkSeeds[i];
        var x = Math.cos(sp.a + t * sp.speed * 0.35) * sp.r;
        var z = Math.sin(sp.a + t * sp.speed * 0.35) * sp.r * 0.7 - 1.2;
        var y = sp.y0 + Math.sin(t * sp.speed + sp.phase) * 0.5;
        dummy.position.set(x, y, z);
        dummy.rotation.set(t * sp.speed, sp.phase, 0);
        dummy.scale.setScalar(sp.scale);
        dummy.updateMatrix();
        sparks.setMatrixAt(i, dummy.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;
    }

    /* ---------- pointer, hover, focus ---------- */
    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2(-2, -2);
    var pointerActive = false;
    var focused = null;
    var hovered = null;
    var parallax = { x: 0, y: 0, lerpX: 0, lerpY: 0 };
    var FOCUS_OFFSET = new THREE.Vector3(0.9, -0.55, -2.1);
    var FOCUS_TMP = new THREE.Vector3();
    var FOCUS_ROT = new THREE.Euler(0, 0.15, -0.03);
    var note = document.getElementById("page-note");
    var noteTitle = document.getElementById("page-note-title");
    var noteBody = document.getElementById("page-note-body");
    var heroEl = document.querySelector(".hero");

    function setNDC(x, y) {
      ndc.x = (x / window.innerWidth) * 2 - 1;
      ndc.y = -(y / window.innerHeight) * 2 + 1;
    }
    window.addEventListener("pointermove", function (e) {
      pointerActive = true;
      setNDC(e.clientX, e.clientY);
      parallax.x = ndc.x; parallax.y = ndc.y;
    }, { passive: true });

    canvas.addEventListener("touchmove", function (e) {
      var t = e.touches[0];
      setNDC(t.clientX, t.clientY);
    }, { passive: true });

    function pickPage() {
      if (!pages.length || !inHero()) return null;
      raycaster.setFromCamera(ndc, camera);
      var hits = raycaster.intersectObjects(pages, false);
      return hits.length ? hits[0].object : null;
    }

    var hoverTarget = null;
    var heroHeight = 0;
    function measureHero() {
      if (heroEl) heroHeight = heroEl.offsetHeight;
    }
    measureHero();
    if (window.ResizeObserver && heroEl) {
      new ResizeObserver(measureHero).observe(heroEl);
    } else {
      window.addEventListener("resize", measureHero);
    }

    function inHero() {
      return heroEl && (window.scrollY < heroHeight - 60);
    }

    function focusPage(mesh) {
      focused = mesh;
      if (noteTitle) noteTitle.textContent = mesh.userData.feature.title;
      if (noteBody) noteBody.textContent = mesh.userData.feature.body;
      if (note) note.hidden = false;
      document.body.style.cursor = "auto";
    }
    function releaseFocus() {
      focused = null;
      if (note) note.hidden = true;
      document.body.style.cursor = "auto";
    }

    canvas.addEventListener("pointerdown", function (e) {
      setNDC(e.clientX, e.clientY);
      var hit = pickPage();
      if (hit) {
        if (hit === focused) { releaseFocus(); } else { focusPage(hit); }
      } else if (focused) {
        releaseFocus();
      }
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && focused) releaseFocus();
    });
    /* clicking plain content (nav, chapters) also puts a focused page back */
    document.addEventListener("pointerdown", function (e) {
      if (focused && e.target !== canvas && (!note || !note.contains(e.target))) releaseFocus();
    });
    /* any focus moving elsewhere frees the screen so overlays never cover focus */
    document.addEventListener("focusin", function (e) {
      if (focused && (!note || !note.contains(e.target))) releaseFocus();
    });

    /* ---------- scroll fade-out as chapters arrive ---------- */
    var skyDim = 0;
    function updateScrollPush() {
      var h = window.innerHeight;
      var y = window.scrollY;
      var t = Math.min(1, Math.max(0, y / (h * 0.55)));
      skyDim = t * t;
    }

    /* ---------- render loop ---------- */
    var clock = new THREE.Clock();
    var paused = false;
    var sparksSettled = false;

    function tick() {
      var dt = Math.min(clock.getDelta(), 0.05);
      var t = clock.elapsedTime;
      var reduced = reducedMotion.matches;

      updateScrollPush();
      var drag = skyDim;
      if (drag > 0.995) return; /* opaque chapters cover the sky — let the GPU rest */

      /* parallax */
      if (!reduced) {
        parallax.lerpX += (parallax.x * 0.55 - parallax.lerpX) * 0.045;
        parallax.lerpY += (parallax.y * 0.35 - parallax.lerpY) * 0.045;
      }
      camera.position.set(
        CAM_HOME.x + parallax.lerpX,
        CAM_HOME.y + parallax.lerpY * 0.6,
        CAM_HOME.z + drag * 2.6
      );
      camera.lookAt(0, drag * 1.2, 0);

      /* hover + cursor */
      var target = focused ? null : pickPage();
      if (target !== hovered) {
        hovered = target;
        document.body.style.cursor = hovered ? "pointer" : "auto";
      }

      for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var u = p.userData;
        if (!reduced) u.drift += dt * u.driftSpeed;

        if (p === focused) {
          /* brought to the light, just forward of camera */
          FOCUS_TMP.copy(FOCUS_OFFSET).applyMatrix4(camera.matrixWorld);
          p.rotation.copy(FOCUS_ROT);
          p.position.lerp(FOCUS_TMP, reduced ? 1 : 0.09);
          continue;
        }

        if (!reduced && p === hovered && pointerActive) {
          u.hover = Math.min(1, u.hover + 0.12);
        } else {
          u.hover = Math.max(0, u.hover - 0.08);
        }
        var press = u.hover;

        p.position.set(
          u.home.x + Math.sin(u.drift) * 0.16,
          u.home.y + Math.cos(u.drift * 1.3) * 0.12 + press * 0.28,
          u.home.z + press * 0.5
        );
        if (!reduced) {
          /* only rotation.z animates: it spins the sheet within its own
             plane, which cannot move it into another depth layer */
          p.rotation.z = u.homeRot.z + Math.sin(u.drift * 0.7) * 0.05;
          p.rotation.x = u.homeRot.x;
          p.rotation.y = u.homeRot.y;
        } else {
          p.rotation.copy(u.homeRot);
        }
      }

      if (reduced) {
        if (!sparksSettled) { updateSparks(0); sparksSettled = true; }
      } else {
        updateSparks(t);
      }

      renderer.render(scene, camera);
    }

    document.addEventListener("visibilitychange", function () {
      paused = document.hidden;
      if (!paused) clock.getDelta(); /* swallow the gap */
    });

    var rafId = 0;
    function rafLoop() {
      rafId = requestAnimationFrame(rafLoop);
      if (!paused && !manualPaused) tick();
    }
    rafLoop();

    /* ---------- resize ---------- */
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      CAM_HOME.z = isSmall.matches ? 9.4 : 7.4;
      assignHomes();
    }
    window.addEventListener("resize", onResize);
    if (isSmall.addEventListener) isSmall.addEventListener("change", onResize);

  }).catch(function (err) {
    docEl.classList.add("no-webgl");
    if (window.console) console.warn("IdeaCraft sky disabled:", err && err.message);
  });

})();
