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
  DisputeContinued: ['0xshipper', '0xcarrier'], AgreementCompleted: ['0xshipper', '0xcarrier'], Refunded: ['0xshipper'],
};
const abi = new Interface(ESCROW_ABI);
for (const [name, recipients] of Object.entries(cases)) {
  test(`${name} routes only to its intended recipients and exists in the deployed ABI`, () => {
    assert.ok(abi.getEvent(name));
    for (const account of ['0xshipper', '0xcarrier', '0xarbitrator', '0xunrelated']) {
      const item = eventNotification({ name, args: { agreementId: 2n, openedBy: '0xshipper', reason: 'Damaged cargo' } }, agreement, account.toUpperCase(), '0xarbitrator');
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
