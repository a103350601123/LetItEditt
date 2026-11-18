/* Inspector: canvas settings + clip properties */
(function () {
  const VE = (window.VE = window.VE || {});

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  const TYPE_ICON = { video: 'film', image: 'image', audio: 'music', text: 'type' };

  const Inspector = {
    app: null,
    root: null,

    init(app) {
      this.app = app;
      this.root = document.getElementById('inspector');
    },

    render() {
      const app = this.app;
      if (!app || !app.state.project) return;
      const found = app.state.selection ? VE.findClip(app.state.project, app.state.selection) : null;
      this.root.innerHTML = '';
      this.root.scrollTop = 0;
      if (found) this.renderClip(found.clip, found.track);
      else this.renderProject();
    },

    /* ---------------- shared controls ---------------- */

    section(title) {
      const sec = h('div', 'insp-section');
      const t = h('div', 'insp-title');
      t.textContent = title;
      sec.appendChild(t);
      for (let i = 1; i < arguments.length; i++) {
        if (arguments[i]) sec.appendChild(arguments[i]);
      }
      return sec;
    },

    control(label, node) {
      const wrap = h('div', 'control');
      const head = h('div', 'control-label');
      head.innerHTML = `<span>${VE.escapeHtml(label)}</span>`;
      wrap.append(head, node);
      return wrap;
    },

    slider(label, value, min, max, step, format, onInput, onChange) {
      const app = this.app;
      const wrap = h('div', 'control');
      const head = h('div', 'control-label');
      head.innerHTML = `<span>${VE.escapeHtml(label)}</span><span class="val"></span>`;
      const val = head.querySelector('.val');
      const input = h('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = value;
      const paint = () => { val.textContent = format(Number(input.value)); };
      paint();
      input.addEventListener('input', () => {
        paint();
        onInput(Number(input.value));
        app.invalidate();
        app.scheduleSave();
      });
      input.addEventListener('change', () => { if (onChange) onChange(Number(input.value)); else app.commit({}); });
      wrap.append(head, input);
      return wrap;
    },

    numberRow(label, value, opts, onInput, onDone) {
      const app = this.app;
      const wrap = h('div', 'control');
      const head = h('div', 'control-label');
      head.innerHTML = `<span>${VE.escapeHtml(label)}</span>`;
      const input = h('input', 'input');
      input.type = 'number';
      input.step = opts.step || 0.1;
      if (opts.min != null) input.min = opts.min;
      if (opts.max != null) input.max = opts.max;
      input.value = Number(value).toFixed(opts.decimals != null ? opts.decimals : 2);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (isNaN(v)) return;
        onInput(v);
        app.invalidate();
        app.scheduleSave();
      });
      input.addEventListener('change', () => {
        if (onDone) onDone(Number(input.value));
        else app.commit({});
      });
      wrap.append(head, input);
      return wrap;
    },

    selectRow(label, options, value, onChange) {
      const wrap = h('div', 'control');
      const head = h('div', 'control-label');
      head.innerHTML = `<span>${VE.escapeHtml(label)}</span>`;
      const sel = h('select', 'input');
      options.forEach(o => {
        const opt = h('option', null, o.name || o.label);
        opt.value = o.id;
        if (o.id === value) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => onChange(sel.value));
      wrap.append(head, sel);
      return wrap;
    },

    colorRow(label, value, onInput, onChange) {
      const wrap = h('div', 'control');
      const head = h('div', 'control-label');
      head.innerHTML = `<span>${VE.escapeHtml(label)}</span>`;
      const row = h('div', 'color-row');
      const picker = h('input');
      picker.type = 'color';
      picker.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
      picker.addEventListener('input', () => { onInput(picker.value); this.app.invalidate(); });
      picker.addEventListener('change', () => onChange(picker.value));
      const sw = h('div', 'swatches');
      VE.PALETTE.forEach(c => {
        const b = h('button', 'swatch');
        b.style.background = c;
        b.title = c;
        b.type = 'button';
        b.addEventListener('click', () => {
          picker.value = c;
          onInput(c);
          onChange(c);
        });
        sw.appendChild(b);
      });
      row.append(picker, sw);
      wrap.append(head, row);
      return wrap;
    },

    segRow(label, options, active, onPick) {
      const wrap = h('div', 'control');
      const head = h('div', 'control-label');
      head.innerHTML = `<span>${VE.escapeHtml(label)}</span>`;
      const seg = h('div', 'seg');
      options.forEach(o => {
        const b = h('button');
        b.type = 'button';
        if (o.icon) b.innerHTML = VE.icon(o.icon);
        else b.textContent = o.name;
        b.title = o.name;
        b.className = o.id === active ? 'active' : '';
        b.addEventListener('click', () => onPick(o.id));
        seg.appendChild(b);
      });
      wrap.append(head, seg);
      return wrap;
    },

    iconButton(label, icon, onClick, cls = 'btn tiny') {
      const b = h('button', cls);
      b.type = 'button';
      b.innerHTML = VE.icon(icon);
      const span = h('span');
      span.textContent = label;
      b.appendChild(span);
      b.addEventListener('click', onClick);
      return b;
    },

    /* ---------------- project panel ---------------- */

    renderProject() {
      const app = this.app;
      const project = app.state.project;

      const head = h('div', 'insp-head');
      head.innerHTML = `<div class="badge-icon">${VE.icon('settings')}</div>
        <div class="insp-head-text"><strong>Project</strong><span>Canvas &amp; settings</span></div>`;
      this.root.appendChild(head);

      const aspectGrid = h('div', 'aspect-grid');
      VE.ASPECTS.forEach(a => {
        const b = h('button', 'aspect-btn' + (project.aspect === a.id ? ' active' : ''));
        b.type = 'button';
        const i = document.createElement('i');
        let w, hh;
        if (a.w >= a.h) { w = 22; hh = Math.max(8, Math.round(22 * a.h / a.w)); }
        else { hh = 20; w = Math.max(8, Math.round(20 * a.w / a.h)); }
        i.style.width = w + 'px';
        i.style.height = hh + 'px';
        b.append(i, document.createTextNode(a.short));
        b.addEventListener('click', () => app.setAspect(a.id));
        aspectGrid.appendChild(b);
      });

      const stats = h('div');
      const dur = VE.projectDuration(project);
      const clipCount = project.tracks.reduce((n, t) => n + t.clips.length, 0);
      stats.innerHTML = `<div class="stat-row"><span>Aspect ratio</span><b>${project.aspect}</b></div>
        <div class="stat-row"><span>Duration</span><b>${VE.fmtClock(dur)}</b></div>
        <div class="stat-row"><span>Clips</span><b>${clipCount}</b></div>`;
      stats.style.marginTop = '10px';

      const bg = this.colorRow('Background', project.background || '#000000',
        (v) => { project.background = v; app.invalidate(); },
        (v) => { project.background = v; app.commit({ history: true, timeline: true }); });

      this.root.appendChild(this.section('Canvas', aspectGrid, stats, bg));

      const trackList = h('div');
      project.tracks.forEach(t => {
        const row = h('div', 'stat-row');
        row.innerHTML = `<span style="display:flex;align-items:center;gap:6px">${VE.icon(TYPE_ICON[t.type] || 'layers')}${VE.escapeHtml(t.name)}</span><b>${t.clips.length}</b>`;
        trackList.appendChild(row);
      });
      const addTrack = h('div', 'btn-row');
      addTrack.appendChild(this.iconButton('Add track', 'plus', () => {
        VE.openMenu(addTrack.querySelector('button'), [
          { label: 'Video track', icon: 'film', onClick: () => app.addTrack('video') },
          { label: 'Overlay track', icon: 'layers', onClick: () => app.addTrack('overlay') },
          { label: 'Text track', icon: 'type', onClick: () => app.addTrack('text') },
          { label: 'Audio track', icon: 'music', onClick: () => app.addTrack('audio') }
        ]);
      }, 'btn ghost tiny'));
      trackList.appendChild(addTrack);

      this.root.appendChild(this.section('Tracks', trackList));

      const storage = h('div');
      const note = h('p', 'insp-note');
      note.textContent = 'Projects autosave to this browser. Media never leaves your device. Save a project file to move the edit to another computer.';
      const fileBtns = h('div', 'action-grid');
      fileBtns.appendChild(this.iconButton('Save project', 'download', () => app.saveProjectFile(), 'btn tiny'));
      fileBtns.appendChild(this.iconButton('Open project', 'folder', () => app.openProjectFile(), 'btn tiny'));
      fileBtns.appendChild(this.iconButton('Export video', 'download', () => app.openExport(), 'btn tiny'));
      fileBtns.appendChild(this.iconButton('New project', 'plus', () => app.newProject(), 'btn tiny'));
      storage.append(fileBtns, note);
      this.root.appendChild(this.section('Project file', storage));

      const shortcuts = h('div', 'kbd-list');
      VE.SHORTCUTS.slice(0, 6).forEach(([k, d]) => {
        shortcuts.insertAdjacentHTML('beforeend', `<kbd>${VE.escapeHtml(k)}</kbd><span>${VE.escapeHtml(d)}</span>`);
      });
      this.root.appendChild(this.section('Shortcuts', shortcuts));

      const reset = h('button', 'btn ghost tiny');
      reset.textContent = 'Clear browser storage';
      reset.style.marginTop = '4px';
      reset.addEventListener('click', () => app.resetAllData());
      this.root.appendChild(this.section('Storage', reset));

      VE.hydrateIcons(this.root);
    },

    /* ---------------- clip panel ---------------- */

    renderClip(clip, track) {
      const app = this.app;
      const project = app.state.project;
      const asset = clip.assetId ? app.state.assets.get(clip.assetId) : null;
      const isText = clip.type === 'text';
      const isAudio = clip.type === 'audio';
      const isVisual = !isAudio;

      const head = h('div', 'insp-head');
      const title = isText ? ((clip.text || 'Text').split('\n')[0] || 'Text') : clip.name;
      head.innerHTML = `<div class="badge-icon">${VE.icon(TYPE_ICON[clip.type] || 'film')}</div>
        <div class="insp-head-text"><strong></strong><span>${clip.type} clip</span></div>`;
      head.querySelector('strong').textContent = title;
      const close = h('button', 'icon-btn sm');
      close.innerHTML = VE.icon('x');
      close.title = 'Deselect';
      close.addEventListener('click', () => app.selectClip(null));
      head.appendChild(close);
      this.root.appendChild(head);

      if (asset && asset.missing) {
        const warn = h('div', 'insp-section');
        warn.innerHTML = `<div class="relink-bar" style="margin:0"><span>Media file is missing. Relink it from the Media tab to restore this clip.</span></div>`;
        this.root.appendChild(warn);
      }

      /* quick actions */
      const actions = h('div', 'action-grid');
      actions.appendChild(this.iconButton('Split', 'scissors', () => app.splitSelection(), 'btn tiny'));
      actions.appendChild(this.iconButton('Duplicate', 'copy', () => app.duplicateSelection(), 'btn tiny'));
      actions.appendChild(this.iconButton('Delete', 'trash', () => app.deleteSelection(), 'btn tiny'));
      if (clip.type === 'video') actions.appendChild(this.iconButton('Detach audio', 'music', () => app.detachAudio(clip.id), 'btn tiny'));
      this.root.appendChild(this.section('Actions', actions));

      /* timing */
      const maxDur = VE.assetDurationLimit(clip, asset);
      const timing = h('div');
      timing.appendChild(this.numberRow('Start (s)', clip.start, { min: 0, step: 0.1, decimals: 2 },
        (v) => { clip.start = Math.max(0, v); },
        () => app.commit({ history: true, timeline: true })
      ));
      timing.appendChild(this.numberRow('Duration (s)', clip.duration, { min: 0.1, max: maxDur, step: 0.1, decimals: 2 },
        (v) => { clip.duration = VE.clamp(v, 0.1, maxDur); },
        () => app.commit({ history: true, timeline: true, inspector: true })
      ));
      if (!isText && clip.type !== 'image') {
        timing.appendChild(this.numberRow('Source in (s)', clip.inPoint, { min: 0, step: 0.1, decimals: 2 },
          (v) => { clip.inPoint = Math.max(0, v); },
          () => app.commit({ history: true, timeline: true })
        ));
        timing.appendChild(this.slider('Speed', clip.speed, 0.25, 4, 0.05, v => v.toFixed(2) + '×',
          (v) => {
            const old = clip.speed;
            const factor = old / v;
            clip.speed = v;
            clip.duration = VE.clamp(clip.duration * factor, 0.1, VE.assetDurationLimit(clip, asset));
          },
          () => { app.commit({ history: true, timeline: true }); this.render(); }
        ));
      }
      const actions2 = h('div', 'btn-row');
      actions2.appendChild(this.iconButton('Move to playhead', 'plus', () => {
        clip.start = Math.max(0, app.state.time);
        app.commit({ history: true, timeline: true, inspector: true });
      }, 'btn ghost tiny'));
      timing.appendChild(actions2);
      this.root.appendChild(this.section('Timing', timing));

      /* transform */
      if (isVisual) {
        const layout = h('div');
        layout.appendChild(this.slider('Position X', clip.x, 0, 1, 0.005, v => Math.round(v * 100) + '%', v => { clip.x = v; }));
        layout.appendChild(this.slider('Position Y', clip.y, 0, 1, 0.005, v => Math.round(v * 100) + '%', v => { clip.y = v; }));
        layout.appendChild(this.slider('Scale', clip.scale, 0.1, 3, 0.01, v => Math.round(v * 100) + '%', v => { clip.scale = v; }));
        layout.appendChild(this.slider('Rotation', clip.rotation, -180, 180, 1, v => Math.round(v) + '°', v => { clip.rotation = v; }));
        layout.appendChild(this.slider('Opacity', clip.opacity, 0, 1, 0.01, v => Math.round(v * 100) + '%', v => { clip.opacity = v; }));
        this.root.appendChild(this.section('Layout', layout));
      }

      /* look */
      if (!isText && !isAudio) {
        const look = h('div');
        look.appendChild(this.segRow('Fit', [{ id: 'cover', name: 'Fill' }, { id: 'contain', name: 'Fit' }], clip.fit,
          (v) => { clip.fit = v; app.commit({ history: true, inspector: true }); }
        ));
        const filterGrid = h('div', 'filter-grid');
        VE.FILTERS.forEach(f => {
          const b = h('button', 'filter-btn' + (clip.filter === f.id ? ' active' : ''));
          b.type = 'button';
          b.title = f.name;
          const i = document.createElement('i');
          if (f.css !== 'none') i.style.filter = f.css;
          const s = document.createElement('span');
          s.textContent = f.name;
          b.append(i, s);
          b.addEventListener('click', () => {
            clip.filter = f.id;
            app.commit({ history: true, timeline: true });
            this.render();
          });
          filterGrid.appendChild(b);
        });
        const fLabel = h('div', 'control-label');
        fLabel.style.marginTop = '4px';
        fLabel.innerHTML = '<span>Color filter</span>';
        look.append(fLabel, filterGrid);
        this.root.appendChild(this.section('Look', look));
      }

      /* text */
      if (isText) {
        const content = h('div');
        const ta = h('textarea', 'input');
        ta.rows = 3;
        ta.value = clip.text;
        const head2 = h('div', 'control-label');
        head2.innerHTML = '<span>Text</span>';
        ta.addEventListener('input', () => {
          clip.text = ta.value;
          VE.Timeline.updateClipLabel(clip);
          app.invalidate();
          app.scheduleSave();
        });
        ta.addEventListener('change', () => app.commit({ history: true }));
        const taWrap = h('div', 'control');
        taWrap.append(head2, ta);
        content.appendChild(taWrap);

        content.appendChild(this.selectRow('Style', VE.TEXT_STYLES, clip.style, (v) => {
          clip.style = v;
          app.commit({ history: true, inspector: true });
        }));
        content.appendChild(this.selectRow('Font', VE.FONTS, clip.fontFamily, (v) => {
          clip.fontFamily = v;
          app.commit({ history: true });
        }));
        content.appendChild(this.slider('Size', clip.fontSize, 16, 220, 1, v => Math.round(v) + 'px', v => { clip.fontSize = v; }));
        content.appendChild(this.slider('Width', clip.textWidth, 0.2, 1, 0.01, v => Math.round(v * 100) + '%', v => { clip.textWidth = v; }));
        content.appendChild(this.segRow('Align', [
          { id: 'left', name: 'Left' }, { id: 'center', name: 'Center' }, { id: 'right', name: 'Right' }
        ], clip.align, (v) => { clip.align = v; app.commit({ history: true }); }));

        const styleBtns = h('div', 'btn-row');
        const boldBtn = this.iconButton('Bold', 'type', () => {
          clip.bold = !clip.bold;
          app.commit({ history: true, inspector: true });
        }, 'btn tiny');
        boldBtn.style.fontWeight = '800';
        boldBtn.classList.toggle('toggle', true);
        boldBtn.classList.toggle('active', !!clip.bold);
        const italicBtn = this.iconButton('Italic', 'type', () => {
          clip.italic = !clip.italic;
          app.commit({ history: true, inspector: true });
        }, 'btn tiny');
        italicBtn.style.fontStyle = 'italic';
        italicBtn.classList.toggle('active', !!clip.italic);
        styleBtns.append(boldBtn, italicBtn);
        content.appendChild(styleBtns);

        content.appendChild(this.colorRow('Color', clip.color,
          (v) => { clip.color = v; },
          (v) => { clip.color = v; app.commit({ history: true }); }
        ));
        if (clip.style === 'gradient') {
          content.appendChild(this.colorRow('Gradient end', clip.color2 || '#3ba0ff',
            (v) => { clip.color2 = v; },
            (v) => { clip.color2 = v; app.commit({ history: true }); }
          ));
        }
        if (clip.style === 'subtitle' || clip.style === 'boxed' || clip.style === 'lowerthird') {
          content.appendChild(this.colorRow('Background', clip.bgColor || '#000000',
            (v) => { clip.bgColor = v; },
            (v) => { clip.bgColor = v; app.commit({ history: true }); }
          ));
        }
        this.root.appendChild(this.section('Text', content));
      }

      /* sound */
      if (!isText) {
        const sound = h('div');
        sound.appendChild(this.slider('Volume', clip.volume, 0, 1, 0.01, v => Math.round(v * 100) + '%', v => { clip.volume = v; }));
        sound.appendChild(this.slider('Fade in', clip.fadeIn || 0, 0, 5, 0.05, v => v.toFixed(1) + 's', v => { clip.fadeIn = v; }));
        sound.appendChild(this.slider('Fade out', clip.fadeOut || 0, 0, 5, 0.05, v => v.toFixed(1) + 's', v => { clip.fadeOut = v; }));
        this.root.appendChild(this.section('Sound', sound));
      }

      /* transitions */
      if (isVisual) {
        const trans = h('div');
        trans.appendChild(this.selectRow('In', VE.TRANSITIONS, (clip.transitionIn && clip.transitionIn.type) || 'none', (v) => {
          clip.transitionIn = { type: v, duration: (clip.transitionIn && clip.transitionIn.duration) || 0.5 };
          app.commit({ history: true, inspector: true });
        }));
        if (clip.transitionIn && clip.transitionIn.type !== 'none') {
          trans.appendChild(this.slider('In duration', clip.transitionIn.duration, 0.1, 3, 0.05, v => v.toFixed(2) + 's',
            (v) => { clip.transitionIn.duration = v; },
            () => app.commit({ history: true })
          ));
        }
        trans.appendChild(this.selectRow('Out', VE.TRANSITIONS, (clip.transitionOut && clip.transitionOut.type) || 'none', (v) => {
          clip.transitionOut = { type: v, duration: (clip.transitionOut && clip.transitionOut.duration) || 0.5 };
          app.commit({ history: true, inspector: true });
        }));
        if (clip.transitionOut && clip.transitionOut.type !== 'none') {
          trans.appendChild(this.slider('Out duration', clip.transitionOut.duration, 0.1, 3, 0.05, v => v.toFixed(2) + 's',
            (v) => { clip.transitionOut.duration = v; },
            () => app.commit({ history: true })
          ));
        }
        this.root.appendChild(this.section('Transitions', trans));
      }

      const info = h('div', 'insp-note');
      if (isText) info.textContent = 'Tip: drag the clip on the timeline to retime it, or drag its edges to trim.';
      else info.textContent = `Source: ${asset ? asset.name : 'missing'} · Track: ${track.name}`;
      this.root.appendChild(this.section('Info', info));
    }
  };

  VE.Inspector = Inspector;
})();
