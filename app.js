/* ============================================================
   maxschwarz.digital — Desktop-Metapher
   Alle sichtbaren Projekttexte stammen aus projects.json.
   ============================================================ */
(function () {
  "use strict";

  var desktop = document.getElementById("desktop");
  var iconLayer = document.getElementById("icons");
  var windowLayer = document.getElementById("windows");
  var live = document.getElementById("live");

  /* ANKERPUNKTE (top %, left %) ----------------------------------------
     Bezogen auf das Streufeld, nicht auf die ganze Fläche. Gewollt ist
     ein locker gestreuter Schreibtisch: stellenweise dicht, stellenweise
     luftig, außen bleibt Rand frei. Die Werte sind handgesetzt und
     bewusst UNGLEICHMÄSSIG. Die mittlere Zone ist nach links und rechts
     aufgeteilt, weil im Wallpaper dort das Porträt sitzt. Eine
     Potenzkurve zieht die Punkte noch einmal leicht zur Mitte — eine
     sanfte Betonung, kein Sog.
     Sie legen nicht die Endposition fest, sondern den Startpunkt der
     Platzierung. Mehr Projekte als Paare: zyklisch weiter.
     -------------------------------------------------------------------- */
  var FIXED_POSITIONS = [
    // obere Zone
    [ 8, 12], [ 5, 34], [14, 24], [10, 52], [ 6, 70],
    [16, 62], [12, 86], [22, 44], [20, 78], [26,  8],
    // mittlere Zone — bewusst links und rechts, die Mitte bleibt frei
    [38, 10], [46, 26], [34, 74], [44, 90], [56, 16], [52, 80],
    // untere Zone
    [70, 30], [66, 56], [78, 12], [74, 70], [86, 44]
  ];

  // Zieht einen Prozentwert zur Mitte: aus gleichmäßig wird mittendicht.
  function centerBias(value) {
    var d = (value - 50) / 50;                       // -1 … 1
    var pulled = Math.sign(d) * Math.pow(Math.abs(d), 1.15);
    return 50 + pulled * 50;
  }

  /* MASSE ----------------------------------------------------------------
     Zwei Sätze, einer je Layout; die Werte müssen zu den CSS-Variablen
     passen (Desktop: :root, Mobil: der Mobil-Breakpoint). Mobil ist alles
     kleiner, und zusätzlich kommt FIELD_VH hinzu: die Streufläche ist dort
     ein Vielfaches der Viewporthöhe und scrollt senkrecht — bei 21
     Projekten auf 390 px Breite wäre eine Fläche in Viewporthöhe zu eng,
     die Spiralsuche fände für einen Teil keinen regelkonformen Platz.
     ---------------------------------------------------------------------- */
  var DESKTOP_CFG = {
    ICON_W: 134, COVER_MAX: 92, COVER_MIN: 40,
    EDGE: 20, DOCK_RESERVE: 120, PAD: 4,
    CLUSTER_W: 0.78, CLUSTER_H: 0.82,
    FIELD_VH: 0,          // 0 = genau die Viewporthöhe, kein Scrollen
    AVOID_FACE: true
  };
  var MOBILE_CFG = {
    ICON_W: 114, COVER_MAX: 68, COVER_MIN: 32,
    EDGE: 10, DOCK_RESERVE: 96, PAD: 6,
    /* Fast die ganze Fläche nutzen: auf 390 px Breite ist jeder Prozent
       Rand teuer, und die Anker sollen über die GESAMTE Scrollhöhe
       verteilt sein, nicht in deren Mitte zusammenrücken. */
    CLUSTER_W: 0.98, CLUSTER_H: 0.99,
    FIELD_VH: 1.8,
    /* Die Freihaltezone um das Gesicht ist mobil sinnlos: der Hintergrund
       STEHT (fixierte Ebene), die Icons wandern beim Scrollen darüber
       hinweg. Eine Lücke an einer festen Stelle der Scrollfläche läge
       daher je nach Scrollposition irgendwo — nur nicht zuverlässig auf
       dem Gesicht. */
    AVOID_FACE: false
  };

  function cfg() { return mobileLayout() ? MOBILE_CFG : DESKTOP_CFG; }

  var DOCK_RESERVE = DESKTOP_CFG.DOCK_RESERVE;  // nur noch fuer das Fenster-Dragging
  /* Ein Label darf höchstens zu diesem Anteil seiner Fläche verdeckt
     sein. Die Vorgabe war 25 %, das hat sich als zu viel erwiesen: eine
     Verdeckung am Rand frisst dort ein ganzes Wort — "STRUNK" las sich
     als "TRUNK". 8 % lassen die Überlappung weiterhin sichtbar zu, ohne
     dass Text verlorengeht, und kosten nachweislich keine Streuung
     (Breite des Haufens bleibt bei 60 %). */
  var MAX_LABEL_COVER = 0.08;

  /* Der gerade gültige Maßsatz. Wird in layoutIcons() (und einmal beim
     Aufbau) gesetzt, damit boxFromNatural() und fitsHere() nicht jedes Mal
     die Media Queries abfragen müssen. */
  var ACTIVE = DESKTOP_CFG;

  /* Das Wallpaper trägt ein Porträt. Dieser Bereich wird weitgehend
     freigehalten, damit der Haufen nicht auf dem Gesicht liegt. Angaben
     als Anteil des VIEWPORTS. Die Zone deckt Gesicht und Kinnpartie ab
     (y 37–79 %); Kappe und Stirn darüber dürfen überlagert werden.
     Die Freihaltung ist kein hartes Verbot: FACE_GUESTS Icons
     dürfen hineinragen, sonst wirkte die Fläche wie ausgestanzt statt
     wie ein Hintergrund, der durchscheint. */
  var FACE_W = 0.26;
  var FACE_H = 0.42;
  var FACE_CY = 0.58;
  var FACE_GUESTS = 2;     // so viele Icons dürfen trotzdem hineinragen
  var EPS = 0.5;

  var projects = [];
  /* Viewport-Signatur des letzten Layouts: Breite und Ausrichtung. Nur
     deren Änderung rechtfertigt ein Neulayout (siehe resize-Handler). */
  var lastLayoutW = null;
  var lastLayoutPortrait = null;
  var selected = null;
  var openWindows = [];  // in Stapelreihenfolge, letztes = oberstes
  var zTop = 50;
  var cascade = 0;

  // Mobil: gleiche Streuung, kleinere Masse, scrollende Flaeche; Fenster als Vollbild-Sheet.
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* SCROLL-SPERRE ---------------------------------------------------------
     Mobil ist NICHT <body> der Scroller, sondern <html> (siehe
     Mobil-Breakpoint: `html, body { height:auto; overflow-y:auto }`).
     `body.style.overflow = "hidden"` allein blieb deshalb wirkungslos, der
     Desktop scrollte hinter dem Sheet weiter — und jedes Ein-/Ausfahren von
     Safaris Adressleiste löste ein `resize` aus. Gesperrt wird daher auf
     BEIDEN Elementen; die Scrollposition wird gemerkt und beim Freigeben
     wiederhergestellt, weil `overflow:hidden` auf dem Scroller sie
     verwirft.
     ---------------------------------------------------------------------- */
  var scrollLockY = 0;
  var scrollLocked = false;

  function lockScroll() {
    if (scrollLocked) return;
    scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    scrollLocked = true;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  function unlockScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    /* Layout erzwingen, BEVOR zurückgesprungen wird: solange der Scroller
       noch als `overflow:hidden` gilt, ist seine Scrollhöhe 0 und
       scrollTo() landet wirkungslos bei 0. */
    void document.documentElement.scrollHeight;
    window.scrollTo(0, scrollLockY);
  }

  /* STABILE VIEWPORTHÖHE --------------------------------------------------
     Die mobile Streufläche ist ein Vielfaches der Viewporthöhe. Würde sie
     live aus `window.innerHeight` gerechnet, änderte sie sich bei jedem
     Ein-/Ausfahren der Adressleiste (gemessen: 85 px, alle Icons wandern).
     Gemessen wird daher EINMAL je Ausrichtung/Breite über ein unsichtbares
     Element mit `height: 100dvh`; der Wert wird gecacht und bei reinen
     Höhenänderungen nicht neu erhoben. Dadurch bleibt die Platzierung
     deterministisch.
     ---------------------------------------------------------------------- */
  var dvhProbe = null;
  var vhCache = Object.create(null);

  function portraitNow() {
    return window.matchMedia("(orientation: portrait)").matches;
  }

  function stableViewportHeight() {
    var key = (portraitNow() ? "p" : "l") + ":" + document.documentElement.clientWidth;
    if (vhCache[key] != null) return vhCache[key];

    if (!dvhProbe) {
      dvhProbe = document.createElement("div");
      dvhProbe.setAttribute("aria-hidden", "true");
      dvhProbe.style.cssText =
        "position:fixed;top:0;left:0;width:0;height:100dvh;" +
        "visibility:hidden;pointer-events:none;z-index:-1;";
      document.body.appendChild(dvhProbe);
    }
    var h = Math.round(dvhProbe.getBoundingClientRect().height) || window.innerHeight;
    vhCache[key] = h;
    return h;
  }

  function mobileLayout() {
    return window.matchMedia("(max-width: 760px)").matches ||
           window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches ||
           // Flache Viewports (Querformat): zu wenig Höhe für die Streuung.
           window.matchMedia("(max-height: 520px)").matches;
  }

  /* ---------------------------------------------- Icon-Positionierung */

  // Thumbnail-Box im ECHTEN Seitenverhältnis des ersten Bildes.
  /* Das kuratierte Cover bringt keine Maße mit, deshalb wird die Box aus
     der NATÜRLICHEN Bildgröße gebildet, sobald das Bild geladen ist. Bis
     dahin steht eine quadratische Platzhalterbox; danach läuft das Layout
     einmal neu. So bleibt die Darstellung unbeschnitten und die Formate
     (Querformat, Poster, Cover) bleiben unterscheidbar.
     ---------------------------------------------------------------------- */
  function boxFromNatural(nw, nh) {
    var c = ACTIVE;
    if (!nw || !nh) return { w: c.COVER_MAX, h: c.COVER_MAX };
    var long = Math.max(nw, nh);
    var w = Math.round(nw / long * c.COVER_MAX);
    var h = Math.round(nh / long * c.COVER_MAX);
    // Sehr flache Motive bekommen eine Mindesthöhe; damit die Proportion
    // dabei nicht kippt, wird die andere Seite mitskaliert und danach auf
    // die Zellenbreite begrenzt.
    if (h < c.COVER_MIN) { w = Math.round(w * c.COVER_MIN / h); h = c.COVER_MIN; }
    if (w < c.COVER_MIN) { h = Math.round(h * c.COVER_MIN / w); w = c.COVER_MIN; }
    if (w > c.ICON_W) { h = Math.round(h * c.ICON_W / w); w = c.ICON_W; }
    return { w: w, h: h };
  }

  function applyThumbBox(thumb, img) {
    // Natürliche Maße merken: beim Wechsel des Layouts (Drehen, Resize
    // über den Breakpoint) wird die Box daraus neu gerechnet.
    thumb._nw = img.naturalWidth;
    thumb._nh = img.naturalHeight;
    var size = boxFromNatural(img.naturalWidth, img.naturalHeight);
    thumb.style.width = size.w + "px";
    thumb.style.height = size.h + "px";
    // Erst jetzt wird das Bild sichtbar und bekommt seinen Schatten —
    // vorher bleibt die Zelle leer, es gibt also kein graues Rechteck.
    thumb.classList.add("is-loaded");
  }

  // Alle bereits geladenen Thumbnails auf den aktuellen Maßsatz bringen.
  function resizeThumbs() {
    iconLayer.querySelectorAll(".icon__thumb").forEach(function (thumb) {
      if (!thumb._nw || !thumb._nh) return;
      var size = boxFromNatural(thumb._nw, thumb._nh);
      thumb.style.width = size.w + "px";
      thumb.style.height = size.h + "px";
    });
  }

  // Nach dem Laden der Cover einmal neu anordnen (gebündelt).
  var relayoutTimer;
  function scheduleRelayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(layoutIcons, 60);
  }

  /* ENTSPANNUNGSSCHLEIFE -------------------------------------------------
     Die feste Positionsliste kennt die Bildformate nicht und erzeugt
     deshalb Überlappungen. Sie dient daher nur noch als ANKER: Jedes Icon
     startet auf seinem Ankerpunkt, danach schieben sich überlappende
     Icons entlang der kürzeren Überschneidungsachse auseinander, während
     eine schwache Feder jedes Icon zu seinem Anker zurückzieht — die
     gewollte Streuung bleibt so erhalten. Gerechnet wird auf der VOLLEN
     Box aus Thumbnail und Label plus PAD. Komplett deterministisch, kein
     Math.random.
     -------------------------------------------------------------------- */
  /* PLATZIERUNG -----------------------------------------------------------
     Die Icons werden der Reihe nach gesetzt: jedes sucht von seinem Anker
     aus auf einer Spirale nach außen den NÄCHSTEN Platz, der die Regeln
     einhält. Das Verfahren ist deterministisch (feste Ankerliste, feste
     Richtungen, feste Schrittweite), terminiert immer und braucht keine
     Iteration, die sich festfahren kann.

     Zwei unterschiedlich strenge Regeln:
     1. THUMBNAILS überlappen sich GAR NICHT; zwischen ihnen bleiben PAD
        Pixel Luft. Keine Arbeit verdeckt eine andere.
     2. LABELS dürfen sich leicht überlappen — aber ein Label darf INSGESAMT
        höchstens MAX_LABEL_COVER seiner Fläche von fremden Labels und
        Thumbnails verdeckt sein. Gerechnet wird kumulativ, nicht je Paar:
        sonst könnten drei Nachbarn zusammen ein Label fast zudecken.
     ------------------------------------------------------------------------ */

  // Thumbnail-Rechteck einer Box: oben, horizontal mittig.
  function thumbRect(box) {
    return { x: box.x + (box.w - box.tw) / 2, y: box.y, w: box.tw, h: box.th };
  }

  // Label-Rechteck: unten, horizontal mittig.
  function labelRect(box) {
    return {
      x: box.x + (box.w - box.lw) / 2,
      y: box.y + box.h - box.lh,
      w: box.lw,
      h: box.lh
    };
  }

  function intersectArea(a, b) {
    var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox > 0 && oy > 0) ? ox * oy : 0;
  }

  function overlapsWithPad(a, b, pad) {
    return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + pad > EPS &&
           Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + pad > EPS;
  }

  function clampBox(box, b) {
    box.x = Math.min(Math.max(box.x, b.x), b.x + b.w - box.w);
    box.y = Math.min(Math.max(box.y, b.y), b.y + b.h - box.h);
  }

  function insideFace(box, face) {
    return face ? intersectArea(thumbRect(box), face) > 0 : false;
  }

  /* Passt die Box an ihrer aktuellen Position neben alle bereits
     gesetzten? Liefert die Verdeckungsbeiträge mit zurück, damit der
     Aufrufer sie nach dem Zuschlag verbuchen kann. */
  function fitsHere(box, placed) {
    var tb = thumbRect(box), lb = labelRect(box);
    var ownCover = 0;
    var added = [];

    for (var i = 0; i < placed.length; i++) {
      var other = placed[i];
      var to = thumbRect(other), lo = labelRect(other);

      // Regel 1: Thumbnails berühren sich nicht.
      if (overlapsWithPad(tb, to, ACTIVE.PAD)) return null;

      // Regel 2a: wie viel verdecken die anderen MEIN Label?
      ownCover += intersectArea(lb, lo) + intersectArea(lb, to);

      // Regel 2b: wie viel verdecke ICH von deren Label?
      var onOther = intersectArea(lo, lb) + intersectArea(lo, tb);
      if (other.cover + onOther > MAX_LABEL_COVER * lo.w * lo.h) return null;
      added.push({ box: other, area: onOther });
    }

    if (ownCover > MAX_LABEL_COVER * lb.w * lb.h) return null;
    return { cover: ownCover, added: added };
  }

  /* Spiralsuche ab dem Anker. Schrittweite SEARCH_STEP, SEARCH_DIRS
     Richtungen, die mit wachsendem Radius leicht mitdrehen — dadurch
     entstehen keine sichtbaren Speichen. */
  var SEARCH_STEP = 6;
  var SEARCH_DIRS = 16;
  var SEARCH_MAX = 900;

  function placeBox(box, placed, bounds, face, mayEnterFace) {
    for (var pass = 0; pass < 2; pass++) {
      // Erster Durchgang meidet die Gesichtszone, der zweite erlaubt sie —
      // sonst fände ein eingekreistes Icon gar keinen Platz.
      var avoidFace = (pass === 0) && !mayEnterFace;

      for (var r = 0; r <= SEARCH_MAX; r += SEARCH_STEP) {
        var steps = (r === 0) ? 1 : SEARCH_DIRS;
        for (var k = 0; k < steps; k++) {
          var angle = (k / SEARCH_DIRS) * Math.PI * 2 + r * 0.11;
          box.x = box.ax + Math.cos(angle) * r;
          box.y = box.ay + Math.sin(angle) * r;
          clampBox(box, bounds);

          if (avoidFace && insideFace(box, face)) continue;

          var fit = fitsHere(box, placed);
          if (fit) {
            box.cover = fit.cover;
            fit.added.forEach(function (entry) { entry.box.cover += entry.area; });
            return true;
          }
        }
      }
    }
    // Nichts gefunden: auf dem Anker stehen lassen (kommt bei dieser
    // Projektzahl nicht vor, ist aber die ehrliche Rückfallebene).
    box.x = box.ax; box.y = box.ay;
    clampBox(box, bounds);
    return false;
  }

  function layoutIcons() {
    if (!projects.length) return;

    var mobile = mobileLayout();
    ACTIVE = cfg();
    var c = ACTIVE;
    // Thumbnails erst auf den Maßsatz bringen, dann messen und platzieren.
    resizeThumbs();

    /* FLÄCHE ------------------------------------------------------------
       Desktop: genau der Viewport, die Seite scrollt nicht.
       Mobil: die Breite bleibt die Viewportbreite (waagerecht wird NICHT
       gescrollt), die Höhe ist ein Vielfaches davon und wird hier auf
       #icons gesetzt — daraus entsteht die senkrechte Scrollfläche. */
    var W, H;
    if (mobile) {
      W = document.documentElement.clientWidth;
      H = Math.round(stableViewportHeight() * c.FIELD_VH);
      iconLayer.style.height = H + "px";
    } else {
      iconLayer.style.height = "";
      W = desktop.clientWidth;
      H = desktop.clientHeight;
    }

    // Harte Grenze: kein Icon über den Rand, keines unter das Dock.
    var bounds = {
      x: c.EDGE, y: c.EDGE,
      w: Math.max(c.ICON_W, W - 2 * c.EDGE),
      h: Math.max(80, H - c.EDGE - c.DOCK_RESERVE)
    };

    // Streufeld, in dem die Anker liegen.
    var field = { w: bounds.w * c.CLUSTER_W, h: bounds.h * c.CLUSTER_H };
    field.x = bounds.x + (bounds.w - field.w) / 2;
    field.y = bounds.y + (bounds.h - field.h) / 2;

    // Freizuhaltende Gesichtszone, bezogen auf den Viewport. Mobil ohne.
    var face = null, faceCx = 0, faceCy = 0;
    if (c.AVOID_FACE) {
      face = { w: W * FACE_W, h: H * FACE_H };
      face.x = W / 2 - face.w / 2;
      face.y = H * FACE_CY - face.h / 2;
      faceCx = face.x + face.w / 2;
      faceCy = face.y + face.h / 2;
    }

    var boxes = projects.map(function (p, i) {
      var pos = FIXED_POSITIONS[i % FIXED_POSITIONS.length];
      var el = p._icon;
      var thumb = el.querySelector(".icon__thumb");
      var label = el.querySelector(".icon__label");
      var box = {
        w: el.offsetWidth || c.ICON_W,
        h: el.offsetHeight || 140,
        tw: (thumb && thumb.offsetWidth) || c.COVER_MAX,
        th: (thumb && thumb.offsetHeight) || c.COVER_MAX,
        lw: (label && label.offsetWidth) || 100,
        lh: (label && label.offsetHeight) || 30,
        cover: 0
      };
      box.ax = field.x + field.w * centerBias(pos[1]) / 100 - box.w / 2;
      box.ay = field.y + field.h * centerBias(pos[0]) / 100 - box.h / 2;
      box.x = box.ax;
      box.y = box.ay;
      return box;
    });

    /* Die FACE_GUESTS Icons mit dem anker-nächsten Abstand zur
       Gesichtsmitte dürfen hineinragen. Ohne sie wirkte die freie Fläche
       wie ausgestanzt statt wie ein Hintergrund, der durchscheint. */
    var guests = !face ? [] : boxes.slice()
      .sort(function (p, q) {
        return Math.hypot(p.ax - faceCx, p.ay - faceCy) -
               Math.hypot(q.ax - faceCx, q.ay - faceCy);
      })
      .slice(0, FACE_GUESTS);

    var placed = [];
    var unplaced = 0;
    boxes.forEach(function (box) {
      if (!placeBox(box, placed, bounds, face, guests.indexOf(box) > -1)) unplaced++;
      placed.push(box);
    });

    projects.forEach(function (p, i) {
      p._icon.style.transform = "none";
      p._icon.style.left = Math.round(boxes[i].x) + "px";
      p._icon.style.top = Math.round(boxes[i].y) + "px";
    });

    // Für die Selbstprüfung von außen nachvollziehbar machen.
    iconLayer.dataset.layout = unplaced ? "scattered-partial" : "scattered";

    // Signatur merken: nur Breite und Ausrichtung lösen ein Neulayout aus.
    lastLayoutW = document.documentElement.clientWidth;
    lastLayoutPortrait = portraitNow();
  }

  /* ---------------------------------------------- Hilfen */

  // Bild für die Vorschau-Kachel: erstes Item mit Thumbnail (Videos haben
  // inzwischen ebenfalls eines), sonst das erste Bild.
  /* Das Desktop-Icon und die Fenster-Kopfzeile zeigen IMMER das kuratierte
     Titelbild aus p.cover — nicht mehr das erste Element aus items. Fehlt
     es, fällt der Code auf das erste Bild zurück, damit nichts leer bleibt. */
  function coverSource(p) {
    if (p.cover && (p.cover.thumb || p.cover.file)) return p.cover;
    for (var i = 0; i < p.items.length; i++) {
      if (p.items[i].thumb || p.items[i].type === "image") return p.items[i];
    }
    return null;
  }

  // Cover-Element oder neutraler Glyph, wenn es gar kein Bild gibt.
  function coverElement(p, alt) {
    var item = coverSource(p);
    if (!item) {
      var glyph = document.createElement("span");
      glyph.className = "icon__glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = "▣";
      return glyph;
    }
    var el = document.createElement("img");
    /* ICON-FASSUNG zuerst: `cover.icon` ist die 220-px-Variante, genau für
       diese Darstellung (~92 px, mobil ~68 px) gerechnet. Davor lief hier
       das 600-px-Thumbnail durch — dieselbe Fläche, aber das Vierfache an
       Bytes. Rückfall auf `thumb`, dann auf die Vollgrafik, damit ein
       Datensatz ohne Icon-Fassung nichts kaputt macht.
       Die Kacheln im Fenster nutzen weiterhin `thumb`, die Großansicht
       weiterhin `file` — hier ändert sich nur die kleinste Stufe. */
    el.src = item.icon || item.thumb || item.file;
    el.alt = alt === undefined ? (item.name || "") : alt;
    // Cover NICHT lazy: sie liegen absolut positioniert auf dem Desktop
    // und blieben sonst beim ersten Paint als leere Kacheln stehen.
    el.loading = "eager";
    el.decoding = "async";
    el.setAttribute("fetchpriority", "low");
    return el;
  }

  /* Formatgruppen in der Reihenfolge ihres ERSTEN Vorkommens; die Items
     selbst bleiben in der Reihenfolge aus projects.json. */
  function groupByFormat(items) {
    var order = [], map = Object.create(null);
    items.forEach(function (item) {
      var f = item.format || "";
      if (!map[f]) { map[f] = []; order.push(f); }
      map[f].push(item);
    });
    return order.map(function (f) { return { format: f, items: map[f] }; });
  }

  // Umfangszeile: Formate mit Anzahl, rein aus den Daten.
  function scopeLine(items) {
    return groupByFormat(items).map(function (g) {
      return (g.format || "–") + " " + g.items.length;
    }).join(", ");
  }

  // Sichtbarer Hinweis auf der Desktop-Fläche (Ladefehler, leere Liste).
  function showNotice(text) {
    var box = document.createElement("p");
    box.className = "notice";
    box.textContent = text;
    iconLayer.appendChild(box);
    live.textContent = text;
  }

  /* ---------------------------------------------- Icons bauen */

  function buildIcons() {
    var frag = document.createDocumentFragment();

    // Tab-Reihenfolge soll der sichtbaren Anordnung folgen, nicht der
    // Reihenfolge in projects.json: grob nach Zeile (y), dann nach x.
    var visualOrder = projects.slice().sort(function (a, b) {
      var pa = FIXED_POSITIONS[a._index % FIXED_POSITIONS.length];
      var pb = FIXED_POSITIONS[b._index % FIXED_POSITIONS.length];
      return (pa[0] - pb[0]) || (pa[1] - pb[1]);
    });

    visualOrder.forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon";
      // Auswahl als Umschaltzustand — die native Button-Rolle bleibt.
      btn.setAttribute("aria-pressed", "false");

      var thumb = document.createElement("span");
      thumb.className = "icon__thumb";
      /* Platzhalterbox, bis die echte Proportion des Covers bekannt ist.
         Sie ist LEER (CSS blendet das Bild bis `is-loaded` aus und lässt
         den Schatten weg) — es bleibt also kein graues Rechteck zurück. */
      thumb.style.width = ACTIVE.COVER_MAX + "px";
      thumb.style.height = ACTIVE.COVER_MAX + "px";

      var cover = coverElement(p);
      thumb.appendChild(cover);
      if (cover.tagName === "IMG") {
        if (cover.complete && cover.naturalWidth) {
          applyThumbBox(thumb, cover);
        } else {
          cover.addEventListener("load", function () {
            applyThumbBox(thumb, cover);
            scheduleRelayout();
          }, { once: true });
        }
      }

      var label = document.createElement("span");
      label.className = "icon__label";
      label.textContent = p.title;

      btn.appendChild(thumb);
      btn.appendChild(label);

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        select(p);
        // Pro Ereignis entscheiden: per Finger genügt ein Tap, mit Maus
        // selektiert der einfache Klick nur.
        if (e.pointerType === "touch" || mobileLayout()) openWindow(p, btn);
      });
      btn.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        openWindow(p, btn);
      });
      btn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(p);
          openWindow(p, btn);
        }
      });

      p._icon = btn;
      frag.appendChild(btn);
    });

    iconLayer.appendChild(frag);
  }

  function select(p) {
    if (selected && selected._icon) selected._icon.setAttribute("aria-pressed", "false");
    selected = p;
    if (p) p._icon.setAttribute("aria-pressed", "true");
  }

  /* ---------------------------------------------- Fenster */

  // Gemeinsames Fenster-Gerüst: Titelleiste, Ampeln, leerer Inhaltsbereich.
  function buildWindow(key, titleText, opener, extraClass) {
    var win = document.createElement("section");
    win.className = "window" + (extraClass ? " " + extraClass : "");
    win.key = key;
    win.opener = opener || null;
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "false");
    win.tabIndex = -1;

    var titleId = "win-title-" + key;
    win.setAttribute("aria-labelledby", titleId);

    win.innerHTML =
      '<div class="titlebar">' +
        '<div class="titlebar__row">' +
          '<div class="lights">' +
            '<button class="light light--close" type="button" aria-label="Fenster schließen"></button>' +
            '<button class="light light--min" type="button" disabled aria-hidden="true" tabindex="-1"></button>' +
            '<button class="light light--zoom" type="button" disabled aria-hidden="true" tabindex="-1"></button>' +
          "</div>" +
          '<h2 class="titlebar__title" id="' + titleId + '"></h2>' +
        "</div>" +
        '<span class="titlebar__rule"></span>' +
      "</div>" +
      '<div class="window__body"></div>';

    // Alle Daten per DOM-API, nie per String-Konkatenation: Titel und
    // Dateinamen können Anführungszeichen oder < enthalten.
    win.querySelector(".titlebar__title").textContent = "Information about: " + titleText;

    // Treppenförmig versetzt platzieren.
    var offset = (cascade % 6) * 26;
    cascade++;
    win.style.left = Math.max(12, Math.round(desktop.clientWidth * 0.22) + offset) + "px";
    win.style.top = 40 + offset + "px";

    win.querySelector(".light--close").addEventListener("click", function (e) {
      e.stopPropagation();
      closeWindow(win);
    });
    // Ein Listener für Maus, Stift und Finger: bringt das Fenster nach vorn.
    win.addEventListener("pointerdown", function () { focusWindow(win); });

    makeDraggable(win, win.querySelector(".titlebar"));
    return win;
  }

  function mountWindow(win, announce) {
    windowLayer.appendChild(win);
    openWindows.push(win);
    focusWindow(win);
    win.focus();
    // Mobil deckt das Sheet die ganze Fläche ab — der Desktop darf
    // dahinter nicht weiterscrollen.
    if (mobileLayout()) lockScroll();
    live.textContent = announce;
  }

  // Bereits offenes Fenster mit diesem Schlüssel nach vorn holen.
  function raiseExisting(key) {
    var existing = openWindows.find(function (w) { return w.key === key; });
    if (existing) { focusWindow(existing); return true; }
    return false;
  }

  /* KACHELN ---------------------------------------------------------------
     Im Fenster steht die ÜBERSICHT: kleine Kacheln aus der thumb-Datei
     (600 px, schnell). Das Großbild kommt auf Klick aus der file-Datei
     (1600 px). Jede Kachel ist ein Button und meldet sich mit ihrem Index
     in der Quick-Look-Liste des Fensters an, damit die Pfeiltasten in
     derselben Reihenfolge blättern, in der die Kacheln im Fenster stehen.
     ------------------------------------------------------------------------ */

  // Bildelement mit ruhigem Platzhalterton, der nach dem Laden verschwindet.
  function pictureElement(src, alt) {
    var img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("load", function () {
      if (img.parentElement) img.parentElement.classList.add("is-loaded");
    }, { once: true });
    return img;
  }

  function tileElement(item, win) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";

    /* INTRINSISCHE HÖHE ----------------------------------------------------
       Mobil haben die Kacheln keine feste Höhe mehr (sonst würden hohe
       Formate beschnitten), sondern das Seitenverhältnis der Datei. Das muss
       SCHON VOR dem Laden bekannt sein: eine Kachel ohne Höhe ist 0 px hoch,
       käme damit nie in den Sichtbereich, und ein `loading="lazy"`-Bild in
       einer 0-px-Kachel würde nie geladen — die Kachel bliebe für immer leer.
       Die Maße stehen in projects.json (87 von 89 Dateien). Übergeben wird
       das als Custom Property, nicht als `aspect-ratio`: das Feed-Raster
       setzt sein eigenes, gemeinsames Verhältnis und darf hiervon nicht
       überschrieben werden. */
    var hasRatio = item.width && item.height;
    if (hasRatio) btn.style.setProperty("--tile-ratio", item.width + " / " + item.height);

    if (item.type === "video") {
      // Stumme Endlosvorschau; der Klick führt in die Großansicht, wo das
      // Video mit Bedienelementen und Ton läuft.
      var v = document.createElement("video");
      v.src = item.file;
      if (item.poster) v.poster = item.poster;
      v.autoplay = true;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "auto";
      v.setAttribute("aria-hidden", "true");
      btn.appendChild(v);
      btn.classList.add("is-loaded");
      btn.setAttribute("aria-label", item.name + " — Großansicht öffnen");
    } else {
      var tileImg = pictureElement(item.thumb || item.file, item.name);
      /* Zwei Dateien (eine SVG) bringen keine Maße mit. Ohne Verhältnis
         wäre die Kachel mobil 0 px hoch und das lazy-Bild würde nie laden —
         also lädt es hier sofort und bestimmt die Höhe selbst. */
      if (!hasRatio) tileImg.loading = "eager";
      btn.appendChild(tileImg);
      btn.setAttribute("aria-label", item.name + " — Großansicht öffnen");
    }

    var index = win.qlItems.length;
    win.qlItems.push(item);
    btn.addEventListener("click", function () { openQuickLook(win, index, btn); });

    return btn;
  }

  // "1.0" → "Slide 1", "2.2" → "Slide 2.2"
  function slideLabel(value) {
    var text = String(value).replace(/\.0$/, "");
    return "Slide " + text;
  }

  /* FEED-RASTER ----------------------------------------------------------
     Drei gleich breite Spalten mit minimalem Abstand — so, wie das Raster
     später im Profil steht. `spalte` bestimmt die Spalte, die Position
     innerhalb der Spalte die Zeile. Alle Kacheln bekommen dasselbe
     Seitenverhältnis (aus dem ersten Item der Gruppe), damit die Reihen
     sauber abschließen und nicht ausfransen.
     Mehrere Slides in einer Spalte werden beschriftet; tragen alle
     Einträge einer Spalte denselben Slide-Wert, sind es Varianten und es
     wird nicht beschriftet.
     ---------------------------------------------------------------------- */
  function renderFeedGrid(items, win) {
    var grid = document.createElement("div");
    grid.className = "feedgrid";

    var first = items[0];
    if (first && first.width && first.height) {
      grid.style.setProperty("--feed-ratio", first.width + " / " + first.height);
    }

    // Spaltenzuordnung und Slide-Beschriftung vorab bestimmen.
    var rowOf = [0, 0, 0];
    var perColumn = [[], [], []];
    items.forEach(function (item, i) {
      var col = typeof item.spalte === "number" ? item.spalte : i % 3;
      perColumn[Math.max(0, Math.min(2, col))].push(item);
    });
    var labelColumn = perColumn.map(function (colItems) {
      var distinct = {};
      colItems.forEach(function (it) { distinct[it.slide] = true; });
      return Object.keys(distinct).length > 1;
    });

    items.forEach(function (item, i) {
      var col = typeof item.spalte === "number" ? item.spalte : i % 3;
      col = Math.max(0, Math.min(2, col));

      var cell = document.createElement("div");
      cell.className = "feedgrid__cell";
      cell.style.gridColumn = String(col + 1);
      cell.style.gridRow = String(rowOf[col] + 1);
      rowOf[col]++;

      cell.appendChild(tileElement(item, win));

      if (labelColumn[col] && item.slide !== undefined) {
        var tag = document.createElement("span");
        tag.className = "slidetag";
        tag.textContent = slideLabel(item.slide);
        cell.appendChild(tag);
      }
      grid.appendChild(cell);
    });

    return grid;
  }

  // DJ-Karten: kompaktes Raster, damit die Karte pro Act auf einen Blick
  // erkennbar ist.
  function renderCardGrid(items, win) {
    var grid = document.createElement("div");
    grid.className = "cardgrid";
    items.forEach(function (item) { grid.appendChild(tileElement(item, win)); });
    return grid;
  }

  /* Alle übrigen Formate ebenfalls als Raster statt über die volle Breite —
     sonst wird aus einer Kampagne mit vielen Teilen ein Scroll-Marathon. */
  function renderTileGrid(items, win) {
    var grid = document.createElement("div");
    grid.className = "tilegrid";
    items.forEach(function (item) { grid.appendChild(tileElement(item, win)); });
    return grid;
  }

  function openWindow(p, opener) {
    // Schlüssel ist die laufende Nummer, nicht der Slug — Slugs können in
    // den Daten doppelt vorkommen.
    var key = "project-" + p._id;
    if (raiseExisting(key)) return;

    var win = buildWindow(key, p.title, opener);
    var body = win.querySelector(".window__body");
    // Sammelt die Items in genau der Reihenfolge, in der ihre Kacheln im
    // Fenster stehen — danach blättert die Großansicht.
    win.qlItems = [];

    body.innerHTML =
      '<div class="infohead">' +
        '<div class="infohead__thumb"></div>' +
        "<div>" +
          '<div class="infohead__name"></div>' +
          '<div class="infohead__scope"></div>' +
        "</div>" +
      "</div>";

    body.querySelector(".infohead__name").textContent = p.title;
    body.querySelector(".infohead__scope").textContent = scopeLine(p.items);
    body.querySelector(".infohead__thumb").appendChild(coverElement(p, ""));

    groupByFormat(p.items).forEach(function (group) {
      var section = document.createElement("section");
      section.className = "formatgroup";

      var head = document.createElement("h3");
      head.className = "formatgroup__head";
      head.textContent = (group.format || "–") + " (" + group.items.length + ")";
      section.appendChild(head);

      if (group.format === "Feed-Raster") {
        section.appendChild(renderFeedGrid(group.items, win));
      } else if (group.format === "DJ-Karten") {
        section.appendChild(renderCardGrid(group.items, win));
      } else {
        section.appendChild(renderTileGrid(group.items, win));
      }

      body.appendChild(section);
    });

    mountWindow(win, "Fenster geöffnet: " + p.title);
  }

  /* GROSSANSICHT (Quick Look) ---------------------------------------------
     Liegt über allem, zeigt das Bild vollständig und so groß wie möglich,
     blättert mit den Pfeiltasten durch alle Kacheln des Fensters und gibt
     den Fokus beim Schließen an die angeklickte Kachel zurück.
     ------------------------------------------------------------------------ */
  var quickLook = null;   // { el, win, index, opener, stage, ... }

  function quickLookOpen() { return quickLook !== null; }

  function openQuickLook(win, index, opener) {
    if (quickLook) closeQuickLook();

    var el = document.createElement("div");
    el.className = "quicklook";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Großansicht");

    el.innerHTML =
      '<button class="quicklook__close" type="button" aria-label="Großansicht schließen">×</button>' +
      /* Pfeil-Knöpfe: auf dem Desktop eine Bequemlichkeit, auf dem Handy
         die einzige Möglichkeit zu blättern — dort gibt es keine
         Pfeiltasten. Sie liegen über dem Grund, nicht über dem Bild. */
      '<button class="quicklook__nav quicklook__nav--prev" type="button" aria-label="Vorherige Datei">\u2039</button>' +
      '<button class="quicklook__nav quicklook__nav--next" type="button" aria-label="Nächste Datei">\u203a</button>' +
      '<div class="quicklook__stage"></div>' +
      '<div class="quicklook__bar">' +
        '<span class="quicklook__name"></span>' +
        '<span class="quicklook__meta"></span>' +
      "</div>";

    quickLook = {
      el: el,
      win: win,
      index: index,
      opener: opener,
      stage: el.querySelector(".quicklook__stage")
    };

    // Klick auf den abgedunkelten Grund schließt; Klicks auf das Bild oder
    // die Zeile darunter nicht.
    el.addEventListener("click", function (e) {
      /* Der Schließen-Knopf setzt quickLook auf null; derselbe Klick
         blubbert danach bis hierher weiter. Ohne diese Zeile liefe der
         Zugriff auf quickLook.stage in einen TypeError. */
      if (!quickLook) return;
      if (e.target === el || e.target === quickLook.stage) closeQuickLook();
    });
    el.querySelector(".quicklook__close").addEventListener("click", closeQuickLook);
    el.querySelector(".quicklook__nav--prev").addEventListener("click", function (e) {
      e.stopPropagation(); stepQuickLook(-1);
    });
    el.querySelector(".quicklook__nav--next").addEventListener("click", function (e) {
      e.stopPropagation(); stepQuickLook(1);
    });

    /* Wischen nach links/rechts blättert. Schwelle 45 px, und die
       waagerechte Strecke muss die senkrechte deutlich übertreffen —
       sonst löst schon ein Scrollversuch einen Bildwechsel aus. */
    var swipeX = 0, swipeY = 0, swiping = false;
    el.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { swiping = false; return; }
      swipeX = e.touches[0].clientX;
      swipeY = e.touches[0].clientY;
      swiping = true;
    }, { passive: true });
    el.addEventListener("touchend", function (e) {
      if (!swiping) return;
      swiping = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - swipeX, dy = t.clientY - swipeY;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      stepQuickLook(dx < 0 ? 1 : -1);
    }, { passive: true });

    document.body.appendChild(el);
    showQuickLookItem(index);
    el.querySelector(".quicklook__close").focus();
  }

  function showQuickLookItem(index) {
    var items = quickLook.win.qlItems;
    if (!items.length) return;
    // Umlaufend blättern.
    quickLook.index = (index + items.length) % items.length;

    var item = items[quickLook.index];
    var stage = quickLook.stage;
    stage.textContent = "";

    if (item.type === "video") {
      var v = document.createElement("video");
      v.src = item.file;
      if (item.poster) v.poster = item.poster;
      v.controls = true;        // in der Großansicht mit Ton und Bedienung
      v.autoplay = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute("aria-label", item.name);
      stage.appendChild(v);
    } else {
      // Großansicht nimmt die große Datei, nicht das Thumbnail.
      var img = document.createElement("img");
      img.src = item.file;
      img.alt = item.name;
      img.decoding = "async";
      stage.appendChild(img);
    }

    quickLook.el.querySelector(".quicklook__name").textContent = item.name;
    quickLook.el.querySelector(".quicklook__meta").textContent =
      (item.format || "–") + " · " + (quickLook.index + 1) + " / " + items.length;

    // Bei einer einzelnen Datei gibt es nichts zu blättern.
    var single = items.length < 2;
    quickLook.el.querySelectorAll(".quicklook__nav").forEach(function (b) {
      b.hidden = single;
    });
  }

  function stepQuickLook(delta) {
    if (quickLook) showQuickLookItem(quickLook.index + delta);
  }

  function closeQuickLook() {
    if (!quickLook) return;
    var opener = quickLook.opener;
    quickLook.el.remove();
    quickLook = null;
    if (opener && document.contains(opener)) opener.focus();
  }

  // Kleines Fenster mit genau einer Angabe (Dock-Skills).
  function openSkillWindow(name, line, opener) {
    var key = "skill-" + name;
    if (raiseExisting(key)) return;

    var win = buildWindow(key, name, opener, "window--skill");
    var para = document.createElement("p");
    para.className = "skill-line";
    para.textContent = line;
    win.querySelector(".window__body").appendChild(para);

    mountWindow(win, "Fenster geöffnet: " + name);
  }

  function focusWindow(win) {
    zTop++;
    win.style.zIndex = String(zTop);
    // Stapelreihenfolge aktualisieren: fokussiertes Fenster ans Ende.
    var i = openWindows.indexOf(win);
    if (i > -1) { openWindows.splice(i, 1); openWindows.push(win); }
  }

  function closeWindow(win) {
    var i = openWindows.indexOf(win);
    if (i > -1) openWindows.splice(i, 1);

    // Nichts soll im Hintergrund weiterlaufen.
    win.querySelectorAll("video").forEach(function (v) { v.pause(); });
    if (quickLook && quickLook.win === win) closeQuickLook();

    win.classList.add("window--closing");
    var remove = function () { win.remove(); };
    win.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, 500);   // Rückfall, falls die Animation ausfällt

    live.textContent = "Fenster geschlossen";

    var next = openWindows[openWindows.length - 1];
    if (next) {
      next.focus();
    } else {
      /* Reihenfolge ist wichtig: der Fokus wird NOCH IM gesperrten Zustand
         zurückgegeben, sonst scrollt der Browser das Icon beim Fokussieren
         von sich aus in den Sichtbereich und überschreibt die gemerkte
         Scrollposition. Erst danach wird freigegeben und zurückgesprungen. */
      if (win.opener && document.contains(win.opener)) win.opener.focus();
      unlockScroll();
    }
  }

  /* ---------------------------------------------- Drag per Titelleiste */

  function makeDraggable(win, handle) {
    handle.addEventListener("pointerdown", function (e) {
      // Ampel-Buttons nicht als Drag-Griff behandeln.
      if (e.target.closest(".light")) return;
      if (mobileLayout()) return;        // Sheets werden nicht verschoben
      if (e.button !== 0 && e.pointerType === "mouse") return;

      var rect = win.getBoundingClientRect();
      var dx = e.clientX - rect.left;
      var dy = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);

      function move(ev) {
        // Fenster im Viewport halten; die Titelleiste muss greifbar
        // bleiben, also auch nicht hinter dem Dock verschwinden.
        var maxLeft = window.innerWidth - 60;
        var maxTop = window.innerHeight - DOCK_RESERVE - 40;
        var left = Math.min(Math.max(ev.clientX - dx, -rect.width + 60), maxLeft);
        var top = Math.min(Math.max(ev.clientY - dy, 0), Math.max(0, maxTop));
        win.style.left = Math.round(left) + "px";
        win.style.top = Math.round(top) + "px";
      }
      function up() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  /* ---------------------------------------------- Globale Events */

  // Klick auf freie Desktop-Fläche hebt die Auswahl auf.
  desktop.addEventListener("click", function () { select(null); });

  document.addEventListener("keydown", function (e) {
    // Die Großansicht liegt oben, also reagiert sie zuerst: Escape schließt
    // erst sie, erst der zweite Druck das Fenster darunter.
    if (quickLookOpen()) {
      if (e.key === "Escape") { e.preventDefault(); closeQuickLook(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); stepQuickLook(1); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); stepQuickLook(-1); return; }
      return;
    }
    if (e.key === "Escape" && openWindows.length) {
      closeWindow(openWindows[openWindows.length - 1]);
    }
  });

  /* RESIZE ----------------------------------------------------------------
     iOS feuert `resize`, sobald Safaris Adressleiste ein- oder ausfährt.
     Würde dabei neu gewürfelt, sprängen alle Icons (gemessen: bis 129 px).
     Neu layoutet wird deshalb nur, wenn sich BREITE oder AUSRICHTUNG
     wirklich geändert haben — reine Höhenänderungen bleiben folgenlos.
     ---------------------------------------------------------------------- */
  var resizeTimer;
  window.addEventListener("resize", function () {
    var w = document.documentElement.clientWidth;
    var portrait = portraitNow();
    if (w === lastLayoutW && portrait === lastLayoutPortrait) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutIcons, 120);
  });

  /* ---------------------------------------------- Dock

     Das Dock ist vollständig datengetrieben: Einträge UND Grafiken werden
     ausschließlich über assets/icons/ gepflegt. icons.json bestimmt
     Reihenfolge, Gruppierung (daraus entstehen die Trennstriche), Label
     und Aktion; die Grafik ist die darin genannte Datei im selben Ordner.
     Austausch einer Grafik = Datei ersetzen (SVG oder PNG, Endung im
     Manifest anpassen). Im Code ist dafür nichts anzufassen; die Dateien
     werden als <img> eingebunden und nicht geparst oder umgefärbt.
     ---------------------------------------------------------------------- */

  var ICON_DIR = "assets/icons/";

  function dockItemElement(entry) {
    var isLink = entry.aktion === "link" && entry.href;
    var el = document.createElement(isLink ? "a" : "button");

    el.className = "dock__item";
    el.title = entry.label;
    el.setAttribute("aria-label", entry.label);

    if (isLink) {
      el.href = entry.href;
      // Externe Ziele in neuem Tab, mailto: bleibt im selben.
      if (/^https?:/i.test(entry.href)) {
        el.target = "_blank";
        el.rel = "noopener noreferrer";
      }
    } else {
      el.type = "button";
    }

    // Die Vergrößerung wirkt nur auf diesen Wrapper, nicht auf die Zelle:
    // so bleibt das Layout der Leiste stabil und das Schildchen darüber
    // wird nicht mitskaliert.
    var icon = document.createElement("span");
    icon.className = "dock__icon";

    if (entry.datei) {
      var img = document.createElement("img");
      img.src = ICON_DIR + entry.datei;
      img.alt = "";
      img.decoding = "async";
      // Fehlt die Datei, tritt der Labeltext an ihre Stelle — kein
      // kaputtes Bildsymbol.
      img.addEventListener("error", function () {
        img.replaceWith(textFallback(entry.label));
      });
      icon.appendChild(img);
    } else {
      icon.appendChild(textFallback(entry.label));
    }
    el.appendChild(icon);

    var tip = document.createElement("span");
    tip.className = "dock__tip";
    tip.textContent = entry.label;
    el.appendChild(tip);

    if (entry.aktion === "skill") {
      el.addEventListener("click", function () {
        openSkillWindow(entry.label, entry.text || "", el);
      });
    }

    return el;
  }

  function textFallback(label) {
    var span = document.createElement("span");
    span.className = "dock__text";
    span.textContent = label;
    return span;
  }

  function buildDock(entries) {
    var dock = document.getElementById("dock");
    dock.textContent = "";

    var lastGroup = null;
    entries.forEach(function (entry) {
      if (!entry || !entry.label) return;
      if (lastGroup !== null && entry.gruppe !== lastGroup) {
        var sep = document.createElement("span");
        sep.className = "dock__sep";
        sep.setAttribute("aria-hidden", "true");
        dock.appendChild(sep);
      }
      lastGroup = entry.gruppe;
      dock.appendChild(dockItemElement(entry));
    });

    enableMagnification(dock);
  }

  /* VERGRÖSSERUNG BEIM HOVER ----------------------------------------------
     Das Icon unter dem Zeiger wächst, die direkten Nachbarn abgestuft mit.
     Gerechnet wird über den Abstand der INDIZES zum Icon unter dem Zeiger,
     nicht über die Pixeldistanz — dadurch bleiben die Stufen gleichmäßig,
     egal wie breit eine Zelle gerade ist. Skaliert wird nur .dock__icon
     mit transform-origin: bottom center, deshalb wachsen die Icons nach
     oben und stehen unten weiter bündig auf einer Linie.
     ---------------------------------------------------------------------- */
  var MAG_STEPS = [1.45, 1.22, 1.08];

  function enableMagnification(dock) {
    var items = [].slice.call(dock.querySelectorAll(".dock__item"));
    if (!items.length) return;

    function apply(centerIndex) {
      items.forEach(function (el, i) {
        var d = centerIndex === null ? 99 : Math.abs(i - centerIndex);
        el.style.setProperty("--dock-scale", d < MAG_STEPS.length ? MAG_STEPS[d] : 1);
        el.classList.toggle("is-hovered", d === 0);
      });
    }

    dock.addEventListener("pointermove", function (e) {
      // Auf Touch und im Mobil-Layout bleibt die Leiste ruhig.
      if (e.pointerType === "touch" || mobileLayout() || reducedMotion.matches) return;
      var hit = e.target.closest ? e.target.closest(".dock__item") : null;
      apply(hit ? items.indexOf(hit) : null);
    });
    dock.addEventListener("pointerleave", function () { apply(null); });
  }

  fetch(ICON_DIR + "icons.json")
    .then(function (r) {
      if (!r.ok) throw new Error("icons.json: HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      var entries = data && Array.isArray(data.dock) ? data.dock : [];
      if (!entries.length) throw new Error("icons.json enthält keine Dock-Einträge");
      buildDock(entries);
    })
    .catch(function (err) {
      // Ohne Manifest sind weder Labels noch Ziele bekannt. Das Dock bleibt
      // sichtbar und sagt das auch, statt leer zu verschwinden.
      var dock = document.getElementById("dock");
      dock.textContent = "";
      dock.appendChild(textFallback("Dock nicht verfügbar"));
      live.textContent = "Dock konnte nicht geladen werden.";
      console.error(err);
    });

  /* ---------------------------------------------- Start */

  fetch("projects.json")
    .then(function (r) {
      if (!r.ok) throw new Error("projects.json: HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      projects = (data && data.projects ? data.projects : []).filter(function (p) {
        return p && p.slug && p.title && Array.isArray(p.items) && p.items.length;
      });
      if (!projects.length) {
        showNotice("Keine Projekte vorhanden.");
        return;
      }
      // _index = Platz in der Positionsliste, _id = eindeutiger Schlüssel.
      projects.forEach(function (p, i) { p._index = i; p._id = i; });
      // Maßsatz steht VOR dem Aufbau fest, damit die Platzhalterboxen und
      // die ersten geladenen Cover schon die richtige Größe bekommen.
      ACTIVE = cfg();
      buildIcons();
      layoutIcons();
    })
    .catch(function (err) {
      showNotice("Projekte konnten nicht geladen werden.");
      console.error(err);
    });
})();
