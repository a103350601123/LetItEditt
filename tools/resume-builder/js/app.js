'use strict';

/* ------------------------------------------------------------------
   Resume / CV Builder
   Vanilla JS. Renders a semantic resume from data + a 10-layout ×
   6-theme template engine, updates live, saves to localStorage and
   prints through the browser's own print pipeline.
------------------------------------------------------------------- */

const STORAGE_KEY = 'toolbox.resumeBuilder.v1';
const PAGE_W = 794;   // A4 width at 96 dpi
const PAGE_H = 1123;  // A4 height at 96 dpi
const MAX_PHOTO = 640;

/* ---------- template engine configuration ---------- */

const THEMES = [
  { id: 'indigo',   name: 'Indigo',   accent: '#4f46e5', deep: '#312e81', soft: '#eef2ff', line: '#e3e6ef' },
  { id: 'teal',     name: 'Teal',     accent: '#0f766e', deep: '#134e4a', soft: '#ecfdf5', line: '#dceae7' },
  { id: 'crimson',  name: 'Crimson',  accent: '#b91c1c', deep: '#7f1d1d', soft: '#fef2f2', line: '#f0dcdf' },
  { id: 'amber',    name: 'Amber',    accent: '#b45309', deep: '#78350f', soft: '#fffbeb', line: '#efe6d4' },
  { id: 'forest',   name: 'Forest',   accent: '#15803d', deep: '#14532d', soft: '#f0fdf4', line: '#dceade' },
  { id: 'graphite', name: 'Graphite', accent: '#334155', deep: '#1e293b', soft: '#f1f5f9', line: '#e0e5ec' }
];

const MAIN_TWO = ['summary', 'experience', 'projects', 'education'];
const SIDE_TWO = ['contact', 'skills', 'languages', 'certifications'];

const LAYOUTS = [
  { id: 'classic', name: 'Classic', structure: 'single',
    order: ['summary', 'experience', 'education', 'projects', 'skills', 'certifications', 'languages'] },

  { id: 'minimal', name: 'Minimal', structure: 'single',
    order: ['summary', 'experience', 'education', 'projects', 'skills', 'languages', 'certifications'] },

  { id: 'modern', name: 'Modern', structure: 'two', side: 'right', sideWidth: '34%',
    main: MAIN_TWO, sideSections: SIDE_TWO },

  { id: 'sidebar-left', name: 'Left Sidebar', structure: 'two', side: 'left',
    main: MAIN_TWO, sideSections: SIDE_TWO },

  { id: 'sidebar-right', name: 'Right Sidebar', structure: 'two', side: 'right',
    main: MAIN_TWO, sideSections: SIDE_TWO },

  { id: 'creative', name: 'Creative', structure: 'two', side: 'left', sideWidth: '36%', dark: true,
    main: ['summary', 'experience', 'education', 'projects'], sideSections: SIDE_TWO },

  { id: 'executive', name: 'Executive', structure: 'single', centered: true,
    order: ['summary', 'experience', 'education', 'skills', 'certifications', 'projects', 'languages'] },

  { id: 'tech', name: 'Tech', structure: 'two', side: 'right', sideWidth: '34%', dark: true,
    main: MAIN_TWO, sideSections: ['contact', 'skills', 'certifications', 'languages'] },

  { id: 'academic', name: 'Academic', structure: 'single', centered: true,
    order: ['summary', 'education', 'experience', 'projects', 'certifications', 'skills', 'languages'] },

  { id: 'elegant', name: 'Elegant', structure: 'single', centered: true,
    order: ['summary', 'experience', 'education', 'projects', 'skills', 'languages', 'certifications'] }
];

const SECTION_TITLES = {
  summary: 'Profile',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  certifications: 'Certifications',
  languages: 'Languages',
  contact: 'Contact'
};

const ICONS = {
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.6 3h2.2l1.4 4-2 1.4a12 12 0 0 0 5.4 5.4l1.4-2 4 1.4v2.2A2.6 2.6 0 0 1 16.4 18 13.4 13.4 0 0 1 3 4.6 2.6 2.6 0 0 1 5.6 2z"/></svg>',
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  website: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>'
};

/* ---------- form definitions ---------- */

const LANGUAGE_LEVELS = ['Native', 'Fluent', 'Professional', 'Intermediate', 'Basic'];

const LIST_DEFS = {
  experience: {
    label: 'Experience',
    blank: () => ({ role: '', company: '', location: '', start: '', end: '', description: '' }),
    fields: [
      { key: 'role', label: 'Job title', ph: 'Senior Product Designer', wide: true },
      { key: 'company', label: 'Company', ph: 'Northwind Labs' },
      { key: 'location', label: 'Location', ph: 'San Francisco, CA' },
      { key: 'start', label: 'Start', ph: 'Mar 2021' },
      { key: 'end', label: 'End', ph: 'Present' },
      { key: 'description', label: 'Achievements', ph: 'One achievement per line — each becomes a bullet', type: 'textarea', rows: 4, wide: true }
    ]
  },
  education: {
    label: 'Education',
    blank: () => ({ degree: '', school: '', location: '', start: '', end: '', details: '' }),
    fields: [
      { key: 'degree', label: 'Degree / programme', ph: 'BFA, Interaction Design', wide: true },
      { key: 'school', label: 'School / university', ph: 'California College of the Arts' },
      { key: 'location', label: 'Location', ph: 'San Francisco, CA' },
      { key: 'start', label: 'Start', ph: '2011' },
      { key: 'end', label: 'End', ph: '2015' },
      { key: 'details', label: 'Details', ph: 'Honours, thesis, relevant modules…', type: 'textarea', rows: 3, wide: true }
    ]
  },
  projects: {
    label: 'Project',
    blank: () => ({ name: '', link: '', description: '' }),
    fields: [
      { key: 'name', label: 'Project name', ph: 'Atlas design system' },
      { key: 'link', label: 'Link', ph: 'yoursite.com/project' },
      { key: 'description', label: 'Description', ph: 'What it is, what you did and the outcome.', type: 'textarea', rows: 3, wide: true }
    ]
  },
  certifications: {
    label: 'Certification',
    blank: () => ({ name: '', issuer: '', year: '' }),
    fields: [
      { key: 'name', label: 'Certification', ph: 'Google UX Design Certificate', wide: true },
      { key: 'issuer', label: 'Issuer', ph: 'Google' },
      { key: 'year', label: 'Year', ph: '2023' }
    ]
  },
  languages: {
    label: 'Language',
    blank: () => ({ name: '', level: 'Fluent' }),
    fields: [
      { key: 'name', label: 'Language', ph: 'Spanish' },
      { key: 'level', label: 'Level', type: 'select', options: LANGUAGE_LEVELS }
    ]
  }
};

/* ---------- sample content ---------- */

const SAMPLE = {
  template: { layout: 'classic', theme: 'indigo' },
  personal: {
    name: 'Alex Morgan',
    title: 'Senior Product Designer',
    email: 'alex.morgan@example.com',
    phone: '+1 (415) 555-0142',
    location: 'San Francisco, CA',
    website: 'alexmorgan.design',
    photo: ''
  },
  summary: 'Product designer with nine years of experience shaping B2B and consumer products from first sketch to shipped release. I pair research-led thinking with a strong systems mindset, and I enjoy mentoring designers and raising the quality bar across a team.',
  skills: 'Product strategy, Design systems, Interaction design, User research, Prototyping, Figma, HTML & CSS, Accessibility, Data-informed design, Team mentoring',
  experience: [
    {
      role: 'Senior Product Designer',
      company: 'Northwind Labs',
      location: 'San Francisco, CA',
      start: 'Mar 2021',
      end: 'Present',
      description: 'Led the redesign of the analytics workspace used by 40,000 people, lifting weekly active use by 27%.\nBuilt a design system of 120 components that cut new-feature design time in half.\nMentored three mid-level designers and introduced a fortnightly critique.'
    },
    {
      role: 'Product Designer',
      company: 'Lumen & Co.',
      location: 'Oakland, CA',
      start: 'Jun 2017',
      end: 'Feb 2021',
      description: 'Owned onboarding and billing for a fintech platform, reducing drop-off by 18%.\nPartnered with research to run 60+ interviews and turn findings into a quarterly roadmap.\nShipped a mobile-first dashboard used by 12,000 small businesses.'
    },
    {
      role: 'UI Designer',
      company: 'Paper Kite Studio',
      location: 'Remote',
      start: 'Sep 2015',
      end: 'May 2017',
      description: 'Designed marketing sites and product interfaces for early-stage startups.\nCreated the studio component library and handoff process.'
    }
  ],
  education: [
    {
      degree: 'BFA, Interaction Design',
      school: 'California College of the Arts',
      location: 'San Francisco, CA',
      start: '2011',
      end: '2015',
      details: 'Graduated with honours. Thesis on accessible data visualisation.'
    }
  ],
  projects: [
    {
      name: 'Atlas design system',
      link: 'alexmorgan.design/atlas',
      description: 'A cross-platform system of tokens, components and documentation adopted by four product teams.'
    },
    {
      name: 'Transit Atlas',
      link: 'alexmorgan.design/transit',
      description: 'A volunteer-built map that helps riders find step-free routes across the Bay Area.'
    }
  ],
  certifications: [
    { name: 'Certified Professional in Accessibility Core Competencies', issuer: 'IAAP', year: '2023' },
    { name: 'Google UX Design Certificate', issuer: 'Google', year: '2020' }
  ],
  languages: [
    { name: 'English', level: 'Native' },
    { name: 'Spanish', level: 'Professional' },
    { name: 'French', level: 'Intermediate' }
  ]
};

/* ---------- state ---------- */

const state = normalizeData(deepClone(SAMPLE));

/* ---------- dom ---------- */

const $ = id => document.getElementById(id);

const els = {
  editor: document.querySelector('.editor'),
  cvPage: $('cvPage'),
  previewScroll: $('previewScroll'),
  previewFit: $('previewFit'),
  pageInfo: $('pageInfo'),
  saveChip: $('saveChip'),
  saveText: $('saveText'),
  templateChip: $('templateChip'),
  designMeta: $('designMeta'),
  layoutName: $('layoutName'),
  themeName: $('themeName'),
  layoutStrip: $('layoutStrip'),
  themeStrip: $('themeStrip'),
  templateBrowser: $('templateBrowser'),
  templateCount: $('templateCount'),
  photoInput: $('photoInput'),
  photoThumb: $('photoThumb'),
  photoInitials: $('photoInitials'),
  btnPhotoRemove: $('btnPhotoRemove'),
  summaryCount: $('summaryCount'),
  countExperience: $('countExperience'),
  countEducation: $('countEducation'),
  countSkills: $('countSkills'),
  countProjects: $('countProjects'),
  countCertifications: $('countCertifications'),
  countLanguages: $('countLanguages'),
  btnPrint: $('btnPrint'),
  btnSample: $('btnSample'),
  btnReset: $('btnReset'),
  toast: $('toast'),
  lists: {
    experience: $('listExperience'),
    education: $('listEducation'),
    projects: $('listProjects'),
    certifications: $('listCertifications'),
    languages: $('listLanguages')
  }
};

/* ---------- small helpers ---------- */

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function displayUrl(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function dateRange(start, end) {
  return [start, end].map(v => String(v || '').trim()).filter(Boolean).join(' – ');
}

function splitSkills(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[,;]+/)
    .map(s => s.trim())
    .filter(s => {
      if (!s) return false;
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getByPath(object, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), object);
}

function setByPath(object, path, value) {
  const keys = path.split('.');
  let cursor = object;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor[keys[i]] == null) return;
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
}

function getLayout() {
  return LAYOUTS.find(layout => layout.id === state.template.layout) || LAYOUTS[0];
}

function getTheme() {
  return THEMES.find(theme => theme.id === state.template.theme) || THEMES[0];
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many || one + 's');
}

/* ---------- data normalisation / persistence ---------- */

function normalizeData(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const personal = source.personal && typeof source.personal === 'object' ? source.personal : {};
  const out = {
    template: {
      layout: LAYOUTS.some(l => l.id === (source.template && source.template.layout))
        ? source.template.layout : 'classic',
      theme: THEMES.some(t => t.id === (source.template && source.template.theme))
        ? source.template.theme : 'indigo'
    },
    personal: {},
    summary: typeof source.summary === 'string' ? source.summary : '',
    skills: typeof source.skills === 'string' ? source.skills : '',
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    languages: []
  };

  ['name', 'title', 'email', 'phone', 'location', 'website', 'photo'].forEach(key => {
    out.personal[key] = typeof personal[key] === 'string' ? personal[key] : '';
  });

  Object.keys(LIST_DEFS).forEach(name => {
    const items = Array.isArray(source[name]) ? source[name] : [];
    out[name] = items.map(item => {
      const blank = LIST_DEFS[name].blank();
      Object.keys(blank).forEach(key => {
        if (item && typeof item[key] === 'string') blank[key] = item[key];
      });
      return blank;
    });
  });

  return out;
}

function emptyData() {
  const empty = {
    template: { layout: 'classic', theme: 'indigo' },
    personal: { name: '', title: '', email: '', phone: '', location: '', website: '', photo: '' },
    summary: '',
    skills: '',
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    languages: []
  };
  return empty;
}

function applyData(data) {
  const next = normalizeData(data);
  state.template = next.template;
  state.personal = next.personal;
  state.summary = next.summary;
  state.skills = next.skills;
  Object.keys(LIST_DEFS).forEach(name => {
    state[name] = next[name];
  });
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: deepClone(SAMPLE), fresh: true };
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return { data: deepClone(SAMPLE), fresh: true };
    return { data: normalizeData(parsed.data), fresh: false };
  } catch (err) {
    return { data: deepClone(SAMPLE), fresh: true };
  }
}

let saveTimer = 0;

function scheduleSave() {
  els.saveChip.classList.add('saving');
  els.saveText.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 380);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, data: state }));
    els.saveChip.classList.remove('saving');
    els.saveText.textContent = 'Saved locally';
    els.saveChip.title = 'Saved at ' + new Date().toLocaleTimeString();
  } catch (err) {
    els.saveChip.classList.remove('saving');
    els.saveText.textContent = 'Not saved';
    toast('Browser storage is full, so this CV was not saved. Try a smaller photo.', true);
  }
}

/* ---------- toast ---------- */

let toastTimer = 0;
function toast(message, isError) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', Boolean(isError));
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

/* ==================================================================
   PREVIEW RENDERING
   ================================================================== */

function contactHTML() {
  const p = state.personal;
  const rows = [];
  if (hasText(p.email)) rows.push(['email', p.email.trim()]);
  if (hasText(p.phone)) rows.push(['phone', p.phone.trim()]);
  if (hasText(p.location)) rows.push(['location', p.location.trim()]);
  if (hasText(p.website)) rows.push(['website', displayUrl(p.website)]);
  if (!rows.length) return '';
  return '<ul class="cv-contact">' + rows.map(([kind, value]) =>
    '<li>' + ICONS[kind] + '<span>' + esc(value) + '</span></li>'
  ).join('') + '</ul>';
}

function avatarHTML() {
  const photo = state.personal.photo;
  if (photo) {
    return '<div class="cv-avatar"><img class="cv-photo" src="' + esc(photo) + '" alt=""></div>';
  }
  const initials = initialsOf(state.personal.name) || 'CV';
  return '<div class="cv-avatar"><span class="cv-mono">' + esc(initials) + '</span></div>';
}

function headerHTML(layout) {
  const p = state.personal;
  const name = hasText(p.name) ? p.name.trim() : 'Your Name';
  const role = hasText(p.title) ? p.title.trim() : '';
  const single = layout.structure === 'single';
  return '<header class="cv-header">' +
    (single ? avatarHTML() : '') +
    '<div class="cv-head-text">' +
      '<h1 class="cv-name' + (hasText(p.name) ? '' : ' is-placeholder') + '">' + esc(name) + '</h1>' +
      (role ? '<p class="cv-role">' + esc(role) + '</p>' : '') +
      (single ? contactHTML() : '') +
    '</div>' +
  '</header>';
}

function bulletHTML(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map(line => line.replace(/^[\s\-•*]+/, '').trim())
    .filter(Boolean);
  if (!lines.length) return '';
  if (lines.length === 1) return '<p class="cv-item-desc">' + esc(lines[0]) + '</p>';
  return '<ul class="cv-bullets">' + lines.map(line => '<li>' + esc(line) + '</li>').join('') + '</ul>';
}

function summaryHTML() {
  const paragraphs = String(state.summary || '')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) return '';
  return paragraphs.map(p =>
    '<p class="cv-summary-text">' + esc(p).replace(/\n/g, '<br>') + '</p>'
  ).join('');
}

function experienceHTML() {
  const items = state.experience.filter(item =>
    hasText(item.role) || hasText(item.company) || hasText(item.description) || hasText(item.start)
  );
  if (!items.length) return '';
  const body = items.map(item => {
    const title = hasText(item.role) ? item.role.trim() : (item.company || '').trim();
    const sub = [item.role ? item.company : '', item.location].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
    const dates = dateRange(item.start, item.end);
    return '<div class="cv-item">' +
      '<div class="cv-item-head">' +
        '<div><h3 class="cv-item-title">' + esc(title) + '</h3>' +
        (sub ? '<p class="cv-item-sub">' + esc(sub) + '</p>' : '') + '</div>' +
        (dates ? '<span class="cv-item-date">' + esc(dates) + '</span>' : '') +
      '</div>' +
      bulletHTML(item.description) +
    '</div>';
  }).join('');
  return '<section class="cv-section"><h2>' + SECTION_TITLES.experience + '</h2>' + body + '</section>';
}

function educationHTML() {
  const items = state.education.filter(item =>
    hasText(item.degree) || hasText(item.school) || hasText(item.details)
  );
  if (!items.length) return '';
  const body = items.map(item => {
    const title = hasText(item.degree) ? item.degree.trim() : (item.school || '').trim();
    const sub = [item.degree ? item.school : '', item.location].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
    const dates = dateRange(item.start, item.end);
    return '<div class="cv-item">' +
      '<div class="cv-item-head">' +
        '<div><h3 class="cv-item-title">' + esc(title) + '</h3>' +
        (sub ? '<p class="cv-item-sub">' + esc(sub) + '</p>' : '') + '</div>' +
        (dates ? '<span class="cv-item-date">' + esc(dates) + '</span>' : '') +
      '</div>' +
      bulletHTML(item.details) +
    '</div>';
  }).join('');
  return '<section class="cv-section"><h2>' + SECTION_TITLES.education + '</h2>' + body + '</section>';
}

function projectsHTML() {
  const items = state.projects.filter(item =>
    hasText(item.name) || hasText(item.description) || hasText(item.link)
  );
  if (!items.length) return '';
  const body = items.map(item => {
    const title = hasText(item.name) ? item.name.trim() : displayUrl(item.link);
    const link = hasText(item.link) ? displayUrl(item.link) : '';
    return '<div class="cv-item">' +
      '<div class="cv-item-head">' +
        '<div><h3 class="cv-item-title">' + esc(title) + '</h3>' +
        (link ? '<p class="cv-item-sub">' + esc(link) + '</p>' : '') + '</div>' +
      '</div>' +
      bulletHTML(item.description) +
    '</div>';
  }).join('');
  return '<section class="cv-section"><h2>' + SECTION_TITLES.projects + '</h2>' + body + '</section>';
}

function certificationsHTML() {
  const items = state.certifications.filter(item => hasText(item.name) || hasText(item.issuer));
  if (!items.length) return '';
  const body = items.map(item => {
    const title = hasText(item.name) ? item.name.trim() : item.issuer.trim();
    const sub = [item.issuer, item.year].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
    return '<div class="cv-item">' +
      '<div class="cv-item-head">' +
        '<div><h3 class="cv-item-title">' + esc(title) + '</h3>' +
        (sub ? '<p class="cv-item-sub">' + esc(sub) + '</p>' : '') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  return '<section class="cv-section"><h2>' + SECTION_TITLES.certifications + '</h2>' + body + '</section>';
}

function skillsHTML(layout) {
  const skills = splitSkills(state.skills);
  if (!skills.length) return '';
  if (layout.structure === 'two') {
    return '<section class="cv-section"><h2>' + SECTION_TITLES.skills + '</h2>' +
      '<ul class="cv-tags">' + skills.map(skill => '<li>' + esc(skill) + '</li>').join('') + '</ul>' +
    '</section>';
  }
  return '<section class="cv-section"><h2>' + SECTION_TITLES.skills + '</h2>' +
    '<p class="cv-skill-line">' + skills.map(esc).join(' · ') + '</p>' +
  '</section>';
}

function languagesHTML() {
  const items = state.languages.filter(item => hasText(item.name));
  if (!items.length) return '';
  const body = items.map(item =>
    '<div class="cv-lang"><span>' + esc(item.name) + '</span>' +
    (hasText(item.level) ? '<em>' + esc(item.level) + '</em>' : '') + '</div>'
  ).join('');
  return '<section class="cv-section"><h2>' + SECTION_TITLES.languages + '</h2>' +
    '<div class="cv-langs">' + body + '</div></section>';
}

function contactSectionHTML() {
  const contact = contactHTML();
  if (!contact) return '';
  return '<section class="cv-section"><h2>Contact</h2>' + contact + '</section>';
}

function renderSection(name, layout) {
  switch (name) {
    case 'summary': {
      const body = summaryHTML();
      return body ? '<section class="cv-section"><h2>' + SECTION_TITLES.summary + '</h2>' + body + '</section>' : '';
    }
    case 'experience': return experienceHTML();
    case 'education': return educationHTML();
    case 'projects': return projectsHTML();
    case 'skills': return skillsHTML(layout);
    case 'certifications': return certificationsHTML();
    case 'languages': return languagesHTML();
    case 'contact': return contactSectionHTML();
    default: return '';
  }
}

function renderPreview() {
  const layout = getLayout();
  const theme = getTheme();

  els.cvPage.className = 'cv layout-' + layout.id;
  els.cvPage.dataset.structure = layout.structure;
  if (layout.side) els.cvPage.dataset.side = layout.side;
  else els.cvPage.removeAttribute('data-side');
  els.cvPage.setAttribute('style',
    '--accent:' + theme.accent + ';--deep:' + theme.deep + ';--soft:' + theme.soft +
    ';--line:' + theme.line + ';--side-w:' + (layout.sideWidth || '33%')
  );

  if (layout.structure === 'two') {
    const side = '<aside class="cv-side">' +
      avatarHTML() +
      layout.sideSections.map(name => renderSection(name, layout)).join('') +
    '</aside>';
    const main = '<div class="cv-main">' +
      headerHTML(layout) +
      layout.main.map(name => renderSection(name, layout)).join('') +
    '</div>';
    els.cvPage.innerHTML = '<div class="cv-cols">' +
      (layout.side === 'right' ? main + side : side + main) +
    '</div>';
  } else {
    els.cvPage.innerHTML = '<div class="cv-main">' +
      headerHTML(layout) +
      layout.order.map(name => renderSection(name, layout)).join('') +
    '</div>';
  }

  fitPreview();
}

/* ---------- preview scaling ---------- */

let fitFrame = 0;

function fitPreview() {
  if (fitFrame) {
    cancelAnimationFrame(fitFrame);
    fitFrame = 0;
  }
  applyFit();
}

function scheduleFit() {
  if (fitFrame) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    applyFit();
  });
}

function applyFit() {
  const pane = els.previewScroll;
  if (!pane) return;

  const style = getComputedStyle(pane);
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const availW = Math.max(180, pane.clientWidth - padX);
  const availH = Math.max(180, pane.clientHeight - padY);
  const isMobile = window.innerWidth < 900;

  let scale = Math.min(1, availW / PAGE_W);
  if (!isMobile && availH > 240) scale = Math.min(scale, availH / PAGE_H);
  scale = Math.max(0.16, scale);

  const sheetH = els.cvPage.offsetHeight || PAGE_H;
  els.cvPage.style.transform = 'scale(' + scale.toFixed(4) + ')';
  els.previewFit.style.width = Math.round(PAGE_W * scale) + 'px';
  els.previewFit.style.height = Math.round(sheetH * scale) + 'px';

  const pages = Math.max(1, Math.ceil((sheetH - 6) / PAGE_H));
  els.pageInfo.textContent = plural(pages, 'page') + ' · A4';
}

/* ==================================================================
   FORM RENDERING
   ================================================================== */

function fieldHTML(listName, index, item, field) {
  const id = listName + '-' + index + '-' + field.key;
  const bind = listName + '.' + index + '.' + field.key;
  const value = item[field.key] == null ? '' : String(item[field.key]);
  const wide = field.wide ? ' span-2' : '';

  if (field.type === 'textarea') {
    return '<label class="field' + wide + '" for="' + id + '">' +
      '<span class="field-label">' + esc(field.label) + '</span>' +
      '<textarea id="' + id + '" data-bind="' + bind + '" rows="' + (field.rows || 3) + '" ' +
      'placeholder="' + esc(field.ph || '') + '" maxlength="1200">' + esc(value) + '</textarea>' +
    '</label>';
  }

  if (field.type === 'select') {
    const options = field.options.map(option =>
      '<option value="' + esc(option) + '"' + (value === option ? ' selected' : '') + '>' + esc(option) + '</option>'
    ).join('');
    return '<label class="field' + wide + '" for="' + id + '">' +
      '<span class="field-label">' + esc(field.label) + '</span>' +
      '<select id="' + id + '" data-bind="' + bind + '">' + options + '</select>' +
    '</label>';
  }

  return '<label class="field' + wide + '" for="' + id + '">' +
    '<span class="field-label">' + esc(field.label) + '</span>' +
    '<input type="text" id="' + id + '" data-bind="' + bind + '" value="' + esc(value) + '" ' +
    'placeholder="' + esc(field.ph || '') + '" maxlength="140">' +
  '</label>';
}

function itemCardHTML(listName, item, index) {
  const def = LIST_DEFS[listName];
  return '<div class="item-card" data-list="' + listName + '">' +
    '<div class="item-top">' +
      '<span class="item-num">' + String(index + 1).padStart(2, '0') + '</span>' +
      '<strong>' + esc(def.label) + ' ' + (index + 1) + '</strong>' +
      '<button type="button" class="icon-btn" data-remove="' + listName + '" data-index="' + index + '" ' +
        'aria-label="Remove ' + esc(def.label.toLowerCase()) + ' ' + (index + 1) + '" title="Remove">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 15h10l1-15"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="field-grid">' +
      def.fields.map(field => fieldHTML(listName, index, item, field)).join('') +
    '</div>' +
  '</div>';
}

function renderList(listName) {
  const container = els.lists[listName];
  if (!container) return;
  container.innerHTML = state[listName].map((item, index) =>
    itemCardHTML(listName, item, index)
  ).join('');
  container.querySelectorAll('textarea').forEach(autoGrow);
}

function renderAllLists() {
  Object.keys(LIST_DEFS).forEach(renderList);
}

function syncStaticFields() {
  document.querySelectorAll('[data-bind]').forEach(element => {
    if (element.closest('.list')) return;
    const value = getByPath(state, element.dataset.bind);
    element.value = value == null ? '' : String(value);
  });
  document.querySelectorAll('textarea').forEach(autoGrow);
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  const min = window.innerWidth < 900 ? 104 : 84;
  textarea.style.height = Math.max(min, textarea.scrollHeight + 2) + 'px';
}

function updatePhotoUI() {
  const photo = state.personal.photo;
  if (photo) {
    els.photoThumb.src = photo;
    els.photoThumb.hidden = false;
    els.photoInitials.hidden = true;
  } else {
    els.photoThumb.removeAttribute('src');
    els.photoThumb.hidden = true;
    els.photoInitials.hidden = false;
    els.photoInitials.textContent = initialsOf(state.personal.name) || 'CV';
  }
  els.btnPhotoRemove.disabled = !photo;
}

function updateCounts() {
  const words = state.summary.trim() ? state.summary.trim().split(/\s+/).length : 0;
  els.summaryCount.textContent = plural(words, 'word');
  els.countExperience.textContent = plural(state.experience.length, 'role');
  els.countEducation.textContent = plural(state.education.length, 'entry', 'entries');
  els.countSkills.textContent = plural(splitSkills(state.skills).length, 'skill');
  els.countProjects.textContent = plural(state.projects.length, 'project');
  els.countCertifications.textContent = plural(state.certifications.length, 'certificate');
  els.countLanguages.textContent = plural(state.languages.length, 'language');
}

function updateTitle() {
  const name = state.personal.name.trim();
  document.title = name
    ? name + ' — Resume'
    : 'Resume / CV Builder — 60 professional templates, export to PDF';
}

/* ==================================================================
   DESIGN UI (10 layouts × 6 themes = 60 templates)
   ================================================================== */

function buildDesignUI() {
  els.layoutStrip.innerHTML = LAYOUTS.map(layout => {
    const classes = [];
    if (layout.structure === 'two') classes.push('thumb-two');
    if (layout.structure === 'two' && layout.side === 'right') classes.push('right');
    if (layout.dark) classes.push('thumb-dark');
    if (layout.centered) classes.push('centered');
    return '<button type="button" class="layout-opt" role="radio" aria-checked="false" ' +
      'data-layout="' + layout.id + '" title="' + esc(layout.name) + ' layout">' +
      '<span class="thumb ' + classes.join(' ') + '" aria-hidden="true" style="--c:#8b7cff">' +
        (layout.structure === 'two' ? '<span class="th-side"></span>' : '') +
        '<b></b><i></i><i></i><i></i>' +
      '</span>' +
      '<span>' + esc(layout.name) + '</span>' +
    '</button>';
  }).join('');

  els.themeStrip.innerHTML = THEMES.map(theme =>
    '<button type="button" class="theme-opt" role="radio" aria-checked="false" ' +
      'data-theme="' + theme.id + '">' +
      '<i style="--c:' + theme.accent + '" aria-hidden="true"></i>' + esc(theme.name) +
    '</button>'
  ).join('');

  els.templateBrowser.innerHTML = LAYOUTS.map(layout => {
    const chips = THEMES.map(theme => {
      const miniClasses = ['tpl-mini'];
      if (layout.structure === 'two') miniClasses.push('two');
      if (layout.structure === 'two' && layout.side === 'right') miniClasses.push('right');
      if (layout.dark) miniClasses.push('dark');
      return '<button type="button" class="tpl-chip" role="option" aria-selected="false" ' +
        'data-layout="' + layout.id + '" data-theme="' + theme.id + '" ' +
        'title="' + esc(layout.name + ' · ' + theme.name) + '">' +
        '<span class="' + miniClasses.join(' ') + '" aria-hidden="true" style="--c:' + theme.accent + '">' +
          (layout.structure === 'two' ? '<span class="mini-side"></span>' : '') +
          '<b></b><i></i><i></i>' +
        '</span>' +
        '<span class="tpl-text"><strong>' + esc(layout.name) + '</strong><em>' + esc(theme.name) + '</em></span>' +
      '</button>';
    }).join('');
    return '<section class="tpl-group" aria-label="' + esc(layout.name) + ' templates">' +
      '<h4>' + esc(layout.name) + '</h4>' +
      '<div class="tpl-row">' + chips + '</div>' +
    '</section>';
  }).join('');

  els.templateCount.textContent = (LAYOUTS.length * THEMES.length) + ' combos';
}

function syncDesignUI() {
  const layout = getLayout();
  const theme = getTheme();

  els.layoutName.textContent = layout.name;
  els.themeName.textContent = theme.name;
  els.designMeta.textContent = layout.name + ' · ' + theme.name;
  els.templateChip.textContent = layout.name + ' · ' + theme.name;

  document.querySelectorAll('.layout-opt').forEach(button => {
    button.setAttribute('aria-checked', button.dataset.layout === layout.id ? 'true' : 'false');
  });
  document.querySelectorAll('.theme-opt').forEach(button => {
    button.setAttribute('aria-checked', button.dataset.theme === theme.id ? 'true' : 'false');
  });
  document.querySelectorAll('.tpl-chip').forEach(button => {
    const active = button.dataset.layout === layout.id && button.dataset.theme === theme.id;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.thumb').forEach(thumb => {
    thumb.style.setProperty('--c', theme.accent);
  });
}

function setTemplate(layoutId, themeId) {
  const layout = LAYOUTS.find(item => item.id === layoutId);
  const theme = THEMES.find(item => item.id === themeId);
  if (!layout || !theme) return;
  state.template = { layout: layout.id, theme: theme.id };
  syncDesignUI();
  renderPreview();
  saveNow();
}

/* ==================================================================
   PHOTO
   ================================================================== */

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function shrinkImage(dataUrl, maxSize) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.onerror = () => reject(new Error('Could not decode image'));
    image.src = dataUrl;
  });
}

async function handlePhoto(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    toast('Please choose an image file.', true);
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast('That image is over 20 MB. Please choose a smaller photo.', true);
    return;
  }
  try {
    const raw = await readFileAsDataURL(file);
    const shrunk = await shrinkImage(raw, MAX_PHOTO);
    state.personal.photo = shrunk;
    updatePhotoUI();
    renderPreview();
    saveNow();
    toast('Photo added. It is stored in this browser only.');
  } catch (err) {
    toast('That image could not be read. Try a JPG or PNG.', true);
  } finally {
    els.photoInput.value = '';
  }
}

/* ==================================================================
   LIST ACTIONS
   ================================================================== */

function addItem(listName) {
  const def = LIST_DEFS[listName];
  if (!def) return;
  state[listName].push(def.blank());
  renderList(listName);
  updateCounts();
  renderPreview();
  saveNow();

  if (window.innerWidth >= 900) {
    const cards = els.lists[listName].querySelectorAll('.item-card');
    const last = cards[cards.length - 1];
    const input = last && last.querySelector('input, textarea, select');
    if (input) input.focus();
  }
}

function removeItem(listName, index) {
  if (!LIST_DEFS[listName] || !Number.isInteger(index)) return;
  state[listName].splice(index, 1);
  renderList(listName);
  updateCounts();
  renderPreview();
  saveNow();
  toast('Removed.');
}

/* ==================================================================
   EVENTS
   ================================================================== */

function bindEvents() {
  els.editor.addEventListener('input', event => {
    const field = event.target;
    const bind = field.dataset && field.dataset.bind;
    if (!bind) return;

    setByPath(state, bind, field.value);
    if (field.tagName === 'TEXTAREA') autoGrow(field);
    updateCounts();
    renderPreview();
    scheduleSave();

    if (bind === 'personal.name') {
      updatePhotoUI();
      updateTitle();
    }
  });

  els.editor.addEventListener('change', event => {
    const field = event.target;
    if (field.tagName !== 'SELECT') return;
    const bind = field.dataset && field.dataset.bind;
    if (!bind) return;
    setByPath(state, bind, field.value);
    updateCounts();
    renderPreview();
    scheduleSave();
  });

  els.editor.addEventListener('click', event => {
    const addButton = event.target.closest('[data-add]');
    if (addButton) {
      addItem(addButton.dataset.add);
      return;
    }
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton) {
      removeItem(removeButton.dataset.remove, Number(removeButton.dataset.index));
    }
  });

  els.photoInput.addEventListener('change', event => {
    handlePhoto(event.target.files && event.target.files[0]);
  });

  els.btnPhotoRemove.addEventListener('click', () => {
    state.personal.photo = '';
    updatePhotoUI();
    renderPreview();
    saveNow();
    toast('Photo removed.');
  });

  els.layoutStrip.addEventListener('click', event => {
    const button = event.target.closest('[data-layout]');
    if (button) setTemplate(button.dataset.layout, state.template.theme);
  });

  els.themeStrip.addEventListener('click', event => {
    const button = event.target.closest('[data-theme]');
    if (button) setTemplate(state.template.layout, button.dataset.theme);
  });

  els.templateBrowser.addEventListener('click', event => {
    const chip = event.target.closest('.tpl-chip');
    if (chip) setTemplate(chip.dataset.layout, chip.dataset.theme);
  });

  rovingKeys(els.layoutStrip, '.layout-opt');
  rovingKeys(els.themeStrip, '.theme-opt');

  els.btnPrint.addEventListener('click', () => {
    saveNow();
    renderPreview();
    window.print();
  });

  els.btnSample.addEventListener('click', () => {
    if (!confirm('Replace the current CV with the sample content?')) return;
    applyData(deepClone(SAMPLE));
    refreshEverything();
    saveNow();
    toast('Sample CV loaded.');
  });

  els.btnReset.addEventListener('click', () => {
    if (!confirm('Clear this CV and remove it from this browser?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    applyData(emptyData());
    refreshEverything();
    saveNow();
    toast('CV cleared. Start fresh whenever you are ready.');
  });

  window.addEventListener('resize', scheduleFit);

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(els.cvPage);
    observer.observe(els.previewScroll);
  }

  window.addEventListener('pagehide', () => {
    if (saveTimer) saveNow();
  });
}

function rovingKeys(container, selector) {
  container.addEventListener('keydown', event => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(container.querySelectorAll(selector));
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();

    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, current - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;

    buttons[next].focus();
    buttons[next].click();
  });
}

/* ==================================================================
   BOOT
   ================================================================== */

function refreshEverything() {
  renderAllLists();
  syncStaticFields();
  syncDesignUI();
  updatePhotoUI();
  updateCounts();
  updateTitle();
  renderPreview();
}

function init() {
  const loaded = loadData();
  applyData(loaded.data);

  buildDesignUI();
  refreshEverything();

  if (loaded.fresh) {
    saveNow();
  } else {
    els.saveText.textContent = 'Saved locally';
  }

  bindEvents();
  renderPreview();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitPreview).catch(() => {});
  }
}

init();
