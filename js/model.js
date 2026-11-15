/* Project + clip model */
(function () {
  const VE = (window.VE = window.VE || {});

  const DEFAULT_TRACKS = () => ([
    { id: VE.uid('trk'), type: 'video', name: 'Video 1', muted: false, hidden: false, locked: false, clips: [] },
    { id: VE.uid('trk'), type: 'overlay', name: 'Overlay', muted: false, hidden: false, locked: false, clips: [] },
    { id: VE.uid('trk'), type: 'text', name: 'Text', muted: false, hidden: false, locked: false, clips: [] },
    { id: VE.uid('trk'), type: 'audio', name: 'Audio', muted: false, hidden: false, locked: false, clips: [] }
  ]);

  VE.createProject = function () {
    const now = Date.now();
    return {
      version: 1,
      id: VE.uid('proj'),
      name: 'Untitled project',
      aspect: '16:9',
      background: '#000000',
      fps: 30,
      createdAt: now,
      updatedAt: now,
      tracks: DEFAULT_TRACKS()
    };
  };

  VE.trackKindName = function (kind) {
    return { video: 'Video', overlay: 'Overlay', text: 'Text', audio: 'Audio' }[kind] || 'Track';
  };

  VE.createTrack = function (kind, existing) {
    const siblings = (existing || []).filter(t => t.type === kind).length;
    return {
      id: VE.uid('trk'),
      type: kind,
      name: VE.trackKindName(kind) + ' ' + (siblings + 1),
      muted: false,
      hidden: false,
      locked: false,
      clips: []
    };
  };

  VE.baseClip = function (type, name) {
    return {
      id: VE.uid('clip'),
      type,
      name: name || 'Clip',
      start: 0,
      duration: 5,
      inPoint: 0,
      speed: 1,
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      fit: 'cover',
      filter: 'none',
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      transitionIn: { type: 'none', duration: 0.4 },
      transitionOut: { type: 'none', duration: 0.4 },
      assetId: null,
      text: '',
      fontFamily: 'Inter',
      fontSize: 56,
      bold: true,
      italic: false,
      color: '#ffffff',
      color2: '#3ba0ff',
      bgColor: '#000000',
      style: 'plain',
      textWidth: 0.86,
      lineHeight: 1.22,
      align: 'center',
      createdAt: Date.now()
    };
  };

  VE.createMediaClip = function (asset, opts = {}) {
    const type = asset.type === 'image' ? 'image' : asset.type === 'audio' ? 'audio' : 'video';
    const clip = VE.baseClip(type, asset.name);
    clip.assetId = asset.id;
    clip.duration = type === 'image' ? 5 : Math.max(0.2, asset.duration || 5);
    if (type === 'image') {
      clip.fit = opts.fit || 'contain';
    }
    clip.start = opts.start || 0;
    if (opts.trackId) clip.trackId = opts.trackId;
    if (opts.fit) clip.fit = opts.fit;
    return clip;
  };

  VE.createTextClip = function (text, styleId, opts = {}) {
    const preset = VE.TEXT_PRESETS.find(p => p.id === styleId) || VE.TEXT_PRESETS[0];
    const clip = VE.baseClip('text', 'Text');
    Object.assign(clip, {
      text: text || preset.sample,
      style: preset.clip.style,
      fontFamily: preset.clip.fontFamily,
      fontSize: preset.clip.fontSize,
      bold: preset.clip.bold !== undefined ? preset.clip.bold : true,
      color: preset.clip.color || '#ffffff',
      color2: preset.clip.color2 || '#3ba0ff',
      bgColor: preset.clip.bgColor || '#000000',
      x: preset.clip.x !== undefined ? preset.clip.x : 0.5,
      y: preset.clip.y !== undefined ? preset.clip.y : 0.5,
      textWidth: preset.clip.textWidth || 0.86,
      duration: 4,
      start: opts.start || 0,
      transitionIn: { type: 'fade', duration: 0.35 },
      transitionOut: { type: 'fade', duration: 0.35 }
    });
    Object.assign(clip, opts.overrides || {});
    return clip;
  };

  VE.findClip = function (project, clipId) {
    for (const track of project.tracks) {
      const index = track.clips.findIndex(c => c.id === clipId);
      if (index !== -1) return { clip: track.clips[index], track, index };
    }
    return null;
  };

  VE.projectDuration = function (project) {
    let end = 0;
    for (const t of project.tracks) {
      for (const c of t.clips) end = Math.max(end, c.start + c.duration);
    }
    return Math.max(0, end);
  };

  VE.clipEnd = clip => clip.start + clip.duration;

  VE.assetDurationLimit = function (clip, asset) {
    if (!asset) return Infinity;
    if (clip.type === 'image' || clip.type === 'text') return Infinity;
    const remaining = Math.max(0.1, (asset.duration || clip.duration) - clip.inPoint);
    return remaining / Math.max(0.05, clip.speed);
  };

  VE.cloneProject = function (project) {
    return JSON.parse(JSON.stringify(project));
  };

  VE.ensureTrack = function (project, type) {
    let track = project.tracks.find(t => t.type === type);
    if (track) return track;
    track = VE.createTrack(type, project.tracks);
    const audioIndex = project.tracks.findIndex(t => t.type === 'audio');
    if (type === 'audio' || audioIndex === -1) project.tracks.push(track);
    else project.tracks.splice(audioIndex, 0, track);
    return track;
  };

  VE.findFreeStart = function (track, preferred, duration) {
    const clips = track.clips.slice().sort((a, b) => a.start - b.start);
    let start = Math.max(0, preferred);
    let moved = true;
    let guard = 0;
    while (moved && guard++ < 200) {
      moved = false;
      for (const c of clips) {
        const overlaps = start < c.start + c.duration && start + duration > c.start;
        if (overlaps) {
          start = c.start + c.duration;
          moved = true;
        }
      }
    }
    return start;
  };

  /* tiny event-free history based on project snapshots */
  VE.History = class History {
    constructor(project) {
      this.stack = [VE.cloneProject(project)];
      this.index = 0;
      this.limit = 80;
    }
    push(project) {
      const snap = VE.cloneProject(project);
      const current = this.stack[this.index];
      if (JSON.stringify(current) === JSON.stringify(snap)) return false;
      this.stack = this.stack.slice(0, this.index + 1);
      this.stack.push(snap);
      if (this.stack.length > this.limit) this.stack.shift();
      this.index = this.stack.length - 1;
      return true;
    }
    undo() {
      if (this.index <= 0) return null;
      this.index--;
      return VE.cloneProject(this.stack[this.index]);
    }
    redo() {
      if (this.index >= this.stack.length - 1) return null;
      this.index++;
      return VE.cloneProject(this.stack[this.index]);
    }
    get canUndo() { return this.index > 0; }
    get canRedo() { return this.index < this.stack.length - 1; }
  };
})();
