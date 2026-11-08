(() => {
  'use strict';

  const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '';
  const guide = document.querySelector('[data-voice-guide]');
  if (!guide) return;

  const SECTIONS = [
    {
      id: 'hero',
      sel: '.hero',
      title: 'Welcome',
      context: 'ThinkSphere Super Intelligence. Mission: build intelligent AI-powered products and solutions that simplify lives, empower people, and create a smarter future. Tagline: technology should feel human. Eyebrow: think clearer, live better. Based in Hyderabad, India.',
      fallback: 'Welcome to ThinkSphere Super Intelligence. We build thoughtful AI products that make everyday life simpler, more capable, and a little smarter.'
    },
    {
      id: 'about',
      sel: '#about',
      title: 'A smarter kind of technology',
      context: 'ThinkSphere Super Intelligence believes technology should feel human. It creates software, AI, and SaaS products that solve real-world problems across industries. North star: make the complex feel simple. Values: simplify, empower, move forward. The section invites visitors to explore the ThinkSphere Super Intelligence product engine.',
      fallback: 'ThinkSphere Super Intelligence believes technology should feel human, so we create software, AI, and SaaS products that solve real problems and make complex things feel simple.'
    },
    {
      id: 'ecosystem',
      sel: '#ecosystem',
      title: 'The product engine',
      context: 'One engine, many products. ThinkSphere Super Intelligence is a multi-product technology company building AI, SaaS, and digital solutions. Four branches: AI systems covering generative AI, agents and automation; SaaS products with cloud tools, APIs and subscriptions; business tools for workflow, analytics and decisions; and digital learning for education, skills and new ideas. Process: research, build, operate, scale.',
      fallback: 'At the center is the ThinkSphere Super Intelligence product engine, connecting AI systems, SaaS platforms, business tools, and digital learning, from first sketch all the way to global scale.'
    },
    {
      id: 'focus',
      sel: '#focus',
      title: 'Where we focus',
      context: 'Ideas become impact when the right minds work together. ThinkSphere Super Intelligence focuses first on education, opening new possibilities for learning with intelligent tools and human-first thinking. Other areas: technology and SaaS; research and analytics; people and growth through skill development. Also exploring business support, corporate research, marketing and content.',
      fallback: 'ThinkSphere Super Intelligence focuses on education, technology and SaaS, research and analytics, and people and growth, building intelligent tools that open new possibilities.'
    },
    {
      id: 'approach',
      sel: '#approach',
      title: 'Our point of view',
      context: 'The ThinkSphere Super Intelligence point of view: the best intelligence is the kind that helps everyone move forward. Built around people, designed for what is next.',
      fallback: 'The ThinkSphere Super Intelligence point of view is simple: the best intelligence is the kind that helps everyone move forward, built around people and designed for what is next.'
    },
    {
      id: 'connect',
      sel: '#connect',
      title: 'The next idea starts here',
      context: 'ThinkSphere Super Intelligence invites visitors to make something that matters. A good idea can change an ordinary day. The company is based in Hyderabad, India, and invites people to reach out and build the next meaningful idea together.',
      fallback: 'The next idea starts here. Let us make something that matters with ThinkSphere Super Intelligence and build a smarter, more human future together.'
    }
  ];

  const CARD_META = {
    'Education': {
      context: 'ThinkSphere Super Intelligence focuses first on education, opening new possibilities for learning with intelligent tools and human-first thinking.',
      fallback: 'ThinkSphere Super Intelligence focuses first on education, opening new possibilities for learning with intelligent tools and human-first thinking.'
    },
    'Technology & SaaS': {
      context: 'In technology and SaaS, ThinkSphere Super Intelligence builds intelligent products, software, and services for a changing world, including cloud tools and APIs.',
      fallback: 'In technology and SaaS, ThinkSphere Super Intelligence builds intelligent products, software, and services for a changing world.'
    },
    'Research & analytics': {
      context: 'ThinkSphere Super Intelligence turns research and data into meaningful insight, finding the signal in complexity.',
      fallback: 'ThinkSphere Super Intelligence finds the signal in complexity through research, data, and meaningful insight.'
    },
    'People & growth': {
      context: 'ThinkSphere Super Intelligence supports people and growth by helping teams become stronger through skill development and thoughtful communication.',
      fallback: 'ThinkSphere Super Intelligence supports stronger teams through skill development and thoughtful communication.'
    }
  };

  const cardSections = new Map();
  const cardSectionFor = new WeakMap();
  document.querySelectorAll('#focus .focus-card').forEach((card) => {
    const titleEl = card.querySelector('h3');
    if (!titleEl) return;
    const title = titleEl.textContent.trim();
    const descEl = card.querySelector('p');
    const desc = descEl ? descEl.textContent.trim() : '';
    const meta = CARD_META[title] || {};
    const section = {
      id: 'focus-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      title: title,
      context: (meta.context ? meta.context + ' ' : '') + desc,
      fallback: meta.fallback || desc,
      staticText: meta.fallback || desc
    };
    cardSections.set(section.id, section);
    cardSectionFor.set(card, section);
    card.tabIndex = 0;
  });

  const trigger = guide.querySelector('[data-action="toggle"]');
  const panel = guide.querySelector('.voice-panel');
  const sectionEl = guide.querySelector('[data-section]');
  const captionEl = guide.querySelector('[data-caption]');
  const stateLabel = guide.querySelector('[data-state-label]');
  const playBtn = guide.querySelector('[data-action="play"]');
  const replayBtn = guide.querySelector('[data-action="replay"]');
  const closeBtn = guide.querySelector('[data-action="close"]');

  const cache = new Map();
  let enabled = false;
  let activeId = null;
  let audio = null;
  let seq = 0;
  let scrollTimer = null;
  let prefetching = false;
  let health = { server: false, ollama: false, tts: false };

  const sectionForId = (id) => SECTIONS.find((s) => s.id === id) || null;
  const resolveSection = (id) => SECTIONS.find((s) => s.id === id) || cardSections.get(id) || null;

  function entryFor(id) {
    if (!cache.has(id)) {
      cache.set(id, { text: null, url: null, textPromise: null, audioPromise: null, error: false });
    }
    return cache.get(id);
  }

  function setStatus(kind, label) {
    guide.dataset.state = kind;
    stateLabel.textContent = label;
  }

  function setPanel(open) {
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    trigger.setAttribute('aria-expanded', String(open));
  }

  function updatePlayLabel() {
    playBtn.textContent = audio && !audio.paused ? 'Pause' : 'Play';
  }

  function stopAudio() {
    if (!audio) return;
    audio.onended = null;
    audio.onplay = null;
    audio.onpause = null;
    audio.pause();
    audio.currentTime = 0;
    audio = null;
    updatePlayLabel();
  }

  function getActiveId() {
    const mid = window.innerHeight * 0.5;
    let found = null;
    for (const s of SECTIONS) {
      const el = document.querySelector(s.sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) found = s.id;
    }
    return found || 'hero';
  }

  async function ensureText(section) {
    const entry = entryFor(section.id);
    if (entry.text) return entry.text;
    if (section.staticText) {
      entry.text = section.staticText;
      return entry.text;
    }
    if (entry.textPromise) return entry.textPromise;
    entry.textPromise = (async () => {
      try {
        const res = await fetch(API_BASE + '/api/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: section.id, title: section.title, context: section.context })
        });
        if (!res.ok) throw new Error('explain ' + res.status);
        const data = await res.json();
        if (!data.text) throw new Error('empty explanation');
        entry.text = data.text;
        return entry.text;
      } catch (err) {
        entry.error = true;
        entry.text = section.fallback;
        return entry.text;
      } finally {
        entry.textPromise = null;
      }
    })();
    return entry.textPromise;
  }

  async function ensureAudio(section) {
    const entry = entryFor(section.id);
    if (entry.url) return entry.url;
    if (entry.audioPromise) return entry.audioPromise;
    entry.audioPromise = (async () => {
      try {
        const text = await ensureText(section);
        const res = await fetch(API_BASE + '/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        if (!res.ok) throw new Error('tts ' + res.status);
        const blob = await res.blob();
        if (!blob.size) throw new Error('empty audio');
        entry.url = URL.createObjectURL(blob);
        return entry.url;
      } catch (err) {
        entry.audioError = true;
        return null;
      } finally {
        entry.audioPromise = null;
      }
    })();
    return entry.audioPromise;
  }

  function playUrl(url, section, run) {
    stopAudio();
    if (!url) return;
    audio = new Audio(url);
    audio.preload = 'auto';
    audio.onplay = () => {
      if (run !== seq) return;
      setStatus('speaking', 'Speaking');
      updatePlayLabel();
    };
    audio.onpause = () => {
      if (run !== seq || !audio) return;
      updatePlayLabel();
      if (audio.currentTime > 0 && !audio.ended) setStatus('paused', 'Paused');
    };
    audio.onended = () => {
      if (run !== seq) return;
      setStatus('idle', 'Listening');
      updatePlayLabel();
    };
    const played = audio.play();
    if (played && played.catch) {
      played.catch(() => {
        if (run !== seq) return;
        setStatus('paused', 'Tap play');
        updatePlayLabel();
      });
    }
  }

  async function explain(section, force) {
    if (!enabled || !section) return;
    if (activeId === section.id && !force) return;
    activeId = section.id;
    const run = ++seq;
    stopAudio();
    sectionEl.textContent = section.title;
    const entry = entryFor(section.id);
    captionEl.textContent = entry.text || section.fallback;
    setStatus('thinking', 'Thinking');
    updatePlayLabel();

    await ensureText(section);
    if (run !== seq || !enabled) return;
    captionEl.textContent = entry.text;

    const url = await ensureAudio(section);
    if (run !== seq || !enabled) return;
    if (url) {
      playUrl(url, section, run);
    } else {
      setStatus('offline', 'Captions only');
    }
  }

  async function prefetchOthers() {
    if (prefetching) return;
    prefetching = true;
    for (const s of SECTIONS) {
      if (!enabled) break;
      if (s.id === activeId) continue;
      const entry = entryFor(s.id);
      if (entry.url) continue;
      try {
        await ensureText(s);
        if (!enabled) break;
        await ensureAudio(s);
      } catch (_) {}
    }
    prefetching = false;
  }

  let cardsPrefetching = false;

  async function prefetchCards() {
    if (cardsPrefetching || !enabled) return;
    cardsPrefetching = true;
    for (const section of cardSections.values()) {
      if (!enabled) break;
      const entry = entryFor(section.id);
      if (entry.url) continue;
      try {
        await ensureText(section);
        if (!enabled) break;
        await ensureAudio(section);
      } catch (_) {}
    }
    cardsPrefetching = false;
  }

  function setEnabled(on) {
    enabled = on;
    guide.classList.toggle('active', on);
    if (on) {
      setPanel(true);
      const id = getActiveId();
      activeId = null;
      explain(sectionForId(id));
      setTimeout(prefetchOthers, 1800);
    } else {
      clearHover();
      stopAudio();
      setPanel(false);
      activeId = null;
      setStatus('idle', 'Ready');
    }
    updatePlayLabel();
  }

  trigger.addEventListener('click', () => setEnabled(!enabled));
  closeBtn.addEventListener('click', () => setEnabled(false));

  playBtn.addEventListener('click', () => {
    if (audio) {
      if (audio.paused) {
        const played = audio.play();
        if (played && played.catch) played.catch(() => setStatus('paused', 'Tap play'));
      } else {
        audio.pause();
      }
      return;
    }
    const section = resolveSection(activeId || getActiveId());
    activeId = null;
    explain(section, true);
  });

  replayBtn.addEventListener('click', () => {
    const section = resolveSection(activeId || getActiveId());
    activeId = null;
    explain(section, true);
  });

  let hoverTimer = null;

  function clearHover() {
    window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function speakCard(section) {
    if (!enabled || !section) return;
    if (activeId === section.id && audio && !audio.paused) return;
    activeId = null;
    explain(section, true).then(() => {
      if (enabled) window.setTimeout(prefetchCards, 1500);
    });
  }

  document.querySelectorAll('#focus .focus-card').forEach((card) => {
    const section = cardSectionFor.get(card);
    if (!section) return;
    card.addEventListener('mouseenter', () => {
      if (!enabled) return;
      clearHover();
      hoverTimer = window.setTimeout(() => speakCard(section), 320);
    });
    card.addEventListener('mouseleave', clearHover);
    card.addEventListener('focusin', () => {
      if (!enabled) return;
      clearHover();
      hoverTimer = window.setTimeout(() => speakCard(section), 320);
    });
    card.addEventListener('focusout', clearHover);
  });

  function onScroll() {
    if (!enabled) return;
    const id = getActiveId();
    if (!id || id === activeId) return;
    if (id === 'focus' && activeId && activeId.indexOf('focus-') === 0) return;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      if (!enabled) return;
      const section = sectionForId(getActiveId());
      if (section) {
        activeId = null;
        explain(section);
      }
    }, 650);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  fetch(API_BASE + '/api/health')
    .then((r) => r.json())
    .then((data) => {
      health = data;
      if (!data.ollama || !data.tts) {
        setStatus('idle', 'Ready');
      }
    })
    .catch(() => {
      health = { server: false, ollama: false, tts: false };
    });

  window.setTimeout(() => {
    if (enabled) return;
    const section = sectionForId(getActiveId());
    if (!section) return;
    ensureText(section)
      .then(() => ensureAudio(section))
      .catch(() => {});
  }, 4500);

  setStatus('idle', 'Ready');
  updatePlayLabel();
})();
