import { PiwiDashboardReporter } from './reporter.js';
import { wrapConfig } from './config-wrapper.js';
import { createGlobalSetup } from './helpers.js';

const _default = Object.assign(PiwiDashboardReporter, { wrapConfig, createGlobalSetup });
export = _default;
