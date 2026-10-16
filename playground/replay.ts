// Bar replay for the workspace playground: a "Replay" topbar button that docks a control
// strip — start time, step, play/pause, speed, stop — and drives `ctx.replay`, so every
// cell replays on ONE clock and none shows a bar that closes after the shared time.
// Registered at import time, before the workspace is constructed.
import { registerWidgetAction, type WidgetContext } from '../src/plugin';
import type { WorkspaceWidgetContext } from '../src/workspace';

/** Pace choices: label → delay between two revealed bars (ms). */
const SPEEDS: ReadonlyArray<readonly [string, number]> = [
    ['0.5×', 2000],
    ['1×', 1000],
    ['2×', 500],
    ['5×', 200],
    ['10×', 100],
];
const DEFAULT_SPEED_MS = 1000;

/** Only a workspace hands its actions `replay`; a single-chart widget does not. */
function hasReplay(ctx: WidgetContext): ctx is WorkspaceWidgetContext {
    return 'replay' in ctx;
}

/** `YYYY-MM-DDTHH:mm` in UTC — what the workspace's default timezone displays. */
function toUtcInput(ms: number): string {
    return new Date(ms).toISOString().slice(0, 16);
}

function fromUtcInput(value: string): number {
    return value ? Date.parse(`${value}:00Z`) : NaN;
}

function formatCursor(ms: number | null): string {
    return ms == null ? '—' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
        'all:unset;box-sizing:border-box;padding:4px 14px;border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-sm);color:var(--vela-fg);cursor:pointer;';
    b.onclick = onClick;
    return b;
}

// The strip is DOM state only (like the playground's Code dialog): the WidgetContext is
// never stored beyond the one `run` call that built it.
let closeStrip: (() => void) | null = null;

registerWidgetAction({
    id: 'dev.replay',
    target: 'topbar',
    label: 'Replay',
    icon: 'replay',
    align: 'left',
    run: (ctx) => {
        if (!hasReplay(ctx)) return;
        if (closeStrip) {
            closeStrip();
            return;
        }
        const { replay, toast } = ctx;

        const strip = document.createElement('div');
        strip.setAttribute('role', 'group');
        strip.setAttribute('aria-label', 'Bar replay controls');
        strip.style.cssText =
            'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 12px;background:var(--vela-surface-overlay);border-top:1px solid var(--vela-border-soft);color:var(--vela-fg);font-size:var(--vela-font-size-md);';

        const fromLabel = document.createElement('label');
        fromLabel.textContent = 'Start (UTC) ';
        const from = document.createElement('input');
        from.type = 'datetime-local';
        from.style.cssText =
            'background:var(--vela-surface-overlay);color:var(--vela-fg);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-sm);padding:3px 6px;font:inherit;';
        // A quarter of the way back from the newest bar: plenty of hidden bars to replay.
        const bounds = replay.bounds;
        if (bounds) from.value = toUtcInput(bounds.first + (bounds.last - bounds.first) * 0.75);
        fromLabel.append(from);

        const speed = document.createElement('select');
        speed.setAttribute('aria-label', 'Replay speed');
        speed.style.cssText = from.style.cssText;
        for (const [label, ms] of SPEEDS) {
            const o = document.createElement('option');
            o.value = String(ms);
            o.textContent = label;
            o.selected = ms === DEFAULT_SPEED_MS;
            speed.append(o);
        }

        const status = document.createElement('span');
        status.setAttribute('role', 'status');
        status.style.cssText = 'margin-left:auto;color:var(--vela-fg-muted);';

        const startBtn = button('Start', () => {
            const ms = fromUtcInput(from.value);
            if (!Number.isFinite(ms)) {
                toast('Pick a start time first', 'error');
                return;
            }
            void replay.start({ from: ms });
        });
        const stepBtn = button('Step', () => void replay.step());
        const playBtn = button('Play', () => {
            if (replay.state.playing) replay.pause();
            else replay.play(Number(speed.value));
        });
        const stopBtn = button('Stop', () => replay.stop());
        const closeBtn = button('Close', () => closeStrip?.());
        speed.onchange = () => {
            if (replay.state.playing) replay.play(Number(speed.value)); // calling play() again changes the pace
        };

        const refresh = (): void => {
            const s = replay.state;
            for (const b of [stepBtn, playBtn, stopBtn]) {
                b.style.opacity = s.active ? '1' : '0.45';
                b.style.pointerEvents = s.active ? 'auto' : 'none';
            }
            playBtn.textContent = s.playing ? 'Pause' : 'Play';
            status.textContent = s.active
                ? `${s.playing ? 'Playing' : 'Paused'} · ${formatCursor(s.cursorTime)} · ${s.remaining} bars left`
                : 'Pick a start time, then press Start';
        };

        const offs = (['replay:start', 'replay:step', 'replay:play', 'replay:pause', 'replay:end'] as const).map((e) => replay.on(e, refresh));
        refresh();

        strip.append(fromLabel, startBtn, stepBtn, playBtn, speed, stopBtn, closeBtn, status);
        const undock = ctx.dockStrip(strip);
        closeStrip = () => {
            replay.stop(); // leaving the strip must not leave the grid stuck in the past
            for (const off of offs) off();
            undock();
            closeStrip = null;
        };
    },
});
