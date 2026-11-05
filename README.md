# ev-engine-sound-simulator
Live engine sound simulator (TeslaSound - Vinfast) for VinFast and other EVs using Web Audio API and real-time GPS speed tracking.


# 🚗 EV Engine Sound Simulator (TeslaSound - Vinfast)

A real-time, browser-based engine sound synthesizer designed for VinFast and other Electric Vehicles (EVs). It uses the **Web Audio API** and **GPS speed tracking** to synthesize authentic gas engine sounds (V8, V12, Flat-Six, etc.) directly in the vehicle's browser.

## ✨ Features

* **Live Sound Synthesis:** Audio is generated in real-time using DSP algorithms rather than audio loops, dynamically reacting to acceleration and speed changes.

* **GPS Speed Integration:** Tracks vehicle movement via browser GPS geolocation to simulate realistic engine revs and gear shifts.

* **Multiple Engine Profiles:** Supports various car sound signatures (e.g., Porsche 911 GT3, V8 Muscle, etc.).

* **Interactive Dash & Gauge:** Features a full instrument cluster UI showing real-time RPM, speed, throttle levels, and gear states.

* **Test Drive Mode:** Built-in simulation controls with virtual pedals to test engine sound profiles without moving the car.

* **VinFast & EV Browser Optimized:** Designed to run seamlessly inside in-car web browsers or any mobile device connected via Bluetooth.

## 📁 Project Structure

```
evsound-io/
├── css/
│   ├── story-exp.css
│   ├── story.css
│   ├── style-exp.css
│   └── style.css          # Main styling for UI and gauge components
├── images/                # Asset icons, background graphics, and Open Graph previews
├── img/                   # Additional dynamic car renders/assets
├── js/
│   ├── app.js             # Application entry point and UI controller
│   ├── audio.js           # Web Audio API engine initialization
│   ├── engine-dsp.js      # Digital Signal Processing algorithm for engine sound synthesis
│   ├── gps.js             # Geolocation tracking and speed calculation
│   ├── vehicle.js         # Vehicle physics & RPM model
│   ├── cars.js            # Engine profiles configuration
│   ├── help.js            # FAQ and onboard modal logic
│   ├── paywall.js         # Subscription/freemium model handler
│   ├── qrcode.js          # Cross-device pair link generator
│   ├── thruster-fx.js     # Sound modifier effects
│   └── version.js         # Version control management
├── explore.html           # Feature showcase page
└── index.html             # Core web app interface
```

## 🚀 Getting Started

Since this project is built with pure HTML5, CSS3, and modern JavaScript, no build process or node dependencies are required.

### Local Development

1. Clone the repository:

   ```bash
   git clone https://github.com/Richards-Tech/ev-engine-sound-simulator.git
   ```

2. Navigate into the project folder:

   ```bash
   cd ev-engine-sound-simulator
   ```

3. Open `index.html` using a local web server (e.g., Live Server extension in VS Code, or python simple server):

   ```bash
   python3 -m http.server 8000
   ```

4. Access `http://localhost:8000` in your browser.

> **Note:** GPS tracking requires secure context (`https://`) or `localhost` to access location services in modern browsers.

## 🛠️ Built With

* **HTML5 & CSS3** - Responsive UI styled for modern embedded car displays.

* **JavaScript (ES6+)** - Pure modular JS without external frameworks.

* **Web Audio API** - Real-time audio synthesis and sound wave processing (`engine-dsp.js`).

* **HTML5 Geolocation API** - High-accuracy GPS tracking for speed calculation.

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
