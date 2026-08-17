import {Config} from '@remotion/cli/config';

const configuredBrowserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE?.trim();

if (configuredBrowserExecutable) {
  Config.setBrowserExecutable(configuredBrowserExecutable);
  Config.setChromeMode('chrome-for-testing');
}
