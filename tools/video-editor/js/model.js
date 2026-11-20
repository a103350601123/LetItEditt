/* Project + clip model: factories, migration/sanitising, layer helpers */
(function () {
  const VE = (window.VE = window.VE || {});

  const TRACK_TYPES = ['video', 'overlay', 'text', 'audio'];
  const CLIP_TYPES = ['video', 'image', 'audio', 'text', 'shape'];

  const DEFAULT_TRACKS = () => ([
    { id: VE.uid('trk'), type: 'video', name: 'Video 1', muted: false, hidden: false, locked: false, groupId: null, clips: [] },
    { id: VE.uid('trk'), type: 'overlay', name: 'Overlay', muted: false, hidden: false, locked: false, groupId: null, clips: [] },
    { id: VE.uid('trk'), type: 'text', name: 'Text', muted: false, hidden: false, locked: false, groupId: null, clips: [] },
    { id: VE.uid('trk'), type: 'audio', name: 'Audio', muted: false, hidden: false, locked: false, groupId: null, clips: [] }
  ]);

  VE.createProject = function () {
    const now = Date.now();
    return {
      version: 2,
      app: VE.APP_NAME,
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
      type: TRACK_TYPES.includes(kind) ? kind : 'overlay',
      name: VE.trackKindName(kind) + ' ' + (siblings + 1),
      muted: false,
      hidden: false,
      locked: false,
      groupId: null,
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
      effects: [],
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      transitionIn: { type: 'none', duration: 0.4 },
      transitionOut: { type: 'none', duration: 0.4 },
      animationId: 'none',
      animDuration: 0.6,
      animSpeed: 1,
      animDirection: 'left',
      animDelay: 0,
      locked: false,
      hidden: false,
      assetId: null,
      shape: 'rect',
      shapeColor: '#7c5cff',
      shapeColor2: '#3ba0ff',
      shapeWidth: 0.3,
      shapeHeight: 0.2,
      text: '',
      fontFamily: 'system-ui',
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
    if (type === 'image') clip.fit = opts.fit || 'contain';
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
      animationId: preset.clip.animationId || 'fade-in',
      duration: 4,
      start: opts.start || 0,
      transitionIn: { type: 'none', duration: 0.35 },
      transitionOut: { type: 'none', duration: 0.35 }
    });
    if (opts.overrides) {
      Object.assign(clip, opts.overrides);
      if (opts.overrides.duration != null) clip.duration = opts.overrides.duration;
    }
    return clip;
  };

  VE.createShapeClip = function (procId, opts = {}) {
    const item = VE.PROCEDURAL_MAP[procId] || VE.PROCEDURAL[0];
    const clip = VE.baseClip('shape', item.label);
    Object.assign(clip, {
      shape: item.shape,
      name: item.label,
      x: 0.5, y: 0.5,
      duration: opts.duration || 4,
      start: opts.start || 0,
      shapeColor: item.category === 'decorative' ? '#3ba0ff' : '#7c5cff',
      shapeColor2: '#ff5cc8',
      opacity: 0.9,
      animationId: item.category === 'animated' ? 'fade-in' : 'none',
      transitionIn: { type: 'fade', duration: 0.3 },
      transitionOut: { type: 'fade', duration: 0.3 }
    });
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
    if (clip.type === 'image' || clip.type === 'text' || clip.type === 'shape') return Infinity;
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
        if (overlaps) { start = c.start + c.duration; moved = true; }
      }
    }
    return start;
  };

  /* Layer ordering: array order is render order (later = in front). */
  VE.layerInfo = function (project, clipId) {
    const flat = [];
    project.tracks.forEach((t, ti) => t.clips.forEach((c, ci) => flat.push({ clip: c, track: t, trackIndex: ti, clipIndex: ci })));
    const idx = flat.findIndex(e => e.clip.id === clipId);
    if (idx < 0) return null;
    /* Later entries are rendered in front, so Z increases with array order. */
    return { index: idx, count: flat.length, z: idx + 1, entry: flat[idx], flat };
  };

  VE.moveLayer = function (project, clipId, direction, limit) {
    const info = VE.layerInfo(project, clipId);
    if (!info) return false;
    const target = info.index + (direction > 0 ? 1 : -1);
    if (target < 0 || target >= info.flat.length) return false;
    const a = info.entry, b = info.flat[target];
    const ai = a.track.clips.indexOf(a.clip);
    const bi = b.track.clips.indexOf(b.clip);
    a.track.clips.splice(ai, 1);
    b.track.clips.splice(bi, 0, a.clip);
    if (limit && a.track.clips.length > limit) return false;
    return true;
  };

  /* Migration + validation. Accepts projects from any earlier build. */
  VE.sanitizeProject = function (raw) {
    if (!raw || typeof raw !== 'object') return null;
    const src = raw.project && Array.isArray(raw.project.tracks) ? raw.project : raw;
    if (!Array.isArray(src.tracks)) return null;
    const p = Object.assign({}, src);
    p.version = 2;
    p.app = VE.APP_NAME;
    p.aspect = VE.ASPECT_MAP[p.aspect] ? p.aspect : '16:9';
    p.background = typeof p.background === 'string' ? p.background : '#000000';
    p.name = typeof p.name === 'string' && p.name.trim() ? p.name : 'Untitled project';
    p.fps = Number(p.fps) || 30;
    p.createdAt = p.createdAt || Date.now();
    p.updatedAt = p.updatedAt || Date.now();
    const seenTracks = new Set();
    p.tracks = src.tracks.filter(t => t && typeof t === 'object').map((t, ti) => {
      let id = t.id || VE.uid('trk');
      if (seenTracks.has(id)) id = VE.uid('trk');
      seenTracks.add(id);
      const track = {
        id,
        type: TRACK_TYPES.includes(t.type) ? t.type : 'overlay',
        name: String(t.name || VE.trackKindName(t.type) || 'Track'),
        muted: !!t.muted,
        hidden: !!t.hidden,
        locked: !!t.locked,
        groupId: typeof t.groupId === 'string' && t.groupId ? t.groupId : null,
        order: Number.isFinite(t.order) ? t.order : ti,
        clips: []
      };
      const seenClips = new Set();
      track.clips = (Array.isArray(t.clips) ? t.clips : []).filter(c => c && c.id).map(c => {
        let cid = c.id || VE.uid('clip');
        if (seenClips.has(cid)) cid = VE.uid('clip');
        seenClips.add(cid);
        const base = VE.baseClip(CLIP_TYPES.includes(c.type) ? c.type : 'video', String(c.name || 'Clip'));
        const clip = Object.assign(base, c);
        clip.id = cid;
        clip.type = CLIP_TYPES.includes(clip.type) ? clip.type : 'video';
        clip.start = Math.max(0, Number(clip.start) || 0);
        clip.duration = Math.max(0.1, Number(clip.duration) || 1);
        clip.inPoint = Math.max(0, Number(clip.inPoint) || 0);
        clip.speed = VE.clamp(clip.speed || 1, 0.05, 16);
        clip.opacity = VE.clamp(clip.opacity == null ? 1 : clip.opacity, 0, 1);
        clip.x = VE.clamp(clip.x == null ? 0.5 : clip.x, -1, 2);
        clip.y = VE.clamp(clip.y == null ? 0.5 : clip.y, -1, 2);
        clip.scale = VE.clamp(clip.scale == null ? 1 : clip.scale, 0.05, 10);
        clip.rotation = Number(clip.rotation) || 0;
        clip.volume = VE.clamp(clip.volume == null ? 1 : clip.volume, 0, 1);
        clip.transitionIn = Object.assign({ type: 'none', duration: 0.4 }, clip.transitionIn || {});
        clip.transitionOut = Object.assign({ type: 'none', duration: 0.4 }, clip.transitionOut || {});
        if (!VE.TRANSITIONS.some(t2 => t2.id === clip.transitionIn.type)) clip.transitionIn.type = 'none';
        if (!VE.TRANSITIONS.some(t2 => t2.id === clip.transitionOut.type)) clip.transitionOut.type = 'none';
        clip.animationId = VE.ANIM_MAP[clip.animationId] ? clip.animationId : 'none';
        clip.animDuration = VE.clamp(clip.animDuration == null ? 0.6 : clip.animDuration, 0.05, 30);
        clip.animSpeed = VE.clamp(clip.animSpeed == null ? 1 : clip.animSpeed, 0.1, 4);
        clip.animDelay = VE.clamp(clip.animDelay || 0, -10, 60);
        const animSpec = VE.ANIM_MAP[clip.animationId];
        clip.animDirection = ['left', 'right', 'up', 'down'].includes(clip.animDirection)
          ? clip.animDirection : (animSpec ? animSpec.direction : 'left');
        clip.locked = !!clip.locked;
        clip.hidden = !!clip.hidden;
        clip.effects = Array.isArray(clip.effects)
          ? clip.effects.filter(e => e && VE.EFFECT_MAP[e.id] && VE.EFFECT_MAP[e.id].kind !== 'none')
            .map(e => ({ id: e.id, amount: VE.clamp(e.amount == null ? VE.EFFECT_MAP[e.id].amount : e.amount, 0, 1) }))
          : [];
        if (!VE.FILTER_MAP[clip.filter]) clip.filter = 'none';
        if (!VE.PROCEDURAL_MAP[clip.shape]) clip.shape = 'rect';
        clip.text = typeof clip.text === 'string' ? clip.text : '';
        return clip;
      });
      return track;
    });
    if (!p.tracks.length) p.tracks = DEFAULT_TRACKS();
    if (p.tracks.length > VE.MAX_TRACKS) p.tracks = p.tracks.slice(0, VE.MAX_TRACKS);
    return p;
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
