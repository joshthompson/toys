import { For } from 'solid-js';
import {
  DEFAULT_DESKTOP,
  DEFAULT_ICON_SIZE,
  ICON_SIZE_OPTIONS,
  isIconSize,
  type Panes,
} from '../os/shell';
import { NO_SCREENSAVER, SCREENSAVERS } from '../os/screensavers';

const SWATCHES = [
  { name: 'Teal', value: DEFAULT_DESKTOP },
  { name: 'Classic', value: '#008080' },
  { name: 'Slate', value: '#4a5b6b' },
  { name: 'Aubergine', value: '#5a3d6b' },
  { name: 'Moss', value: '#4a6b3d' },
  { name: 'Rust', value: '#8c5230' },
  { name: 'Midnight', value: '#1a1a3d' },
  { name: 'Graphite', value: '#404040' },
];

export function SettingsPane(props: { panes: Panes }) {
  const restoreDefaults = () => {
    props.panes.setColour(DEFAULT_DESKTOP);
    props.panes.setWallpaper(null);
    props.panes.setIconSize(DEFAULT_ICON_SIZE);
    props.panes.setScreensaver(NO_SCREENSAVER);
  };

  return (
    <div class="pane">
      <fieldset class="field">
        <legend>Desktop colour</legend>
        <div class="swatches">
          <For each={SWATCHES}>
            {(swatch) => (
              <button
                class="swatch"
                classList={{ 'is-active': props.panes.colour() === swatch.value }}
                style={{ background: swatch.value }}
                title={swatch.name}
                aria-label={swatch.name}
                aria-pressed={props.panes.colour() === swatch.value}
                onClick={() => props.panes.setColour(swatch.value)}
              />
            )}
          </For>
        </div>
      </fieldset>

      <label class="field-row">
        Custom
        <input
          type="color"
          value={props.panes.colour()}
          onInput={(e) => props.panes.setColour(e.currentTarget.value)}
        />
        <code>{props.panes.colour()}</code>
      </label>

      <div class="field-row">
        Background
        <code>{props.panes.wallpaper()?.name ?? 'None'}</code>
        <button
          class="chrome-button"
          aria-disabled={!props.panes.wallpaper()}
          onClick={() => props.panes.wallpaper() && props.panes.setWallpaper(null)}
        >
          Remove
        </button>
      </div>
      <p class="field-hint">
        Right-click a picture on the desktop to use it. Backgrounds are always tiled.
      </p>

      <label class="field-row">
        Icon size
        <select
          class="chrome-select"
          value={props.panes.iconSize()}
          onChange={(e) => {
            // The value can only be one of the options, but narrow it rather than cast.
            if (isIconSize(e.currentTarget.value)) props.panes.setIconSize(e.currentTarget.value);
          }}
        >
          <For each={ICON_SIZE_OPTIONS}>
            {(option) => <option value={option.value}>{option.name}</option>}
          </For>
        </select>
      </label>

      <label class="field-row">
        Screensaver
        <select
          class="chrome-select"
          value={props.panes.screensaver()}
          onChange={(e) => props.panes.setScreensaver(e.currentTarget.value)}
        >
          <option value={NO_SCREENSAVER}>No Screensaver</option>
          <For each={SCREENSAVERS}>{(saver) => <option value={saver.id}>{saver.name}</option>}</For>
        </select>
        <button
          class="chrome-button"
          aria-disabled={props.panes.screensaver() === NO_SCREENSAVER}
          onClick={() =>
            props.panes.screensaver() !== NO_SCREENSAVER && props.panes.previewScreensaver()
          }
        >
          Preview
        </button>
      </label>
      <p class="field-hint">Starts on its own after a minute of nothing happening.</p>

      <footer class="pane-actions">
        <button class="chrome-button" onClick={restoreDefaults}>
          Restore defaults
        </button>
      </footer>
    </div>
  );
}
