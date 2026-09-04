import { binName, type Panes } from '../os/shell';

export function AboutPane(props: { panes: Panes }) {
  const depth = () => props.panes.binLevels().length - 1;

  return (
    <div class="pane about-pane">
      <div class="about-head">
        <span class="about-glyph" aria-hidden="true">
          ★
        </span>
        <div>
          <h1>Josh OS '95</h1>
          <p>A desktop full of small web toys.</p>
        </div>
      </div>

      <dl class="about-specs">
        <dt>Toys installed</dt>
        <dd>{props.panes.toyCount()}</dd>
        <dt>Deepest bin</dt>
        <dd>{binName(depth())}</dd>
      </dl>

      <p class="about-foot">Built by Josh Thompson.</p>
    </div>
  );
}
