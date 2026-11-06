import React from 'react';
import { render } from 'ink';
import { loadConfig, resolveProjectsRoot } from '../../config/loader.js';
import { getDb } from '../../state/db.js';
import { FleetStore } from '../../state/queries.js';
import { DaemonManager } from '../../core/daemon-manager.js';
import { App } from '../../tui/app.js';

export async function runFleetTui(projectsDir?: string): Promise<void> {
  const root = resolveProjectsRoot(projectsDir);
  const config = loadConfig(root);
  const db = getDb(root);
  const store = new FleetStore(db);
  const daemonManager = new DaemonManager({ config, store });

  const { waitUntilExit } = render(
    React.createElement(App, {
      store,
      config,
      daemonManager,
    })
  );

  await waitUntilExit();
}
