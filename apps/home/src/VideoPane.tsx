import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { downloadFile, formatBytes } from './files';
import { createTransport, MediaBar } from './media';
import type { Menu } from './osApi';
import { TASKBAR_HEIGHT, VIDEO_APP, type Panes } from './shell';

type Props = {
  fileId: string;
  panes: Panes;
  onTitle: (title: string) => void;
  /** Hand the window a menu bar. An accessor, so the greyed-out items keep up. */
  onMenus: (menus: () => Menu[], select: (id: string) => void) => void;
  /** Ask the window for a body this big, in pixels. It decides what it can spare. */
  onSizeToContent: (w: number, h: number) => void;
};

/** How much of the desktop a window is allowed to take just by being opened. */
const ROOM = 0.7;

/**
 * Josh's Video Playback App — the same shape as the listening app, with the picture
 * where the worm would be.
 */
export function VideoPane(props: Props) {
  const [id, setId] = createSignal(props.fileId);
  const transport = createTransport();
  let video!: HTMLVideoElement;
  let stage!: HTMLDivElement;
  let foot!: HTMLDivElement;
  /** Set once the window has been sized. Only the video it opened on gets to do that. */
  let sized = false;

  const films = () => props.panes.filesOfKind('video');
  const at = () => films().findIndex((f) => f.id === id());
  const current = () => props.panes.fileById(id());

  const step = (by: number, thenPlay = transport.playing()) => {
    const all = films();
    if (all.length < 2) return;
    const here = at();
    const next = all[here < 0 ? 0 : (here + by + all.length) % all.length];
    setId(next.id);
    props.onTitle(`${next.name} — ${VIDEO_APP}`);
    if (thenPlay) video.addEventListener('canplay', () => transport.play(), { once: true });
  };

  /** The same File menu the picture viewer has, for the same reason. */
  const menus = (): Menu[] => [
    {
      label: 'File',
      items: [{ id: 'download', label: 'Download Video', disabled: !current() }],
    },
  ];

  /**
   * Shape the window round the film it just opened, rather than leaving a wide one
   * letterboxed top and bottom in a window built for something else. Never larger than
   * the picture really is — blowing a small clip up to fill the desktop only makes a
   * blurrier one — and never more than a fair share of the screen.
   */
  const sizeToVideo = () => {
    const { videoWidth: vw, videoHeight: vh } = video;
    if (sized || !vw || !vh) return;
    sized = true;
    const scale = Math.min(
      (window.innerWidth * ROOM) / vw,
      ((window.innerHeight - TASKBAR_HEIGHT) * ROOM) / vh,
      1,
    );
    props.onSizeToContent(Math.round(vw * scale), Math.round(vh * scale) + foot.clientHeight);
  };

  onMount(() => {
    props.onMenus(menus, (pick) => {
      const file = current();
      if (pick === 'download' && file) downloadFile(file);
    });

    transport.attach(video);
    // Nothing on 'ended': a film that finishes stops, and the arrows are there for
    // whoever wants the next one. Running straight on is a thing a jukebox does.
    // In case the file was quick enough to be ready before any of this ran.
    video.addEventListener('loadedmetadata', sizeToVideo);
    sizeToVideo();
    onCleanup(() => video.removeEventListener('loadedmetadata', sizeToVideo));
  });

  return (
    <div
      class="video-pane"
      tabindex={0}
      onKeyDown={(e) => {
        if (e.key === ' ') transport.toggle();
        else if (e.key === 'ArrowRight') transport.seek(transport.time() + 5);
        else if (e.key === 'ArrowLeft') transport.seek(transport.time() - 5);
        else return;
        // Space would otherwise re-press whichever button was last clicked.
        e.preventDefault();
      }}
    >
      <div class="video-stage" ref={stage}>
        {/* Clicking the picture plays and pauses it, as it does everywhere else. */}
        <video ref={video} src={current()?.url} onClick={() => transport.toggle()} />
        <Show when={transport.broken()}>
          <p class="media-broken">
            Josh's Computer can't play this one. It's on the desktop all the same.
          </p>
        </Show>
      </div>

      <div class="media-foot" ref={foot}>
        <MediaBar
          transport={transport}
          siblings={films()}
          onStep={step}
          extra={
            <button
              class="chrome-button"
              title="Full screen"
              onClick={() => void stage.requestFullscreen?.().catch(() => {})}
            >
              <span aria-hidden="true">⛶</span>
            </button>
          }
        />
        <span class="media-status">
          <Show when={current()} fallback="Not on the desktop any more">
            {(file) => (
              <>
                <Show when={at() >= 0}>
                  Video {at() + 1} of {films().length} —{' '}
                </Show>
                {file().name} — {formatBytes(file().size)}
              </>
            )}
          </Show>
        </span>
      </div>
    </div>
  );
}
