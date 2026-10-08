// Process-level flags shared between server, health checks and shutdown logic.
export interface AppState {
  shuttingDown: boolean;
}

export const state: AppState = { shuttingDown: false };
