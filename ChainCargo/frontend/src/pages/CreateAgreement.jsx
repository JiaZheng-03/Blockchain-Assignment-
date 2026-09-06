import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import {
  FIXED_MILESTONES,
  MIN_SCHEDULE_BUFFER_MS,
  generateAgreementName,
  syncFinalMilestoneDueAt,
  toDateTimeLocalValue,
  validateAgreementBasics,
  validateAgreementDraft,
} from '../utils/agreementValidation';
import {
  getCarrierReputationTier,
  readCarrierReputation,
} from '../utils/carrierReputation';
import { findAgreementCreatedId } from '../utils/contractReceipts';

const DETAIL_ERROR_TARGETS = new Set(['title', 'carrier', 'totalAmount', 'deadline', 'notes']);

function getErrorTarget(message) {
  if (!message) return null;
  const normalized = message.toLowerCase();
  const milestoneMatch = normalized.match(/milestone\s+(\d+)/);
  if (milestoneMatch) return `milestone-${Number(milestoneMatch[1]) - 1}`;
  if (normalized.includes('agreement name') || normalized.includes('same name')) return 'title';
  if (normalized.includes('carrier') || normalized.includes('participant')) return 'carrier';
  if (normalized.includes('total amount') || normalized.includes('escrow amount') || normalized.includes('funding')) return 'totalAmount';
  if (normalized.includes('final deadline') || normalized.includes('delivery deadline')) return 'deadline';
  if (normalized.includes('agreement notes')) return 'notes';
  if (normalized.includes('payout') || normalized.includes('percentage')) return 'percentage';
  return null;
}

function CreateAgreement() {
  const transactionInFlight = useRef(false);
  const navigate = useNavigate();
  const {
    account,
    isConnected,
    isConnecting,
    connectWallet,
    switchWallet,
  } = useWallet();
  const {
    address,
    getReadContract,
    getWriteContract,
    isConfigured,
    refreshKey,
    waitForTransaction,
  } = useContract();
  const { isShipper, isRegistered, loading: profileLoading, profile } = useProfile();
  const titleAccount = useRef(account);
  const [form, setForm] = useState({
    title: generateAgreementName(account),
    carrier: '',
    totalAmount: '',
    deadline: '',
    notes: '',
  });
  const [milestones, setMilestones] = useState(
    FIXED_MILESTONES.map((milestone) => ({ ...milestone, dueAt: '' })),
  );
  const [finalMilestoneFollowsDeadline, setFinalMilestoneFollowsDeadline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [registeredCarriers, setRegisteredCarriers] = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [carrierDirectoryError, setCarrierDirectoryError] = useState('');
  const [carrierSearchOpen, setCarrierSearchOpen] = useState(false);
  const [carrierTouched, setCarrierTouched] = useState(false);
  const [minimumDateTime, setMinimumDateTime] = useState('');
  const [minimumMilestoneDateTime, setMinimumMilestoneDateTime] = useState('');
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (!account || account.toLowerCase() === titleAccount.current?.toLowerCase()) return;
    titleAccount.current = account;
    setForm((current) => ({ ...current, title: generateAgreementName(account) }));
  }, [account]);

  useEffect(() => {
    const updateMinimum = () => {
      setMinimumDateTime(
        toDateTimeLocalValue(new Date(Date.now() + MIN_SCHEDULE_BUFFER_MS + 60_000)),
      );
      setMinimumMilestoneDateTime(
        toDateTimeLocalValue(new Date(Date.now() + 60_000)),
      );
    };
    updateMinimum();
    const timer = window.setInterval(updateMinimum, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !isConfigured || !isShipper) {
      setRegisteredCarriers([]);
      return undefined;
    }

    async function loadCarriers() {
      try {
        setCarriersLoading(true);
        setCarrierDirectoryError('');
        const contract = await getReadContract();
        const addresses = await contract.getUsersByRole(2);
        const entries = await Promise.all(
          addresses.map(async (address) => {
            const [carrierProfile, reputation] = await Promise.all([
              contract.getProfile(address),
              readCarrierReputation(contract, address),
            ]);
            return {
              address,
              name: carrierProfile.name,
              reputation,
              reputationTier: reputation === null
                ? 'Redeploy required'
                : getCarrierReputationTier(reputation),
            };
          }),
        );
        if (!cancelled) {
          setRegisteredCarriers(entries);
        }
      } catch (loadError) {
        if (!cancelled) setCarrierDirectoryError(friendlyContractError(loadError));
      } finally {
        if (!cancelled) setCarriersLoading(false);
      }
    }

    loadCarriers();
    return () => {
      cancelled = true;
    };
  }, [getReadContract, isConfigured, isConnected, isShipper, refreshKey]);

  const updateForm = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (name === 'carrier') setError('');
    if (name === 'deadline') {
      const deadlineMs = value ? new Date(value).getTime() : 0;
      const conflictsWithDeadline = (milestone, index) => {
        if (!milestone.dueAt || !deadlineMs || (finalMilestoneFollowsDeadline && index === 1)) return false;
        const dueMs = new Date(milestone.dueAt).getTime();
        return dueMs > deadlineMs || (finalMilestoneFollowsDeadline && index === 0 && dueMs >= deadlineMs);
      };
      const invalidCount = milestones.filter(conflictsWithDeadline).length;
      setMilestones((current) => syncFinalMilestoneDueAt(
        current.map((milestone, index) => (
          conflictsWithDeadline(milestone, index) ? { ...milestone, dueAt: '' } : milestone
        )),
        value,
        finalMilestoneFollowsDeadline,
      ));
      if (invalidCount) {
        setError(
          `${invalidCount} milestone date${invalidCount === 1 ? ' was' : 's were'} cleared because it exceeded the new final deadline.`,
        );
      }
    }
  };

  const toggleFinalMilestoneDeadline = (event) => {
    const followsFinalDeadline = event.target.checked;
    const pickupDueMs = milestones[0].dueAt ? new Date(milestones[0].dueAt).getTime() : 0;
    const deadlineMs = form.deadline ? new Date(form.deadline).getTime() : 0;
    if (followsFinalDeadline && pickupDueMs && deadlineMs && pickupDueMs >= deadlineMs) {
      setError('Milestone 1 must be earlier than the Final Delivery Deadline.');
      return;
    }
    setFinalMilestoneFollowsDeadline(followsFinalDeadline);
    setMilestones((current) => syncFinalMilestoneDueAt(
      current,
      form.deadline,
      followsFinalDeadline,
    ));
    setError('');
  };

  const updateMilestone = (index, field, value) => {
    if (field === 'dueAt' && value) {
      const dueMs = new Date(value).getTime();
      const previousDueAt = index > 0 ? milestones[index - 1].dueAt : '';
      const previousDueMs = previousDueAt ? new Date(previousDueAt).getTime() : 0;
      const deadlineMs = form.deadline ? new Date(form.deadline).getTime() : 0;

      if (previousDueMs && dueMs <= previousDueMs) {
        setError(`Milestone ${index + 1} must be later than milestone ${index}.`);
        return;
      }
      if (deadlineMs && dueMs > deadlineMs) {
        setError(`Milestone ${index + 1} cannot be later than the final deadline.`);
        return;
      }
      if (index === 0 && finalMilestoneFollowsDeadline && deadlineMs && dueMs >= deadlineMs) {
        setError('Milestone 1 must be earlier than the Final Delivery Deadline.');
        return;
      }
      setError('');
    }

    setMilestones((current) =>
      current.map((milestone, itemIndex) => {
        if (itemIndex === index) return { ...milestone, [field]: value };
        if (
          field === 'dueAt' &&
          value &&
          itemIndex > index &&
          milestone.dueAt &&
          new Date(milestone.dueAt).getTime() <= new Date(value).getTime()
        ) {
          return { ...milestone, dueAt: '' };
        }
        return milestone;
      }),
    );
  };

  const updatePercentage = (index, value) => {
    const percentage = Math.min(99, Math.max(1, Number.parseInt(value, 10) || 1));
    setMilestones((current) => current.map((milestone, itemIndex) => ({
      ...milestone,
      percentage: itemIndex === index ? String(percentage) : String(100 - percentage),
    })));
    setError('');
  };

  const getMilestoneMinimum = (index) => {
    if (index === 0 || !milestones[index - 1].dueAt) return minimumMilestoneDateTime;
    const previousDueMs = new Date(milestones[index - 1].dueAt).getTime();
    return toDateTimeLocalValue(new Date(previousDueMs + 60_000));
  };

  const moveToStep = (nextStep) => {
    setError('');
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const continueToMilestones = async () => {
    try {
      setBusy(true);
      setError('');
      validateAgreementBasics({ form, account });
      const contract = await getReadContract();
      const [carrierProfile, nameAvailable] = await Promise.all([
        contract.getProfile(form.carrier.trim()),
        contract.isAgreementNameAvailable(account, form.title),
      ]);
      if (Number(carrierProfile.role) !== 2) {
        throw new Error('The carrier wallet must register as a Carrier before you create the agreement.');
      }
      if (!nameAvailable) {
        throw new Error('You already created an agreement with this name. Choose a different agreement name.');
      }
      moveToStep(2);
    } catch (validationError) {
      setError(friendlyContractError(validationError));
    } finally {
      setBusy(false);
    }
  };

  const continueToReview = async () => {
    try {
      setBusy(true);
      setError('');
      validateAgreementDraft({ form, milestones, account });
      const contract = await getReadContract();
      const carrierProfile = await contract.getProfile(form.carrier);
      if (Number(carrierProfile.role) !== 2) {
        throw new Error('The carrier wallet must register as a Carrier before you create the agreement.');
      }
      moveToStep(3);
    } catch (validationError) {
      const message = friendlyContractError(validationError);
      setError(message);
      if (DETAIL_ERROR_TARGETS.has(getErrorTarget(message))) setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (step !== 3) return;
    if (!isConnected) {
      await connectWallet();
      return;
    }
    if (!isShipper) {
      setError('Only a wallet registered as a shipper can create agreements.');
      return;
    }
    if (transactionInFlight.current) return;
    transactionInFlight.current = true;

    try {
      setBusy(true);
      const { totalWei, payouts, dueDates, deadline } = validateAgreementDraft({
        form,
        milestones,
        account,
      });
      const readContract = await getReadContract();
      const [carrierProfile, nameAvailable] = await Promise.all([
        readContract.getProfile(form.carrier),
        readContract.isAgreementNameAvailable(account, form.title),
      ]);
      if (Number(carrierProfile.role) !== 2) {
        throw new Error('The carrier wallet must register as a Carrier before you create the agreement.');
      }
      if (!nameAvailable) {
        throw new Error('You already created an agreement with this name. Choose a different agreement name.');
      }
      const contract = await getWriteContract();
      const transaction = await contract.createAgreement(
        form.title.trim(),
        form.carrier,
        deadline,
        form.notes,
        milestones.map((milestone) => milestone.name),
        milestones.map((milestone) => milestone.details),
        payouts,
        dueDates,
        { value: totalWei },
      );
      const receipt = await waitForTransaction(transaction);
      const agreementId = findAgreementCreatedId(
        receipt,
        contract.interface,
        address,
      );
      if (agreementId === null) {
        navigate('/history', {
          state: {
            historyNotice:
              'The agreement transaction succeeded, but its ID could not be read from the receipt. Locate the new agreement in this history list.',
          },
        });
        return;
      }
      navigate(`/agreement/${agreementId.toString()}`);
    } catch (submitError) {
      const message = friendlyContractError(submitError);
      const target = getErrorTarget(message);
      setError(message);
      if (DETAIL_ERROR_TARGETS.has(target)) setStep(1);
      else if (target?.startsWith('milestone-') || target === 'percentage') setStep(2);
    } finally {
      transactionInFlight.current = false;
      setBusy(false);
    }
  };

  if (isConnected && !profileLoading && !isRegistered) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Registration required</span>
        <h2>Register this wallet before creating an agreement</h2>
        <p>Only a registered Shipper can create and fund logistics agreements.</p>
        <Link className="btn btn-primary" to="/register?role=shipper">Register as Shipper</Link>
      </div>
    );
  }

  if (isConnected && !profileLoading && !isShipper) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Current role: {profile?.roleLabel}</span>
        <h2>Only Shippers create agreements</h2>
        <p>Carriers are assigned by a Shipper. They submit milestone evidence and receive payouts after Shipper confirmation.</p>
        <button className="btn btn-primary" onClick={switchWallet} disabled={isConnecting}>
          {isConnecting ? 'Open MetaMask…' : 'Switch to your Shipper wallet'}
        </button>
      </div>
    );
  }

  const selectedCarrier = registeredCarriers.find(
    (carrier) => carrier.address.toLowerCase() === form.carrier.trim().toLowerCase(),
  );
  const carrierQuery = form.carrier.trim().toLowerCase();
  const matchingCarriers = carrierQuery
    ? registeredCarriers.filter((carrier) => (
      carrier.name.toLowerCase().includes(carrierQuery)
      || carrier.address.toLowerCase().includes(carrierQuery)
    )).slice(0, 8)
    : [];
  const carrierInputMessage = !form.carrier.trim()
    ? 'Type a Carrier name or wallet address to search.'
    : selectedCarrier
      ? `Registered Carrier: ${selectedCarrier.name}`
      : matchingCarriers.length
        ? 'Choose the matching registered Carrier below.'
        : 'No registered Carrier matches this input.';
  const errorTarget = getErrorTarget(error);

  return (
    <div className="form-card agreement-wizard">
      <span className="eyebrow">Shipper workflow</span>
      <h2>Create New Agreement</h2>
      <p>Define the shipment, choose its milestone payment split, then review everything before funding escrow.</p>

      <div className="wizard-steps" aria-label="Agreement creation progress">
        {['Agreement Details', 'Milestones', 'Review & Fund'].map((label, index) => {
          const number = index + 1;
          return (
            <button
              className={`${step === number ? 'active' : ''} ${step > number ? 'complete' : ''}`}
              disabled={number > step}
              key={label}
              onClick={() => number < step && moveToStep(number)}
              type="button"
            >
              <span>{step > number ? '✓' : number}</span>
              {label}
            </button>
          );
        })}
      </div>

      {!isConfigured && <div className="notice error">Deploy the contract before creating agreements.</div>}
      <form className="form-grid" onSubmit={submit}>
        {step === 1 && (
          <section className="wizard-section">
            <div>
              <h3>Agreement Details</h3>
              <p>Enter the parties, total payload/escrow value, and final shipment deadline.</p>
            </div>
            <label>
              Agreement Name
              <input aria-invalid={errorTarget === 'title'} name="title" value={form.title} readOnly />
              <small>This unique name is generated automatically from the creation time and Shipper wallet.</small>
              {errorTarget === 'title' && <small className="field-error">{error}</small>}
            </label>
            <div className="carrier-field">
              <label htmlFor="carrier-search-input">Registered Carrier</label>
              <div
                className="carrier-search"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setCarrierSearchOpen(false);
                    setCarrierTouched(true);
                  }
                }}
              >
                <input
                  aria-autocomplete="list"
                  aria-controls="carrier-suggestions"
                  aria-expanded={carrierSearchOpen && Boolean(carrierQuery)}
                  aria-invalid={errorTarget === 'carrier' || (carrierTouched && !selectedCarrier)}
                  autoComplete="off"
                  disabled={carriersLoading || !registeredCarriers.length}
                  id="carrier-search-input"
                  name="carrier"
                  onChange={(event) => {
                    updateForm(event);
                    setCarrierSearchOpen(true);
                    setCarrierTouched(false);
                  }}
                  onFocus={() => setCarrierSearchOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setCarrierSearchOpen(false);
                  }}
                  placeholder={carriersLoading ? 'Loading registered Carriers…' : 'Search by Carrier name or wallet address'}
                  required
                  role="combobox"
                  spellCheck="false"
                  value={form.carrier}
                />
                {carrierSearchOpen && carrierQuery && (
                  <div className="carrier-suggestions" id="carrier-suggestions" role="listbox" aria-label="Registered Carrier suggestions">
                    {matchingCarriers.length ? matchingCarriers.map((carrier) => (
                      <button
                        aria-selected={selectedCarrier?.address === carrier.address}
                        key={carrier.address}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setForm((current) => ({ ...current, carrier: carrier.address }));
                          setError('');
                          setCarrierSearchOpen(false);
                          setCarrierTouched(true);
                        }}
                        role="option"
                        type="button"
                      >
                        <span><strong>{carrier.name}</strong><code>{carrier.address}</code></span>
                        <small>{carrier.reputation === null ? 'Score unavailable' : `${carrier.reputation.toString()} pts · ${carrier.reputationTier}`}</small>
                      </button>
                    )) : <p className="carrier-search-empty">No registered Carrier found.</p>}
                  </div>
                )}
              </div>
              <small className={carrierTouched && !selectedCarrier ? 'field-error' : ''}>
                {carrierInputMessage} {registeredCarriers.length} registered Carrier{registeredCarriers.length === 1 ? '' : 's'} available.
              </small>
              {errorTarget === 'carrier' && <small className="field-error">{error}</small>}
            </div>
            {selectedCarrier && (
              <div className="carrier-reputation-preview">
                <span className="reputation-mark">★</span>
                <span>
                  <small>On-chain carrier reputation</small>
                  <strong>
                    {selectedCarrier.reputation === null
                      ? 'Redeploy the updated contract to enable points'
                      : `${selectedCarrier.reputation.toString()} points · ${selectedCarrier.reputationTier}`}
                  </strong>
                </span>
                <small>Earned only when Shippers confirm completed milestones.</small>
              </div>
            )}
            {carrierDirectoryError && <div className="notice error">{carrierDirectoryError}</div>}
            {!carriersLoading && !registeredCarriers.length && !carrierDirectoryError && (
              <div className="notice">
                No Carrier is registered yet. Authorize a different MetaMask account and register
                it as Carrier before continuing.
              </div>
            )}
            <label>
              Total Payload / Escrow Value (ETH)
              <input aria-invalid={errorTarget === 'totalAmount'} name="totalAmount" value={form.totalAmount} onChange={updateForm} required min="0.000001" step="any" type="number" placeholder="10" />
              <small>The full payable value is locked in the smart contract and divided across milestones.</small>
              {errorTarget === 'totalAmount' && <small className="field-error">{error}</small>}
            </label>
            <label>
              Final Delivery Deadline
              <input aria-invalid={errorTarget === 'deadline'} name="deadline" value={form.deadline} onChange={updateForm} required min={minimumDateTime} type="datetime-local" />
              <small>Must be at least 1 hour from now.</small>
              {errorTarget === 'deadline' && <small className="field-error">{error}</small>}
            </label>
            <label>
              Agreement Notes
              <textarea aria-invalid={errorTarget === 'notes'} name="notes" value={form.notes} onChange={updateForm} rows="4" placeholder="Add shipment instructions" />
              {errorTarget === 'notes' && <small className="field-error">{error}</small>}
            </label>
            <div className="wizard-actions">
              <button className="btn btn-primary" disabled={busy} type="button" onClick={continueToMilestones}>
                {busy ? 'Checking name…' : 'Continue to Milestones'}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="wizard-section">
            <div className="section-heading">
              <div>
                <h3>Payment Milestones</h3>
                <p>Choose how much escrow is released at cargo pickup and final delivery.</p>
                <small>Due dates must be chronological and no later than the final deadline.</small>
              </div>
            </div>
            {milestones.map((milestone, index) => (
              <div className="milestone-editor" key={`milestone-${index}`}>
                <div className="section-heading">
                  <strong>Milestone {index + 1}</strong>
                  <span className="badge">{milestone.percentage || 0}% of escrow</span>
                </div>
                <div className="notice">
                  <strong>{milestone.name}</strong>
                  <p>{milestone.details}</p>
                </div>
                <label>
                  Escrow percentage
                  <input
                    aria-invalid={errorTarget === 'percentage'}
                    max="99"
                    min="1"
                    onChange={(event) => updatePercentage(index, event.target.value)}
                    step="1"
                    type="number"
                    value={milestone.percentage}
                  />
                  <small>Changing this value automatically sets milestone {index === 0 ? 2 : 1} to {100 - Number(milestone.percentage || 0)}%.</small>
                  {errorTarget === 'percentage' && index === 0 && <small className="field-error">{error}</small>}
                </label>
                <div>
                  {index === 1 && (
                    <label className="deadline-sync-control">
                      <input
                        checked={finalMilestoneFollowsDeadline}
                        onChange={toggleFinalMilestoneDeadline}
                        type="checkbox"
                      />
                      Use Final Delivery Deadline for Milestone 2
                    </label>
                  )}
                  <label>
                    Due date
                    <input
                      aria-invalid={errorTarget === `milestone-${index}`}
                      required
                      min={getMilestoneMinimum(index)}
                      max={form.deadline || undefined}
                      disabled={index === 1 && finalMilestoneFollowsDeadline}
                      step="60"
                      type="datetime-local"
                      value={milestone.dueAt}
                      onChange={(event) => updateMilestone(index, 'dueAt', event.target.value)}
                    />
                    <small>
                      {index === 0
                        ? 'Must be in the future and no later than the final deadline.'
                        : finalMilestoneFollowsDeadline
                          ? 'Automatically follows the Final Delivery Deadline.'
                          : `Must be later than milestone ${index} and no later than the final deadline.`}
                    </small>
                    {errorTarget === `milestone-${index}` && <small className="field-error">{error}</small>}
                  </label>
                </div>
              </div>
            ))}
            <div className="percentage-summary valid">
              <span>Total payout allocation</span>
              <strong>{milestones[0].percentage}% / {milestones[1].percentage}% · 100% total</strong>
            </div>
            <div className="wizard-actions">
              <button className="btn btn-secondary" type="button" onClick={() => moveToStep(1)}>Back to Details</button>
              <button className="btn btn-primary" disabled={busy} type="button" onClick={continueToReview}>
                {busy ? 'Checking agreement…' : 'Review Agreement'}
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="wizard-section">
            <div>
              <h3>Review & Fund</h3>
              <p>Check the final terms. MetaMask deposits the full escrow only after you confirm.</p>
            </div>
            <div className="review-grid">
              <div><small>Agreement</small><strong>{form.title}</strong></div>
              <div><small>Payload / escrow value</small><strong>{form.totalAmount} ETH</strong></div>
              <div><small>Carrier</small><code>{form.carrier}</code></div>
              <div>
                <small>Carrier reputation</small>
                <strong>
                  {selectedCarrier?.reputation === null || !selectedCarrier
                    ? 'Unavailable until redeployment'
                    : `${selectedCarrier.reputation.toString()} points · ${selectedCarrier.reputationTier}`}
                </strong>
              </div>
              <div><small>Final deadline</small><strong>{new Date(form.deadline).toLocaleString()}</strong></div>
            </div>
            <div className="review-milestones">
              {milestones.map((milestone, index) => (
                <div className="review-milestone" key={`review-${index}`}>
                  <span><strong>{index + 1}. {milestone.name}</strong><small>{milestone.details}</small></span>
                  <span><strong>{milestone.percentage}%</strong><small>{new Date(milestone.dueAt).toLocaleString()}</small></span>
                </div>
              ))}
            </div>
            <div className="notice">
              Milestone terms become immutable after confirmation. Creating this agreement requires exactly one MetaMask transaction.
            </div>
            <div className="wizard-actions">
              <button className="btn btn-secondary" type="button" onClick={() => moveToStep(2)}>Edit Milestones</button>
              <button className="btn btn-primary" disabled={busy || !isConfigured} type="submit">
                {busy ? 'Confirming transaction…' : `Fund & Create (${form.totalAmount || '0'} ETH)`}
              </button>
            </div>
          </section>
        )}
        {error && !errorTarget && <div className="notice error">{error}</div>}
      </form>
    </div>
  );
}

export default CreateAgreement;
