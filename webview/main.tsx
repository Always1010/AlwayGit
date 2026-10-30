import React from 'react';
import { createRoot } from 'react-dom/client';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';
import './appearance.css';
import { CommitTree } from './CommitTree';
import { App } from './App';
createRoot(document.getElementById('root')!).render(
  window.__ALWAYGIT_COMMIT_TREE__ ? (
    <CommitTree target={window.__ALWAYGIT_COMMIT_TREE__.commitTree} />
  ) : (
    <App />
  ),
);
