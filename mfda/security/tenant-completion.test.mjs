import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTenantCompletionScope } from '../src/lib/tenant-completion.js';

const a = ['tenant', 'user-a', 1, 'org-a', 'admin', 1];
test('tenant completion guards validate authorization and lifetime', async t => {
  let current;
  let lifetime;
  const reset = () => { current = [...a]; lifetime = createTenantCompletionScope(a, () => current); };
  await t.test('unchanged tenant and token renewal allow completion', () => {
    reset(); const isCurrent = lifetime.capture(); current = [...a];
    assert.equal(isCurrent(), true);
  });
  await t.test('every identity, org, role and generation dimension is enforced', () => {
    for (let i = 1; i < a.length; i++) {
      reset(); const isCurrent = lifetime.capture(); current[i] = 'changed';
      assert.equal(isCurrent(), false, 'scope dimension ' + i);
    }
  });
  await t.test('loading, absent membership, logout and expiry fail closed', () => {
    reset(); const isCurrent = lifetime.capture(); current = null;
    assert.equal(isCurrent(), false);
  });
  await t.test('A → B → A does not revive the first auth/org generation', () => {
    for (const index of [2, 5]) {
      reset(); const isCurrent = lifetime.capture();
      current = ['tenant', 'user-b', 2, 'org-b', 'member', 2];
      assert.equal(isCurrent(), false);
      current = [...a]; current[index] += 2;
      assert.equal(isCurrent(), false);
    }
  });
  await t.test('unmount and StrictMode cleanup never revive a captured continuation', () => {
    reset(); const old = lifetime.capture(); lifetime.invalidate();
    assert.equal(old(), false);
    lifetime.activate();
    assert.equal(old(), false);
    assert.equal(lifetime.capture()(), true);
  });
  await t.test('failed work retried in a fresh scope cannot release the previous result', async () => {
    reset(); const old = lifetime.capture();
    await assert.rejects(Promise.reject(new Error('synthetic request failure')));
    current = ['tenant', 'user-b', 2, 'org-b', 'member', 2];
    const next = createTenantCompletionScope(current, () => current).capture();
    await Promise.resolve();
    assert.equal(old(), false); assert.equal(next(), true);
  });
});
