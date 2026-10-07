// An operation belongs to one authorized tenant lifetime. Comparing IDs alone
// would revive an old operation after A → B → A; generations prevent that.
export function createTenantCompletionScope(scope, readCurrentScope) {
  const key = JSON.stringify(scope);
  let active = true;
  let generation = 0;
  return {
    activate() { active = true; },
    invalidate() { active = false; generation++; },
    capture() {
      const ticket = generation;
      return () => active && ticket === generation && JSON.stringify(readCurrentScope()) === key;
    },
  };
}
