// Local storage key whose presence says this browser holds a signed-in session, so the next load
// exchanges the refresh cookie. Its value is the signed-in user's account id, so a tab can tell
// whether the session the browser holds is still its own user's. It's removed when a session ends.
// A '1' left from before the value held an id still counts as a session, but names no user
export const SESSION_KEY = 'lumina:has_session';
