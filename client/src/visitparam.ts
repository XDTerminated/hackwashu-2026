const params = new URLSearchParams(location.search);
/** Online, /?visit=<id> plays a friend's island instead of your own (set by the rocket). */
export const VISIT_ID = params.get("visit");
/** Flying home by rocket (/?land): straight onto your island, no title screen. */
export const LANDING_HOME = params.has("land");
