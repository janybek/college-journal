// Exit codes of the working server and its commands. A module of its own: supervisor.js and server.js must not import each other.
export const EXIT = { ok: 0, crash: 1, config: 2, portBusy: 3 };
