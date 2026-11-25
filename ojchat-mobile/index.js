// Re-export from index.ts so Metro can find index.js as entry point
import { AppRegistry } from 'react-native';

import App from './src/app/App';

AppRegistry.registerComponent('OjchatApp', () => App);
