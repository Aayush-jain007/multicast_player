const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win;
let ffmpegProc;

// Get correct ffmpeg path depending on dev or packaged mode
function getFFmpegPath() {
  if (app.isPackaged) {
    // When packaged, ffmpeg.exe will be inside resources/ffmpeg/
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  } else {
    // In development, use local ffmpeg/ffmpeg.exe (or system ffmpeg on Linux)
    // For testing on Ubuntu, you can keep 'ffmpeg' to use system binary
    return process.platform === 'win32'
      ? path.join(__dirname, 'ffmpeg', 'ffmpeg.exe')
      : 'ffmpeg';
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, // maybe increase size for better UI space
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('start-stream', (_, { address, port }) => {
  stopStream();

  const args = [
    '-protocol_whitelist', 'file,udp,rtp',
    '-i', `rtp://@${address}:${port}`,
    '-acodec', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '1',
    '-f', 'wav',
    'pipe:1'
  ];

  const ffmpegPath = getFFmpegPath();
  console.log('Platform:', process.platform);
  console.log('Is Packaged:', app.isPackaged);
  console.log('Launching ffmpeg from:', ffmpegPath);

  ffmpegProc = spawn(ffmpegPath, args);

  ffmpegProc.stdout.on('data', chunk => {
    win.webContents.send('audio-chunk', chunk.toString('base64'));
  });

  ffmpegProc.stderr.on('data', data => {
    win.webContents.send('log', data.toString());
  });

  ffmpegProc.on('error', (error) => {
    console.error('FFmpeg spawn error:', error);
    win.webContents.send('log', `FFmpeg Error: ${error.message}`);
  });

  ffmpegProc.on('close', () => {
    win.webContents.send('log', 'Stream stopped');
  });
});

ipcMain.handle('stop-stream', () => {
  stopStream();
});

function stopStream() {
  if (ffmpegProc) {
    ffmpegProc.kill();
    ffmpegProc = null;
  }
}

app.on('window-all-closed', () => app.quit());
