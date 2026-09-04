/* @refresh reload */
/**
 * Josh OS, from the top.
 *
 * The source is in three folders and the rule is short: `os/` is the computer —
 * the desktop, the windows, the icons, the bin, what it remembers between visits.
 * `apps/` is one file per thing that fills a window, whether it has an icon of its
 * own or only turns up when the computer has something to say. `shared/` is what
 * neither of them owns.
 *
 * Nothing in `os/` reaches into an app for anything but its component, and no app
 * reaches into another — the two `maths*` modules are the calculator's own, not a
 * shared library. An app that needs the desktop is handed `Panes`, which is the
 * whole of what the computer will do on an app's behalf.
 */
import { render } from 'solid-js/web';
import { App } from './os/App';
import { ScreensaverPage } from './os/Screensaver';
import { routedScreensaver } from './os/screensavers';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// /screensaver/<id> is a saver on its own; anything else is the desktop.
const routed = routedScreensaver();

render(() => (routed ? <ScreensaverPage saver={routed} /> : <App />), root);
