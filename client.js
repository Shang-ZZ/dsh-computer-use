window.__ModuleLoader__.load({
  id: 'dsh-computer-use',
  factory(require) {
    const React = require('react');
    const { useState, useEffect } = React;
    const h = React.createElement;

    const v = (name, fallback) => `var(--dsw-alias-${name}, ${fallback})`;

    function PanelIcon({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 8, y: 12, width: 48, height: 38, rx: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 3 }),
        h('line', { x1: 8, y1: 22, x2: 56, y2: 22, stroke: 'currentColor', strokeWidth: 3 }),
        h('path', { d: 'M27 27 L27 48 L32 43 L37 52 L42 50 L37 41 L44 41 Z', fill: 'currentColor' })
      );
    }

    function ageText(ms) {
      if (!ms) return '';
      const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
      if (s < 5) return 'just now';
      if (s < 60) return `${s}s ago`;
      return `${Math.round(s / 60)}m ago`;
    }

    const LIVE_WINDOW_MS = 15000;

    function WindowMonitor() {
      const [state, setState] = useState({ app: null, at: 0, screenSeq: 0, hasFrame: false, active: false });
      useEffect(() => {
        let alive = true;
        let timer;
        fetch('/dsh-computer-use/start', { method: 'POST' }).catch(() => {});
        async function poll() {
          try {
            const r = await fetch('/dsh-computer-use/window', { cache: 'no-store' });
            if (!r.ok) return;
            const data = await r.json();
            if (alive) setState({
              app: data.app ?? null,
              at: data.at ?? 0,
              active: !!data.active,
              screenSeq: data.screenSeq ?? 0,
              hasFrame: !!data.hasFrame,
            });
          } catch {
            // keep the last state
          }
        }
        poll();
        timer = setInterval(poll, 500);
        return () => {
          alive = false;
          clearInterval(timer);
          fetch('/dsh-computer-use/stop', { method: 'POST' }).catch(() => {});
        };
      }, []);

      const live = state.active;
      const imgSrc = state.active && state.hasFrame ? `/dsh-computer-use/screen?t=${state.screenSeq}` : null;

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
      const emptyStyle = { padding: 24, fontSize: 13, lineHeight: 1.7, overflowY: 'auto', minHeight: 0 };

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
                h('div', { style: { fontWeight: 600, marginBottom: 10, fontSize: 14 } }, 'Computer Use 实时监控'),
                h('div', null, '此面板实时显示 agent 通过 computer use 正在控制的窗口画面。'),
                h('div', { style: { marginTop: 8 } },
                  '让 agent 执行一个电脑操作任务（例如「打开计算器并读取显示」），画面就会在这里实时跟随它操作的那个窗口。'),
                h('div', { style: { marginTop: 14, fontSize: 12, opacity: 0.72 } },
                  '前提：本机已安装 ChatGPT 桌面应用；并已在「系统设置 → 隐私与安全性 → 屏幕录制」给 DeepSeek Harness 授权。')
              )
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
