// Request IDs need UUID syntax for server idempotency, but web pages served over HTTP do not expose
// crypto.randomUUID(). These IDs are not authentication secrets.
export const newId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (part) => {
    const value = Math.floor(Math.random() * 16);
    return (part === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
