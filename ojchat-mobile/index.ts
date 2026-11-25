// Must be the very first import: installs global `crypto.getRandomValues` /
// `crypto.randomUUID`, which the crypto layer and @stablelib rely on.
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';

import App from './src/app/App';

AppRegistry.registerComponent('TempRNApp73', () => App);
