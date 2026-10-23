window.__ModuleLoader__.load({
  id: 'dsh-computer-use',
  factory(require) {
    const React = require('react');
    const { useState, useEffect } = React;
    const h = React.createElement;

    const v = (name, fallback) => `var(--dsw-alias-${name}, ${fallback})`;

    // Sidebar icon: a window with a pointer, drawn in the panel row's currentColor.
    function PanelIcon({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 8, y: 12, width: 48, height: 38, rx: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 3 }),
        h('line', { x1: 8, y1: 22, x2: 56, y2: 22, stroke: 'currentColor', strokeWidth: 3 }),
        h('path', {
          d: 'M27 27 L27 48 L32 43 L37 52 L42 50 L37 41 L44 41 Z',
          fill: 'currentColor',
        })
      );
    }

    function ageText(ms) {
      if (!ms) return '';
      const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
      if (s < 5) return 'just now';
      if (s < 60) return `${s}s ago`;
      return `${Math.round(s / 60)}m ago`;
    }

    // A target is "live" if it changed within the last 15 seconds.
    const LIVE_WINDOW_MS = 15000;

    function WindowMonitor() {
      const [state, setState] = useState({ app: null, at: 0 });
      useEffect(() => {
        let alive = true;
        let timer;
        async function poll() {
          try {
            const r = await fetch('/dsh-computer-use/window', { cache: 'no-store' });
            if (!r.ok) return;
            const data = await r.json();
            if (alive) setState({ app: data.app ?? null, at: data.at ?? 0 });
          } catch {
            // The host route is not reachable; keep the last state.
          }
        }
        poll();
        timer = setInterval(poll, 1500);
        return () => { alive = false; clearInterval(timer); };
      }, []);

      const live = state.app != null && Date.now() - state.at < LIVE_WINDOW_MS;
      const rootStyle = {
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        backgroundColor: v('canvas', '#fff'), color: v('text', '#17181c'), fontFamily: 'inherit',
      };
      const headerStyle = {
        padding: '12px 14px', borderBottom: `1px solid ${v('border', '#e6e7ea')}`,
        display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, flexShrink: 0,
      };
      const dotStyle = {
        width: 9, height: 9, borderRadius: '50%',
        backgroundColor: live ? '#16a34a' : '#9ca3af',
        flexShrink: 0,
      };
      const bodyStyle = { padding: 16, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' };
      const appNameStyle = { fontSize: 17, fontWeight: 600, wordBreak: 'break-word' };
      const metaStyle = { fontSize: 12, opacity: 0.6, lineHeight: 1.4 };
      const idleStyle = { fontSize: 13, opacity: 0.65, lineHeight: 1.5 };

      return h(
        'div',
        { style: rootStyle },
        h(
          'div',
          { style: headerStyle },
          h('span', { style: dotStyle }),
          'Computer Use'
        ),
        h(
          'div',
          { style: bodyStyle },
          live
            ? h(React.Fragment, null,
                h('div', { style: appNameStyle }, state.app),
                h('div', { style: metaStyle }, `The agent is controlling this app · ${ageText(state.at)}`))
            : h('div', { style: idleStyle },
                'Idle. When the agent controls an app through computer use, its window shows up here in real time.')
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'computer-use-monitor' }, WindowMonitor)
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'computer-use-monitor', order: 31, label: () => 'Computer Use' },
            PanelIcon
          )
        );
      },
    };
  },
});
