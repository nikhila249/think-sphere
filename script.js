const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '';
const SPLASH_VOICE_TEXT = 'ThinkSphere Super Intelligence.';

const introSplash = document.querySelector('.intro-splash');
let splashVoiceUrl = null;
let splashVoiceLoading = null;
let splashAudio = null;
let splashVoicePending = false;

function loadSplashVoice() {
  if (splashVoiceUrl) return Promise.resolve(splashVoiceUrl);
  if (splashVoiceLoading) return splashVoiceLoading;
  splashVoiceLoading = fetch(API_BASE + '/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: SPLASH_VOICE_TEXT })
  })
    .then((res) => {
      if (!res.ok) throw new Error('tts ' + res.status);
      return res.blob();
    })
    .then((blob) => {
      if (!blob.size) throw new Error('empty audio');
      splashVoiceUrl = URL.createObjectURL(blob);
      return splashVoiceUrl;
    })
    .catch(() => null)
    .finally(() => { splashVoiceLoading = null; });
  return splashVoiceLoading;
}

function showSplashSound() {
  if (!introSplash) return;
  const button = introSplash.querySelector('[data-splash-sound]');
  if (button) button.hidden = false;
}

async function playSplashVoice() {
  if (!introSplash || splashVoicePending) return;
  if (splashAudio && !splashAudio.paused) return;
  splashVoicePending = true;
  try {
    if (!splashAudio) {
      const url = await loadSplashVoice();
      if (!url) return;
      splashAudio = new Audio(url);
      splashAudio.preload = 'auto';
    }
    await splashAudio.play();
    const button = introSplash.querySelector('[data-splash-sound]');
    if (button) button.hidden = true;
  } catch (_) {
    showSplashSound();
  } finally {
    splashVoicePending = false;
  }
}

if (introSplash) {
  loadSplashVoice();
  window.setTimeout(playSplashVoice, 1200);
  introSplash.addEventListener('pointerdown', playSplashVoice, { once: true });
  const soundButton = introSplash.querySelector('[data-splash-sound]');
  if (soundButton) soundButton.addEventListener('click', playSplashVoice);
  window.setTimeout(() => introSplash.classList.add('leave'), 3900);
  window.setTimeout(() => introSplash.remove(), 4700);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    } else {
      entry.target.classList.remove('visible');
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });

document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));

const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav-links');
const setMenu = (open) => {
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  nav.classList.toggle('open', open);
};
menuButton.addEventListener('click', () => {
  setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
});
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenu(false);
});
document.addEventListener('click', (event) => {
  if (!nav.contains(event.target) && !menuButton.contains(event.target)) setMenu(false);
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) setMenu(false);
});

const heroArt = document.querySelector('.hero-art');
if (heroArt && window.matchMedia('(pointer: fine)').matches) {
  let pointerFrame;
  heroArt.addEventListener('pointermove', (event) => {
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      const bounds = heroArt.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      heroArt.style.setProperty('--pointer-x', x.toFixed(2));
      heroArt.style.setProperty('--pointer-y', y.toFixed(2));
    });
  });
  heroArt.addEventListener('pointerleave', () => {
    heroArt.style.removeProperty('--pointer-x');
    heroArt.style.removeProperty('--pointer-y');
  });
}

const scrollProgress = document.querySelector('.scroll-progress');
const updateScrollProgress = () => {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
  scrollProgress.style.setProperty('--page-progress', progress.toFixed(3));
};
window.addEventListener('scroll', updateScrollProgress, { passive: true });
window.addEventListener('resize', updateScrollProgress);
updateScrollProgress();
