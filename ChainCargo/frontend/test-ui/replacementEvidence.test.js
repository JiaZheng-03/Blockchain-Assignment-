import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { ethers } from 'ethers';
import { isValidDisputeText } from '../src/utils/disputeResolution.js';
import { friendlyContractError } from '../src/utils/contractErrors.js';
import { canSubmitEvidenceForWorkflow } from '../src/utils/evidenceStorage.js';
import { eventNotification, mergeNotificationQueue } from '../src/utils/notifications.js';

let server;
let Action;
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Action = (await server.ssrLoadModule('/src/components/ReplacementEvidenceAction.jsx')).default;
});
after(async () => { await server?.close(); });
const props = {
  id: '7', isArbitrator: true, status: 3, responseDeadline: 172900, nowSeconds: 172899,
  milestone: { proofHash: ethers.id('evidence'), submittedAt: 50, proofURI: 'supabase://old' },
  busyAction: '', reason: '  Please upload the signed receipt  ', confirmationOpen: false,
  setConfirmationOpen: () => {}, transact: () => {},
};
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const buttons = (tree) => nodes(tree).filter((node) => node.type === 'button');

test('corrects evidence review and Arbitrator timeout messages', async () => {
  const source = await readFile(new URL('../src/pages/AgreementDetail.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes('The 24-hour review period has ended. The Carrier may now request Arbitrator review.'));
  assert.ok(!source.includes('The 1-hour review period'));
  assert.match(friendlyContractError({ errorName: 'ArbitratorResponsePeriodClosed' }), /^The 48-hour Arbitrator response period has expired\./);
});

test('replacement action requires Arbitrator, disputed status, evidence, idle transaction and unexpired deadline', () => {
  assert.equal(buttons(Action(props)).length, 1);
  for (const override of [
    { isArbitrator: false }, { status: 0 }, { status: 4 }, { busyAction: 'other' },
    { milestone: undefined }, { milestone: { ...props.milestone, proofHash: ethers.ZeroHash } },
    { milestone: { ...props.milestone, submittedAt: 0 } },
    { responseDeadline: 0 }, { nowSeconds: props.responseDeadline }, { nowSeconds: props.responseDeadline + 1 },
  ]) assert.equal(Action({ ...props, ...override }), null);
});

test('resolution reason enforces trimmed nonempty text and 1000 UTF-8 bytes on both buttons', () => {
  for (const reason of ['', '   ', 'a'.repeat(1001), '界'.repeat(334), '😀'.repeat(251)]) {
    assert.equal(isValidDisputeText(reason), false);
    const tree = Action({ ...props, reason, confirmationOpen: true });
    assert.equal(buttons(tree)[0].props.disabled, true);
    assert.equal(buttons(tree)[2].props.disabled, true);
  }
  for (const reason of [' a ', 'a'.repeat(1000), '😀'.repeat(250)]) {
    assert.equal(isValidDisputeText(reason), true);
    assert.equal(buttons(Action({ ...props, reason }))[0].props.disabled, false);
  }
});

test('requires dialog confirmation, allows Go Back, and passes exact replacement arguments through transact', async () => {
  let open = false;
  const calls = [];
  const options = { ...props, setConfirmationOpen: (value) => { open = value; },
    transact: async (action, callback) => {
      calls.push(action);
      await callback({ resolveDisputeAndContinue: async (...args) => calls.push(args) });
    },
  };
  buttons(Action(options))[0].props.onClick();
  assert.equal(open, true);
  assert.deepEqual(calls, []);
  let dialog = Action({ ...options, confirmationOpen: open });
  assert.ok(nodes(dialog).some((node) => node.props?.role === 'alertdialog'));
  buttons(dialog)[1].props.onClick();
  assert.equal(open, false);
  assert.deepEqual(calls, []);
  dialog = Action({ ...options, confirmationOpen: true });
  await buttons(dialog)[2].props.onClick();
  assert.deepEqual(calls, ['continue-replacement', ['7', false, 'Please upload the signed receipt']]);
  assert.equal(open, false);
  await buttons(Action({ ...options, reason: ' ', confirmationOpen: true }))[2].props.onClick();
  assert.equal(calls.length, 2);
});

test('refreshed Active replacement workflow enables upload and sends one Carrier notification with reason', async () => {
  // Confirmed state returned by the contract after replacement resolution.
  const agreement = { status: 0, shipper: '0xshipper', carrier: '0xcarrier', title: 'Cargo' };
  const milestone = { state: 0, proofHash: ethers.ZeroHash, proofURI: '', submittedAt: 0 };
  assert.equal(Action({ ...props, status: agreement.status, milestone }), null);
  assert.equal(canSubmitEvidenceForWorkflow({ agreementStatus: agreement.status, milestoneIndex: 0 }), true);
  const args = { agreementId: 7, shipper: '0xarbitrator', evidenceApproved: false, resolutionReason: props.reason.trim() };
  assert.equal(eventNotification({ name: 'EvidenceRevisionRequested', args }, agreement, '0xcarrier', '0xarbitrator'), null);
  const item = eventNotification({ name: 'DisputeContinued', args }, agreement, '0xcarrier', '0xarbitrator');
  assert.match(item.message, /requested replacement evidence/);
  assert.ok(item.message.includes(args.resolutionReason));
  const notification = { ...item, key: 'tx:1', scope: 'carrier' };
  assert.deepEqual(mergeNotificationQueue([notification], [notification, notification], 'carrier', new Set()), [notification]);
  const source = await readFile(new URL('../src/pages/AgreementDetail.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes('[0, 1, 3, 4].includes(Number(rawAgreement.status))'));
  assert.ok(source.includes('agreement.status !== 3 && disputeInfo?.resolutionReason'));
});
