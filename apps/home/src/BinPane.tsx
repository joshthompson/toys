import { For, Show } from 'solid-js';
import { BIN_GLYPH, binName, type Panes } from './shell';
import { resolve, artwork } from './toys';

type Props = {
  depth: number;
  panes: Panes;
};

export function BinPane(props: Props) {
  const level = () => props.panes.binLevels()[props.depth];
  /** Every bin below the top one holds the previous bin, plus whatever was dropped on it. */
  const nested = () => props.depth > 0;
  const isEmpty = () => !nested() && !level().toys.length;

  return (
    <div class="bin-pane">
      <Show
        when={!isEmpty()}
        fallback={
          <p class="bin-empty">
            <span class="bin-empty-glyph" aria-hidden="true">
              {BIN_GLYPH}
            </span>
            {binName(props.depth)} is empty.
            <small>Drag a toy onto the bin, or right-click one and pick Delete.</small>
          </p>
        }
      >
        <ul class="bin-list">
          <Show when={nested()}>
            <li class="bin-row is-bin">
              <span class="bin-row-art is-glyph" aria-hidden="true">
                {BIN_GLYPH}
              </span>
              <span class="bin-row-name">{binName(props.depth - 1)}</span>
              <button
                class="chrome-button"
                onClick={() => props.panes.openBin(props.depth - 1)}
              >
                Open
              </button>
            </li>
          </Show>

          <For each={level().toys}>
            {(toy) => (
              <li class="bin-row">
                <Show
                  when={artwork(toy)}
                  fallback={
                    <span class="bin-row-art is-glyph" aria-hidden="true">
                      ★
                    </span>
                  }
                >
                  <img class="bin-row-art" classList={{ 'is-bare': !!toy.icon }} src={resolve(artwork(toy)!)} alt="" />
                </Show>
                <span class="bin-row-name">{toy.name}</span>
                <button class="chrome-button" onClick={() => props.panes.restore(toy.name)}>
                  Put back
                </button>
              </li>
            )}
          </For>
        </ul>

        <footer class="bin-actions">
          <span class="bin-status">
            {level().toys.length + (nested() ? 1 : 0)} item
            {level().toys.length + (nested() ? 1 : 0) === 1 ? '' : 's'}
          </span>
          <button
            class="chrome-button"
            aria-disabled={!level().toys.length}
            onClick={() => level().toys.length && props.panes.emptyLevel(props.depth)}
          >
            Empty
          </button>
        </footer>
      </Show>
    </div>
  );
}
