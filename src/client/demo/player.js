const player = document.getElementById('demo-player');
const choice = document.getElementById('demo-audio');
const status = document.getElementById('demo-playback-status');
let position = 0;
choice.addEventListener('change', () => {
  if (player.readyState >= 1) position = player.currentTime;
  player.pause();
  player.src = choice.value === 'silent' ? '/demo/handle-demo-silent.mp4' : '/demo/handle-demo.mp4';
  player.load();
  status.textContent = `${choice.selectedOptions[0].textContent} selected. Press play to watch.`;
});
player.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(player.duration)) player.currentTime = Math.min(position, player.duration);
});
player.addEventListener('error', () => {
  status.textContent = 'This video could not load. Choose another version or try again.';
});
