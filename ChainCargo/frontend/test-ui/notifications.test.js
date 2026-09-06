import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { ESCROW_ABI } from '../src/contracts/abi.js';
import { eventNotification, mergeNotificationQueue, notificationKey, notificationScope, refundNotification } from '../src/utils/notifications.js';
const agreement = { shipper: '0xshipper', carrier: '0xcarrier', title: 'Cargo A' };
const cases = {
  AgreementCreated: ['0xcarrier'], AgreementAccepted: ['0xshipper'], AgreementRejected: ['0xshipper'],
  MilestoneProofSubmitted: ['0xshipper'], EvidenceRevisionRequested: ['0xcarrier'], MilestoneConfirmed: ['0xcarrier'],
  DeadlineExtensionRequested: ['0xshipper'], DeadlineExtensionApproved: ['0xcarrier'], DeadlineExtensionRejected: ['0xcarrier'],
  DisputeOpened: ['0xcarrier', '0xarbitrator'], DisputeResolved: ['0xshipper', '0xcarrier'],
  DisputedAgreementCancelled: ['0xshipper', '0xcarrier'],
  DisputeResponseSubmitted: ['0xshipper', '0xarbitrator'],
  DisputeFollowUpRequested: ['0xcarrier'],
  DisputeContinued: ['0xshipper', '0xcarrier'], AgreementCompleted: ['0xshipper', '0xcarrier'], Refunded: ['0xshipper'],
};
const abi = new Interface(ESCROW_ABI);
for (const [name, recipients] of Object.entries(cases)) {
  test(`${name} routes only to its intended recipients and exists in the deployed ABI`, () => {
    assert.ok(abi.getEvent(name));
    for (const account of ['0xshipper', '0xcarrier', '0xarbitrator', '0xunrelated']) {
      const item = eventNotification({
        name,
        args: {
          agreementId: 2n,
          openedBy: '0xshipper',
          reason: 'Damaged cargo',
          respondedBy: '0xcarrier',
          responseDetails: 'Cargo was delivered intact',
          requestedFrom: '0xcarrier',
          question: 'Provide the signed delivery receipt',
          resolutionReason: 'The evidence proves delivery',
        },
      }, agreement, account.toUpperCase(), '0xarbitrator');
      assert.equal(Boolean(item), recipients.includes(account));
      if (item) { assert.equal(item.title, 'Cargo A'); assert.equal(item.agreementId, '2'); }
    }
  });
}
test('carrier-opened disputes exclude the opener and include shipper and arbitrator', () => {
  const event = { name: 'DisputeOpened', args: { agreementId: 2n, openedBy: '0xcarrier' } };
  assert.equal(eventNotification(event, agreement, '0xcarrier', '0xarbitrator'), null);
  assert.ok(eventNotification(event, agreement, '0xshipper', '0xarbitrator'));
  assert.ok(eventNotification(event, agreement, '0xarbitrator', '0xarbitrator'));
});
test('read identity normalizes casing and isolates chain, contract, wallet, transaction and log index', () => {
  const scope = notificationScope(1, '0xABC', '0xDEF');
  const log = { transactionHash: '0xAAA', index: 2 };
  const key = notificationKey(scope, log);
  assert.equal(key, notificationKey(notificationScope('0x1', '0xabc', '0xdef'), { transactionHash: '0xaaa', logIndex: 2 }));
  for (const other of [notificationScope(2, '0xABC', '0xDEF'), notificationScope(1, '0x123', '0xDEF'), notificationScope(1, '0xABC', '0x456')]) assert.notEqual(key, notificationKey(other, log));
  assert.notEqual(key, notificationKey(scope, { ...log, index: 3 }));
  assert.notEqual(key, notificationKey(scope, { ...log, transactionHash: '0xBBB' }));
});
test('polling deduplicates queue, close suppresses repeat popups, read removes pending, scope changes discard old wallet', () => {
  const item = { key: 'one', scope: 'wallet-a', read: false };
  const next = { key: 'two', scope: 'wallet-a', read: false };
  assert.deepEqual(mergeNotificationQueue([item], [item, item, next], 'wallet-a', new Set()), [item, next]);
  assert.deepEqual(mergeNotificationQueue([], [item, next], 'wallet-a', new Set(['one'])), [next]);
  assert.deepEqual(mergeNotificationQueue([item], [{ ...item, read: true }], 'wallet-a', new Set()), []);
  assert.deepEqual(mergeNotificationQueue([item], [item], 'wallet-b', new Set()), []);
});
test('refund availability follows contract pending-state and strict deadline conditions', () => {
  const active = { ...agreement, id: 2, status: 0n, nextMilestone: 0n };
  const milestone = { state: 0n, dueAt: 100n };
  const source = { transactionHash: '0xabc', index: 1 };
  const create = (a = active, m = milestone, now = 101) => refundNotification(a, m, now, source, 'scope');
  assert.ok(create());
  assert.equal(create(active, milestone, 100), null);
  for (const status of [1, 2, 3, 4, 5, 6]) assert.equal(create({ ...active, status }), null);
  for (const state of [1, 2]) assert.equal(create(active, { ...milestone, state }), null);
  assert.notEqual(create().key, create(active, { ...milestone, dueAt: 99 }).key);
});

// Exercise the same read store and queue/selection operations used by the provider and popup.
import { createNotificationReadStore, nextUnreadSelection, notificationPosition } from '../src/utils/notifications.js';
function inboxFixture() {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = createNotificationReadStore(() => storage);
  const items = ['a', 'b', 'c'].map((key) => ({ key, scope: 'scope', read: false }));
  const refresh = () => items.map((item) => ({ ...item, read: store.isRead(item.key) }));
  return { values, storage, store, items, refresh };
}
test('Previous and Next select updates without changing read status or history', () => {
  const { items, values, refresh } = inboxFixture();
  for (const index of [0, 1, 2, 1, 0]) {
    assert.equal(notificationPosition(items, { key: items[index].key, index }), index);
  }
  assert.equal(values.size, 0);
  assert.deepEqual(refresh(), items);
});
test('marking current read advances to the next unread and retains read history', () => {
  for (const index of [0, 1, 2]) {
    const { items, store, refresh } = inboxFixture();
    const selection = nextUnreadSelection(items, index);
    store.markRead([items[index].key]);
    const history = refresh();
    const pending = mergeNotificationQueue(items, history, 'scope', new Set());
    assert.equal(history.length, 3);
    assert.equal(history.filter((item) => !item.read).length, 2);
    assert.equal(pending[notificationPosition(pending, selection)].key, items[(index + 1) % 3].key);
    assert.equal(history[index].read, true);
  }
});
test('marking the final unread removes the popup and excludes it after reload', () => {
  const { items, storage, store, refresh } = inboxFixture();
  store.markRead(items.map((item) => item.key));
  assert.deepEqual(mergeNotificationQueue(items, refresh(), 'scope', new Set()), []);
  const reloaded = createNotificationReadStore(() => storage);
  assert.ok(items.every((item) => reloaded.isRead(item.key)));
  assert.equal(notificationPosition([], null), -1);
});
test('Mark All as Read includes dismissed updates and retains every history entry', () => {
  const { items, store, refresh } = inboxFixture();
  const presented = new Set(['a', 'b']);
  assert.equal(mergeNotificationQueue([], items, 'scope', presented).length, 1);
  store.markRead(refresh().filter((item) => !item.read).map((item) => item.key));
  assert.equal(refresh().length, 3);
  assert.equal(refresh().filter((item) => !item.read).length, 0);
  assert.deepEqual(mergeNotificationQueue([], refresh(), 'scope', presented), []);
});
test('dismissal suppresses polling popups without reads, and a fresh session restores unread updates', () => {
  const { items, values, refresh } = inboxFixture();
  const dismissed = new Set(items.map((item) => item.key));
  assert.deepEqual(mergeNotificationQueue([], refresh(), 'scope', dismissed), []);
  assert.equal(values.size, 0);
  assert.deepEqual(mergeNotificationQueue([], refresh(), 'scope', new Set()), items);
});
test('tabs share persisted reads, isolate scopes, and reconcile read removals without stale memory', () => {
  const { storage, values, store } = inboxFixture();
  const otherTab = createNotificationReadStore(() => storage);
  const key = notificationKey(notificationScope(1, 'contract', 'wallet'), { transactionHash: 'tx', index: 0 });
  store.markRead([key]);
  assert.equal(otherTab.isRead(key), true);
  for (const scope of [notificationScope(2, 'contract', 'wallet'), notificationScope(1, 'other', 'wallet'), notificationScope(1, 'contract', 'other')]) {
    assert.equal(otherTab.isRead(notificationKey(scope, { transactionHash: 'tx', index: 0 })), false);
  }
  values.delete(key);
  assert.equal(store.isRead(key), false);
  assert.equal(otherTab.isRead(key), false);
});
test('reading in another tab preserves current selection when an earlier notification disappears', () => {
  const { items, store, refresh } = inboxFixture();
  const selection = { key: 'b', index: 1 };
  store.markRead(['a']);
  const pending = mergeNotificationQueue(items, refresh(), 'scope', new Set());
  assert.equal(pending[notificationPosition(pending, selection)].key, 'b');
});
test('unavailable storage retains reads for the current session', () => {
  const store = createNotificationReadStore(() => { throw new Error('Storage blocked'); });
  store.markRead(['a', 'b']);
  assert.equal(store.isRead('a'), true);
  assert.equal(store.isRead('b'), true);
  assert.equal(store.isRead('c'), false);
});
