import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { formatBytes } from './files';
import { createTransport, MediaBar } from './media';
import { VIDEO_APP, type Panes } from './shell';

type Props = {
  fileId: string;
  panes: Panes;
  onTitle: (title: string) => void;
};

/**
 * Josh's Video Playback App — the same shape as the listening app, with the picture
 * where the worm would be.
 */
export function VideoPane(props: Props) {
  const [id, setId] = createSignal(props.fileId);
  const transport = createTransport();
  let video!: HTMLVideoElement;
  let stage!: HTMLDivElement;

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

  onMount(() => {
    transport.attach(video);
    const advance = () => step(1, true);
    video.addEventListener('ended', advance);
    onCleanup(() => video.removeEventListener('ended', advance));
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

      <div class="media-foot">
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
