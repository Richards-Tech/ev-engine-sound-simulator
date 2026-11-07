/*
 * app.js — wires the UI, speed source, drivetrain simulation and audio.
 */
(function () {
  'use strict';

  // The garage (garage.html, behind a PIN): every car, including the ones in
  // js/garage-cars.js that aren't released yet, in the test drive only, with
  // no Pro or free-time limits and settings of its own.
  var GARAGE = document.body.getAttribute('data-page') === 'garage';
  var STORAGE_KEY = GARAGE ? 'motorsound.garage.v1' : 'motorsound.settings.v2';
  var TICK_MS = 16;
  var MPS_TO_KMH = 3.6;
  var MPS_TO_MPH = 2.236936;

  var cars = window.MOTORSOUND_CARS;
  // pinned: ids of the cars a Pro user put on the front page (null: not chosen yet).
  // added: the NEW_CARS already put on that front page once.
  // A new visitor starts in Shift Maniac (also the fallback), though the
  // Tesla Roadster now leads the list: it is silent until you speed up briskly.
  var DEFAULT_CAR = 'city-shifter';
  // autoplay: start the last car's engine when the page opens (see autoplay()).
  // more: the "More settings" fold is open (see setMore()).
  var defaults = { carId: DEFAULT_CAR, mode: 'gps', volume: 1, intensity: 0.5, character: 0.75, crackle: 0.3, units: 'kmh', sort: '', autoplay: false, more: false, pinned: null, added: [] };
  // New cars go onto a Pro user's own front page once, so they get noticed;
  // unpinning one afterwards sticks.
  var NEW_CARS = ['haunted-hearse', 'lamborghini-urus', 'slipstream', 'ferrari-enzo', 'lamborghini-veneno', 'tesla-roadster-thrust', 'audi-rs6', 'nissan-gtr-nismo-r35', 'bugatti-chiron', 'porsche-911-turbo-s', 'bmw-m3', 'porsche-911-gt3-rs-991'];
  var settings = loadSettings();
  if (GARAGE) settings.mode = 'demo';
  else addNewCars();
  var car = findCar(settings.carId);
  var TACH_MAX, electric, haunted, thruster;
  // A car with thrusters: its THRUST button (the REV button), smoothed.
  var thrustPedal = 0;
  carState();

  var vehicle = new Vehicle(car);
  var audio = new EngineAudio();
  var gps = new GpsSpeed(renderGps);

  var engineOn = false;
  var tickTimer = 0;
  var stopTimer = 0;
  var lastTick = 0;
  var pads = { gas: 0, brake: 0, rev: 0, cruise: 0, hold: 0 };
  // W key: a steady, comfortable pedal (normal street driving) that eases in
  // and out instead of jumping to full throttle.
  var CRUISE_PEDAL = 0.3;
  var cruisePedal = 0;
  // On-screen pedals: the top edge is a light touch, the bottom is full.
  var PEDAL_MIN = 0.1;
  // Gas pedal: its top part holds the current speed; below that it accelerates.
  var GAS_HOLD = 0.25;
  var gpsSpeed = 0;
  var gpsAccel = 0;
  var demo = null;
  var clutchSent = 0;
  // Whine tuning multipliers (1 = the car's own); see setupTuning.
  var tune = { whinePitch: 1, whineLevel: 1 };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    gpsOnBtn: $('gpsOnBtn'),
    startBtn: $('startBtn'), startLabel: $('startLabel'), status: $('status'),
    gpsWarn: $('gpsWarn'), gpsWarnHelp: $('gpsWarnHelp'), gpsChip: $('gpsChip'), audioChip: $('audioChip'),
    speed: $('speed'), unit: $('unit'), gear: $('gear'), rpm: $('rpm'),
    tachValue: $('tachValue'), throttleBar: $('throttleBar'),
    brandPro: $('brandPro'), renewLine: $('renewLine'), renewDate: $('renewDate'), demoBtn: $('demoBtn'), diag: $('diag'),
    moreBtn: $('moreBtn'), more: $('moreSettings'),
    proLine: $('proLine'), proText: $('proText'), proBtn: $('proBtn'), gaugeTime: $('gaugeTime'),
    revPad: document.querySelector('[data-pad="rev"]')
  };

  // ---------- settings ----------

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { s = {}; }
    var out = {};
    for (var k in defaults) out[k] = s[k] !== undefined ? s[k] : defaults[k];
    return out;
  }

  function addNewCars() {
    var fresh = NEW_CARS.filter(function (id) { return settings.added.indexOf(id) < 0; });
    if (!fresh.length) return;
    if (Array.isArray(settings.pinned)) {
      fresh.forEach(function (id) { if (settings.pinned.indexOf(id) < 0) settings.pinned.push(id); });
    }
    settings.added = settings.added.concat(fresh);
    saveSettings();
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  function findCar(id) {
    var fallback = cars[0];
    for (var i = 0; i < cars.length; i++) {
      if (cars[i].id === id && drivable(cars[i])) return cars[i];
      if (cars[i].id === DEFAULT_CAR) fallback = cars[i];
    }
    return fallback;
  }

  // A car needs its sound to be driven, and a Pro car needs Pro (not in the garage).
  function drivable(c) {
    return !c.soon && (GARAGE || !c.pro || Paywall.isPro());
  }

  // What follows from the car: the tach's scale and what kind of sound it makes.
  function carState() {
    TACH_MAX = Math.ceil((car.engine.limiterRpm + 100) / 1000) * 1000;
    // An electric motor has no idle to rev and no exhaust to crackle.
    electric = car.engine.type === 'electric';
    // The Halloween car: no engine sound, so nothing to crackle, and its own
    // labels in the demo run.
    haunted = car.engine.type === 'haunted';
    // A car with thrusters has a THRUST button instead of REV.
    thruster = car.engine.type === 'thruster';
  }

  // Switch to another car in place, without reloading the page. A running
  // engine starts again as the new car (this is a tap, so audio may start).
  function selectCar(c) {
    if (thrusterFx) thrusterFx.stopFlip();
    car = c;
    settings.carId = c.id;
    saveSettings();
    carState();
    stopDemo();
    vehicle = new Vehicle(car);
    thrustPedal = 0;
    audio.setEngine();
    showCar();
    if (engineOn) startEngine();
  }

  // ---------- analytics ----------

  // A Vercel custom event. window.va only exists once the visitor said Yes to
  // analytics (consent.js); the garage never sends any.
  // Paused: each event is billed and nobody reads them. Set to true to resume.
  var TRACK_EVENTS = false;
  function track(name, data) {
    if (!TRACK_EVENTS || GARAGE || typeof window.va !== 'function') return;
    window.va('event', { name: name, data: data });
  }

  // ---------- simulation loop ----------

  function tick() {
    var now = performance.now();
    var elapsed = Math.min(0.5, (now - lastTick) / 1000);
    lastTick = now;
    // Timers are throttled when the page is in the background; sub-step so
    // the simulation stays stable when a tick arrives late.
    var steps = Math.max(1, Math.ceil(elapsed / 0.02));
    var dt = elapsed / steps;
    for (var i = 0; i < steps; i++) step(dt);
    while (vehicle.clicks.length) audio.click(vehicle.clicks.shift());
    if (vehicle.clutch !== clutchSent) audio.clutch(clutchSent = vehicle.clutch);
    if (engineOn && !GARAGE && !Paywall.isPro()) {
      Paywall.addUsage(elapsed);
      if (Paywall.trialLeft() <= 0) {
        track('Free time up', { car: car.name });
        stopEngine();
        Paywall.open('trial');
        return;
      }
    }
    audio.setParams({
      rpm: vehicle.rpm,
      load: vehicle.load,
      overrun: vehicle.overrun,
      cut: vehicle.cut,
      character: settings.character,
      crackle: settings.crackle,
      whinePitch: tune.whinePitch,
      whineLevel: tune.whineLevel,
      speed: vehicle.speed,
      rev: thruster ? thrustPedal : vehicle.revPedal
    });
  }

  function step(dt) {
    var input;
    if (settings.mode === 'gps') {
      var g = gps.read();
      gpsSpeed += (g.speed - gpsSpeed) * (1 - Math.exp(-dt / 0.25));
      gpsAccel += (g.accel - gpsAccel) * (1 - Math.exp(-dt / 0.35));
      input = { source: 'gps', speed: gpsSpeed, accel: gpsAccel, rev: pads.rev };
    } else {
      if (demo) demo.step(dt);
      var d = demo ? demo.input : pads;
      var cruiseTarget = pads.cruise && !demo ? CRUISE_PEDAL : 0;
      cruisePedal += (cruiseTarget - cruisePedal) * (1 - Math.exp(-dt / (cruiseTarget > cruisePedal ? 0.9 : 0.4)));
      if (pads.brake) cruisePedal = 0;
      input = { source: 'demo', gas: Math.max(d.gas, cruisePedal), brake: d.brake, rev: d.rev, hold: !demo && pads.hold === 1 };
    }
    // THRUST fires the jets any time, driving or not, and never revs the
    // drivetrain (it eases in and out like the REV pedal).
    if (thruster) {
      var tp = input.rev || 0;
      thrustPedal += (tp - thrustPedal) * (1 - Math.exp(-dt / (tp > thrustPedal ? 0.06 : 0.1)));
      input.rev = 0;
    }
    vehicle.update(dt, input);
  }

  function startEngine() {
    if (!GARAGE && !Paywall.isPro() && Paywall.trialLeft() <= 0) {
      Paywall.open('trial');
      return;
    }
    if (!EngineAudio.supported()) {
      setStatus('This browser cannot play generated audio (no Web Audio).', 'error');
      return;
    }
    clearTimeout(stopTimer);
    clearInterval(tickTimer);
    vehicle.intensity = settings.intensity;
    vehicle.start();
    gpsSpeed = 0;
    gpsAccel = 0;
    audio.volume = settings.volume;
    // audio.start() must run synchronously inside the tap handler.
    var started;
    try { started = audio.start(car.engine); } catch (err) { started = Promise.reject(err); }
    started.then(function () {
      renderAudioChip();
      renderDiagnostics();
    }, function (err) {
      stopEngine();
      setStatus('Could not start audio: ' + err.message, 'error');
    });
    if (settings.mode === 'gps') gps.start();
    engineOn = true;
    lastTick = performance.now();
    tickTimer = setInterval(tick, TICK_MS);
    renderStart();
    renderAudioChip();
    if (settings.mode === 'gps') setStatus('Drive — the engine follows your speed.');
    else setStatus('Test drive — press Gas / Brake (lower = harder, top of Gas holds speed), or play the demo run.');
  }

  function stopEngine() {
    engineOn = false;
    vehicle.stop();
    stopDemo();
    gps.stop();
    audio.stop(0.45);
    renderStart();
    renderAudioChip();
    setStatus('');
    stopTimer = setTimeout(function () {
      clearInterval(tickTimer);
      vehicle.reset();
    }, 1200);
  }

  // ---------- demo run (test drive) ----------

  // ev: the label for an electric car; engineOnly: skipped for one (nothing to blip).
  // spooky: the label for the Halloween car.
  var DEMO_STEPS = [
    { label: 'Idle', ev: 'Standing still', spooky: 'A heartbeat in the dark', dur: 2 },
    { label: 'Blipping the throttle', spooky: 'Waking the dead', rev: 0.55, dur: 0.45, engineOnly: true },
    { label: 'Blipping the throttle', spooky: 'Waking the dead', dur: 1.2, engineOnly: true },
    { label: 'Blipping the throttle', spooky: 'Waking the dead', rev: 1, dur: 1.1, engineOnly: true },
    { label: 'Blipping the throttle', spooky: 'Waking the dead', dur: 1.8, engineOnly: true },
    { label: 'Launch — full throttle to 130 km/h', spooky: 'Full throttle — the beast growls', gas: 1, until: function (v) { return v.speed >= 130 / 3.6; }, dur: 25 },
    { label: 'Lift off', ev: 'Lift off — regen', spooky: 'Lift off — a ghost moans', dur: 3 },
    { label: 'Braking — rev-matched downshifts', ev: 'Braking — regen', spooky: 'Braking into the fog', brake: 0.4, until: function (v) { return v.speed <= 45 / 3.6; }, dur: 12 },
    { label: 'Cruising', spooky: 'Cruising with the ghost choir', gas: 0.28, dur: 4 },
    { label: 'Kickdown', ev: 'Full power', spooky: 'Kickdown — the beast wakes again', gas: 1, until: function (v) { return v.speed >= 110 / 3.6; }, dur: 12 },
    { label: 'Braking to a stop', brake: 0.55, until: function (v) { return v.speed < 0.3; }, dur: 20 },
    { label: 'Idle', ev: 'Standing still', spooky: 'The bell tolls', dur: 2.5 }
  ];

  function startDemo() {
    if (!engineOn) startEngine();
    vehicle.park();
    var steps = DEMO_STEPS.filter(function (s) { return !(electric && s.engineOnly); });
    demo = {
      i: -1,
      t: 0,
      input: { gas: 0, brake: 0, rev: 0 },
      step: function (dt) {
        var s = steps[this.i];
        this.t += dt;
        if (this.i < 0 || this.t >= s.dur || (s.until && s.until(vehicle))) {
          this.i++;
          this.t = 0;
          if (this.i >= steps.length) {
            stopDemo();
            setStatus('Demo finished — hold Gas / Brake to drive yourself.');
            return;
          }
          s = steps[this.i];
          this.input = { gas: s.gas || 0, brake: s.brake || 0, rev: s.rev || 0 };
          setStatus('Demo: ' + (haunted && s.spooky || electric && s.ev || s.label));
        }
      }
    };
    el.demoBtn.classList.add('running');
    el.demoBtn.textContent = '■ Stop demo run';
  }

  function stopDemo() {
    demo = null;
    el.demoBtn.classList.remove('running');
    el.demoBtn.textContent = '▶ Play demo run';
  }

  // ---------- rendering ----------

  function setStatus(text, kind) {
    gpsMessage = false;
    el.status.textContent = text;
    el.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function renderStart() {
    el.startBtn.classList.toggle('on', engineOn);
    el.startLabel.textContent = engineOn ? 'Stop engine' : 'Start engine';
  }

  function renderPro() {
    var pro = Paywall.isPro();
    el.proLine.classList.toggle('is-pro', pro);
    el.proLine.hidden = pro;   // Pro shows in the title instead
    el.brandPro.hidden = !pro;
    el.renewLine.hidden = !pro;
    if (pro) {
      console.log('>>> Pro user, until ' + Paywall.proUntil());
      var until = new Date(Paywall.proUntil());
      el.renewDate.textContent = until.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      return;
    }
    var left = Math.ceil(Paywall.trialLeft());
    var hours = Math.floor(left / 3600);
    var timeLeft = hours > 0
      ? hours + ':' + ('0' + Math.floor((left % 3600) / 60)).slice(-2) + ':' + ('0' + (left % 60)).slice(-2)
      : Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
    el.proText.textContent = left > 0
      ? 'Free today: ' + timeLeft + ' of engine time left'
      : 'Free time used up for today';
    // The same, under the maximized gauge, where the line above is out of sight.
    el.gaugeTime.textContent = el.proText.textContent;
    el.gaugeTime.classList.toggle('out', left <= 0);
  }

  function renderAudioChip() {
    var chip = el.audioChip;
    if (!engineOn) {
      chip.dataset.state = 'off';
      chip.textContent = 'Engine off';
    } else if (audio.running()) {
      chip.dataset.state = 'ok';
      chip.textContent = 'Engine running';
    } else {
      chip.dataset.state = 'wait';
      chip.textContent = 'Starting audio…';
    }
  }

  // First-time visitors: location is what revs the engine, so say so up front
  // until the browser has actually granted it. Each page load starts from the
  // browser's last answer, so the warning doesn't flash up (pushing the car
  // picker down) only to vanish once the browser answers again.
  var LOC_KEY = 'motorsound.locPermission.v1';
  var locPermission = 'unknown';   // 'granted' | 'prompt' | 'denied' | 'unknown'
  try { locPermission = localStorage.getItem(LOC_KEY) || 'unknown'; } catch (e) { /* private mode */ }

  function setLocPermission(state) {
    locPermission = state;
    try { localStorage.setItem(LOC_KEY, state); } catch (e) { /* private mode */ }
    renderGpsWarn();
  }

  function renderGpsWarn() {
    if (!el.gpsWarn) return;   // the garage has no GPS
    var needed = settings.mode === 'gps' && gps.status !== 'ok' && locPermission !== 'granted';
    el.gpsWarn.hidden = !needed;
    el.gpsWarnHelp.hidden = locPermission !== 'denied';
  }

  function renderGps() {
    var chip = el.gpsChip;
    var st = gps.status;
    if (settings.mode !== 'gps') {
      chip.dataset.state = 'off';
      chip.textContent = 'GPS not used';
    } else if (st === 'ok') {
      chip.dataset.state = 'ok';
      var acc = gps.accuracy ? ' ±' + Math.round(gps.accuracy) + ' m' : '';
      var rate = gps.rateHz ? ' · ' + gps.rateHz.toFixed(1) + ' Hz' : '';
      chip.textContent = 'GPS' + rate + acc;
    } else if (st === 'waiting') {
      chip.dataset.state = 'wait';
      chip.textContent = 'GPS: waiting for fix';
    } else if (st === 'stale') {
      chip.dataset.state = 'wait';
      chip.textContent = 'GPS: signal lost';
    } else if (st === 'off') {
      chip.dataset.state = 'off';
      chip.textContent = 'GPS off';
    } else {
      chip.dataset.state = 'bad';
      chip.textContent = st === 'denied' ? 'GPS: permission denied' : 'GPS unavailable';
    }
    if (st === 'denied' && settings.mode === 'gps') {
      chip.setAttribute('data-help', '');
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
    } else {
      chip.removeAttribute('data-help');
      chip.removeAttribute('role');
      chip.removeAttribute('tabindex');
    }
    if (gps.error && (st === 'denied' || st === 'error' || st === 'unsupported')) {
      setStatus(gps.error, 'error');
      gpsMessage = true;
    } else if (gps.error && (st === 'stale' || st === 'waiting')) {
      setStatus(gps.error, 'warn');
      gpsMessage = true;
    } else if (gpsMessage && st === 'ok') {
      setStatus('Drive — the engine follows your speed.');
      gpsMessage = false;
    }
    // Offer a one-tap way to turn GPS on while it is off (also in test drive,
    // where it switches to GPS drive). Not when the browser refused or cannot
    // do location: the chip's help covers that.
    if (el.gpsOnBtn) {
      el.gpsOnBtn.hidden = !(settings.mode !== 'gps' || st === 'off');
    }
    renderGpsWarn();
  }

  // "Turn on GPS": drive by GPS, and start the engine if it isn't running, so
  // the sound follows the car at once. Runs inside the tap, as audio needs.
  function turnOnGps() {
    if (settings.mode !== 'gps') setMode('gps');
    if (!engineOn) startEngine();
  }

  var lastGpsRender = 0;
  var gpsMessage = false; // status line currently shows a GPS problem
  // A car with thrusters blasts them out of its picture (thruster-fx.js).
  var thrusterFx = window.ThrusterFx ? new window.ThrusterFx() : null;

  function renderThrusters(now) {
    var e = car.engine, thrust = 0, rev = false;
    if (e.type === 'thruster' && engineOn) {
      // As the synthesizer hears it: the accelerator only after the start-up.
      var load = vehicle.startT < EngineDSP.thrustStartS ? 0 : vehicle.load;
      thrust = EngineDSP.thrust(load, thrustPedal, e.sound.onset);
      // THRUST held at a standstill covers the screen in gas; driving, the
      // gas rolls out lighter, so the page stays readable.
      rev = EngineDSP.thrust(0, thrustPedal, e.sound.onset) > 0 && vehicle.speed < 0.5;
    }
    thrusterFx.frame(now, thrust, rev, vehicle.speed, $('carHero').querySelector('img'), car.nozzle);
  }

  function render(now) {
    var mps = vehicle.speed;
    var speed = settings.units === 'mph' ? mps * MPS_TO_MPH : mps * MPS_TO_KMH;
    el.speed.textContent = String(Math.round(speed));
    el.gear.textContent = engineOn || vehicle.rpm > 50 ? vehicle.gearLabel() : '–';
    el.rpm.textContent = String(Math.round(vehicle.rpm / 10) * 10);
    var frac = Math.min(1, vehicle.rpm / TACH_MAX);
    el.tachValue.setAttribute('stroke-dasharray', (frac * 100).toFixed(2) + ' 100');
    el.tachValue.classList.toggle('shift', vehicle.rpm > car.engine.redlineRpm - 400);
    var thr = vehicle.neutral ? vehicle.revPedal : vehicle.throttle;
    if (thruster) thr = Math.max(thr, thrustPedal);
    // The throttle bar also shows the thrusters' boost during the flip.
    if (thrusterFx) thr = Math.max(thr, thrusterFx.flipLv);
    el.throttleBar.style.width = (Math.min(1, thr) * 100).toFixed(1) + '%';
    // Revving in neutral only: hide the button once the car moves. THRUST
    // works any time.
    var canRev = thruster || (!electric && vehicle.speed < 0.5);
    el.revPad.classList.toggle('shown', engineOn && canRev);
    if (el.revPad.disabled === canRev) {
      el.revPad.disabled = !canRev;
      // A disabled button may never see its pointerup; don't leave the pedal held.
      pads.rev = 0;
      el.revPad.classList.remove('active');
    }
    if (now - lastGpsRender > 1000) {
      lastGpsRender = now;
      if (engineOn) renderGps();
      renderAudioChip();
    }
    if (thrusterFx) renderThrusters(now);
    requestAnimationFrame(render);
  }

  // Placeholder silhouette shown until a car's photo has loaded: the same
  // simple side profile for every car (drawn for this app, not manufacturer art).
  var CAR_ART = '<path d="M6 44 L6 34 L40 31 L62 17 L120 17 L144 30 L192 33 L194 44 Z"/>' +
    '<path d="M66 20 L116 20 L134 30 L56 31 Z" class="glass"/>';

  // Photo per car (side profile): here, or a car's own `photo` (as the cars in
  // the garage have). A car without one (a "coming soon" car) keeps the drawn
  // silhouette.
  var CAR_PHOTO = { 
    'gt3': 'img/gt3.png', 
    'ferrari-v12': 'img/ferrari-v12.png', 
    'v8-muscle': 'img/v8-muscle.png', 
    'city-shifter': 'img/city-shifter.png', 
    'hellcat': 'img/hellcat.png', 
    'haunted-hearse': 'img/haunted-hearse.png', 
    'electric-zen': 'img/electric-zen.png', 
    'lamborghini-urus': 'img/lamborghini-urus.png', 
    'slipstream': 'img/slipstream.png', 
    'ferrari-enzo': 'img/ferrari-enzo.png', 
    'lamborghini-veneno': 'img/lamborghini-veneno.png', 
    'tesla-roadster-thrust': 
    'img/tesla-roadster-thrust.png', 
    'audi-rs6': 'img/audi-rs6.png', 
    'nissan-gtr-nismo-r35': 
    'img/nissan-gtr-nismo-r35.png', 
    'bugatti-chiron': 'img/bugatti-chiron.png', 
    'porsche-911-turbo-s': 'img/porsche-911-turbo-s.png', 
    'bmw-m3': 'img/bmw-m3.png', 
    'porsche-911-gt3-rs-991': 'img/porsche-911-gt3-rs-991.png',
    'ferrari-812-superfast': 'img/ferrari-812-superfast.png',
    'ferrari-purosangue': 'img/ferrari-purosangue.png',
    'lamborghini-revuelto': 'img/lamborghini-revuelto.webp',
    'lamborghini-temerario': 'img/lamborghini-temerario.webp',
    'lamborghini-aventador-svj': 'img/lamborghini-aventador-svj.webp',
    'ferrari-296-gt3': 'img/ferrari-296-gt3.png',
    'bmw-m2': 'img/bmw-m2.png', 
    'bmw-m4': 'img/bmw-m4.png',
    'bmw-m5': 'img/bmw-m5.png',
    'mazda-rx7-fd3s': 'img/mazda-rx7.jpg',
    'lexus-lfa': 'img/lexus-lfa.png',
    'koenigsegg-jesko': 'img/koenigsegg-jesko.png',
    'koenigsegg-agera-rs': 'img/koenigsegg-agera-rs.png',
    'koenigsegg-regera': 'img/koenigsegg-regera.png',
    'koenigsegg-gemera': 'img/koenigsegg-gemera.png',
    'koenigsegg-ccx': 'img/koenigsegg-ccx.png',
    'koenigsegg-one1': 'img/koenigsegg-one1.png',
    'koenigsegg-agera-r': 'img/koenigsegg-agera-r.png',
    'koenigsegg-agera': 'img/koenigsegg-agera.png',
    'gma-t50': 'img/gma-t50.png',
    'bugatti-tourbillon': 'img/bugatti-tourbillon.png',
    'corvette-z06-c8': 'img/corvette-z06-c8.png',
    'laferrari': 'img/laferrari.png',
    'ferrari-sf90-stradale': 'img/ferrari-sf90-stradale.png',
    'ferrari-488-gtb': 'img/ferrari-488-gtb.png',
    'ferrari-f8-tributo': 'img/ferrari-f8-tributo.png',
    'mclaren-gt4': 'img/mclaren-gt4.webp',
    'mclaren-720s': 'img/mclaren-720s.webp',
    'mclaren-750s': 'img/mclaren-750s.webp',
    'mclaren-765lt': 'img/mclaren-765lt.webp',
    'mclaren-p1': 'img/mclaren-p1.webp',
    'mclaren-artura-gt4': 'img/mclaren-artura-gt4.webp',
    'mclaren-570-gt4': 'img/mclaren-570-gt4.webp',
    'porsche-718-cayman-gt4': 'img/porsche-718-cayman-gt4.webp',
    'porsche-718-cayman-gt4-rs': 'img/porsche-718-cayman-gt4-rs.webp',
    'porsche-911-gt3-rs-992': 'img/porsche-911-gt3-rs-992.webp',
    'porsche-911-gt2-rs-991-2': 'img/porsche-911-gt2-rs-991-2.webp',
    'aston-martin-vantage-f1': 'img/aston-martin-vantage-f1.webp',
    'audi-r8-v10': 'img/audi-r8-v10.webp',
    'mercedes-amg-gt-r': 'img/mercedes-amg-gt-r.webp',
    'chevrolet-corvette-c8-grand-sport': 'img/chevrolet-corvette-c8-grand-sport.webp',
    'ford-mustang-dark-horse-sc': 'img/ford-mustang-dark-horse-sc.webp'
  };


  function carPhoto(holder, c) {
    var img = holder.querySelector('img'), src = c.photo || CAR_PHOTO[c.id];
    if (!src) {
      holder.classList.remove('has-photo');
      img.removeAttribute('src');
      return;
    }
    if (holder.id === 'carHero') img.alt = c.name + ' engine sound for your Tesla';
    img.onload = function () { holder.classList.add('has-photo'); };
    img.src = src;
  }

  var PICK_ART = '<span class="pick-art"><img alt=""><svg viewBox="0 0 200 56" aria-hidden="true">' + CAR_ART +
    '<circle cx="48" cy="44" r="10" class="wheel"/><circle cx="152" cy="44" r="10" class="wheel"/></svg></span>';

  // Pro users choose the front-page cars in "Show all cars"; until they do,
  // it is the free cars.
  function pinnedIds() {
    // A saved id of a car that is gone (the old "New Car" teaser) is skipped.
    if (Array.isArray(settings.pinned)) return settings.pinned.filter(function (id) { return cars.some(function (c) { return c.id === id; }); });
    return cars.filter(function (c) { return !c.pro; }).map(function (c) { return c.id; });
  }

  // The garage shows every car, the unreleased ones first.
  function frontCars() {
    if (GARAGE) return cars.filter(function (c) { return c.garage; }).concat(cars.filter(function (c) { return !c.garage; }));
    var pro = Paywall.isPro(), ids = pinnedIds();
    if (!pro) return cars.filter(function (c) { return !c.pro; });
    return idsToCars(ids);
  }

  function idsToCars(ids) {
    return ids.map(function (id) { return cars.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean);
  }

  // "Test out the new way of sorting": a free user tries the Pro cars window
  // on a list of their own. It is never saved and never reaches the front
  // page, unless they get Pro while it is open. null when no test run is on.
  var trial = null;

  // The cars in "Your front page": the test-run list, or the real front page.
  function myIds() {
    return trial ? trial.slice() : frontCars().map(function (c) { return c.id; });
  }

  function setMyIds(ids) {
    if (trial) { trial = ids; return; }
    settings.pinned = ids;
    saveSettings();
    renderCarPicker();
  }

  function startTrial() {
    track('Sort test started');
    trial = cars.filter(function (c) { return !c.pro && !c.soon; }).map(function (c) { return c.id; });
    $('carsHint').textContent = '';
    renderAllCars();
  }

  function renderCarPicker() {
    var box = $('carPicker');
    box.textContent = '';
    var list = frontCars(), section = null;
    list.forEach(function (c) {
      // The garage splits its cars in two: in the garage, then in production.
      if (GARAGE && section !== !!c.garage) {
        section = !!c.garage;
        var count = list.filter(function (o) { return !!o.garage === section; }).length;
        var head = document.createElement('div');
        head.className = 'pick-section' + (section ? ' pick-section-garage' : '');
        head.textContent = (section ? 'In the garage' : 'In production') + ' · ' + count;
        box.appendChild(head);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.car = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', c.id === car.id ? 'true' : 'false');
      b.innerHTML = PICK_ART + '<span class="pick-name"></span>';
      carPhoto(b.querySelector('.pick-art'), c);
      var name = b.querySelector('.pick-name');
      name.textContent = c.name;
      var sub = document.createElement('small');
      if (c.soon) {
        b.classList.add('pick-later');
        b.setAttribute('aria-disabled', 'true');
        sub.textContent = 'Sound coming soon';
      } else if (GARAGE) {
        // Released or not, and who gets it.
        sub.textContent = c.garage ? 'Garage' : c.pro ? 'Pro' : 'Free';
        if (c.garage) b.classList.add('pick-garage');
      }
      if (sub.textContent) name.appendChild(sub);
      b.addEventListener('click', function () {
        if (c.id === car.id) { showOff(c, b); return; }
        if (!drivable(c)) {
          setStatus(c.name + ': the engine sound is coming soon.');
          return;
        }
        selectCar(c);
        track('Car picked', { car: c.name });
        showOff(c, b);
      });
      box.appendChild(b);
    });
    if (GARAGE) return;   // every car is already on show
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'pick-all';
    all.setAttribute('aria-haspopup', 'dialog');
    all.innerHTML = '<span class="all-plus" aria-hidden="true">+</span>' +
      '<span class="pick-name">Show all cars<small>' + cars.length + ' cars</small></span>';
    all.addEventListener('click', openAllCars);
    box.appendChild(all);
  }

  // A car can show off when it is picked (again): the Roadster blows a cloud
  // of smoke out of its button and backflips on its thrusters, silently.
  function showOff(c, button) {
    if (!thrusterFx || c.selectFx !== 'thrusterFlip') return;
    thrusterFx.smokeBurst(button);
    if (c.nozzle) thrusterFx.flip($('carHero').querySelector('img'));
  }

  function markPickedCar() {
    Array.prototype.forEach.call($('carPicker').querySelectorAll('[data-car]'), function (b) {
      b.setAttribute('aria-checked', String(b.dataset.car === car.id));
    });
  }

  // ---------- "Show all cars" modal ----------
  // Pro: tap a car to pin it to the front page (green) or unpin it.
  // Free: look only; a tap explains it is Pro and shows the upgrade QR code.

  var carsModal = $('carsModal');
  var allTiles = null;   // car id -> tile, built the first time the modal opens

  function buildAllCars() {
    allTiles = {};
    var grid = $('carsGrid');
    cars.forEach(function (c) {
      // Pro: only the Add button adds the car, so a tap meant to scroll the
      // list never adds one. Free: a tap anywhere explains Pro.
      var b = document.createElement('div');
      b.className = 'all-car';
      b.innerHTML = PICK_ART + '<span class="all-name"></span><span class="all-tag"></span><button type="button" class="all-badge"></button>';
      carPhoto(b.querySelector('.pick-art'), c);
      b.querySelector('.all-name').textContent = c.name;
      b.querySelector('.all-tag').textContent = c.tagline;
      b.addEventListener('click', function (e) {
        if (!Paywall.isPro() && !trial) Paywall.open('pin');
        else if (e.target.closest('.all-badge')) togglePin(c.id);
      });
      grid.appendChild(b);
      allTiles[c.id] = b;
    });
  }

  // The list below the sort buttons: the order cars were added (cars.js) until
  // a sort is on. Newest first is the reverse of that (new cars are added
  // last); A–Z sorts by name. Tap the lit button again to switch it off.
  function sortAllCars() {
    var sort = settings.sort;
    // The "coming soon" teaser always stays last.
    var order = cars.filter(function (c) { return !c.soon; });
    if (sort === 'az') order.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (sort === 'new') order.reverse();
    order = order.concat(cars.filter(function (c) { return c.soon; }));
    var grid = $('carsGrid');
    order.forEach(function (c) { grid.appendChild(allTiles[c.id]); });
    var btns = document.querySelectorAll('[data-sort]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].dataset.sort === sort));
  }

  // "Your front page" (Pro): the pinned cars in front-page order, first car
  // first. The arrows move a car; the double arrow makes it first.
  function renderMyCars() {
    var pro = Paywall.isPro() || !!trial, box = $('myCars');
    box.hidden = !pro;
    if (!pro) return;
    // The rows are kept and only moved, never rebuilt: emptying the list
    // would throw its scroll back to the top and reload every picture.
    var list = $('myCarsList'), top = list.scrollTop;
    var mine = idsToCars(myIds()), ids = mine.map(function (c) { return c.id; });
    Object.keys(myRows).forEach(function (id) {
      if (ids.indexOf(id) < 0) { myRows[id].remove(); delete myRows[id]; }
    });
    mine.forEach(function (c, i) {
      var t = myRows[c.id] || (myRows[c.id] = myCarRow(c));
      if (list.children[i] !== t) list.insertBefore(t, list.children[i] || null);
      var btns = t.querySelectorAll('[data-to]');
      btns[0].disabled = i === 0;
      btns[1].disabled = i === mine.length - 1;
      btns[2].disabled = mine.length === 1;
    });
    list.scrollTop = top;
  }

  var myRows = {};   // car id -> its row in "Your front page"
  // The remove button's X is drawn, not a ✕ character: the car's browser
  // has no font with ✕ and showed an empty button.
  var REMOVE_X = '<svg class="x-icon" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M3 3l10 10M13 3L3 13"/></svg>';

  function myCarRow(c) {
    var t = document.createElement('div');
    t.className = 'my-car';
    t.dataset.id = c.id;
    t.innerHTML = PICK_ART + '<span class="all-name"></span>' +
      '<span class="my-move"><button type="button" data-to="up" aria-label="Move up">▲</button>' +
      '<button type="button" data-to="down" aria-label="Move down">▼</button>' +
      '<button type="button" data-to="remove" aria-label="Take off the front page">' + REMOVE_X + '</button></span>';
    carPhoto(t.querySelector('.pick-art'), c);
    t.querySelector('.all-name').textContent = c.name;
    Array.prototype.forEach.call(t.querySelectorAll('[data-to]'), function (b) {
      b.addEventListener('click', function () { moveCar(c.id, b.dataset.to); });
    });
    return t;
  }

  // Bring a row of "Your front page" into view by scrolling only that list.
  function showMyCar(id) {
    var list = $('myCarsList'), row = myRows[id];
    if (!row) return;
    var lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
    if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top;
    else if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom;
  }

  // Press a green row of "Your front page" and drag it up or down. A mouse
  // picks it up at once; a finger holds on it first (see below). The list scrolls by itself when a row is
  // dragged to its top or bottom edge; the arrows stay as the other way to move.
  function setupMyCarsDrag() {
    var list = $('myCarsList'), drag = null, tick = null;

    function rows() { return Array.prototype.slice.call(list.querySelectorAll('.my-car')); }
    function order() { return rows().map(function (r) { return r.dataset.id; }); }

    function place(y) {
      var row = drag.row;
      drag.y = y;
      if (Math.abs(y - drag.y0) > 6) drag.moved = true;
      var lr = list.getBoundingClientRect();
      // Only once the row was really moved, so pressing a row at the edge
      // does not set the list scrolling.
      if (!drag.moved) { /* stay */ }
      else if (y < lr.top + 36) list.scrollTop -= 10;
      else if (y > lr.bottom - 36) list.scrollTop += 10;
      row.style.transform = 'none';
      var nat = row.getBoundingClientRect(), h = nat.height;
      var center = y - drag.grab + h / 2, moved = true;
      while (moved) {
        moved = false;
        var prev = row.previousElementSibling, next = row.nextElementSibling;
        if (prev) {
          var p = prev.getBoundingClientRect();
          if (center < p.top + p.height / 2) { list.insertBefore(row, prev); moved = true; }
        }
        if (!moved && next) {
          var n = next.getBoundingClientRect();
          if (center > n.top + n.height / 2) { list.insertBefore(next, row); moved = true; }
        }
      }
      nat = row.getBoundingClientRect();
      row.style.transform = 'translateY(' + (y - drag.grab - nat.top) + 'px)';
    }

    function begin(row, e) {
      drag = { row: row, grab: e.clientY - row.getBoundingClientRect().top, y: e.clientY, y0: e.clientY, moved: false, order: order().join() };
      row.classList.add('dragging');
      try { row.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      tick = setInterval(function () { if (drag) place(drag.y); }, 40);
    }

    function finish(save) {
      if (!drag) return;
      clearInterval(tick);
      var row = drag.row, before = drag.order;
      drag = null;
      row.classList.remove('dragging');
      row.style.transform = '';
      // A tap without a move changes nothing.
      if (save && order().join() !== before) setMyIds(order());
      renderMyCars();
    }

    // A finger must hold still on a row for a moment before it picks the row
    // up. Until then a swipe is a scroll, so the list can be scrolled from
    // anywhere on it. Moving before the hold ends cancels the pick-up.
    var HOLD_MS = 350, HOLD_SLOP = 8;
    var press = null;   // a touch that may still turn into a drag

    function endPress() {
      if (!press) return;
      clearTimeout(press.timer);
      press = null;
    }

    // On a phone the rows do not drag at all: the arrows move a car instead.
    function onPhone() {
      return window.matchMedia('(max-width: 700px) and (pointer: coarse)').matches;
    }

    list.addEventListener('pointerdown', function (e) {
      var row = e.target.closest('.my-car');
      if (!row || onPhone() || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.pointerType === 'mouse') {
        e.preventDefault();
        begin(row, e);
        return;
      }
      press = { row: row, e: e, x: e.clientX, y: e.clientY, timer: null };
      press.timer = setTimeout(function () {
        var p = press;
        press = null;
        begin(p.row, p.e);
      }, HOLD_MS);
    });
    list.addEventListener('pointermove', function (e) {
      if (drag) { place(e.clientY); return; }
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > HOLD_SLOP) endPress();
    });
    list.addEventListener('pointerup', function () { endPress(); finish(true); });
    list.addEventListener('pointercancel', function () { endPress(); finish(false); });
    // While a row is dragged, the finger moves the row, not the page.
    list.addEventListener('touchmove', function (e) { if (drag && e.cancelable) e.preventDefault(); }, { passive: false });
    list.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function moveCar(id, to) {
    if (to === 'remove') { togglePin(id); return; }
    var ids = myIds();
    var i = ids.indexOf(id);
    if (i < 0) return;
    ids.splice(i, 1);
    ids.splice(to === 'up' ? Math.max(0, i - 1) : i + 1, 0, id);
    setMyIds(ids);
    renderMyCars();
    showMyCar(id);
  }

  function renderAllCars() {
    var pro = Paywall.isPro() || !!trial, ids = myIds();
    sortAllCars();
    // Free: the big button that starts a test run. During it, the bar that
    // says nothing is kept.
    $('trySortBtn').hidden = pro;
    $('trySortBar').hidden = !trial;
    renderMyCars();
    // Pro: two columns, your front page on the left and the cars still to add
    // on the right. Free: the plain list, look only.
    $('carsSplit').parentNode.classList.toggle('is-pro', pro);
    $('carsTitle').textContent = pro ? 'Your cars' : 'All cars';
    $('carsLead').hidden = pro;
    $('carsLead').textContent = pro ? ''
      : 'Cars marked Free come with the free version. TeslaSound Pro unlocks every car and lets you pin your favorites to the front page.';
    cars.forEach(function (c) {
      var b = allTiles[c.id];
      var pinned = pro && ids.indexOf(c.id) >= 0;
      var badge = pro ? (pinned ? 'pinned' : 'pin') : (c.pro ? 'pro' : 'free');
      b.hidden = pinned;   // a car you added is on the left, not in this list
      b.dataset.badge = badge;
      b.querySelector('.all-badge').textContent = { pinned: 'Added', pin: '+ Add', pro: 'Pro', free: 'Free' }[badge];
    });
    // Pro: how many cars are on the front page, and how many are left to add.
    var left = cars.filter(function (c) { return !allTiles[c.id].hidden; }).length;
    // Free: the window title already says "All cars".
    $('allCarsTitle').hidden = !pro;
    // In its place, Free gets a short note on what Pro adds here.
    $('carsProNote').hidden = pro;
    $('allCarsTitle').textContent = 'Add cars (' + left + ')';
    $('myCarsTitle').textContent = 'Your cars on the front page (' + ids.length + ')';
  }

  function togglePin(id) {
    var ids = myIds();
    var i = ids.indexOf(id);
    if (i < 0) {
      ids.push(id);
    } else if (ids.length > 1) {
      ids.splice(i, 1);
    } else {
      $('carsHint').textContent = 'Keep at least one car on the front page.';
      return;
    }
    $('carsHint').textContent = '';
    setMyIds(ids);
    renderAllCars();
    if (i < 0) showMyCar(id);
  }

  function openAllCars() {
    if (!allTiles) buildAllCars();
    renderAllCars();
    $('carsHint').textContent = '';
    carsModal.hidden = false;
    // The page behind stays put: the mouse wheel scrolls only the window.
    document.documentElement.classList.add('no-scroll');
  }

  function closeAllCars() {
    carsModal.hidden = true;
    trial = null;
    document.documentElement.classList.remove('no-scroll');
  }

  function setupTach() {
    var cx = 200, cy = 200, r = 168, a0 = 135, sweep = 270;
    function pt(angleDeg, radius) {
      var a = angleDeg * Math.PI / 180;
      return (cx + radius * Math.cos(a)).toFixed(2) + ' ' + (cy + radius * Math.sin(a)).toFixed(2);
    }
    function arc(fromDeg, toDeg) {
      var large = toDeg - fromDeg > 180 ? 1 : 0;
      return 'M ' + pt(fromDeg, r) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + pt(toDeg, r);
    }
    function angleOf(rpm) { return a0 + sweep * rpm / TACH_MAX; }
    var redRpm = car.engine.tachRedRpm || car.engine.redlineRpm;
    var full = arc(a0, a0 + sweep);
    $('tachTrack').setAttribute('d', full);
    el.tachValue.setAttribute('d', full);
    $('tachRed').setAttribute('d', arc(angleOf(redRpm), a0 + sweep));

    var ns = 'http://www.w3.org/2000/svg';
    var g = $('tachTicks');
    g.textContent = '';
    for (var rpm = 0; rpm <= TACH_MAX; rpm += 500) {
      var major = rpm % 1000 === 0;
      var ang = angleOf(rpm);
      var line = document.createElementNS(ns, 'line');
      var p1 = pt(ang, r - 18).split(' '), p2 = pt(ang, r - (major ? 36 : 28)).split(' ');
      line.setAttribute('x1', p1[0]); line.setAttribute('y1', p1[1]);
      line.setAttribute('x2', p2[0]); line.setAttribute('y2', p2[1]);
      line.setAttribute('class', 'tick' + (major ? ' major' : '') + (rpm >= redRpm ? ' red' : ''));
      g.appendChild(line);
      if (major) {
        var p3 = pt(ang, r + 32).split(' ');
        var text = document.createElementNS(ns, 'text');
        text.setAttribute('x', p3[0]); text.setAttribute('y', p3[1]);
        text.setAttribute('class', 'tick-label');
        text.textContent = String(rpm / 1000);
        g.appendChild(text);
      }
    }
  }

  function check(ok, label, detail, level) {
    var li = document.createElement('li');
    var mark = document.createElement('span');
    mark.className = ok ? 'ok' : (level || 'bad');
    mark.textContent = ok ? '✓' : (level === 'warn' ? '!' : '✗');
    var body = document.createElement('span');
    body.textContent = label + (detail ? ' — ' + detail : '');
    li.appendChild(mark);
    li.appendChild(body);
    el.diag.appendChild(li);
    return li;
  }

  function renderDiagnostics() {
    el.diag.textContent = '';
    var ua = navigator.userAgent || '';
    if (/Tesla/i.test(ua)) check(true, 'Tesla browser detected');
    check(window.isSecureContext !== false, 'Secure connection (HTTPS)',
      window.isSecureContext === false ? 'location needs https://' : '');
    check(EngineAudio.supported(), 'Web Audio');
    var worklet = typeof window.AudioWorkletNode === 'function';
    check(worklet, 'AudioWorklet', worklet ? '' : 'using fallback, may crackle', 'warn');
    if (audio.kind) check(true, 'Sound engine', audio.kind + ' @ ' + audio.ctx.sampleRate + ' Hz');
    // What the browser reports for its own audio buffering; the car's audio
    // system adds its part after this.
    var delay = audio.ctx ? (audio.ctx.baseLatency || 0) + (audio.ctx.outputLatency || 0) : 0;
    if (audio.kind && delay > 0) check(delay < 0.15, 'Browser audio delay', Math.round(delay * 1000) + ' ms', 'warn');
    check(GpsSpeed.supported(), 'Location (GPS)');
    if (navigator.permissions && navigator.permissions.query) {
      var li = check(true, 'Location permission', 'checking…');
      navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
        var state = p.state;
        setLocPermission(state);
        p.onchange = function () { setLocPermission(p.state); };
        li.firstChild.className = state === 'denied' ? 'bad' : state === 'granted' ? 'ok' : 'muted';
        li.firstChild.textContent = state === 'denied' ? '✗' : state === 'granted' ? '✓' : '?';
        li.lastChild.textContent = 'Location permission — ' +
          (state === 'prompt' ? 'will be asked on start' : state);
      }, function () {
        li.firstChild.className = 'muted';
        li.firstChild.textContent = '?';
        li.lastChild.textContent = 'Location permission — unknown';
      });
    }
  }

  // ---------- controls ----------

  function setupSlider(id, key, onChange) {
    var input = $(id), out = $(id + 'Out');
    input.value = Math.round(settings[key] * 100);
    out.textContent = input.value + '%';
    input.addEventListener('input', function () {
      settings[key] = input.value / 100;
      out.textContent = input.value + '%';
      if (onChange) onChange(settings[key]);
      saveSettings();
    });
  }

  // Whine tuning sliders, only in the garage or when the site runs on this
  // computer or the local network (never on teslasound.io's own page), for
  // cars with a whine. -100 to 100: 0 is the car's own whine, ±100 an octave
  // higher or lower (pitch) or 4× louder or quieter (volume). Not saved: a
  // reload or another car goes back to the car's own.
  var TUNE_LOCAL = GARAGE || /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)$/.test(location.hostname);

  function setupTuning() {
    if (!TUNE_LOCAL) return;
    $('whinePitch').addEventListener('input', applyTuning);
    $('whineLevel').addEventListener('input', applyTuning);
  }

  function applyTuning() {
    ['whinePitch', 'whineLevel'].forEach(function (key) {
      var input = $(key);
      tune[key] = Math.pow(key === 'whinePitch' ? 2 : 4, input.value / 100);
      $(key + 'Out').textContent = input.value;
    });
    var hz = car.engine.sound.whineRatio * tune.whinePitch * 100;
    $('whineInfo').textContent = 'Whine at 6,000 rpm: ' + Math.round(hz).toLocaleString('en-US') + ' Hz, volume ×' + tune.whineLevel.toFixed(2) + '.';
  }

  // Per car: the sliders back at the car's own whine, shown only for a car with one.
  function renderTuning() {
    var on = TUNE_LOCAL && !electric && !!car.engine.sound.whine;
    Array.prototype.forEach.call(document.querySelectorAll('[data-local]'), function (n) { n.hidden = !on; });
    $('whinePitch').value = $('whineLevel').value = 0;
    tune.whinePitch = tune.whineLevel = 1;
    if (on) applyTuning();
  }

  function setMode(mode) {
    settings.mode = mode;
    saveSettings();
    document.body.classList.toggle('mode-demo', mode === 'demo');
    var btns = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-checked', String(btns[i].dataset.mode === mode));
    if (mode !== 'demo') stopDemo();
    if (engineOn) {
      if (mode === 'gps') {
        gpsSpeed = vehicle.speed;
        gps.start();
        setStatus('Drive — the engine follows your speed.');
      } else {
        gps.stop();
        setStatus('Test drive — press Gas / Brake (lower = harder, top of Gas holds speed), or play the demo run.');
      }
    }
    renderGps();
  }

  function setUnits(units) {
    settings.units = units;
    saveSettings();
    el.unit.textContent = units === 'mph' ? 'mph' : 'km/h';
    var btns = document.querySelectorAll('[data-units]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-checked', String(btns[i].dataset.units === units));
  }

  function setAutoplay(on) {
    settings.autoplay = on;
    saveSettings();
    var btns = document.querySelectorAll('[data-autoplay]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-checked', String((btns[i].dataset.autoplay === 'on') === on));
  }

  // "More settings" under Volume: opens and closes everything but Volume.
  // Closed at first; open or closed is remembered. The garage has no fold.
  function setMore(open) {
    if (!el.moreBtn) return;
    settings.more = open;
    saveSettings();
    el.moreBtn.setAttribute('aria-expanded', String(open));
    el.more.hidden = !open;
  }

  // "Autoplay last engine": on page load, start the car driven last. Not a
  // Pro car without Pro (findCar() then picked another), and not with the
  // free time used up: the page just opens as usual. Not in the garage.
  function autoplay() {
    if (GARAGE || !settings.autoplay || car.id !== settings.carId) return;
    if (!Paywall.isPro() && Paywall.trialLeft() <= 0) return;
    audio.canStart().then(function (ok) {
      if (engineOn) return;
      if (ok) startEngine();
      else waitForTap();
    });
  }

  // The browser blocks sound until the first tap: start on that tap, wherever
  // it lands. pointerup and click (not touchend), so a scroll doesn't count.
  function waitForTap() {
    var events = ['pointerup', 'click'];
    setStatus('Tap anywhere to start the engine.');
    function tap(e) {
      // Opening "More settings" (on the way to this switch) is not a start:
      // keep waiting.
      if (el.moreBtn && el.moreBtn.contains(e.target)) return;
      events.forEach(function (ev) { document.removeEventListener(ev, tap, true); });
      // Started by a pedal already, or the Start button is about to (starting
      // it here would make the button stop it again).
      if (engineOn || el.startBtn.contains(e.target)) return;
      if ($('autoplaySwitch').contains(e.target)) {
        setStatus('');
        return;
      }
      startEngine();
    }
    events.forEach(function (ev) { document.addEventListener(ev, tap, true); });
  }

  // The button in the gauge's top right corner: the gauge column takes the
  // full width and the controls move down under it, and back. Not kept
  // across reloads, so the page always opens with the Start button in view.
  // Not on the garage page.
  function setupGaugeMax() {
    var btn = $('gaugeMax');
    if (!btn) return;
    function set(on) {
      document.body.classList.toggle('gauge-max-on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Back to the controls' : 'Maximize gauge';
      // The car card's height depends on the controls' width.
      holdCarCardHeight();
      window.scrollTo(0, 0);
    }
    btn.addEventListener('click', function () { set(!document.body.classList.contains('gauge-max-on')); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('gauge-max-on')) set(false);
    });
  }

  function setupPads() {
    var all = document.querySelectorAll('[data-pad]');
    Array.prototype.forEach.call(all, function (pad) {
      var key = pad.dataset.pad;
      function press(e) {
        if (pad.disabled) return;
        e.preventDefault();
        if (pad.setPointerCapture && e.pointerId !== undefined) {
          try { pad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
        if (demo) stopDemo();
        if (!engineOn) startEngine();
        else audio.resumeIfNeeded();
        pads[key] = 1;
        pad.classList.add('active');
      }
      function release() {
        pads[key] = 0;
        pad.classList.remove('active');
      }
      pad.addEventListener('pointerdown', press);
      pad.addEventListener('pointerup', release);
      pad.addEventListener('pointercancel', release);
      pad.addEventListener('lostpointercapture', release);
      pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });

    function padLight(key, on) {
      var b = document.querySelector('[data-pad="' + key + '"], [data-pedal="' + key + '"]');
      if (!b) return;
      b.classList.toggle('active', on);
      b.style.setProperty('--press', on ? 1 : 0);
    }

    var keys = { ArrowUp: 'gas', KeyW: 'cruise', KeyD: 'gas', ArrowDown: 'brake', KeyS: 'brake', KeyB: 'brake', Space: 'rev', KeyR: 'rev' };
    document.addEventListener('keydown', function (e) {
      var key = keys[e.code];
      // Leave browser shortcuts alone (Ctrl/Cmd+R reload, Ctrl+W, Ctrl+D...).
      if (!key || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'INPUT') return;
      e.preventDefault();
      if (demo) stopDemo();
      if (!engineOn) startEngine();
      pads[key] = 1;
      padLight(key, true);
    });
    document.addEventListener('keyup', function (e) {
      var key = keys[e.code];
      if (!key) return;
      pads[key] = 0;
      padLight(key, false);
    });
    window.addEventListener('blur', function () {
      pads.gas = pads.brake = pads.rev = pads.cruise = pads.hold = 0;
      ['gas', 'brake', 'rev', 'cruise'].forEach(function (k) { padLight(k, false); });
    });
  }

  // Test-drive Gas and Brake pedals: the lower the finger on the pedal, the
  // harder it presses, and sliding up or down while holding eases on or off.
  // The top part of the Gas pedal holds the current speed instead.
  function setupPedals() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-pedal]'), function (pedal) {
      var key = pedal.dataset.pedal;
      var plate = pedal.querySelector('.pedal-plate');
      var pointer = null;
      function apply(e) {
        var r = plate.getBoundingClientRect();
        var f = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        if (key === 'gas') {
          pads.hold = f < GAS_HOLD ? 1 : 0;
          f = Math.max(0, (f - GAS_HOLD) / (1 - GAS_HOLD));
        }
        pads[key] = PEDAL_MIN + (1 - PEDAL_MIN) * f;
        pedal.style.setProperty('--press', pads[key].toFixed(3));
      }
      function press(e) {
        e.preventDefault();
        try { pedal.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (demo) stopDemo();
        if (!engineOn) startEngine();
        else audio.resumeIfNeeded();
        pointer = e.pointerId;
        pedal.classList.add('active');
        apply(e);
      }
      function release(e) {
        if (e.pointerId !== pointer) return;
        pointer = null;
        pads[key] = 0;
        if (key === 'gas') pads.hold = 0;
        pedal.classList.remove('active');
        pedal.style.setProperty('--press', 0);
      }
      pedal.addEventListener('pointerdown', press);
      pedal.addEventListener('pointermove', function (e) { if (e.pointerId === pointer) apply(e); });
      pedal.addEventListener('pointerup', release);
      pedal.addEventListener('pointercancel', release);
      pedal.addEventListener('lostpointercapture', release);
      pedal.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  }

  // Hold the car card at the height of the car with the longest name and
  // tagline (at this screen width), so picking another car doesn't move the
  // car picker below it.
  function holdCarCardHeight() {
    var name = $('carName'), tag = $('carTag'), card = name.parentNode, max = 0;
    card.style.minHeight = '';
    cars.forEach(function (c) {
      name.textContent = c.name;
      tag.textContent = c.tagline;
      max = Math.max(max, card.offsetHeight);
    });
    name.textContent = car.name;
    tag.textContent = car.tagline;
    card.style.minHeight = max + 'px';
  }

  // Everything on the page that shows the current car.
  function showCar() {
    carPhoto($('carHero'), car);
    $('carName').textContent = car.name;
    $('carTag').textContent = car.tagline;
    markPickedCar();
    setupTach();
    $('crackle').parentNode.hidden = electric || haunted;
    document.body.classList.toggle('haunted', haunted);
    el.revPad.firstChild.textContent = thruster ? 'Thrust' : 'Rev';
    el.revPad.querySelector('small').textContent = thruster ? 'hold to fire' : 'hold while stopped';
    renderTuning();
  }

  // The public page's GPS help, "All cars" and Pro (not in the garage).
  function initPublic() {
    var help = $('gpsHelp');
    function openHelp() { if (el.gpsChip.hasAttribute('data-help')) help.hidden = false; }
    el.gpsChip.addEventListener('click', openHelp);
    el.gpsChip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHelp(); } });
    el.gpsWarnHelp.addEventListener('click', function () { help.hidden = false; });
    $('gpsHelpClose').addEventListener('click', function () { help.hidden = true; });
    help.addEventListener('click', function (e) { if (e.target === help) help.hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') help.hidden = true; });

    setupMyCarsDrag();
    $('trySortBtn').addEventListener('click', startTrial);
    $('trySortPro').addEventListener('click', function () {
      track('Sort test Get Pro');
      Paywall.open('pin');
    });
    $('carsClose').addEventListener('click', closeAllCars);
    carsModal.addEventListener('click', function (e) { if (e.target === carsModal) closeAllCars(); });
    // Capture phase, so this runs before the payment modal's own Escape handler:
    // when that modal is open over this one, Escape closes only the payment modal.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('payModal').hidden) closeAllCars();
    }, true);

    // Paywall changes every second of trial time; the car lists only change when Pro does.
    var wasPro = Paywall.isPro();
    Paywall.onChange(function () {
      renderPro();
      if (Paywall.isPro() === wasPro) return;
      wasPro = !wasPro;
      // Got Pro during a test run: the list they made becomes their front page.
      if (wasPro && trial) {
        settings.pinned = trial;
        saveSettings();
        trial = null;
      }
      renderCarPicker();
      if (allTiles) renderAllCars();
    });
    el.proBtn.addEventListener('click', function () { Paywall.open(); });
    renderPro();
  }

  function init() {
    holdCarCardHeight();
    window.addEventListener('resize', holdCarCardHeight);
    renderCarPicker();
    setupTuning();
    showCar();
    setupSlider('volume', 'volume', function (v) { audio.setVolume(v); });
    setupSlider('intensity', 'intensity', function (v) { vehicle.intensity = v; });
    setupSlider('character', 'character');
    setupSlider('crackle', 'crackle');
    setMode(settings.mode);
    setUnits(settings.units);
    setAutoplay(settings.autoplay);
    setMore(settings.more);
    setupPads();
    setupPedals();
    setupGaugeMax();

    el.startBtn.addEventListener('click', function () {
      if (engineOn) stopEngine();
      else startEngine();
    });
    if (el.gpsOnBtn) el.gpsOnBtn.addEventListener('click', turnOnGps);
    el.demoBtn.addEventListener('click', function () {
      if (demo) stopDemo();
      else startDemo();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-units]'), function (b) {
      b.addEventListener('click', function () { setUnits(b.dataset.units); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (b) {
      b.addEventListener('click', function () {
        settings.sort = settings.sort === b.dataset.sort ? '' : b.dataset.sort;
        saveSettings();
        if (allTiles) sortAllCars();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-autoplay]'), function (b) {
      b.addEventListener('click', function () { setAutoplay(b.dataset.autoplay === 'on'); });
    });
    if (el.moreBtn) el.moreBtn.addEventListener('click', function () { setMore(!settings.more); });
    // If the browser suspended audio (screen off, app switch), any tap brings it back.
    // iOS Safari only unlocks audio on touchend/click (not pointerdown), so listen for those too.
    ['pointerdown', 'pointerup', 'touchend', 'click'].forEach(function (ev) {
      document.addEventListener(ev, function () { if (engineOn) audio.resumeIfNeeded(); }, true);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && engineOn) audio.resumeIfNeeded();
    });

    if (!GARAGE) initPublic();

    renderDiagnostics();
    requestAnimationFrame(render);
    autoplay();

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ });
    }
  }

  init();
})();
