/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS OVERWRITTEN FOR SELF-HOSTED MOCK SUPPORT.
 */

const makePathProxy = (path = []) => {
  return new Proxy(() => {}, {
    get(target, prop) {
      if (prop === "__path" || prop === "_path") {
        return path.join(":");
      }
      if (prop === "then" || prop === "catch" || typeof prop === "symbol") return undefined;
      return makePathProxy([...path, prop]);
    }
  });
};

export const api = makePathProxy([]);
export const internal = makePathProxy([]);
