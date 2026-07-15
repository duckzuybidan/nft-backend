import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

let configured = false;

export function configureFfmpeg() {
  if (configured) {
    return;
  }

  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
  configured = true;
}

export function toFfmpegPath(filePath: string) {
  return filePath.replace(/\\/g, '/');
}
