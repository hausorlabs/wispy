const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const FFMPEG = 'C:\\Users\\Windows\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const files = [
  { name: 'anim-10-bottleneck', duration: 12, dark: false },
];

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const FRAMES_DIR = path.join(__dirname, '_frames');

async function convertFile(browser, file) {
  const frameDir = path.join(FRAMES_DIR, file.name);
  if (!fs.existsSync(frameDir)) fs.mkdirSync(frameDir, { recursive: true });
  console.log(`\n  Recording: ${file.name} (${file.duration}s at ${FPS}fps)`);

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  const htmlPath = path.join(__dirname, `${file.name}.html`);
  const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;

  // First load to cache fonts
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await sleep(2000);

  // Reload to restart animations
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await sleep(100);

  // Fade-in overlay
  const fadeBg = file.dark ? '#0B0F1A' : '#8ACFEA';
  await page.evaluate((bg) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:99999;background:${bg};opacity:1;transition:opacity 1.2s cubic-bezier(0.25,0.1,0.25,1);pointer-events:none`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '0'; }));
  }, fadeBg);

  const totalFrames = file.duration * FPS;
  const frameInterval = 1000 / FPS;

  for (let i = 0; i < totalFrames; i++) {
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: path.join(frameDir, `frame_${frameNum}.png`), type: 'png' });
    if (i < totalFrames - 1) await sleep(frameInterval);
    if (i > 0 && i % (FPS * 2) === 0) process.stdout.write(` ${Math.round((i / totalFrames) * 100)}%`);
  }
  console.log(' 100%');
  await page.close();

  const outputPath = path.join(__dirname, `${file.name}.mp4`);
  const fadeOutStart = Math.max(0, file.duration - 1.5);
  const ffmpegCmd = [
    `"${FFMPEG}"`,
    '-y',
    `-framerate ${FPS}`,
    `-i "${path.join(frameDir, 'frame_%05d.png')}"`,
    `-vf "fade=t=out:st=${fadeOutStart}:d=1.5,format=yuv420p"`,
    '-c:v libx264',
    '-preset slow',
    '-crf 18',
    '-pix_fmt yuv420p',
    '-movflags +faststart',
    `"${outputPath}"`,
  ].join(' ');

  console.log(`  Encoding ${file.name}.mp4...`);
  try {
    execSync(ffmpegCmd, { stdio: 'pipe' });
    const size = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
    console.log(`  Done: ${file.name}.mp4 (${size} MB)`);
  } catch (err) {
    console.error(`  FFmpeg error:`, err.stderr?.toString().slice(-500));
  }
  fs.rmSync(frameDir, { recursive: true, force: true });
}

(async () => {
  console.log('=== Converting new demo scenes ===');
  if (!fs.existsSync(FRAMES_DIR)) fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [`--window-size=${WIDTH},${HEIGHT}`, '--no-sandbox', '--force-color-profile=srgb'],
  });
  for (const file of files) {
    try { await convertFile(browser, file); } catch (err) { console.error(`  FAILED: ${file.name}:`, err.message); }
  }
  await browser.close();
  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  console.log('\nAll done!');
})();
