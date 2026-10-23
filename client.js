window.__ModuleLoader__.load({
  id: 'dsh-computer-use',
  factory(require) {
    const React = require('react');
    const { useState, useEffect } = React;
    const h = React.createElement;

    const v = (name, fallback) => `var(--dsw-alias-${name}, ${fallback})`;

    function ageText(ms) {
      if (!ms) return '';
      const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
      if (s < 5) return 'just now';
      if (s < 60) return `${s}s ago`;
      return `${Math.round(s / 60)}m ago`;
    }

    // A target is "live" if it changed within the last 15 seconds.
    const LIVE_WINDOW_MS = 15000;

    function MonitorView() {
      const [state, setState] = useState({ app: null, at: 0, imageSeq: 0, hasImage: false });
      useEffect(() => {
        let alive = true;
        let timer;
        async function poll() {
          try {
            const r = await fetch('/dsh-computer-use/window', { cache: 'no-store' });
            if (!r.ok) return;
            const data = await r.json();
            if (alive) setState({
              app: data.app ?? null,
              at: data.at ?? 0,
              imageSeq: data.imageSeq ?? 0,
              hasImage: !!data.hasImage,
            });
          } catch {
            // The host route is not reachable; keep the last state.
          }
        }
        poll();
        timer = setInterval(poll, 1500);
        return () => { alive = false; clearInterval(timer); };
      }, []);

      const live = state.app != null && Date.now() - state.at < LIVE_WINDOW_MS;
      const imgSrc = state.hasImage ? `/dsh-computer-use/screenshot?t=${state.imageSeq}` : null;

      const rootStyle = {
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%',
        backgroundColor: v('bg-base', '#fff'), color: v('label-primary', '#17181c'), fontFamily: 'inherit',
      };
      const headerStyle = {
        padding: '10px 14px', borderBottom: `1px solid ${v('border-l1', '#e6e7ea')}`,
        display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, flexShrink: 0,
      };
      const dotStyle = {
        width: 9, height: 9, borderRadius: '50%',
        backgroundColor: live ? '#16a34a' : '#9ca3af', flexShrink: 0,
      };
      const bodyStyle = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };
      const screenWrapStyle = {
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12, backgroundColor: '#0f1115',
      };
      const imgStyle = { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 };
      const metaStyle = { padding: '10px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 };
      const appNameStyle = { fontWeight: 600, wordBreak: 'break-word' };
      const metaAgeStyle = { fontSize: 12, opacity: 0.6, marginLeft: 'auto' };
      const emptyStyle = { padding: 24, fontSize: 13, opacity: 0.65, lineHeight: 1.6 };

      return h(
        'div',
        { style: rootStyle },
        h('div', { style: headerStyle }, h('span', { style: dotStyle }), 'Computer Use'),
        h(
          'div',
          { style: bodyStyle },
          imgSrc
            ? h('div', { style: screenWrapStyle }, h('img', { style: imgStyle, src: imgSrc, alt: state.app || 'screen' }))
            : h('div', { style: emptyStyle },
                'No screen captured yet. When the agent controls an app through computer use, its window shows up here live.')
        ),
        h(
          'div',
          { style: metaStyle },
          live
            ? h(React.Fragment, null,
                h('span', { style: appNameStyle }, state.app || 'an app'),
                h('span', { style: metaAgeStyle }, ageText(state.at)))
            : h('span', { style: { fontSize: 12, opacity: 0.6 } }, 'Idle')
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'computer-use', order: 40, label: () => 'Computer Use' },
            (props) => h(MonitorView, props)
          )
        );
      },
    };
  },
});
