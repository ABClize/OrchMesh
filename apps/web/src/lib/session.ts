// Same persistence model as FastAPI's official full-stack template.
const key = "access_token";
export const sessionChanged = "orchmesh:session-changed";
export const getToken = () => localStorage.getItem(key);
export function setToken(token: string | null) {
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
  window.dispatchEvent(new Event(sessionChanged));
}
export function expireToken(token: string | null) {
  // A delayed failure from an old request must not log out a newer login.
  if (token && getToken() === token) setToken(null);
}
export function watchSession(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) callback();
  };
  window.addEventListener(sessionChanged, callback);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(sessionChanged, callback);
    window.removeEventListener("storage", storage);
  };
}
