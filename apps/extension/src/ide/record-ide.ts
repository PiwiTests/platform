// The IDE bundle, `record-ide.js`: the recorder for the pages of a browser the editor service launched. The host goes
// first, so the `chrome` the recorder's references are rewritten to exists before the recorder runs.
import './host.js';
import '../content/record-panel.js';
