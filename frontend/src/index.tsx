import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme/tokens.css';
import './index.css';
import App from './App';
import { applyTheme, currentTheme } from './lib/theme';
// Display theme (docs/SPEC_display_theme.md): the browser remembers the last choice so the login screen and
// the first paint already wear it; the account's saved choice takes over once /auth/me answers.
applyTheme(currentTheme());
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
