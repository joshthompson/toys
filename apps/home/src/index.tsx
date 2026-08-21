/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './App';
import { ScreensaverPage } from './Screensaver';
import { routedScreensaver } from './screensavers';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// /screensaver/<id> is a saver on its own; anything else is the desktop.
const routed = routedScreensaver();

render(() => (routed ? <ScreensaverPage saver={routed} /> : <App />), root);
