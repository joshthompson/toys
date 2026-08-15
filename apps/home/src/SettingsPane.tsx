import { For } from 'solid-js';
import { DEFAULT_DESKTOP, type Panes } from './shell';

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

      <footer class="pane-actions">
        <button
          class="chrome-button"
          onClick={() => props.panes.setColour(DEFAULT_DESKTOP)}
        >
          Restore default
        </button>
      </footer>
    </div>
  );
}
