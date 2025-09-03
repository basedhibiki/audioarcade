'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// ---- Quick palette via CSS variables so you can tweak fast ----
// Set these once in globals.css :root (see step 2)
const useVars = {
  yellow: 'var(--aa-yellow)',
  maroon: 'var(--aa-maroon)',
  red: 'var(--aa-red)',
  violet: 'var(--aa-violet)',
  ink: 'var(--aa-ink)',
};

// Swap this to your actual public asset path (SVG/PNG)
// e.g. /aa-logo.svg you export from your source file
const LOGO_SRC = '/aa-logo.svg';

type Item = {
  label: 'Exit' | 'Tutorial' | 'About' | 'Donate';
  action: 'exit' | 'tutorial' | 'about' | 'donate';
  href?: string;
};

const ITEMS: Item[] = [
  { label: 'Exit', action: 'exit' },
  { label: 'Tutorial', action: 'tutorial' },
  { label: 'About', action: 'about' },
  { label: 'Donate', action: 'donate', href: '/donate' }, // set your link
];

export default function XMBNavCvS2() {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Keyboard: ←/→ or A/D to move, Enter/Space to confirm, Esc to close modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const nearTop = window.scrollY < 8;
      const withinBar =
        barRef.current &&
        document.activeElement &&
        barRef.current.contains(document.activeElement as Node);

      if (!nearTop && !withinBar) return;

      if (['ArrowRight', 'KeyD'].includes(e.code)) {
        e.preventDefault();
        setActive((i) => (i + 1) % ITEMS.length);
      } else if (['ArrowLeft', 'KeyA'].includes(e.code)) {
        e.preventDefault();
        setActive((i) => (i - 1 + ITEMS.length) % ITEMS.length);
      } else if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        trigger(ITEMS[active]);
      } else if (e.key === 'Escape') {
        setShowAbout(false);
        setShowTutorial(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  // Gamepad: D-pad/left stick to move; A/Cross to confirm; B/Circle to close
  useEffect(() => {
    let raf = 0;
    let cooldown = 0;

    const loop = () => {
      const pads = navigator.getGamepads?.() || [];
      const p = pads[0];
      if (p) {
        // Axes: left stick X
        const x = p.axes?.[0] ?? 0;
        // D-pad (typical mapping 12/13/14/15)
        const dpadLeft = !!p.buttons?.[14]?.pressed;
        const dpadRight = !!p.buttons?.[15]?.pressed;

        // Confirm (A/Cross = 0 on most), Cancel (B/Circle = 1)
        const confirm = !!p.buttons?.[0]?.pressed;
        const cancel = !!p.buttons?.[1]?.pressed;

        if (cooldown <= 0) {
          if (x > 0.5 || dpadRight) {
            setActive((i) => (i + 1) % ITEMS.length);
            cooldown = 10; // frames
          } else if (x < -0.5 || dpadLeft) {
            setActive((i) => (i - 1 + ITEMS.length) % ITEMS.length);
            cooldown = 10;
          } else if (confirm) {
            trigger(ITEMS[active]);
            cooldown = 12;
          } else if (cancel) {
            setShowAbout(false);
            setShowTutorial(false);
            cooldown = 12;
          }
        } else {
          cooldown -= 1;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const trigger = (item: Item) => {
    switch (item.action) {
      case 'exit':
        if (history.length > 1) router.back();
        else router.push('/');
        break;
      case 'tutorial':
        setShowTutorial(true);
        break;
      case 'about':
        setShowAbout(true);
        break;
      case 'donate':
        if (item.href) {
          const external = item.href.startsWith('http');
          if (external) window.open(item.href, '_blank', 'noopener,noreferrer');
          else router.push(item.href);
        }
        break;
    }
  };

  return (
    <>
      {/* TOP BAR */}
      <div
        ref={barRef}
        role="menubar"
        aria-label="Audio Arcade menu"
        className="fixed top-0 left-0 right-0 z-50"
      >
        {/* CvS2 header stripe + scanlines */}
        <div className="relative border-b" style={{ borderColor: 'color-mix(in oklab, var(--aa-ink), transparent 60%)' }}>
          {/* gold band */}
          <div className="h-14 w-full" style={{ background: `linear-gradient(180deg, ${useVars.yellow} 0%, color-mix(in oklab, ${useVars.yellow}, white 10%) 100%)` }} />
          {/* maroon underline */}
          <div className="h-1.5 w-full" style={{ background: useVars.maroon }} />
          {/* subtle scanline overlay */}
          <div className="pointer-events-none absolute inset-0 mix-blend-multiply opacity-[0.18] scanlines" />
        </div>

        {/* Content row */}
        <div className="absolute inset-0 flex items-center">
          <div className="mx-auto max-w-6xl w-full px-4 flex items-center gap-5">
            {/* Diamond Badge + Logo (CvS2 tilt) */}
            <div
              className="relative h-10 w-10 shrink-0"
              aria-hidden="true"
            >
              <div
                className="absolute inset-0 rotate-45 rounded-[6px]"
                style={{
                  border: `2px solid ${useVars.maroon}`,
                  background: 'transparent',
                  boxShadow: `4px 4px 0 0 ${useVars.maroon}`,
                }}
              />
              <img
                src={LOGO_SRC}
                alt="Audio Arcade"
                className="absolute inset-0 m-auto h-7 w-7 -rotate-12"
                style={{ filter: 'drop-shadow(0 1px 0 rgba(0,0,0,.25))' }}
              />
            </div>

            {/* Title */}
            <div className="uppercase tracking-widest text-sm"
              style={{ color: useVars.ink, textShadow: '0 1px 0 rgba(255,255,255,.35)' }}>
              Audio Arcade
            </div>

            <div className="h-6 w-px" style={{ background: 'color-mix(in oklab, var(--aa-ink), transparent 60%)' }} />

            {/* Menu */}
            <nav className="flex-1">
              <ul className="flex items-center gap-1.5">
                {ITEMS.map((item, idx) => {
                  const isActive = active === idx;
                  const highlight =
                    item.label === 'Donate' ? useVars.red :
                    item.label === 'Tutorial' ? useVars.violet :
                    useVars.maroon;

                  return (
                    <li key={item.label}>
                      <button
                        role="menuitem"
                        onMouseEnter={() => setActive(idx)}
                        onFocus={() => setActive(idx)}
                        onClick={() => trigger(item)}
                        className="relative px-3 py-2 rounded-lg outline-none focus-visible:ring-2"
                        style={{
                          color: isActive ? useVars.ink : 'color-mix(in oklab, var(--aa-ink), transparent 35%)',
                          background: isActive ? 'color-mix(in oklab, white, transparent 85%)' : 'transparent',
                          boxShadow: isActive ? `inset 0 0 0 1px ${highlight}` : 'none',
                          transition: 'all .18s ease',
                        }}
                      >
                        <span className="text-sm font-semibold uppercase">{item.label}</span>

                        {/* Fat underline bar (CvS2 style) */}
                        <span
                          aria-hidden
                          className="absolute left-1/2 -translate-x-1/2 -bottom-1 h-1.5 rounded-full"
                          style={{
                            width: isActive ? 30 : 10,
                            background: highlight,
                            filter: 'drop-shadow(0 2px 0 rgba(0,0,0,.25))',
                            transition: 'all .18s ease',
                          }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      </div>

      {/* Spacer so content doesn’t sit under the bar */}
      <div className="h-[3.5rem]" />

      {/* Modals */}
      {showTutorial && (
        <Modal title="Tutorial" onClose={() => setShowTutorial(false)}>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>Join a channel and hit <b>Listen</b> to hear the stream.</li>
            <li>Request <b>Aux</b> to queue for control.</li>
            <li>Use <b>←/→</b> (or D-pad/left-stick). <b>Enter/A</b> selects.</li>
            <li><b>Esc/B</b> closes dialogs.</li>
          </ol>
        </Modal>
      )}

      {showAbout && (
        <Modal title="About" onClose={() => setShowAbout(false)}>
          <p className="text-sm">
            <b>Audio Arcade</b> — collaborative sets, queue control, ultra-low latency sessions.
            Built in the RAREGOD / HPBLK universe.
          </p>
          <p className="mt-2 text-sm">© {new Date().getFullYear()} RAREGOD.</p>
        </Modal>
      )}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Gamepad cancel handled in the loop; this is a safety
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          borderColor: 'color-mix(in oklab, var(--aa-ink), transparent 65%)',
          background: `linear-gradient(180deg, color-mix(in oklab, var(--aa-yellow), white 85%) 0%, white 100%)`,
        }}
      >
        {/* Header stripe */}
        <div className="h-2" style={{ background: 'linear-gradient(90deg, var(--aa-maroon), var(--aa-red), var(--aa-violet))' }} />
        <div className="px-5 py-3 flex items-center justify-between">
          <h3 className="text-base font-bold uppercase" style={{ color: 'var(--aa-ink)' }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm"
            style={{ color: 'color-mix(in oklab, var(--aa-ink), transparent 25%)' }}
          >
            ✕
          </button>
        </div>
        <div className="px-5 pb-5 text-ink">
          {children}
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold uppercase"
            style={{
              background: 'color-mix(in oklab, var(--aa-ink), transparent 88%)',
              color: 'var(--aa-ink)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
