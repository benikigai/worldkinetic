const descriptions = [
  ['Reveal the geometry.', 'A coordinate frame and construction lines establish the object in space.'],
  ['Adjust one selected surface.', 'A blue control point moves one segment. The ghost outline preserves its original position.'],
  ['Review the proposed form.', 'Movement stops. Construction lines fade, leaving the refined Adaptive K.'],
];

const scene = document.querySelector('.motion-card');
const playButton = document.getElementById('play-motion');
const playLabel = document.getElementById('play-label');
const steps = [...document.querySelectorAll('[data-step-button]')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let playback = null;

function stopPlayback() {
  window.clearTimeout(playback);
  playback = null;
  playLabel.textContent = reducedMotion.matches ? 'Next stage' : 'Play motion';
}

function showStep(step) {
  scene.dataset.step = String(step);
  document.getElementById('scene-caption').textContent = descriptions[step][0];
  document.getElementById('step-description').textContent = descriptions[step][1];
  steps.forEach((button, index) => button.setAttribute('aria-pressed', String(index === step)));
}

steps.forEach((button, index) => button.addEventListener('click', () => {
  stopPlayback();
  showStep(index);
}));

playButton.addEventListener('click', () => {
  if (playback !== null) {
    stopPlayback();
    return;
  }
  if (reducedMotion.matches) {
    showStep((Number(scene.dataset.step) + 1) % descriptions.length);
    return;
  }
  showStep(0);
  playLabel.textContent = 'Stop motion';
  playback = window.setTimeout(() => {
    showStep(1);
    playback = window.setTimeout(() => {
      showStep(2);
      stopPlayback();
    }, 1300);
  }, 800);
});

window.addEventListener('pagehide', stopPlayback);
reducedMotion.addEventListener('change', stopPlayback);
stopPlayback();
